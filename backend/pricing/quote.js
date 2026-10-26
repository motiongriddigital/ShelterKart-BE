'use strict';
/**
 * ShelterKart -- the quote engine.
 *
 * The fee is set by the PROPERTY (its value, in dollars at the book's frozen
 * exchange rates) and by the evidence DEPTH of the report. It is the same in
 * dollars for every buyer. The buyer's country decides only the currency the
 * price is read in, the tax, and the payment route.
 *
 *   target_usd = clamp( S_ref x (V_usd / V_ref)^0.537 , floor, cap ) x depth
 *   price      = the rung of the buyer's currency ladder nearest to target_usd
 *
 * A quote is the price a buyer was shown, signed and locked for 30 minutes.
 * The checkout charges the quote's total and nothing else; the payment
 * provider's webhook may only CONFIRM a quote, never define a price.
 */
const crypto = require('crypto');
const { taxFor, taxProfileFor, saleStatus } = require('./data');

const DEPTH_LABEL = { gold: 'Gold standard', heavy: 'Heavy', thin: 'Thin' };

/** Evidence depth, decided by the evidence and never by the buyer. */
function depthOf(brief) {
  if (brief && brief.kind === 'dossier') return 'gold';   // the investigator's report is the deepest research we sell
  // The depth of a report is how much of it the public record corroborates, counted from its findings (no overall number):
  // Gold: at least three findings confirmed at an official source. Heavy: at least five findings confirmed or reported by
  // independent sites. Thin: anything less.
  const c = brief && brief.counts;
  if (!c) return 'thin';
  const official = c.confirmed != null ? c.confirmed : (c.verified || 0);   // the live research and the investigator name it differently
  if (official >= 3) return 'gold';
  if (official + (c.reported || 0) >= 5) return 'heavy';
  return 'thin';
}

/**
 * The property's listed price: the midpoint of price_from..price_to, used only if it is in a currency the book
 * has a rate for, is plausible in dollars, and a finding about price survived the evidence check.
 */
function propertyValueOf(data, brief) {
  const p = brief && brief.project; if (!p) return null;
  const from = Number(p.price_from), to = Number(p.price_to) || from, cur = p.price_currency;
  if (!(from > 0) || !(to >= from) || !data.book.fx.perUsd[cur]) return null;
  const mid = (from + to) / 2, usd = mid / data.book.fx.perUsd[cur];
  if (usd < 10000 || usd > 1e8) return null;
  if (brief.kind !== 'dossier' && !(brief.findings || []).some(f => f && f.topic === 'price')) return null;
  return { value: mid, currency: cur, from, to, usd };
}

const minorOf = (data, cur) => (data.currencies[cur] ? data.currencies[cur].minor : 2);
const toMinor = (data, major, cur) => Math.round(major * Math.pow(10, minorOf(data, cur)));
const toMajor = (data, minor, cur) => minor / Math.pow(10, minorOf(data, cur));

/** The target fee in dollars and the rung it lands on. Pure: the same inputs on the same book always agree. */
function feeFor(data, { propertyUsd, depth }) {
  const b = data.book, P = b.params;
  const base = propertyUsd == null ? P.refUsd : P.refUsd * Math.pow(propertyUsd / P.refPropertyUsd, P.exponent);
  const target = Math.min(P.capUsd, Math.max(P.floorUsd, base)) * (P.depth[depth] == null ? 1 : P.depth[depth]);
  let rung = 0, best = Infinity;
  b.rungsUsd.forEach((u, i) => { const d = Math.abs(u - target); if (d < best || (d === best && u > b.rungsUsd[rung])) { best = d; rung = i; } });
  return { targetUsd: Math.round(target * 100) / 100, rung, basis: propertyUsd == null ? 'reference' : 'property' };
}

/** The tax ShelterKart actually charges: only where it collects and remits it (we_collect). Below a threshold, unregistered,
 *  unverified or tax-free, nothing is charged -- a tax we may not collect is never added to a buyer's price. */
const chargedRate = profile => (profile && profile.mode === 'we_collect' ? profile.rate : 0);

/**
 * Split a ladder price into net, tax and gross, exactly, in the currency's smallest unit.
 * Tax-inclusive countries: the ladder price IS the gross. Tax-exclusive: the ladder price is the net and tax is added.
 * Always net + tax = gross.
 */
function splitTax(data, ladderMajor, currency, profile) {
  const rate = chargedRate(profile), inclusive = profile ? profile.inclusive : true;
  const price = toMinor(data, ladderMajor, currency);
  if (!(rate > 0)) return { netMinor: price, taxMinor: 0, grossMinor: price };
  if (inclusive) { const tax = Math.round(price - price / (1 + rate)); return { netMinor: price - tax, taxMinor: tax, grossMinor: price }; }
  const tax = Math.round(price * rate); return { netMinor: price, taxMinor: tax, grossMinor: price + tax };
}

