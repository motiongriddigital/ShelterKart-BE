const crypto = require('crypto');
Object.assign(process.env, { ANTHROPIC_API_KEY:'k', ACCESS_TOKEN_SECRET:'tok', GSTIN: '27ABCDE1234F1Z5', PAYMENTS_ENABLED:'true',
  RAZORPAY_KEY_ID:'rzp_test_id', RAZORPAY_KEY_SECRET:'key_secret', RAZORPAY_WEBHOOK_SECRET:'rzp_whsec', PAYMENT_EVENT_RETRY_SECONDS:'0',
  DODO_API_KEY:'dodo_key', DODO_WEBHOOK_KEY:'whsec_' + Buffer.from('dodo-secret-bytes').toString('base64') });
let orderN = 0, captureDown = false, orderPayments = [];
const captures = [];
const RET=[['https://maharerait.maharashtra.gov.in/x','MahaRERA'],['https://a.com/1','A'],['https://b.com/2','B'],['https://c.com/3','C']];
const OUT={project:{name:'Hubtown Celeste',location:'Mumbai',developer:'Hubtown Limited',ids:['P51900008925']},sources:RET.map(r=>r[0]),
  findings:RET.map((r,i)=>({id:'f'+i,topic:'other',claim:'Claim '+i+'.',kind:'fact',src:[i]})),conflicts:[],gaps:[]};
globalThis.fetch = async (url, o = {}) => {
  const mk = (c, status=200) => ({ ok: status < 300, status, json: async()=>c });
  if (url === 'https://api.razorpay.com/v1/orders') { const b = JSON.parse(o.body); return mk({ id:'order_H'+(++orderN), entity:'order', amount:b.amount, currency:b.currency, status:'created' }); }
  if (/^https:\/\/api\.razorpay\.com\/v1\/orders\/order_\w+\/payments$/.test(url)) return mk({ entity:'collection', items: orderPayments });
  let m = /^https:\/\/api\.razorpay\.com\/v1\/payments\/(pay_\w+)\/capture$/.exec(url);
  if (m) { if (captureDown) return mk({ error:{ code:'SERVER_ERROR', description:'try later' } }, 502); const b = JSON.parse(o.body); captures.push({ id: m[1], ...b }); return mk({ id: m[1], status:'captured', amount: b.amount, currency: b.currency }); }
  const b = JSON.parse(o.body);
  if (b.tools) return mk({stop_reason:'end_turn',content:[{type:'server_tool_use',name:'web_search'},{type:'web_search_tool_result',content:RET.map(([u,t])=>({url:u,title:t}))},{type:'text',text:JSON.stringify(OUT)}]});
  return mk({content:[{type:'text',text:'{"reading":[],"questions":[]}'}]});
};
const app = require(require('path').join(__dirname, '..', '..', 'server.js'));
const { _db } = require('pg');
const find = (m,p) => app.routes.find(r => r.method===m && r.path===p);
function call(route, body, headers={}) { return new Promise(resolve => {
  const res = { code:200, status(c){this.code=c;return this;}, set(){return this;}, json(o){ resolve({ code:this.code, body:o }); } };
  const req = { body, ip:'9.9.9.9', path: route.path, get: k => headers[k.toLowerCase()] };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code:500, body:{ error:err.message } }); const h = hs[i++]; if (h) h(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });
