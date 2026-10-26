'use strict';
/**
 * Market coverage: every market the site lists must be priced and taxed. A market with no price, no tax profile or no
 * currency ladder cannot be sold, so it fails here rather than at checkout.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { MARKETS } = require('../engine/markets.js');
const D = require('../pricing/data.js');
const data = D.load({});
const book = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'price-book.json'), 'utf8'));
const iso = (m, key) => String(m.registry || key).toUpperCase();
let passed = 0, failed = 0;
function t(name, fn) { try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const markets = Object.keys(MARKETS).map(k => ({ key: k, ...MARKETS[k], iso: iso(MARKETS[k], k) }));
t(`all ${markets.length} listed markets are in the pricing data`, () => {
  const missing = markets.filter(m => !data.countries.has(m.iso)).map(m => `${m.key} (${m.label})`);
  assert.deepStrictEqual(missing, [], 'markets with no pricing entry: ' + missing.join(', '));
});
t('every listed market has a tax profile', () => {
  const missing = markets.filter(m => !D.taxFor(data, m.iso)).map(m => `${m.key} (${m.label})`);
  assert.deepStrictEqual(missing, [], 'markets with no tax profile: ' + missing.join(', '));
});
t('every listed market is quoted in a currency the price book has a ladder for (its own, or US dollars as the fallback)', () => {
  const bad = markets.filter(m => data.countries.has(m.iso)).filter(m => !book.ladders[D.quoteCurrency(data, m.iso).currency]).map(m => m.key);
  assert.deepStrictEqual(bad, [], 'markets quoted in a currency with no ladder: ' + bad.join(', '));
});
t('a market whose own currency has no ladder is quoted in US dollars, and says so', () => {
  const fall = markets.filter(m => data.countries.has(m.iso) && D.quoteCurrency(data, m.iso).fallback);
  for (const m of fall) assert.strictEqual(D.quoteCurrency(data, m.iso).currency, 'USD', m.key);
});
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