/** What the free preview shows: the fee for the buyer's country, with nothing stored and nothing locked. */
function previewFee(data, brief, buyer, at = new Date()) {
  const pv = propertyValueOf(data, brief), depth = depthOf(brief), f = feeFor(data, { propertyUsd: pv ? pv.usd : null, depth });
  const cur = buyer.currency, profile = buyer.country ? taxProfileFor(data, buyer.country, at) : null;
  const t = splitTax(data, data.book.ladders[cur][f.rung], cur, profile);
  return {
    price: toMajor(data, t.grossMinor, cur), currency: cur, net: toMajor(data, t.netMinor, cur), tax: toMajor(data, t.taxMinor, cur),
    taxName: chargedRate(profile) > 0 ? profile.name : '', taxRateBps: Math.round(chargedRate(profile) * 10000), taxInclusive: profile ? profile.inclusive : true, taxBy: profile && profile.mode === 'merchant_of_record' ? 'merchant_of_record' : 'shelterkart',
    depth, depthLabel: DEPTH_LABEL[depth], basis: { kind: f.basis, property: pv ? { value: pv.value, currency: pv.currency, from: pv.from, to: pv.to } : null },
    buyer: { country: buyer.country, source: buyer.source, currency: cur, fallback: Boolean(buyer.fallback), wanted: buyer.wanted, onSale: buyer.onSale, reason: buyer.reason },
    priceBookVersion: data.book.version,
  };
}

const sigKey = (env) => env.QUOTE_SECRET || env.ACCESS_TOKEN_SECRET || '';
const signable = q => [q.id, q.ref, q.buyer.country, q.currency, q.grossMinor, q.taxMinor, q.priceBookVersion, q.issuedAt, q.expiresAt].join('|');
const sign = (q, env) => crypto.createHmac('sha256', sigKey(env)).update(signable(q)).digest('hex');
const safeEq = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

class PricingError extends Error { constructor(code, message, extra) { super(message); this.code = code; Object.assign(this, extra || {}); } }

/**
 * Issue a signed quote for this report and buyer. Any earlier open quote for the same report and session is superseded.
 * @throws PricingError country_required | not_on_sale
 */
async function issueQuote({ data, store, brief, buyer, session = 'anon', now = new Date(), supersedes = null, details = {} }) {
  if (!buyer.country) throw new PricingError('country_required', 'Choose your country to see your price.');
  if (!buyer.onSale) throw new PricingError('not_on_sale', 'Reports are not on sale in this country yet.', { reason: buyer.reason, country: buyer.country });
  const p = previewFee(data, brief, buyer, now), profile = taxProfileFor(data, buyer.country, now);
  const pv = propertyValueOf(data, brief), f = feeFor(data, { propertyUsd: pv ? pv.usd : null, depth: p.depth });
  const t = splitTax(data, data.book.ladders[buyer.currency][f.rung], buyer.currency, profile);
  const minutes = data.book.params.quoteMinutes || 30;
  const q = {
    id: 'q_' + crypto.randomBytes(10).toString('hex'), ref: brief.ref, session,
    buyer: { country: buyer.country, source: buyer.source, currency: buyer.currency, fallback: Boolean(buyer.fallback) },
    property: pv ? { value: pv.value, currency: pv.currency } : null,
    depth: p.depth, depthLabel: p.depthLabel, rung: f.rung, targetUsd: f.targetUsd, basis: f.basis,
    currency: buyer.currency, netMinor: t.netMinor, taxMinor: t.taxMinor, grossMinor: t.grossMinor,
    net: toMajor(data, t.netMinor, buyer.currency), tax: toMajor(data, t.taxMinor, buyer.currency), gross: toMajor(data, t.grossMinor, buyer.currency),
    taxName: p.taxName, taxRateBps: p.taxRateBps, taxInclusive: p.taxInclusive, taxBy: p.taxBy, taxMode: profile ? profile.mode : 'none',
    priceBookVersion: data.book.version, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + minutes * 60000).toISOString(),
    status: 'open', supersedes,
  };
  q.signature = sign(q, data.env);
  await store.supersedeOpen({ ref: q.ref, session: q.session, exceptId: q.id });
  await store.saveQuote(q);
  await store.addEvent('quote_issued', { quoteId: q.id, ref: q.ref, details: { country: q.buyer.country, source: q.buyer.source, currency: q.currency, grossMinor: q.grossMinor, targetUsd: q.targetUsd, ...details } });
  return q;
}

/** @returns {{ ok, reason? }}: reason is signature | expired | superseded | used */
function verifyQuote(q, env, now = new Date()) {
  if (!q || !q.signature || !safeEq(q.signature, sign(q, env))) return { ok: false, reason: 'signature' };
  if (q.status === 'superseded') return { ok: false, reason: 'superseded' };
  if (q.status === 'used') return { ok: false, reason: 'used' };
  if (now.getTime() > Date.parse(q.expiresAt)) return { ok: false, reason: 'expired' };
  return { ok: true };
}

/** The quote as the page needs it: amounts as numbers, never the signature. */
function publicQuote(q) {
  return { id: q.id, ref: q.ref, country: q.buyer.country, countrySource: q.buyer.source, currency: q.currency,
    net: q.net, tax: q.tax, gross: q.gross, taxName: q.taxName, taxRateBps: q.taxRateBps, taxInclusive: q.taxInclusive, taxBy: q.taxBy,
    depthLabel: q.depthLabel, priceBookVersion: q.priceBookVersion, issuedAt: q.issuedAt, expiresAt: q.expiresAt };   // the property's value is not sent to the page: the checkout shows only the report's own price
}

module.exports = { chargedRate, depthOf, propertyValueOf, feeFor, splitTax, previewFee, issueQuote, verifyQuote, publicQuote, sign, minorOf, toMinor, toMajor, PricingError, DEPTH_LABEL };
