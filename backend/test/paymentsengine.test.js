'use strict';
/** The payment engines: Razorpay's new calls and events, and the webhook claim. No network, no database. */
const assert = require('assert');
const rzp = require('../engine/razorpay');
const { claimEvent, finishEvent, retrySeconds } = require('../payments/events');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } }

const env = { RAZORPAY_KEY_ID: 'rzp_test_id', RAZORPAY_KEY_SECRET: 'super_secret_value' };
const reply = (data, status = 200) => ({ ok: status < 300, status, json: async () => data });
const seen = [];
const fakeFetch = routes => async (url, o = {}) => { seen.push({ url, method: o.method, body: o.body, headers: o.headers }); const r = routes(url, o); return r; };

(async () => {
  console.log('webhook events');
  await t('authorized, failed and refund events are understood', () => {
    const pay = (event, extra = {}) => ({ event, payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 5000, currency: 'USD', ...extra } } } });
    assert.deepStrictEqual(rzp.parseWebhook(pay('payment.authorized')), { kind: 'payment.authorized', orderId: 'order_1', paymentId: 'pay_1', amountSubunits: 5000, currency: 'USD' });
    const f = rzp.parseWebhook(pay('payment.failed', { error_code: 'E1', error_reason: 'declined' }));
    assert.deepStrictEqual([f.kind, f.errorCode, f.errorReason, f.paymentId], ['payment.failed', 'E1', 'declined', 'pay_1']);
    const r = rzp.parseWebhook({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', amount: 100, currency: 'USD', status: 'processed' } } } });
    assert.deepStrictEqual([r.kind, r.refundId, r.paymentId, r.amountSubunits, r.status], ['refund.processed', 'rfnd_1', 'pay_1', 100, 'processed']);
    assert.strictEqual(rzp.parseWebhook({ event: 'refund.speed_changed', payload: {} }), null);
    assert.strictEqual(rzp.parseWebhook({ event: 'payment.authorized', payload: {} }), null);
  });
  await t('an international payment keeps its flag and fee for the records', () => {
    const p = rzp.parseWebhook({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_9', order_id: 'order_9', amount: 9900, currency: 'AED', fee: 330, international: true, method: 'card' } } } });
    assert.deepStrictEqual([p.international, p.feeSubunits, p.currency, p.method], [true, 330, 'AED', 'card']);
  });

  console.log('matching the payment that settles an order');
  await t('only the exact amount in the exact currency matches, captured before authorized', () => {
    const want = { amountSubunits: 5000, currency: 'USD' };
    assert.strictEqual(rzp.matchPayment([], want), null);
    assert.strictEqual(rzp.matchPayment([{ id: 'pay_a', amount: 4999, currency: 'USD', status: 'captured' }], want), null);
    assert.strictEqual(rzp.matchPayment([{ id: 'pay_a', amount: 5000, currency: 'EUR', status: 'captured' }], want), null);
    assert.strictEqual(rzp.matchPayment([{ id: 'pay_a', amount: 5000, currency: 'USD', status: 'failed' }, { id: 'pay_b', amount: 5000, currency: 'USD', status: 'created' }], want), null);
    assert.strictEqual(rzp.matchPayment([{ id: 'not-an-id', amount: 5000, currency: 'USD', status: 'captured' }], want), null);
    const both = rzp.matchPayment([{ id: 'pay_a', amount: 5000, currency: 'USD', status: 'authorized' }, { id: 'pay_b', amount: 5000, currency: 'USD', status: 'captured' }], want);
    assert.deepStrictEqual([both.payment.id, both.needsCapture], ['pay_b', false]);
    const auth = rzp.matchPayment([{ id: 'pay_a', amount: 5000, currency: 'USD', status: 'authorized' }], want);
    assert.deepStrictEqual([auth.payment.id, auth.needsCapture], ['pay_a', true]);
  });

  console.log('the API calls');
  await t('fetching an order’s payments uses Basic auth, validates the id and returns the items', async () => {
    seen.length = 0;
    const items = await rzp.fetchOrderPayments('order_abc', { env, fetchImpl: fakeFetch(() => reply({ items: [{ id: 'pay_1' }] })) });
    assert.deepStrictEqual(items, [{ id: 'pay_1' }]);
    assert.strictEqual(seen[0].url, 'https://api.razorpay.com/v1/orders/order_abc/payments');
    assert.strictEqual(seen[0].headers.authorization, 'Basic ' + Buffer.from('rzp_test_id:super_secret_value').toString('base64'));
    await assert.rejects(() => rzp.fetchOrderPayments('../x', { env, fetchImpl: fakeFetch(() => reply({})) }), /invalid order id/);
    await assert.rejects(() => rzp.fetchPayment('pay_1/../../x', { env, fetchImpl: fakeFetch(() => reply({})) }), /invalid payment id/);
  });
  await t('capture sends the full amount and currency and checks the answer', async () => {
    seen.length = 0;
    const ok = await rzp.capturePayment({ paymentId: 'pay_1', amountSubunits: 5000, currency: 'USD' }, { env, fetchImpl: fakeFetch(() => reply({ id: 'pay_1', status: 'captured', amount: 5000 })) });
    assert.deepStrictEqual(ok, { paymentId: 'pay_1', status: 'captured', amountSubunits: 5000 });
    assert.deepStrictEqual(JSON.parse(seen[0].body), { amount: 5000, currency: 'USD' });
    await assert.rejects(() => rzp.capturePayment({ paymentId: 'pay_1', amountSubunits: 5000, currency: 'USD' }, { env, fetchImpl: fakeFetch(() => reply({ id: 'pay_1', status: 'captured', amount: 4000 })) }), /did not match/);
    await assert.rejects(() => rzp.capturePayment({ paymentId: 'pay_1', amountSubunits: 5000, currency: 'USD' }, { env, fetchImpl: fakeFetch(() => reply({ id: 'pay_2', status: 'captured', amount: 5000 })) }), /did not match/);
  });
  await t('an API error carries the status and Razorpay’s own code, never the key', async () => {
    let err;
    try { await rzp.capturePayment({ paymentId: 'pay_1', amountSubunits: 5000, currency: 'USD' }, { env, fetchImpl: fakeFetch(() => reply({ error: { code: 'BAD_REQUEST_ERROR', description: 'already captured' } }, 400)) }); } catch (e) { err = e; }
    assert.strictEqual(err.status, 400); assert.deepStrictEqual(err.detail, { code: 'BAD_REQUEST_ERROR', description: 'already captured' });
    assert(!JSON.stringify([err.message, err.detail]).includes('super_secret_value'));
    await assert.rejects(() => rzp.fetchPayment('pay_1', { env: {}, fetchImpl: fakeFetch(() => reply({})) }), /not configured/);
  });
  await t('a zero-decimal and a three-decimal currency convert as Razorpay documents', () => {
    assert.deepStrictEqual([rzp.toSubunits(1500, 'JPY'), rzp.toSubunits(10.5, 'KWD'), rzp.toSubunits(499.99, 'USD')], [1500, 10500, 49999]);
  });

  console.log('the webhook claim');
  const fakeDb = (rows) => { const calls = []; return { calls, query: async (sql, params) => { calls.push({ sql, params }); return { rows: typeof rows === 'function' ? rows(sql, params) : rows }; } }; };
  await t('a claimed event returns its row id; no row means someone already has it', async () => {
    assert.deepStrictEqual(await claimEvent(fakeDb([{ id: 7 }]), 'mor', 'wh_1', 'hash'), { claimed: true, id: 7 });
    assert.deepStrictEqual(await claimEvent(fakeDb([]), 'razorpay', 'pay_1:payment.captured', 'hash'), { claimed: false, id: null });
  });
  await t('the provider is a fixed word in the SQL, the rest are parameters', async () => {
    const db = fakeDb([{ id: 1 }]); await claimEvent(db, 'razorpay', "x'; DROP TABLE", 'h', { PAYMENT_EVENT_RETRY_SECONDS: '5' });
    assert(/VALUES \('razorpay', \$1, \$2/.test(db.calls[0].sql)); assert.deepStrictEqual(db.calls[0].params, ["x'; DROP TABLE", 'h', 5]);
    await assert.rejects(() => claimEvent(db, "razorpay'; --", 'e', 'h'), /unknown payment provider/);
  });
  await t('the retry window defaults to 20 seconds and accepts 0', () => { assert.deepStrictEqual([retrySeconds({}), retrySeconds({ PAYMENT_EVENT_RETRY_SECONDS: '0' }), retrySeconds({ PAYMENT_EVENT_RETRY_SECONDS: 'x' }), retrySeconds({ PAYMENT_EVENT_RETRY_SECONDS: '-1' })], [20, 0, 20, 20]); });
  await t('only a final status can be written', async () => {
    const db = fakeDb([]); await finishEvent(db, 3, 'processed');
    assert.deepStrictEqual(db.calls[0].params, [3, 'processed']);
    await assert.rejects(() => finishEvent(db, 3, 'received'), /not a final status/);
  });

  console.log('the sandbox tool');
  const tool = require('../../tools/razorpay_sandbox_check');
  await t('it refuses a live key and opens nothing', async () => {
    const lines = []; seen.length = 0;
    const r = await tool.run({ env: { RAZORPAY_KEY_ID: 'rzp_live_x', RAZORPAY_KEY_SECRET: 's' }, fetchImpl: fakeFetch(() => reply({})), log: l => lines.push(l) });
    assert.strictEqual(r.ok, false); assert.strictEqual(seen.length, 0); assert(/not a TEST key/.test(lines.join(' ')));
  });
  await t('it opens one order per currency: INR, plus the confirmed foreign ones only when International is on', async () => {
    assert.deepStrictEqual(tool.currenciesOf({ RAZORPAY_CURRENCIES: 'USD' }), ['INR']);
    assert.deepStrictEqual(tool.currenciesOf({ RAZORPAY_INTERNATIONAL: 'true', RAZORPAY_CURRENCIES: 'usd, AED' }), ['INR', 'USD', 'AED']);
    const e = { RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 's' }; let n = 0;
    const r = await tool.run({ env: e, currencies: 'INR,USD', log() {}, fetchImpl: fakeFetch((u, o) => { const b = JSON.parse(o.body); return reply({ id: 'order_T' + (++n), amount: b.amount, currency: b.currency }); }) });
    assert.deepStrictEqual(r.orders.map(o => [o.currency, o.amountSubunits]), [['INR', 49900], ['USD', 500]]);
  });
  await t('checking an order passes only for the exact amount and currency', async () => {
    const e = { RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 's' };
    const mk = items => ({ env: e, orderId: 'order_1', expectSub: 500, currency: 'USD', log() {}, fetchImpl: fakeFetch(() => reply({ items })) });
    assert.strictEqual((await tool.checkOrder(mk([{ id: 'pay_1', amount: 500, currency: 'USD', status: 'captured', international: true, fee: 30 }]))).ok, true);
    assert.strictEqual((await tool.checkOrder(mk([{ id: 'pay_1', amount: 499, currency: 'USD', status: 'captured' }]))).ok, false);
    const auth = await tool.checkOrder(mk([{ id: 'pay_1', amount: 500, currency: 'USD', status: 'authorized' }]));
    assert.deepStrictEqual([auth.ok, auth.needsCapture], [true, true]);
  });

  console.log(`\n${failed ? failed + ' FAILED, ' : 'all passing, '}${passed} passed`);
  process.exit(failed ? 1 : 0);
})();
