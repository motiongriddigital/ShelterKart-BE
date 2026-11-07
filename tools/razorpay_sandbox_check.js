#!/usr/bin/env node
'use strict';
/**
 * Razorpay: sandbox checks. Run these with Razorpay TEST keys (rzp_test_...) before going live. It refuses live keys.
 *
 *   node tools/razorpay_sandbox_check.js [--currency INR,USD,AED]
 *       opens one TEST order per currency (default: INR, plus RAZORPAY_CURRENCIES when RAZORPAY_INTERNATIONAL=true) and prints the order ids.
 *       Pay each order from the checkout page with a Razorpay test card, then run the next command.
 *   node tools/razorpay_sandbox_check.js --check-order order_XXXX --expect-sub 49900 --currency INR
 *       reads the payments made on that order and checks what the server depends on: a payment for exactly that amount in that currency,
 *       captured (or authorized, which the server captures), and what Razorpay says about card origin and fee.
 * Needs RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET. International currencies also need International Payments activated on the account.
 */
const path = require('path');
const R = require(path.join(__dirname, '..', 'backend', 'engine', 'razorpay.js'));

const currenciesOf = (env, asked) => {
  if (asked) return asked.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const list = ['INR'];
  if (env.RAZORPAY_INTERNATIONAL === 'true') for (const c of String(env.RAZORPAY_CURRENCIES || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)) if (!list.includes(c)) list.push(c);
  return list;
};
const SAMPLE = { INR: 499, JPY: 1500, KWD: 5.5 };

async function run({ env = process.env, fetchImpl = globalThis.fetch, log = console.log, currencies } = {}) {
  const problems = [];
  if (!R.configured(env)) problems.push('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must both be set');
  else if (!/^rzp_test_/.test(env.RAZORPAY_KEY_ID)) problems.push('Refusing to run: the key id is not a TEST key (rzp_test_...). This tool opens real orders.');
  if (problems.length) { problems.forEach(p => log('PROBLEM  ' + p)); return { ok: false, problems, orders: [] }; }
  const orders = [];
  for (const cur of currenciesOf(env, currencies)) {
    try {
      const amount = SAMPLE[cur] || 5;
      const o = await R.createOrder({ amount, currency: cur, purchaseId: 'sandbox-' + cur, ref: 'SK-SANDBOX' }, { env, fetchImpl });
      orders.push({ currency: cur, ...o }); log(`OK       ${cur} ${o.amountSubunits} (smallest unit): ${o.orderId}`);
    } catch (e) { problems.push(`${cur}: ${e.message}`); log(`PROBLEM  ${cur}: ${e.message}`); }
  }
  log(problems.length ? '\nFix the problems above (a foreign currency needs International Payments activated in the dashboard), then run again.'
    : '\nPay each order with a Razorpay test card, then run: node tools/razorpay_sandbox_check.js --check-order <order id> --expect-sub <amount> --currency <code>');
  return { ok: problems.length === 0, problems, orders };
}

async function checkOrder({ orderId, expectSub, currency, env = process.env, fetchImpl = globalThis.fetch, log = console.log }) {
  const items = await R.fetchOrderPayments(orderId, { env, fetchImpl });
  const m = R.matchPayment(items, { amountSubunits: Number(expectSub), currency });
  const p = (m && m.payment) || items[0] || {};
  const checks = [
    [`a payment exists on ${orderId}`, items.length > 0],
    [`one is for exactly ${expectSub} in ${currency}`, Boolean(m)],
    ['it is captured (an authorized one is captured by the server)', Boolean(m)],
  ];
  checks.forEach(([label, ok]) => log((ok ? 'PASS  ' : 'FAIL  ') + label));
  log(`      method ${p.method || 'n/a'}, international ${p.international === undefined ? 'n/a' : p.international}, fee ${p.fee == null ? 'n/a' : p.fee}, status ${p.status || 'n/a'}`);
  if (m && m.needsCapture) log('      The payment is only authorized. Either turn on automatic capture in the dashboard, or rely on the server: it captures on payment.authorized.');
  if (currency !== 'INR' && p.fee != null) log('      A foreign-currency fee settles in rupees at Razorpay\'s rate: reconcile it from the settlement report, not from this number.');
  return { ok: checks.every(c => c[1]), payment: p, needsCapture: Boolean(m && m.needsCapture) };
}

module.exports = { run, checkOrder, currenciesOf };

if (require.main === module) (async () => {
  const a = process.argv, arg = n => { const i = a.indexOf(n); return i > -1 ? a[i + 1] : null; };
  const r = arg('--check-order') ? await checkOrder({ orderId: arg('--check-order'), expectSub: arg('--expect-sub'), currency: arg('--currency') }) : await run({ currencies: arg('--currency') });
  process.exitCode = r.ok ? 0 : 1;
})().catch(e => { console.error(e.message); process.exit(1); });