const hook = find('post','/api/payments/razorpay/webhook');
const sendHook = (obj, secret='rzp_whsec') => { const raw = Buffer.from(JSON.stringify(obj)); return call(hook, raw, { 'x-razorpay-signature': crypto.createHmac('sha256', secret).update(raw).digest('hex') }); };
const ev = (event, order_id, id, amount, extra = {}) => ({ event, payload:{ payment:{ entity:{ id, order_id, amount, currency:'INR', status: event === 'payment.authorized' ? 'authorized' : 'captured', ...extra } } } });
const statusOf = id => _db.purchases.find(p => p.id === id).status;
(async () => {
  const pv = await call(find('post','/api/research'), { query:'Hubtown Celeste', market:'in', country:'IN' });
  const ref = pv.body.brief.ref, SUB = Math.round(pv.body.paywall.price * 100);
  const co = find('post','/api/research/checkout');
  const buy = async (key) => {
    const q = (await call(find('post','/api/research/quote'), { ref, country:'IN', session: key })).body.quote.id;
    return (await call(co, { ref, idempotencyKey: key.padEnd(20, 'x'), quoteId: q, billingCountry:'IN' })).body;
  };

  console.log('a webhook that fails is processed again when it is redelivered');
  const a = await buy('authorized-buyer');
  captureDown = true;
  const first = await sendHook(ev('payment.authorized', a.razorpay.orderId, 'pay_AUTH', SUB));
  ok('an authorized payment whose capture fails answers 5xx so Razorpay retries', first.code === 500);
  ok('...and nothing is unlocked yet', statusOf(a.purchaseId) === 'pending_payment');
  captureDown = false;
  const retry = await sendHook(ev('payment.authorized', a.razorpay.orderId, 'pay_AUTH', SUB));
  ok('the redelivery is NOT swallowed as a duplicate: the capture is made, for the exact total in the order’s currency', retry.code === 200 && retry.body.captured === true && captures.length === 1 && captures[0].amount === SUB && captures[0].currency === 'INR');
  ok('after it ended, a further redelivery is a duplicate', (await sendHook(ev('payment.authorized', a.razorpay.orderId, 'pay_AUTH', SUB))).body.duplicate === true);
  const cap = await sendHook(ev('payment.captured', a.razorpay.orderId, 'pay_AUTH', SUB));
  ok('the payment.captured that follows settles the purchase', cap.code === 200 && statusOf(a.purchaseId) === 'paid');

  console.log('an authorized payment for the wrong amount is never captured');
  const w = await buy('wrong-amount-buyer');
  const before = captures.length;
  const wrong = await sendHook(ev('payment.authorized', w.razorpay.orderId, 'pay_WRONG', SUB - 100));
  ok('no capture, no unlock, and the mismatch is answered 200 so it is not retried forever', wrong.code === 200 && wrong.body.mismatch === true && captures.length === before && statusOf(w.purchaseId) === 'pending_payment');

  console.log('events that are only recorded');
  const f = await sendHook({ event:'payment.failed', payload:{ payment:{ entity:{ id:'pay_FAILED', order_id: w.razorpay.orderId, amount: SUB, currency:'INR', error_code:'BAD_REQUEST_ERROR', error_reason:'payment_failed' } } } });
  ok('payment.failed is recorded and changes nothing', f.code === 200 && f.body.noted === 'payment.failed' && statusOf(w.purchaseId) === 'pending_payment');
  ok('...once', (await sendHook({ event:'payment.failed', payload:{ payment:{ entity:{ id:'pay_FAILED', order_id: w.razorpay.orderId, amount: SUB, currency:'INR' } } } })).body.duplicate === true);
  const created = await sendHook({ event:'refund.created', payload:{ refund:{ entity:{ id:'rfnd_0', payment_id:'pay_AUTH', amount: SUB, currency:'INR', status:'created' } } } });
  ok('refund.created is recorded and acknowledged, not booked (the money has not moved yet)', created.code === 200 && created.body.noted === 'refund.created' && statusOf(a.purchaseId) === 'paid');
  const rb = await buy('refunded-at-provider');
  await sendHook(ev('payment.captured', rb.razorpay.orderId, 'pay_RFND', SUB));
  const rf = { event:'refund.processed', payload:{ refund:{ entity:{ id:'rfnd_1', payment_id:'pay_RFND', amount: SUB, currency:'INR', status:'processed' } } } };
  const r1 = await sendHook(rf);
  ok('refund.processed (a refund made in the provider dashboard) is booked: the purchase is refunded', r1.code === 200 && r1.body.refund === 'recorded' && statusOf(rb.purchaseId) === 'refunded');
  ok('...a redelivery of the same refund is a duplicate', (await sendHook(rf)).body.duplicate === true);
  const more = await sendHook({ ...rf, payload:{ refund:{ entity:{ ...rf.payload.refund.entity, id:'rfnd_2' } } } });
  ok('...a second refund id on a payment already refunded in full is refused and recorded, not booked', more.code === 200 && more.body.rejected === 'exceeds');

  console.log('the buyer returns before (or without) the webhook');
  const access = find('post','/api/research/access');
  const r = await buy('returning-buyer');
  orderPayments = [];
  ok('no payment on the order yet: not paid', (await call(access, { ref, purchaseId: r.purchaseId })).code === 402);
  orderPayments = [{ id:'pay_SHORT', amount: SUB - 1, currency:'INR', status:'captured' }];
  const short = await call(access, { ref, purchaseId: r.purchaseId });
  ok('a captured payment one unit short unlocks nothing', short.code === 402 && statusOf(r.purchaseId) === 'pending_payment');
  orderPayments = [{ id:'pay_FOREIGN', amount: SUB, currency:'USD', status:'captured' }];
  ok('the right amount in another currency unlocks nothing', (await call(access, { ref, purchaseId: r.purchaseId })).code === 402);
  orderPayments = [{ id:'pay_FAIL', amount: SUB, currency:'INR', status:'failed' }, { id:'pay_OK', amount: SUB, currency:'INR', status:'captured' }];
  const paid = await call(access, { ref, purchaseId: r.purchaseId });
  ok('Razorpay’s own record of OUR order, exact amount and currency, settles it and returns the token', paid.code === 200 && paid.body.token && statusOf(r.purchaseId) === 'paid');
  ok('the payment id stored is the matching one', _db.purchases.find(p => p.id === r.purchaseId).provider_payment_id === 'pay_OK');
  const r2 = await buy('returning-authorized');
  orderPayments = [{ id:'pay_AUTH2', amount: SUB, currency:'INR', status:'authorized' }];
  const n = captures.length;
  const paid2 = await call(access, { ref, purchaseId: r2.purchaseId });
  ok('an authorized payment is captured first, then settles', paid2.code === 200 && captures.length === n + 1 && captures[n].id === 'pay_AUTH2' && statusOf(r2.purchaseId) === 'paid');
  const r3 = await buy('returning-capture-down');
  orderPayments = [{ id:'pay_AUTH3', amount: SUB, currency:'INR', status:'authorized' }]; captureDown = true;
  const stuck = await call(access, { ref, purchaseId: r3.purchaseId });
  ok('if the capture fails the buyer is told it is not confirmed yet and nothing unlocks', stuck.code === 402 && statusOf(r3.purchaseId) === 'pending_payment');
  captureDown = false;

  console.log('the Merchant of Record webhook');
  const mor = require('../../engine/mor'), morHook = find('post','/api/payments/mor/webhook');
  const sendMor = (id, obj) => { const raw = Buffer.from(JSON.stringify(obj)), ts = String(Math.floor(Date.now() / 1000));
    return call(morHook, raw, { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': mor.sign(id, ts, raw, process.env.DODO_WEBHOOK_KEY) }); };
  const fl = await sendMor('wh_failed_1', { type:'payment.failed', data:{ payload_type:'Payment', payment_id:'pay_d1', currency:'USD', total_amount:1500, metadata:{ purchase_id: a.purchaseId } } });
  ok('payment.failed is acknowledged and changes no purchase', fl.code === 200 && fl.body.noted === 'payment.failed' && statusOf(a.purchaseId) === 'paid');
  ok('...a redelivery with the same webhook-id is a duplicate', (await sendMor('wh_failed_1', { type:'payment.failed', data:{ payment_id:'pay_d1' } })).body.duplicate === true);
  const rr = await sendMor('wh_refund_1', { type:'refund.succeeded', data:{ payload_type:'Refund', payment_id:'pay_d1', amount:500, currency:'USD', status:'succeeded' } });
  ok('a refund event for a payment this server has no purchase for is acknowledged and not booked', rr.code === 200 && rr.body.unmatched === true);
  ok('a badly signed webhook is refused', (await call(morHook, Buffer.from('{}'), { 'webhook-id':'x', 'webhook-timestamp': String(Math.floor(Date.now()/1000)), 'webhook-signature':'v1,AAAA' })).code === 401);
})();
