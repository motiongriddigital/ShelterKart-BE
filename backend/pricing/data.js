'use strict';
/**
 * ShelterKart -- pricing data, and the rule for what is on sale.
 *
 * Everything that varies by country, currency or time is DATA (backend/data/*.json,
 * mirrored by the pricing_v2.sql tables). Adding a country is a data edit; turning
 * one on is a configuration change. Nothing in the code names a country.
 *
 * A country is ON SALE only if all of these hold:
 *   - it is not blocked (sanctions and the like);
 *   - it has a tax profile, and that profile is COMPLETE:
 *       no_tax / not_required_yet   complete (the sales ledger watches the threshold);
 *       we_collect                  complete once a registration number is configured;
 *       registration_required       NOT on sale until registered (or a Merchant of Record serves it);
 *       unverified                  NOT on sale until the tax adviser confirms and the profile is changed;
 *   - a payment route exists for its currency (foreign currencies need Razorpay's
 *     international payments confirmed active, or an approved Merchant of Record).
 *
 * Switching a country on: set the registration environment variable named in its tax
 * profile (for example UK_VAT_NO), or override the profile with TAX_PROFILES.
 */
const fs = require('fs'), path = require('path');
const DATA_DIR = path.join(__dirname, '..', 'data');

function readJson(dir, f) { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }

/** Load and index everything. `env` supplies overrides; `dir` lets tests point at fixtures. */
/** The Merchant of Record's products by currency: data/mor-products.json, overridden by env MOR_PRODUCTS (a JSON object). */
function loadMorProducts(env, dir) {
  let products = {};
  try { products = readJson(dir, 'mor-products.json').products || {}; } catch { /* no file: none mapped */ }
  if (env.MOR_PRODUCTS) { try { products = { ...products, ...JSON.parse(env.MOR_PRODUCTS) }; } catch { console.error('[pricing] MOR_PRODUCTS is not valid JSON; ignored.'); } }
  return Object.fromEntries(Object.entries(products).filter(([c, id]) => /^[A-Z]{3}$/.test(c) && typeof id === 'string' && id.trim()));
}

function load(env = process.env, dir = DATA_DIR) {
  const countries = new Map(readJson(dir, 'countries.json').map(c => [c.iso, c]));
  const baseTax = readJson(dir, 'tax-profiles.json');
  let overrides = {};
  if (env.TAX_PROFILES) { try { overrides = JSON.parse(env.TAX_PROFILES); } catch { console.error('[pricing] TAX_PROFILES is not valid JSON; ignored.'); } }
  const tax = {};
  for (const [id, p] of Object.entries(baseTax)) tax[id] = { ...p, ...(overrides[id] || {}) };
  for (const [id, p] of Object.entries(overrides)) if (!tax[id]) tax[id] = p;
  return {
    dir, env, countries, tax,
    currencies: readJson(dir, 'currencies.json'),
    routes: readJson(dir, 'payment-routes.json'),
    params: readJson(dir, 'price-params.json'),
    book: readJson(dir, 'price-book.json'),
    morProducts: loadMorProducts(env, dir),
  };
}

/** The tax profile for a country as it effectively stands now (a configured registration turns a profile into we_collect). */
function taxFor(data, iso, at = new Date()) {
  const c = data.countries.get(iso); if (!c || !c.tax) return null;
  let p = data.tax[c.tax]; if (!p) return null;
  // Versioned: a profile may carry `versions: [{ validFrom: 'YYYY-MM-DD', ...changed fields }]`; the latest one at or before `at` applies.
  if (Array.isArray(p.versions)) {
    const v = p.versions.filter(x => x.validFrom && Date.parse(x.validFrom) <= at.getTime()).sort((a, b) => Date.parse(a.validFrom) - Date.parse(b.validFrom)).pop();
    if (v) p = { ...p, ...v };
  }
  const registration = p.registration || (p.registrationEnv && data.env[p.registrationEnv]) || '';
  let mode = p.mode;
  if (registration && (mode === 'registration_required' || mode === 'not_required_yet')) mode = 'we_collect';     // registered: charge and remit
  return { id: c.tax, ...p, mode, registration, rate: (p.rateBps || 0) / 10000 };
}

const taxGateOff = env => env.TAX_GATE === 'off' && env.NODE_ENV !== 'production';          // for tests and local development only

const morConfigured = env => Boolean(env.DODO_API_KEY && env.DODO_WEBHOOK_KEY);

/** Which provider route serves this country and currency, or null. The Merchant of Record route serves a country only when it is
 *  enabled in the data, configured (API key and webhook key), has a product for that currency, and the country is not India. */
function routeFor(data, iso, currency) {
  const env = data.env;
  for (const r of data.routes) {
    if (!r.enabled) continue;
    if (!(r.countries.includes('*') || r.countries.includes(iso))) continue;
    if (!(r.currencies.includes('*') || r.currencies.includes(currency))) continue;
    if (r.provider === 'mor') {
      if (iso === 'IN' || !morConfigured(env) || !(data.morProducts || {})[currency]) continue;   // India keeps its own GST registration
      return r;
    }
    if (r.requiresInternational && currency !== 'INR' && !(env.RAZORPAY_INTERNATIONAL === 'true')) continue;   // international payments must be confirmed active
    return r;
  }
  return null;
}

