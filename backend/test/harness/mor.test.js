const crypto = require('crypto');
Object.assign(process.env, { ANTHROPIC_API_KEY:'k', ACCESS_TOKEN_SECRET:'tok', GSTIN: '27ABCDE1234F1Z5', PAYMENTS_ENABLED:'true',
  RAZORPAY_KEY_ID:'rzp_test_id', RAZORPAY_KEY_SECRET:'key_secret', RAZORPAY_WEBHOOK_SECRET:'rzp_whsec',
  DODO_API_KEY:'dk_test_secret_value', DODO_WEBHOOK_KEY:'whsec_' + Buffer.from('a-test-signing-key-0123456789').toString('base64'), DODO_MODE:'test',
  PUBLIC_BASE_URL:'https://shelterkart.test', PRICING_STORE:'pg', NODE_ENV:'test', MOR_PRODUCTS: JSON.stringify({ USD:'pdt_usd', GBP:'pdt_gbp' }) });
let orderN = 0, razorpayDown = false;
const RET=[['https://maharerait.maharashtra.gov.in/x','MahaRERA'],['https://a.com/1','A'],['https://b.com/2','B'],['https://c.com/3','C']];
const OUT={project:{name:'Hubtown Celeste',location:'Mumbai',developer:'Hubtown Limited',ids:['P51900008925']},sources:RET.map(r=>r[0]),
  findings:RET.map((r,i)=>({id:'f'+i,topic:'other',claim:'Claim '+i+'.',kind:'fact',src:[i]})),conflicts:[],gaps:[]};
const dodo = { n: 0, down: false, created: [], sessionPaid: {}, payments: {} };
function dodoFetch(path, o, mk) {
  if (dodo.down) return mk({ message: 'down' }, 503);
  if (o.method === 'POST' && path === '/checkouts') { const b = JSON.parse(o.body); const id = 'cks_' + (++dodo.n); dodo.created.push({ id, body: b, auth: o.headers.Authorization }); return mk({ session_id: id, checkout_url: 'https://test.checkout.dodopayments.com/session/' + id }); }
  let m = path.match(/^\/checkouts\/(cks_\w+)$/); if (m) { const p = dodo.sessionPaid[m[1]]; return mk({ id: m[1], payment_id: p ? p.payment_id : null, payment_status: p ? 'succeeded' : null }); }
  m = path.match(/^\/payments\/(pay_\w+)$/); if (m) return dodo.payments[m[1]] ? mk(dodo.payments[m[1]]) : mk({}, 404);
  return mk({}, 404);
}
globalThis.fetch = async (url, o) => {
  const mk = (c, status=200) => ({ ok: status < 300, status, json: async()=>c });
  if (String(url).startsWith('https://test.dodopayments.com')) return dodoFetch(String(url).slice('https://test.dodopayments.com'.length), o, mk);
  if (url === 'https://api.razorpay.com/v1/orders') { if (razorpayDown) return mk({}, 500); const b = JSON.parse(o.body); return mk({ id:'order_T'+(++orderN), entity:'order', amount:b.amount, currency:b.currency, status:'created' }); }
  const b = JSON.parse(o.body);
  if (b.tools) return mk({stop_reason:'end_turn',content:[{type:'server_tool_use',name:'web_search'},{type:'web_search_tool_result',content:RET.map(([u,t])=>({url:u,title:t}))},{type:'text',text:JSON.stringify(OUT)}]});
  return mk({content:[{type:'text',text:'{"reading":[],"questions":[]}'}]});
};
const app = require(require('path').join(__dirname, '..', '..', 'server.js'));
const { _db, Pool } = require('pg');
const pool = new Pool();
const find = (m,p) => app.routes.find(r => r.method===m && r.path===p);
function call(route, body, headers={}) { return new Promise(resolve => {
  const res = { code:200, status(c){this.code=c;return this;}, set(){return this;}, json(o){ resolve({ code:this.code, body:o }); } };
  const req = { body, ip:'9.9.9.9', path: route.path, get: k => headers[k.toLowerCase()] };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code:500, body:{ error:err.message } }); const h = hs[i++]; if (h) h(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });

