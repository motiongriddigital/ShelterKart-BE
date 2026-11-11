const crypto = require('crypto');
Object.assign(process.env, { ANTHROPIC_API_KEY:'k', ACCESS_TOKEN_SECRET:'tok', GSTIN: '27ABCDE1234F1Z5', PAYMENTS_ENABLED:'true',
  RAZORPAY_KEY_ID:'rzp_test_id', RAZORPAY_KEY_SECRET:'key_secret', RAZORPAY_WEBHOOK_SECRET:'rzp_whsec' });
let orderN = 0, razorpayDown = false;
const RET=[['https://maharerait.maharashtra.gov.in/x','MahaRERA'],['https://a.com/1','A'],['https://b.com/2','B'],['https://c.com/3','C']];
const OUT={project:{name:'Hubtown Celeste',location:'Mumbai',developer:'Hubtown Limited',ids:['P51900008925']},sources:RET.map(r=>r[0]),
  findings:RET.map((r,i)=>({id:'f'+i,topic:'other',claim:'Claim '+i+'.',kind:'fact',src:[i]})),conflicts:[],gaps:[]};
globalThis.fetch = async (url, o) => {
  const mk = (c, status=200) => ({ ok: status < 300, status, json: async()=>c });
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
  const qid = (await call(find('post','/api/research/quote'), { ref, country:'IN', session:'race' })).body.quote.id;
  const co = find('post','/api/research/checkout'), key = 'simultaneous-attempt-0001';
  await pool.query(`INSERT INTO report_purchases (report_ref, amount, currency, status, provider, idempotency_key) VALUES ($1,$2,$3,'pending_payment','razorpay',$4)`, [ref, 499, 'INR', key]);
  _db.blindFirstRead = new Set([key]);
  const loser = await call(co, { ref, idempotencyKey: key, quoteId: qid, billingCountry:'IN' });
  ok('a simultaneous request whose twin has not stored its order yet is told to try again, not given a 500', loser.code === 409 && loser.body.code === 'in_progress');
})();
