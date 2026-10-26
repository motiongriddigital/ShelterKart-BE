#!/usr/bin/env node
'use strict';
/**
 * Merchant of Record: sandbox checks. Run these with the provider's TEST credentials before going live. It refuses to run against live.
 *
 *   node tools/mor_sandbox_check.js
 *       checks the configuration, then opens one real TEST checkout per mapped currency (the cheapest price) and prints its address.
 *       Open each address, pay with the provider's test card, then run the next command for that payment.
 *   node tools/mor_sandbox_check.js --check-payment pay_XXXX --expect-minor 1500 --currency USD
 *       reads that payment from the provider and checks the three things the code depends on and no document can promise:
 *         1. the total charged equals the quote's total (so the product is tax-INCLUSIVE),
 *         2. the currency is the one expected,
 *         3. the session's metadata (purchase_id) comes back on the payment.
 * Needs DODO_API_KEY, DODO_WEBHOOK_KEY, DODO_MODE=test, and the product ids (data/mor-products.json or MOR_PRODUCTS).
 */
const path = require('path');
const root = path.join(__dirname, '..', 'backend');
const D = require(path.join(root, 'pricing', 'data.js')), P = require(path.join(root, 'pricing', 'quote.js')), M = require(path.join(root, 'engine', 'mor.js'));

async function run({ env = process.env, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  if (env.DODO_MODE === 'live') { log('Refusing to run against LIVE: this tool opens real checkout sessions. Set DODO_MODE=test.'); return { ok: false, problems: ['live mode'], sessions: [] }; }
  const problems = [];
  if (!M.configured(env)) problems.push('DODO_API_KEY and DODO_WEBHOOK_KEY must both be set');
  const data = D.load(env), products = data.morProducts;
  if (!products.USD) problems.push('There is no USD product: every currency without a product is quoted in US dollars, so USD must exist');
  for (const cur of Object.keys(products)) if (!data.book.ladders[cur]) problems.push(`${cur} has a product but the price book has no ${cur} ladder`);
  for (const p of D.validate(data)) problems.push('pricing data: ' + p);
  if (problems.length) { problems.forEach(p => log('PROBLEM  ' + p)); return { ok: false, problems, sessions: [] }; }
  const base = String(env.PUBLIC_BASE_URL || 'https://example.com').replace(/\/+$/, ''), sessions = [];
  for (const cur of Object.keys(products)) {
    const minor = P.toMinor(data, data.book.ladders[cur][0], cur);
    const quote = { id: 'q_sandbox0000000000000', ref: 'SK-SANDBOX', currency: cur, grossMinor: minor, buyer: { country: 'US' } };
    try {
      const s = await M.createCheckout({ quote, purchaseId: 'sandbox-' + cur, productId: products[cur], returnUrl: base + '/?sandbox=1', cancelUrl: base + '/' }, { env, fetchImpl });
      sessions.push({ currency: cur, amountMinor: minor, ...s }); log(`OK       ${cur} ${minor} (smallest unit): ${s.checkoutUrl}`);
    } catch (e) { problems.push(`${cur}: ${e.message}`); log(`PROBLEM  ${cur}: ${e.message}`); }
  }
  log(problems.length ? '\nFix the problems above, then run again.' : '\nNow pay each address with the provider\'s test card, then run: node tools/mor_sandbox_check.js --check-payment <payment id> --expect-minor <amount> --currency <code>');
  return { ok: problems.length === 0, problems, sessions };
}

async function checkPayment({ paymentId, expectMinor, currency, env = process.env, fetchImpl = globalThis.fetch, log = console.log }) {
  const pay = await M.getPayment(paymentId, { env, fetchImpl });
  const out = { status: pay.status, totalMinor: Number(pay.total_amount), taxMinor: Number(pay.tax || 0), currency: pay.currency, purchaseId: (pay.metadata || {}).purchase_id || null };
  const checks = [
    ['the payment succeeded', pay.status === 'succeeded'],
    [`the total charged (${out.totalMinor}) equals the quote's total (${expectMinor}): the product is tax-inclusive`, out.totalMinor === Number(expectMinor)],
    [`the currency is ${currency}`, out.currency === currency],
    ['the session metadata (purchase_id) came back on the payment', Boolean(out.purchaseId)],
  ];
  checks.forEach(([label, ok]) => log((ok ? 'PASS  ' : 'FAIL  ') + label));
  if (out.totalMinor !== Number(expectMinor) && out.taxMinor > 0) log(`      The merchant added ${out.taxMinor} of tax on top. Make the product tax-INCLUSIVE in the provider's dashboard.`);
  if (!out.purchaseId) log('      No metadata: the buyer\'s return still settles the purchase (the server checks the payment itself), but ask the provider whether session metadata is copied to the payment.');
  return { ok: checks.every(c => c[1]), out };
}
module.exports = { run, checkPayment };

if (require.main === module) (async () => {
  const a = process.argv, arg = n => { const i = a.indexOf(n); return i > -1 ? a[i + 1] : null; };
  const r = arg('--check-payment') ? await checkPayment({ paymentId: arg('--check-payment'), expectMinor: arg('--expect-minor'), currency: arg('--currency') }) : await run();
  process.exit(r.ok ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
