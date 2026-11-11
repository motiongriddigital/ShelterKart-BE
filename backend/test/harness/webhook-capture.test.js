const crypto = require('crypto');
Object.assign(process.env, { ANTHROPIC_API_KEY:'k', ACCESS_TOKEN_SECRET:'tok', GSTIN: '27ABCDE1234F1Z5', PAYMENTS_ENABLED:'true',
  RAZORPAY_KEY_ID:'rzp_test_id', RAZORPAY_KEY_SECRET:'key_secret', RAZORPAY_WEBHOOK_SECRET:'rzp_whsec' });
let orderN = 0, razorpayDown = false, captureAnswer = null, captureCalls = 0;
const RET=[['https://maharerait.maharashtra.gov.in/x','MahaRERA'],['https://a.com/1','A'],['https://b.com/2','B'],['https://c.com/3','C']];
const OUT={project:{name:'Hubtown Celeste',location:'Mumbai',developer:'Hubtown Limited',ids:['P51900008925']},sources:RET.map(r=>r[0]),
  findings:RET.map((r,i)=>({id:'f'+i,topic:'other',claim:'Claim '+i+'.',kind:'fact',src:[i]})),conflicts:[],gaps:[]};
globalThis.fetch = async (url, o) => {
  const mk = (c, status=200) => ({ ok: status < 300, status, json: async()=>c });
  if (/\/payments\/pay_[A-Za-z0-9]+\/capture$/.test(url)) { captureCalls++; return captureAnswer(url, o, mk); }
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
const hook = find('post','/api/payments/razorpay/webhook');
const sendHook = (obj, secret='rzp_whsec') => { const raw = Buffer.from(JSON.stringify(obj)); return call(hook, raw, { 'x-razorpay-signature': crypto.createHmac('sha256', secret).update(raw).digest('hex') }); };
const captured = (orderId, payId, amount) => ({ event:'payment.captured', payload:{ payment:{ entity:{ id:payId, order_id:orderId, amount, currency:'INR', status:'captured' } } } });
(async () => {
  const pv = await call(find('post','/api/research'), { query:'Hubtown Celeste', market:'in', country:'IN' });
  const ref = pv.body.brief.ref;
  const qid = (await call(find('post','/api/research/quote'), { ref, country:'IN', session:'cap' })).body.quote.id;
  const co = await call(find('post','/api/research/checkout'), { ref, idempotencyKey:'authorized-capture-0001', quoteId: qid, billingCountry:'IN' });
  const orderId = co.body.razorpay.orderId, amount = co.body.razorpay.amountSubunits;
  const authorized = payId => ({ event:'payment.authorized', payload:{ payment:{ entity:{ id:payId, order_id:orderId, amount, currency:'INR', status:'authorized' } } } });
  captureAnswer = (url, o, mk) => mk({ id: 'pay_AUTH1', status: 'captured', amount }, 200);
  const first = await sendHook(authorized('pay_AUTH1'));
  ok('an authorized payment is captured for the quoted total', first.code === 200 && first.body.captured === true && captureCalls === 1);
  captureAnswer = (url, o, mk) => mk({ error: { code: 'BAD_REQUEST_ERROR', description: 'This payment has already been captured' } }, 400);
  const second = await sendHook(authorized('pay_AUTH2'));
  ok('a payment that auto-capture already captured is acknowledged, not answered with a 500 that Razorpay retries', second.code === 200 && second.body.ok === true);
  captureAnswer = (url, o, mk) => mk({ error: { code: 'SERVER_ERROR', description: 'Something went wrong' } }, 502);
  const third = await sendHook(authorized('pay_AUTH3'));
  ok('a real capture failure still answers 500 so that Razorpay retries', third.code === 500);
})();
