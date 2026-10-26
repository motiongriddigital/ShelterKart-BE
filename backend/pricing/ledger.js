'use strict';
/**
 * ShelterKart -- the tax exposure ledger.
 *
 * Where no registration is required yet (a country's threshold has not been reached), sales may open --
 * but only if someone is WATCHING the threshold. This ledger sums twelve months of sales per country, measures
 * them against each country's threshold, and raises an alert at 70% and 90%. At 100% the country stops selling
 * until its registration is configured (it then becomes a we_collect profile and sells again, charging tax).
 *
 * A threshold may be measured on that country's sales or on WORLDWIDE sales (Switzerland, Singapore): the
 * ledger handles both, and a profile may need ALL of its thresholds reached ('all') or ANY of them ('any').
 */
const { taxFor } = require('./data');

const ym = d => d.toISOString().slice(0, 7);
/** The first month of the rolling twelve-month window ending at `now`. */
function windowStart(now) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)); return ym(d); }

async function recordSale({ data, store, country, grossMinor, taxMinor, currency, now = new Date() }) {
  const m = Math.pow(10, data.currencies[currency] ? data.currencies[currency].minor : 2);
  await store.addSale({ country, month: ym(now), gross: grossMinor / m, tax: taxMinor / m, currency });
}
async function recordRefund({ data, store, country, grossMinor, taxMinor, currency, now = new Date() }) {
  await recordSale({ data, store, country, grossMinor: -grossMinor, taxMinor: -taxMinor, currency, now });
}

const toUsd = (data, amount, cur) => amount / data.book.fx.perUsd[cur];
const fromUsd = (data, usd, cur) => usd * data.book.fx.perUsd[cur];

/** Twelve-month progress toward each country's registration threshold. */
async function progress({ data, store, now = new Date() }) {
  const rows = await store.salesSince(windowStart(now));
  const usdBy = {}; let usdAll = 0;
  for (const r of rows) { const u = toUsd(data, r.gross, r.currency); usdBy[r.country] = (usdBy[r.country] || 0) + u; usdAll += u; }
  const out = [];
  for (const [iso, c] of data.countries) {
    const t = taxFor(data, iso); if (!t || !t.thresholds || !t.thresholds.length) continue;
    const parts = t.thresholds.map(th => {
      const sales = fromUsd(data, th.basis === 'worldwide' ? usdAll : (usdBy[iso] || 0), th.currency);
      return { amount: th.amount, currency: th.currency, basis: th.basis, sales: Math.round(sales), pct: sales / th.amount };
    });
    const pct = (t.thresholdMode === 'all' ? Math.min : Math.max)(...parts.map(p => p.pct));
    const registered = t.mode === 'we_collect';
    const level = registered ? 'registered' : pct >= 1 ? 'reached' : pct >= 0.9 ? 'alert' : pct >= 0.7 ? 'watch' : 'ok';
    out.push({ country: iso, name: c.name, thresholds: parts, pct, level, registered, mode: t.mode });
  }
  return out;
}

/** Records and reports each alert once per level. @returns the alerts that are NEW. */
async function checkThresholds({ data, store, now = new Date(), notify = async () => {} }) {
  const prog = await progress({ data, store, now });
  const seen = await store.listEvents({ type: 'tax_threshold' });
  const fresh = [];
  for (const p of prog) {
    if (!['watch', 'alert', 'reached'].includes(p.level)) continue;
    if (seen.some(e => e.details.country === p.country && e.details.level === p.level && e.at >= windowStart(now))) continue;
    const a = { country: p.country, name: p.name, level: p.level, pct: Math.round(p.pct * 100) };
    await store.addEvent('tax_threshold', { details: a }); fresh.push(a);
    await notify(a);
  }
  return fresh;
}

/** True when a not-yet-registered country has reached its threshold: it must stop selling until registration is configured. */
async function thresholdReached({ data, store, country, now = new Date() }) {
  const t = taxFor(data, country);
  if (!t || t.mode !== 'not_required_yet') return false;
  const p = (await progress({ data, store, now })).find(x => x.country === country);
  return Boolean(p && p.level === 'reached');
}

module.exports = { recordSale, recordRefund, progress, checkThresholds, thresholdReached, windowStart, ym };