const morEngine = require(require('path').join(__dirname, '..', '..', 'engine', 'mor.js'));
const hook = find('post', '/api/payments/mor/webhook'), co = find('post', '/api/research/checkout'), access = find('post', '/api/research/access');
let hn = 0;
const sendHook = (obj, { id = 'wh_' + (++hn), ts = Math.floor(Date.now() / 1000), secret = process.env.DODO_WEBHOOK_KEY, sig } = {}) => {
  const raw = Buffer.from(JSON.stringify(obj));
  return call(hook, raw, { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': sig || morEngine.sign(id, ts, raw, secret) });
};
const paid = (purchaseId, payId, amountMinor, currency) => ({ business_id: 'bus_t', type: 'payment.succeeded', timestamp: new Date().toISOString(),
  data: { payload_type: 'Payment', payment_id: payId, total_amount: amountMinor, tax: 0, currency, status: 'succeeded', metadata: purchaseId ? { purchase_id: purchaseId } : {} } });
const row = id => _db.purchases.find(p => p.id === id);
(async () => {
  const pv = await call(find('post', '/api/research'), { query: 'Hubtown Celeste', market: 'in', country: 'IN' });
  const ref = pv.body.brief.ref;
  const quote = async (country, session) => (await call(find('post', '/api/research/quote'), { ref, country, session })).body;

  console.log('quotes');
  const qGB = await quote('GB', 's-gb'), qFR = await quote('FR', 's-fr'), qIN = await quote('IN', 's-in');
  ok('UK buyer: quoted in pounds; the merchant collects the tax, so ShelterKart adds none', qGB.ok && qGB.quote.currency === 'GBP' && qGB.quote.taxBy === 'merchant_of_record' && qGB.quote.tax === 0 && qGB.quote.net === qGB.quote.gross);
  ok('French buyer: no euro product, so quoted in US dollars, still tax by the merchant', qFR.ok && qFR.quote.currency === 'USD' && qFR.quote.taxBy === 'merchant_of_record');
  ok('Indian buyer: rupees and ShelterKart\u2019s own GST, never the merchant', qIN.ok && qIN.quote.currency === 'INR' && qIN.quote.taxBy === 'shelterkart' && qIN.quote.tax > 0);

  console.log('checkout');
  const GB = Math.round(qGB.quote.gross * 100);
  const c1 = await call(co, { ref, idempotencyKey: 'mor-attempt-one-aaaaaaaa', quoteId: qGB.quote.id, billingCountry: 'GB' });
  ok('checkout returns the merchant\u2019s hosted page, not a Razorpay order', c1.code === 200 && c1.body.mor && /^https:\/\/test\.checkout\.dodopayments\.com\/session\/cks_/.test(c1.body.mor.checkoutUrl) && !c1.body.razorpay);
  const s1 = dodo.created[0];
  ok('the session is for EXACTLY the quote\u2019s total in the smallest unit, on the pound product, with the server\u2019s key', s1.body.product_cart[0].product_id === 'pdt_gbp' && s1.body.product_cart[0].amount === GB && s1.auth === 'Bearer dk_test_secret_value');
  ok('the session names the purchase and returns the buyer to the site with the report and purchase', s1.body.metadata.purchase_id === c1.body.purchaseId && s1.body.return_url === 'https://shelterkart.test/?sk_ref=' + encodeURIComponent(ref) + '&sk_purchase=' + c1.body.purchaseId);
  const p1 = row(c1.body.purchaseId);
  ok('the purchase is stored as the merchant\u2019s, pending, with no ShelterKart tax', p1.provider === 'mor' && p1.status === 'pending_payment' && p1.provider_order_id === s1.id && p1.tax_mode === 'merchant_of_record' && Number(p1.tax_amount) === 0);
  const cIN = await call(co, { ref, idempotencyKey: 'in-attempt-razorpay-aaaaaa', quoteId: qIN.quote.id, billingCountry: 'IN' });
  ok('India still pays through Razorpay', cIN.code === 200 && cIN.body.razorpay && !cIN.body.mor);
  const k = 'mor-retry-same-attempt-zzzz', qr = (await quote('GB', 's-retry')).quote.id, before = _db.purchases.length;
  const r1 = await call(co, { ref, idempotencyKey: k, quoteId: qr, billingCountry: 'GB' }), r2 = await call(co, { ref, idempotencyKey: k, quoteId: qr, billingCountry: 'GB' });
  ok('a retry of the same attempt keeps the same purchase and opens a fresh single-use session', r1.body.purchaseId === r2.body.purchaseId && r1.body.mor.checkoutUrl !== r2.body.mor.checkoutUrl && _db.purchases.length === before + 1 && row(r2.body.purchaseId).provider_order_id === dodo.created[dodo.created.length - 1].id);
  dodo.down = true;
  const down = await call(co, { ref, idempotencyKey: 'mor-down-attempt-bbbbbbbb', quoteId: (await quote('GB', 's-down')).quote.id, billingCountry: 'GB' });
  ok('if the merchant is down the buyer is asked to try again, with nothing charged', down.code === 503 && !down.body.mor); dodo.down = false;

  console.log('webhook');
  const P1 = c1.body.purchaseId;
  const badSig = await sendHook(paid(P1, 'pay_MOR1', GB, 'GBP'), { sig: 'v1,AAAAAAAA' });
  const stale = await sendHook(paid(P1, 'pay_MOR1', GB, 'GBP'), { ts: Math.floor(Date.now() / 1000) - 3600 });
  const other = await sendHook(paid(P1, 'pay_MOR1', GB, 'GBP'), { secret: 'whsec_' + Buffer.from('some-other-secret-material').toString('base64') });
  ok('a wrong signature, a replayed (hour-old) webhook and a wrong secret are all refused, and nothing is unlocked', badSig.code === 401 && stale.code === 401 && other.code === 401 && p1.status === 'pending_payment');
  const off = await sendHook(paid(P1, 'pay_MOR1', GB + 1, 'GBP')), cur = await sendHook(paid(P1, 'pay_MOR1', GB, 'USD'));
  ok('one unit off, or the wrong currency: nothing unlocks, and it is recorded', off.body.mismatch && cur.body.mismatch && p1.status === 'pending_payment');
  const um = await sendHook(paid(null, 'pay_NOMETA', GB, 'GBP')), unk = await sendHook(paid('11111111-2222-4333-8444-555555555555', 'pay_UNK', GB, 'GBP'));
  ok('a payment with no usable metadata, or for an unknown purchase, unlocks nothing', um.body.unmatched && unk.body.unknown_purchase && p1.status === 'pending_payment');
  const nf = await sendHook({ type: 'payment.failed', data: { payload_type: 'Payment', payment_id: 'pay_F', metadata: { purchase_id: P1 } } });
  ok('a failed payment is recorded and changes nothing', nf.body.noted === 'payment.failed' && p1.status === 'pending_payment');
  const good = await sendHook(paid(P1, 'pay_MOR1', GB, 'GBP'), { id: 'wh_the_good_one' });
  ok('the exact total settles the purchase, with the merchant\u2019s payment id', good.code === 200 && p1.status === 'paid' && p1.provider_payment_id === 'pay_MOR1');
  const dup = await sendHook(paid(P1, 'pay_MOR1', GB, 'GBP'), { id: 'wh_the_good_one' });
  ok('a redelivery of the same webhook is recognised as a duplicate', dup.body.duplicate === true);
  const acc = await call(access, { ref, purchaseId: P1 });
  ok('the paid buyer receives an access token', acc.code === 200 && acc.body.token);
  ok('the merchant\u2019s sale is not booked as ShelterKart\u2019s: no second invoice is issued', !_db.invoices.some(i => i.purchase_id === P1));
  const sigIN = crypto.createHmac('sha256', 'key_secret').update(cIN.body.razorpay.orderId + '|pay_INDIA1').digest('hex');
  const vIN = await call(find('post', '/api/research/razorpay/verify'), { ref, purchaseId: cIN.body.purchaseId, razorpay_payment_id: 'pay_INDIA1', razorpay_signature: sigIN });
  ok('an Indian purchase IS booked by ShelterKart, with its own invoice', vIN.code === 200 && _db.invoices.some(i => i.purchase_id === cIN.body.purchaseId));

  console.log('return from the merchant (no webhook needed)');
  const FR = Math.round(qFR.quote.gross * 100);
  const c2 = await call(co, { ref, idempotencyKey: 'mor-attempt-two-bbbbbbbb', quoteId: qFR.quote.id, billingCountry: 'FR' }), P2 = c2.body.purchaseId, sid2 = row(P2).provider_order_id;
  ok('before paying, the return is told to wait', (await call(access, { ref, purchaseId: P2 })).code === 402);
  dodo.sessionPaid[sid2] = { payment_id: 'pay_RET2' }; dodo.payments.pay_RET2 = { payment_id: 'pay_RET2', status: 'succeeded', total_amount: FR, currency: 'USD', tax: 0, metadata: {} };
  const back = await call(access, { ref, purchaseId: P2 });
  ok('after paying, the return is settled from the merchant\u2019s own records: no webhook, no metadata', back.code === 200 && back.body.token && row(P2).status === 'paid' && row(P2).provider_payment_id === 'pay_RET2');
  const c3 = await call(co, { ref, idempotencyKey: 'mor-attempt-three-cccccc', quoteId: (await quote('FR', 's-fr3')).quote.id, billingCountry: 'FR' }), P3 = c3.body.purchaseId, sid3 = row(P3).provider_order_id;
  dodo.sessionPaid[sid3] = { payment_id: 'pay_RET3' }; dodo.payments.pay_RET3 = { payment_id: 'pay_RET3', status: 'succeeded', total_amount: FR - 1, currency: 'USD', tax: 0, metadata: {} };
  ok('a return whose payment is one unit short is not accepted', (await call(access, { ref, purchaseId: P3 })).code === 402 && row(P3).status === 'pending_payment');
  dodo.payments.pay_RET3 = { payment_id: 'pay_RET3', status: 'processing', total_amount: FR, currency: 'USD', tax: 0, metadata: {} };
  ok('a return whose payment has not succeeded is not accepted', (await call(access, { ref, purchaseId: P3 })).code === 402 && row(P3).status === 'pending_payment');
  const noKey = dodo.created.every(c => !JSON.stringify(c.body).includes('dk_test'));
  ok('the merchant\u2019s API key never appears in anything sent to the merchant\u2019s body', noKey);
})();
