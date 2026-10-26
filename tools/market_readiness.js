#!/usr/bin/env node
'use strict';
/**
 * Market readiness: for every market the site lists, whether a buyer could pay there, TODAY and ONCE THE MERCHANT IS LIVE.
 * Generated from the data, so it cannot drift from it.   node tools/market_readiness.js [out.md]
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const { MARKETS } = require(path.join(root, 'backend', 'engine', 'markets.js'));
const D = require(path.join(root, 'backend', 'pricing', 'data.js'));
const book = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'data', 'price-book.json'), 'utf8'));
const fx = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'data', 'fx-snapshot.json'), 'utf8'));
const MERCHANT = { DODO_API_KEY: 'k', DODO_WEBHOOK_KEY: 'whsec_QUJD' };
const iso = (m, k) => String(m.registry || k).toUpperCase();

function rows(env, products) {
  const data = D.load(env); if (products) data.morProducts = products;
  return Object.keys(MARKETS).map(k => {
    const m = MARKETS[k], code = iso(m, k), c = data.countries.get(code);
    const s = c ? D.saleStatus(data, code) : { onSale: false, reason: 'not_in_pricing_data' };
    const q = c ? D.quoteCurrency(data, code) : { currency: '' };
    return { label: m.label, code, onSale: s.onSale, reason: s.onSale ? '' : s.reason, taxBy: s.taxBy || '', currency: q.currency };
  });
}
const summary = r => { const by = {}; r.filter(x => !x.onSale).forEach(x => { by[x.reason] = (by[x.reason] || 0) + 1; }); return `${r.filter(x => x.onSale).length} of ${r.length} can take a payment. ${Object.keys(by).length ? 'Not on sale: ' + Object.entries(by).map(([k, n]) => `${k.replace(/_/g, ' ')} ${n}`).join('; ') + '.' : ''}`; };
const today = rows({}), live = rows({ ...MERCHANT }, { USD: 'pdt_usd' }), liveInd = rows({ ...MERCHANT, GSTIN: '27ABCDE1234F1Z5' }, { USD: 'pdt_usd', INR: 'pdt_inr' });
const md = [
  '# ShelterKart: market readiness', '',
  `Generated from the data on ${new Date().toISOString().slice(0, 10)}. Price book ${book.version} (exchange rates of ${fx.asOf}).`, '',
  '## Today', summary(today), '',
  '## Once the Merchant of Record is live (keys set, a USD product mapped)', summary(live), '',
  '## ...and India live too (GSTIN set, Razorpay keys set)', summary(liveInd), '',
  'The merchant opens every market except India, quoted in US dollars until a local-currency product (and ladder) exists. India opens only with the company\'s GST number and Razorpay.', '',
  '| Market | Code | Today | Once the merchant is live | Charged in | Tax collected by |', '|---|---|---|---|---|---|',
  ...today.map((r, i) => `| ${r.label} | ${r.code} | ${r.onSale ? 'on sale' : r.reason.replace(/_/g, ' ')} | ${live[i].onSale ? 'on sale' : live[i].reason.replace(/_/g, ' ')} | ${live[i].currency || '-'} | ${live[i].taxBy ? live[i].taxBy.replace(/_/g, ' ') : '-'} |`), ''
].join('\n');
const out = process.argv[2]; if (out) { fs.writeFileSync(out, md); console.log('wrote ' + out); } else console.log(md);
console.log('today: ' + summary(today)); console.log('merchant live: ' + summary(live));
