const crypto = require('crypto');
const env = { ANTHROPIC_API_KEY:'k', AI_PERSONAL_DATA_ENGINES:'anthropic', PAYMENT_WEBHOOK_SECRET:'whsec', ACCESS_TOKEN_SECRET:'tok-secret', GSTIN: '27ABCDE1234F1Z5', RAZORPAY_KEY_ID:'rzp_test_id', RAZORPAY_KEY_SECRET:'key_secret',
  ACCOUNTS_ENABLED:'on', AUTH_PEPPER:'x'.repeat(40), ACCOUNTS_ALLOW_MEMORY:'true', ACCOUNTS_DEV_ECHO:'on', PAYMENTS_ENABLED:'true' };
Object.assign(process.env, env);
const RET=[['https://maharerait.maharashtra.gov.in/x','MahaRERA'],['https://a.com/1','A'],['https://b.com/2','B'],['https://c.com/3','C'],['https://d.com/4','D']];
const OUT={project:{name:'Hubtown Celeste',location:'Mumbai',developer:'Hubtown Limited',ids:['P51900008925']},sources:RET.map(r=>r[0]),
  findings:RET.map((r,i)=>({id:'f'+i,topic:'other',claim:'Claim number '+i+'.',kind:'fact',src:[i]})),
  conflicts:[{topic:'Possession date',versions:[{value:'Dec 2027',src:1},{value:'Jul 2029',src:2}]}],gaps:[]};
let _o=0; globalThis.fetch = async (url, o) => { const mk = c => ({ ok:true, status:200, json: async()=>c }); if (url === 'https://api.razorpay.com/v1/orders') { const q = JSON.parse(o.body); return mk({ id:'order_A'+(++_o), amount:q.amount, currency:q.currency, status:'created' }); } const b = JSON.parse(o.body);
  if (b.tools) return mk({stop_reason:'end_turn',content:[{type:'server_tool_use',name:'web_search'},{type:'web_search_tool_result',content:RET.map(([u,t])=>({url:u,title:t}))},{type:'text',text:JSON.stringify(OUT)}]});
  return mk({content:[{type:'text',text:'{"reading":[{"observation":"Dates differ.","based_on":["f1"],"question":"Which?"}],"questions":[]}'}]}); };