/** The currencies a provider is configured to accept. For the Merchant of Record: those with a product AND a price ladder. */
function providerCurrencies(data, provider) {
  if (provider === 'mor') return new Set(Object.keys(data.morProducts || {}).filter(c => data.book.ladders[c]));
  if (provider === 'razorpay' && data.env.RAZORPAY_CURRENCIES) return new Set(data.env.RAZORPAY_CURRENCIES.split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
  return new Set(Object.keys(data.book.ladders));
}

/** True when the Merchant of Record route is active for this country (enabled, configured, not India). */
function morActive(data, iso) {
  return iso !== 'IN' && morConfigured(data.env) && (data.routes || []).some(r => r.provider === 'mor' && r.enabled && (r.countries.includes('*') || r.countries.includes(iso)));
}

/** The currency a buyer in this country is quoted in. It follows the route: a currency the provider cannot take falls back to USD. */
function quoteCurrency(data, iso, provider) {
  provider = provider || (morActive(data, iso) ? 'mor' : 'razorpay');
  const c = data.countries.get(iso); const want = c ? c.currency : 'USD';
  const ok = data.book.ladders[want] && providerCurrencies(data, provider).has(want);
  return { currency: ok ? want : 'USD', fallback: !ok && want !== 'USD', wanted: want };
}

/** True when the route that would serve this country is the Merchant of Record. */
function morServes(data, iso) {
  const route = routeFor(data, iso, quoteCurrency(data, iso).currency);
  return Boolean(route && route.provider === 'mor');
}

/** The tax profile the quote uses. Where the Merchant of Record serves the country it is the seller and collects any tax,
 *  so ShelterKart adds NONE of its own (even if the company later registers there): a buyer is never taxed twice. */
function taxProfileFor(data, iso, at = new Date()) {
  if (morServes(data, iso)) return { id: 'MOR', mode: 'merchant_of_record', name: '', rateBps: 0, rate: 0, inclusive: true, registration: null,
    note: 'The merchant of record calculates and collects any tax; it is included in the total.' };
  return taxFor(data, iso, at);
}

/** { onSale, reason, taxBy } for a country. `reason` is a stable code the page turns into words. `taxBy` says who collects the tax. */
function saleStatus(data, iso) {
  const c = data.countries.get(iso);
  if (!c) return { onSale: false, reason: 'unknown_country' };
  if (c.blocked) return { onSale: false, reason: 'blocked' };
  const q = quoteCurrency(data, iso);
  const route = routeFor(data, iso, q.currency);
  const viaMor = Boolean(route && route.provider === 'mor');
  if (!viaMor) {                                   // ShelterKart is the seller: its own tax rules apply
    const t = taxFor(data, iso);
    if (!t) return { onSale: false, reason: 'no_tax_profile' };
    if (!taxGateOff(data.env)) {
      if (t.mode === 'registration_required') return { onSale: false, reason: 'registration_required' };
      if (t.mode === 'unverified') return { onSale: false, reason: 'unverified' };
      if (t.mode === 'we_collect' && !t.registration) return { onSale: false, reason: 'registration_missing' };
    }
  }
  if (!route) return { onSale: false, reason: 'no_payment_route' };
  return { onSale: true, reason: '', taxBy: viaMor ? 'merchant_of_record' : 'shelterkart' };
}

/** Every rule the data must satisfy; returns a list of problems (empty = fine). Run at startup and in tests. */
function validate(data) {
  const problems = [];
  for (const [iso, c] of data.countries) {
    if (c.blocked) continue;
    if (!c.tax || !data.tax[c.tax]) problems.push(`${iso}: no tax profile`);
    if (!data.currencies[c.currency]) problems.push(`${iso}: currency ${c.currency} is not in currencies.json`);
    if (!data.book.fx.perUsd[c.currency]) problems.push(`${iso}: no exchange rate for ${c.currency}`);
  }
  for (const cur of Object.keys(data.currencies)) if (!data.book.ladders[cur]) problems.push(`${cur}: no ladder in the price book`);
  for (const [cur, l] of Object.entries(data.book.ladders)) if (l.length !== data.book.rungsUsd.length) problems.push(`${cur}: ladder has ${l.length} rungs, expected ${data.book.rungsUsd.length}`);
  for (const [cur] of Object.entries(data.morProducts || {})) if (!data.book.ladders[cur]) problems.push(`${cur}: a merchant product is mapped but the price book has no ladder for it`);
  for (const [id, t] of Object.entries(data.tax)) {
    if (!['we_collect', 'not_required_yet', 'registration_required', 'no_tax', 'unverified'].includes(t.mode)) problems.push(`${id}: unknown tax mode ${t.mode}`);
    if (t.mode === 'not_required_yet' && !(t.thresholds && t.thresholds.length)) problems.push(`${id}: not_required_yet needs a threshold to watch`);
  }
  return problems;
}

module.exports = { load, taxFor, taxProfileFor, routeFor, quoteCurrency, saleStatus, morServes, morActive, morConfigured, validate, providerCurrencies, taxGateOff, DATA_DIR };
