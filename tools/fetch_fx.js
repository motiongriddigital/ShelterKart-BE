#!/usr/bin/env node
'use strict';
/**
 * Fetch the official ECB euro reference rates and write a CANDIDATE exchange-rate snapshot for review. It never overwrites
 * backend/data/fx-snapshot.json: a price book freezes the rates it was generated from, so a new snapshot is a pricing decision.
 *
 *   node tools/fetch_fx.js                 write backend/data/fx-snapshot.next.json and print what changed
 *
 * The ECB publishes daily reference rates (EUR 1 = x foreign units) for about thirty currencies, including MYR, ZAR, BRL, MXN, JPY,
 * THB and PHP. It does not publish the Gulf currencies, which are fixed to the US dollar (official pegs, applied here), or TWD, which
 * is carried over from the previous snapshot and listed as "carried" so a person can replace it.
 *
 * To release the new rates: review the candidate, copy it over fx-snapshot.json, then
 *   node tools/build_price_book.js --version <next> --fx fx-snapshot.json
 * (the release guardrails apply: margin, corridor, drift, and the 15% step limit against the active book).
 * To add a LOCAL ladder for a market that is quoted in US dollars today (Malaysia, South Africa, Brazil, Mexico, Japan, Thailand,
 * Philippines): add the currency to backend/data/currencies.json ({"minor":2,"fine":false}; JPY is {"minor":0,"fine":false}),
 * set that country's "currency" in backend/data/countries.json, release the book, and create the merchant product for it.
 */
const fs = require('fs'), path = require('path');
const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const PEGS = { AED: 3.6725, SAR: 3.75, QAR: 3.64, BHD: 0.376, OMR: 0.3845 };   // official fixed rates per US dollar

function parseEcb(xml) {
  const date = (String(xml).match(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/) || [])[1];
  const rates = { EUR: 1 };
  for (const m of String(xml).matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g)) rates[m[1]] = Number(m[2]);
  if (!date || !(rates.USD > 0)) throw new Error('This is not an ECB euro reference-rate file.');
  return { date, rates };
}
const r6 = x => Math.round(x * 1e6) / 1e6;
/** Units of each currency per US dollar, from the euro rates; pegs applied; anything the ECB does not publish is carried over. */
function buildSnapshot({ date, rates }, previous = { perUsd: {} }) {
  const perUsd = { USD: 1 }, carried = [];
  for (const [cur, v] of Object.entries(rates)) if (cur !== 'USD') perUsd[cur] = r6(v / rates.USD);
  for (const [cur, v] of Object.entries(PEGS)) perUsd[cur] = v;
  for (const [cur, v] of Object.entries(previous.perUsd || {})) if (!(cur in perUsd)) { perUsd[cur] = v; carried.push(cur); }
  return { asOf: date, source: `ECB euro foreign exchange reference rates of ${date}; Gulf currencies at their official pegs to the US dollar`, indicative: true, carried, perUsd };
}
module.exports = { parseEcb, buildSnapshot, PEGS, ECB_URL };

if (require.main === module) (async () => {
  const D = path.join(__dirname, '..', 'backend', 'data');
  const previous = JSON.parse(fs.readFileSync(path.join(D, 'fx-snapshot.json'), 'utf8'));
  const res = await fetch(ECB_URL); if (!res.ok) { console.error('The ECB did not answer: ' + res.status); process.exit(1); }
  const snap = buildSnapshot(parseEcb(await res.text()), previous);
  fs.writeFileSync(path.join(D, 'fx-snapshot.next.json'), JSON.stringify(snap, null, 2) + '\n');
  console.log(`candidate snapshot of ${snap.asOf} written to backend/data/fx-snapshot.next.json (${Object.keys(snap.perUsd).length} currencies)`);
  if (snap.carried.length) console.log('carried over from the previous snapshot (the ECB does not publish them): ' + snap.carried.join(', ') + '. Replace them from another official source.');
  const moved = Object.keys(previous.perUsd).filter(c => snap.perUsd[c] && Math.abs(snap.perUsd[c] / previous.perUsd[c] - 1) > 0.15).map(c => `${c} ${((snap.perUsd[c] / previous.perUsd[c] - 1) * 100).toFixed(0)}%`);
  console.log(moved.length ? 'moved by more than 15% since the active snapshot (the release step limit will stop a price release): ' + moved.join(', ') : 'no currency has moved by more than 15% since the active snapshot');
})();