const app = require(require('path').join(__dirname, '..', '..', 'server.js'));
const { _db } = require('pg');
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route, body, { headers = {}, params = {}, query = {}, path = '' } = {}) { return new Promise(resolve => {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const res = { code: 200, headers: {}, cookies: [], status(c) { this.code = c; return this; }, set(k, v) { if (typeof k === 'object') Object.assign(this.headers, k); else this.headers[k] = v; return this; },
    append(k, v) { if (k === 'Set-Cookie') this.cookies.push(v); return this; }, json(o) { resolve({ code: this.code, body: o, cookies: this.cookies }); },
    send(o) { resolve({ code: this.code, body: o, cookies: this.cookies }); }, redirect(c, u) { resolve({ code: c, location: u }); }, write() {}, end() { resolve({ code: this.code, ended: true }); }, flushHeaders() {} };
  const req = { body, params, query, ip: '3.3.3.3', path, headers: h, originalUrl: path, get: k => h[k.toLowerCase()], on() {} };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const fn = hs[i++]; if (fn) fn(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });

async function signIn(email, ip) {
  const rc = await call(find('post', '/api/auth/request-code'), { email });
  const vc = await call(find('post', '/api/auth/verify-code'), { email, code: rc.body.devCode, termsAccepted: true });
  return { cookie: (vc.cookies[0] || '').split(';')[0], user: vc.body.user };
}
(async () => {
  const REF = 'SK-AAAAAAAAAAAA';
  console.log('the wall');
  for (const [m, p] of [['post', '/api/research'], ['post', '/api/research/quote'], ['post', '/api/research/checkout'], ['post', '/api/research/razorpay/verify'], ['post', '/api/research/access'], ['post', '/api/research/document-check'], ['get', '/api/research/by-ref/:ref'], ['post', '/api/investigate/:ref/contact'], ['get', '/api/investigate/:ref/events'], ['get', '/r/:ref/pdf']]) {
    const r = await call(find(m, p), { ref: REF }, { params: { ref: REF }, path: p });
    ok(m.toUpperCase() + ' ' + p + ' needs a session (401 auth_required)', r.code === 401 && r.body && r.body.code === 'auth_required');
  }
  const page = await call(find('get', '/r/:ref'), undefined, { params: { ref: REF }, path: '/r/' + REF });
  ok('the report page sends an unsigned visitor to sign in, remembering where they were going', page.code === 302 && page.location === '/signin?next=%2Fr%2F' + REF);
  for (const [m, p] of [['get', '/api/markets'], ['get', '/api/languages'], ['get', '/api/pricing/countries'], ['get', '/api/health'], ['post', '/api/track'], ['get', '/api/source-consent'], ['post', '/api/dispute'], ['post', '/api/responses'], ['get', '/guide']]) {
    const r = await call(find(m, p), {}, { path: p });
    ok(m.toUpperCase() + ' ' + p + ' stays public (never 401)', r.code !== 401);
  }
  const rec = await call(find('post', '/api/research/recover'), { paymentId: 'pay_ABCDEFGHIJKL' });
  ok('the old recover-by-payment-ID route answers 410 use_account', rec.code === 410 && rec.body.code === 'use_account');
  const start = await call(find('post', '/api/investigate'), { query: 'Hubtown Celeste', country: 'IN', market: 'India' }, { path: '/api/investigate' });
  ok('a search may start without an account (the wall is on the results)', start.code !== 401 && start.code !== 410);

  console.log('a signed-in buyer');
  const A = await signIn('buyer-a@example.com'), B = await signIn('buyer-b@example.com');
  ok('both buyers are signed in with their own cookies', A.cookie && B.cookie && A.cookie !== B.cookie && A.user.id !== B.user.id);
  const hA = { cookie: A.cookie }, hB = { cookie: B.cookie };
  const pv = await call(find('post', '/api/research'), { query: 'Hubtown Celeste', market: 'in', country: 'IN' }, { headers: hA });
  const ref = pv.body.brief.ref;
  ok('signed in, unpaid: the preview is served and the rest is withheld at source', pv.code === 200 && pv.body.brief.locked === true && !JSON.stringify(pv.body).includes('Jul 2029') && pv.body.paywall.active);
  const q = (await call(find('post', '/api/research/quote'), { ref, country: 'IN', session: 'x' }, { headers: hA })).body.quote;
  const co = await call(find('post', '/api/research/checkout'), { ref, idempotencyKey: 'accounts-buyer-a-aaaaaaaaaaaa', quoteId: q.id, billingCountry: 'IN' }, { headers: hA });
  ok('checkout works and stores the buyer as the owner of the purchase', co.code === 200 && _db.purchases.find(p => p.id === co.body.purchaseId).user_id === A.user.id);
  ok('before payment: the report is still the preview and the PDF is refused', (await call(find('get', '/api/research/by-ref/:ref'), undefined, { headers: hA, params: { ref } })).body.brief.locked === true && (await call(find('get', '/r/:ref/pdf'), undefined, { headers: hA, params: { ref }, query: {} })).code === 403);
  ok('before payment: access is refused (402)', (await call(find('post', '/api/research/access'), { ref, purchaseId: co.body.purchaseId }, { headers: hA })).code === 402);
  const hook = find('post', '/api/payments/webhook');
  const raw = Buffer.from(JSON.stringify({ id: 'evt_a1', type: 'payment.succeeded', data: { reportRef: ref, purchaseId: co.body.purchaseId, amount: co.body.amount } }));
  const wh = await call(hook, raw, { headers: { 'x-sk-provider': 'test', 'x-sk-signature': crypto.createHmac('sha256', 'whsec').update(raw).digest('hex') }, path: '/api/payments/webhook' });
  ok('the payment provider’s signed webhook settles the purchase with no session at all', wh.code === 200 && _db.purchases.find(p => p.id === co.body.purchaseId).status === 'paid');

  console.log('who may read it');
  const fullA = await call(find('get', '/api/research/by-ref/:ref'), undefined, { headers: hA, params: { ref } });
  ok('the buyer reads the full report: no token, just the account', fullA.body.brief.locked === false && fullA.body.brief.reading.length === 1);
  const seenB = await call(find('get', '/api/research/by-ref/:ref'), undefined, { headers: hB, params: { ref } });
  ok('another signed-in user sees only the preview of the same project', seenB.body.brief.locked === true && !JSON.stringify(seenB.body).includes('Jul 2029'));
  const stealAccess = await call(find('post', '/api/research/access'), { ref, purchaseId: co.body.purchaseId }, { headers: hB });
  ok('another user cannot turn someone else’s purchase into access', stealAccess.code === 403 && stealAccess.body.code === 'not_entitled');
  const stealVerify = await call(find('post', '/api/research/razorpay/verify'), { ref, purchaseId: co.body.purchaseId, razorpay_payment_id: 'pay_ABCDEFGHIJ', razorpay_signature: 'x' }, { headers: hB });
  ok('nor can they verify it', stealVerify.code === 403);
  const acc = await call(find('post', '/api/research/access'), { ref, purchaseId: co.body.purchaseId }, { headers: hA });
  ok('the owner’s access reply carries no token: access is the account', acc.code === 200 && acc.body.entitled === true && !('token' in acc.body));
  const fakeToken = require('../../engine/access').issueToken(ref, process.env.ACCESS_TOKEN_SECRET);
  const tokenOnly = await call(find('get', '/api/research/by-ref/:ref'), undefined, { headers: { cookie: B.cookie, 'x-report-access': fakeToken }, params: { ref } });
  ok('a valid old-style token no longer opens anything while accounts are on', tokenOnly.body.brief.locked === true);
  const list = await call(find('get', '/api/me/reports'), undefined, { headers: hA });
  const mine = (list.body.reports || []).find(r => r.ref === ref);
  ok('my reports lists the purchase as paid, with the amount', mine && mine.paid === true && mine.amount === co.body.amount && mine.currency === 'INR');
  ok('the other user’s list does not show it as paid', !((await call(find('get', '/api/me/reports'), undefined, { headers: hB })).body.reports || []).some(r => r.ref === ref && r.paid));

  console.log('a refund');
  _db.purchases.find(p => p.id === co.body.purchaseId).status = 'refunded';
  const afterRefund = await call(find('get', '/api/research/by-ref/:ref'), undefined, { headers: hA, params: { ref } });
  ok('after a refund the report is the preview again at the very next request', afterRefund.body.brief.locked === true);

  console.log('signing out');
  await call(find('post', '/api/auth/logout'), {}, { headers: hA });
  ok('after sign-out the same cookie is refused', (await call(find('get', '/api/me'), undefined, { headers: hA })).code === 401);
})();
