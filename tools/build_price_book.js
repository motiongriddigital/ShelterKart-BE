#!/usr/bin/env node
'use strict';
/**
 * Generate the next price book, run the four guardrails, and (only if they pass) write it.
 *
 *   node tools/build_price_book.js                 generate backend/data/price-book.json from price-params.json and fx-snapshot.json
 *   node tools/build_price_book.js --version 2026-11.1 --fx new-rates.json     release a new version at new reference rates
 *   node tools/build_price_book.js --check-drift new-rates.json                 does the ACTIVE book still hold at today's rates? exit 1 if not
 *   node tools/build_price_book.js --dry-run       run the guardrails and print the report; write nothing
 *
 * Prices change only through this script. A failing guardrail blocks the release and says exactly why.
 */
const fs = require('fs'), path = require('path');
const D = path.join(__dirname, '..', 'backend', 'data');
const { generateBook, checkGuardrails } = require(path.join(__dirname, '..', 'backend', 'pricing', 'release.js'));
const read = f => JSON.parse(fs.readFileSync(path.isAbsolute(f) ? f : path.join(D, f), 'utf8'));
const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const has = n => process.argv.includes(n);

const params = read('price-params.json'), currencies = read('currencies.json'), taxes = read('tax-profiles.json');
const maxTaxRate = Math.max(...Object.values(taxes).map(t => t.rateBps)) / 10000;
const active = fs.existsSync(path.join(D, 'price-book.json')) ? read('price-book.json') : null;

if (has('--check-drift')) {
  const fx = read(arg('--check-drift'));
  const r = checkGuardrails(active, { guardrails: params.guardrails, maxTaxRate, currentFx: fx.perUsd });
  console.log(`active book ${active.version} at the rates of ${fx.asOf}: ` + (r.ok ? 'every price point is within the release band' : 'DRIFT'));
  for (const f of r.failures) console.log('  - ' + f.rule + ': ' + f.detail);
  if (!r.ok) console.log('A new price book should be released: node tools/build_price_book.js --version <next> --fx ' + arg('--check-drift'));
  process.exit(r.ok ? 0 : 1);
}

const fx = read(arg('--fx') || 'fx-snapshot.json');
const version = arg('--version') || (active ? active.version : '2026-10.1');
const book = generateBook({ params, fx, currencies, version });
// A release may carry one recorded exception to the step limit (params.stepExceptions[version]); it applies to that version only.
const exception = (params.stepExceptions || {})[version] || null;
const guardrails = exception ? { ...params.guardrails, maxStepPct: exception.maxStepPct } : params.guardrails;
const result = checkGuardrails(book, { guardrails, maxTaxRate, previous: active && active.version !== version ? active : null });
if (exception) console.log(`step exception for ${version}: up to ${(exception.maxStepPct * 100).toFixed(0)}% per price point. Reason: ${exception.reason}`);
console.log(`price book ${version} from the rates of ${fx.asOf}: ${book.rungsUsd.length} rungs, ${Object.keys(book.ladders).length} currencies`);
console.log('guardrails:', JSON.stringify(result.report));
for (const f of result.failures) console.log('  FAIL ' + f.rule + ': ' + f.detail);
if (!result.ok) { console.error('\nRELEASE BLOCKED: the book breaks ' + new Set(result.failures.map(f => f.rule)).size + ' guardrail(s).'); process.exit(1); }
book.guardrails = result.report;
if (!has('--dry-run')) {
  if (active && active.version !== version) fs.writeFileSync(path.join(D, `price-book.${active.version}.json`), JSON.stringify({ ...active, status: 'retired' }, null, 1) + '\n');   // a retired book stays readable forever
  fs.writeFileSync(path.join(D, 'price-book.json'), JSON.stringify(book, null, 1) + '\n');
  console.log('written: backend/data/price-book.json');
}
