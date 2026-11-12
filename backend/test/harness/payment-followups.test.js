const crypto = require('crypto');
Object.assign(process.env, { ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN_SECRET: 'tok', GSTIN: '27ABCDE1234F1Z5', PAYMENTS_ENABLED: 'true', PAYMENT_WEBHOOK_SECRET: 'whsec', PAYMENT_EVENT_RETRY_SECONDS: '0',
  RAZORPAY_KEY_ID: 'rzp_test_id', RAZORPAY_KEY_SECRET: 'key_secret', RAZORPAY_WEBHOOK_SECRET: 'rzp_whsec',
  DODO_API_KEY: 'dodo_key', DODO_WEBHOOK_KEY: 'whsec_' + Buffer.from('dodo-secret-bytes').toString('base64') });
delete process.env.DATABASE_URL; delete process.env.ACCOUNTS_ENABLED;
const refundCalls = [];
globalThis.fetch = async (url, o = {}) => {
  const mk = (c, status = 200) => ({ ok: status < 300, status, json: async () => c });
  const m = /^https:\/\/api\.razorpay\.com\/v1\/payments\/(pay_\w+)\/refund$/.exec(url);
  if (m) { const b = JSON.parse(o.body); refundCalls.push({ id: m[1], ...b }); await new Promise(r => setTimeout(r, 30)); return mk({ id: 'rfnd_OURS', status: 'processed', amount: b.amount }); }
  return mk({ content: [{ type: 'text', text: '{}' }] });
};
const path = require('path');
const app = require(path.join(__dirname, '..', '..', 'server.js'));
const { c } = require(path.join(__dirname, '..', '..', 'app.js'));
const { _db } = require('pg');
const mor = require('../../engine/mor');
const { refundPurchase } = require('../../payments/refunds');
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route, body, headers = {}) { return new Promise(resolve => {
  const res = { code: 200, status(x) { this.code = x; return this; }, set() { return this; }, json(o) { resolve({ code: this.code, body: o }); } };
  const req = { body, ip: '9.9.9.9', path: route.path, get: k => headers[k.toLowerCase()] };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const h = hs[i++]; if (h) h(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, x) => { if (!x) failures++; console.log((x ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });
const rzpHook = find('post', '/api/payments/razorpay/webhook'), morHook = find('post', '/api/payments/mor/webhook'), legacyHook = find('post', '/api/payments/webhook');
const sendRzp = obj => { const raw = Buffer.from(JSON.stringify(obj)); return call(rzpHook, raw, { 'x-razorpay-signature': crypto.createHmac('sha256', 'rzp_whsec').update(raw).digest('hex') }); };
const sendMor = (id, obj) => { const raw = Buffer.from(JSON.stringify(obj)), ts = String(Math.floor(Date.now() / 1000)); return call(morHook, raw, { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': mor.sign(id, ts, raw, process.env.DODO_WEBHOOK_KEY) }); };
const sendLegacy = (obj, provider = 'test') => { const raw = Buffer.from(JSON.stringify(obj)); return call(legacyHook, raw, { 'x-sk-provider': provider, 'x-sk-signature': crypto.createHmac('sha256', 'whsec').update(raw).digest('hex') }); };
const REF = 'SK-ABCDEF123456';
let n = 0;
const purchase = (o = {}) => { const row = { id: crypto.randomUUID(), report_ref: REF, status: 'pending_payment', provider: 'razorpay', provider_order_id: 'order_FU' + (++n), amount: 100, currency: 'INR', buyer_country: 'IN', amount_net: 84.75, tax_amount: 15.25, net_revenue: 84.75, quote_id: null, ...o }; _db.purchases.push(row); return row; };
const capture = (order, pay, amount = 10000) => ({ event: 'payment.captured', payload: { payment: { entity: { id: pay, order_id: order, amount, currency: 'INR', status: 'captured' } } } });
const refundEv = (id, pay, amount, currency = 'INR', event = 'refund.processed') => ({ event, payload: { refund: { entity: { id, payment_id: pay, amount, currency, status: 'processed' } } } });
const events = type => c.pricingStore._raw.events.filter(e => e.type === type || e.event === type || e.name === type);
const errors = []; const origError = console.error; console.error = (...a) => { errors.push(a.join(' ')); };
const refunded = id => c.pricingStore.refundedTotal(id);

(async () => {
  console.log('the same purchase paid twice');
  const p1 = purchase();
  const first = await sendRzp(capture(p1.provider_order_id, 'pay_FIRST'));
  ok('the first payment settles the purchase', first.code === 200 && p1.status === 'paid' && p1.provider_payment_id === 'pay_FIRST');
  const second = await sendRzp(capture(p1.provider_order_id, 'pay_SECOND'));
  ok('a second payment on the same order is acknowledged, does not change the purchase', second.code === 200 && p1.provider_payment_id === 'pay_FIRST' && p1.status === 'paid');
  ok('...and is recorded as a duplicate payment with both payment ids, and logged for the operator', events('duplicate_payment').length === 1 && JSON.stringify(events('duplicate_payment')[0]).includes('pay_SECOND') && JSON.stringify(events('duplicate_payment')[0]).includes('pay_FIRST') && errors.some(e => /paid twice/.test(e)));
  const again = await sendRzp({ event: 'order.paid', payload: { payment: { entity: { id: 'pay_FIRST', order_id: p1.provider_order_id } }, order: { entity: { id: p1.provider_order_id, amount_paid: 10000, currency: 'INR' } } } });
  ok('the first payment announced again by another event is NOT flagged', again.code === 200 && events('duplicate_payment').length === 1);
  const m1 = purchase({ provider: 'mor', provider_order_id: 'cks_1', amount: 15, currency: 'USD', buyer_country: 'US', tax_amount: 0 });
  const morPay = (whid, pay) => sendMor(whid, { type: 'payment.succeeded', data: { payment_id: pay, total_amount: 1500, currency: 'USD', tax: 0, metadata: { purchase_id: m1.id, ref: REF } } });
  ok('a merchant-of-record payment settles', (await morPay('wh_a', 'pay_M1')).code === 200 && m1.status === 'paid' && m1.provider_payment_id === 'pay_M1');
  await morPay('wh_b', 'pay_M2');
  ok('a second merchant payment for the same purchase is flagged as a duplicate and no tax is booked for it', events('duplicate_payment').length === 2 && m1.provider_payment_id === 'pay_M1' && events('mor_tax_collected').length === 1);

  console.log('a refund made at the provider');
  const p2 = purchase(); await sendRzp(capture(p2.provider_order_id, 'pay_R2'));
  const part = await sendRzp(refundEv('rfnd_A', 'pay_R2', 4000));
  ok('a part refund is booked: the purchase stays paid, 40.00 is counted, net revenue falls by the net share', part.body.refund === 'recorded' && p2.status === 'paid' && await refunded(p2.id) === 40);
  ok('...net revenue fell by 40 minus its tax share (100 gross, 15.25 tax: 6.10 tax, 33.90 net)', Math.abs(Number(p2.net_revenue) - (84.75 - 33.9)) < 0.011, 'net_revenue=' + p2.net_revenue);
  const rest = await sendRzp(refundEv('rfnd_B', 'pay_R2', 6000));
  ok('the rest completes it: the purchase is refunded and access ends', rest.body.refund === 'recorded' && p2.status === 'refunded' && await refunded(p2.id) === 100);
  const over = await sendRzp(refundEv('rfnd_C', 'pay_R2', 100));
  ok('more than was paid is refused, recorded, logged and not booked', over.body.rejected === 'exceeds' && await refunded(p2.id) === 100 && events('provider_refund_rejected').length === 1 && errors.some(e => /not booked \(exceeds\)/.test(e)));
  const p3 = purchase(); await sendRzp(capture(p3.provider_order_id, 'pay_R3'));
  const wrongCur = await sendRzp(refundEv('rfnd_D', 'pay_R3', 4000, 'USD'));
  ok('a refund in another currency is refused', wrongCur.body.rejected === 'currency_mismatch' && await refunded(p3.id) === 0 && p3.status === 'paid');
  const none = await sendRzp(refundEv('rfnd_E', 'pay_NOBODY', 4000));
  ok('a refund of a payment this server never sold is acknowledged and ignored', none.code === 200 && none.body.unmatched === true);
  ok('a redelivery of a booked refund event is a duplicate, and a refund.created changes nothing', (await sendRzp(refundEv('rfnd_A', 'pay_R2', 4000))).body.duplicate === true && (await sendRzp(refundEv('rfnd_F', 'pay_R3', 4000, 'INR', 'refund.created'))).body.noted === 'refund.created' && await refunded(p3.id) === 0);
  const mm = purchase({ provider: 'mor', provider_order_id: 'cks_2', amount: 15, currency: 'USD', buyer_country: 'US', tax_amount: 0 });
  await sendMor('wh_c', { type: 'payment.succeeded', data: { payment_id: 'pay_M3', total_amount: 1500, currency: 'USD', metadata: { purchase_id: mm.id, ref: REF } } });
  const mref = await sendMor('wh_d', { type: 'refund.succeeded', data: { refund_id: 'rf_M3', payment_id: 'pay_M3', amount: 1500, currency: 'USD', status: 'succeeded' } });
  ok('a merchant-of-record refund is booked too, under its own refund id', mref.body.refund === 'recorded' && mm.status === 'refunded' && (await c.pricingStore.refundByProviderRef('rf_M3')) !== null);

  console.log('our own refund and the provider\'s event for it');
  const p4 = purchase(); await sendRzp(capture(p4.provider_order_id, 'pay_R4'));
  const ours = refundPurchase({ db: c.pool, data: c.pricingData, store: c.pricingStore, purchaseId: p4.id, amount: 100, reason: 'test', env: process.env, fetchImpl: globalThis.fetch });
  const event = sendRzp(refundEv('rfnd_OURS', 'pay_R4', 10000));
  const [mine, theirs] = await Promise.all([ours, event]);
  ok('the provider\'s event that arrives while our refund is being recorded waits, finds it booked and books nothing again', mine.full === true && theirs.body.refund === 'already_recorded' && await refunded(p4.id) === 100 && refundCalls.length === 1);
  ok('...net revenue was reduced once, not twice', Math.abs(Number(p4.net_revenue) - 0) < 0.011, 'net_revenue=' + p4.net_revenue);
  const p5 = purchase(); await sendRzp(capture(p5.provider_order_id, 'pay_R5'));
  const hold = await c.pricingStore.reserveRefund({ purchaseId: p5.id, amount: 40, currency: 'INR', taxReversed: 6.1, reason: 'we asked, the provider never confirmed' });
  const settled = await sendRzp(refundEv('rfnd_R5', 'pay_R5', 4000));
  ok('a refund of ours that the provider never confirmed is settled by its event with the same amount (no second refund row)', settled.body.refund === 'recorded' && (await c.pricingStore.getRefund(hold)).status === 'processed' && await refunded(p5.id) === 40);
  const p6 = purchase(); await sendRzp(capture(p6.provider_order_id, 'pay_R6'));
  const hold6 = await c.pricingStore.reserveRefund({ purchaseId: p6.id, amount: 10, currency: 'INR', taxReversed: 1.5, reason: 'in flight' });
  const wait = await sendRzp(refundEv('rfnd_R6', 'pay_R6', 4000));
  ok('a refund event while one of ours of another amount is waiting for an operator is answered 503 and not finished, so the provider sends it again', wait.code === 503 && await refunded(p6.id) === 10);
  await c.pricingStore.releaseRefund(hold6);
  const retried = await sendRzp(refundEv('rfnd_R6', 'pay_R6', 4000));
  ok('...and once the operator has dealt with that one, the redelivery is booked', retried.code === 200 && retried.body.refund === 'recorded' && await refunded(p6.id) === 40);

  console.log('the older signed route');
  const l1 = purchase({ provider: 'test', provider_order_id: null });
  const body = o => ({ id: 'evt_' + (++n), type: 'payment.succeeded', data: { reportRef: REF, purchaseId: l1.id, amount: 100, currency: 'INR', ...o } });
  const noCur = body({ currency: undefined }); const rNo = await sendLegacy(noCur);
  ok('an event with no currency (or the wrong one) is refused and not settled', rNo.code === 400 && l1.status === 'pending_payment' && (await sendLegacy(body({ currency: 'USD' }))).code === 400);
  ok('...and a refusal for a bad event is final: its redelivery is a duplicate', (await sendLegacy(noCur)).body.duplicate === true);
  const orig = c.pool.connect.bind(c.pool); let blink = true;
  c.pool.connect = async () => { const cl = await orig(), q = cl.query.bind(cl); cl.query = (sql, ...a) => (blink && /SET status='paid'/.test(sql) ? Promise.reject(new Error('the database blinked')) : q(sql, ...a)); return cl; };
  const good = body({}); const hit = await sendLegacy(good);
  ok('a transient failure while settling answers 500 and leaves the event unfinished', hit.code === 500 && l1.status === 'pending_payment' && errors.some(e => /will be redelivered/.test(e)));
  blink = false; const redo = await sendLegacy(good);
  ok('the provider\'s redelivery is processed and settles the purchase (it used to be dropped as a duplicate for ever)', redo.code === 200 && redo.body.ok === true && l1.status === 'paid');
  ok('and once it ended a further redelivery is a duplicate', (await sendLegacy(good)).body.duplicate === true);
  c.pool.connect = orig;
  const l2 = purchase({ provider: 'test', provider_order_id: null });
  await sendLegacy({ id: 'evt_hdr', type: 'payment.succeeded', data: { reportRef: REF, purchaseId: l2.id, amount: 100, currency: 'INR' } }, 'x'.repeat(80) + ' <script>');
  ok('a provider name that is not a short plain word is stored as "unknown", never as sent', l2.status === 'paid' && [..._db.events.keys()].some(k => k.startsWith('unknown|evt_hdr')) && ![..._db.events.keys()].some(k => /script/.test(k)));
  console.error = origError;
})();
