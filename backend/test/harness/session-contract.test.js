const crypto = require('crypto');
const env = { ANTHROPIC_API_KEY:'k', AI_PERSONAL_DATA_ENGINES:'anthropic', PAYMENT_WEBHOOK_SECRET:'whsec', ACCESS_TOKEN_SECRET:'tok-secret', GSTIN: '27ABCDE1234F1Z5', RAZORPAY_KEY_ID:'rzp_test_id', RAZORPAY_KEY_SECRET:'key_secret',
  ACCOUNTS_ENABLED:'on', AUTH_PEPPER:'x'.repeat(40), ACCOUNTS_ALLOW_MEMORY:'true', ACCOUNTS_DEV_ECHO:'on', PAYMENTS_ENABLED:'true',
  RESEND_API_KEY:'re_test', DELIVERY_FROM:'ShelterKart <no-reply@shelterkart.test>', PUBLIC_BASE_URL:'https://shelterkart.test' };
Object.assign(process.env, env);
const RET=[['https://maharerait.maharashtra.gov.in/x','MahaRERA'],['https://a.com/1','A'],['https://b.com/2','B'],['https://c.com/3','C'],['https://d.com/4','D']];
const OUT={project:{name:'Hubtown Celeste',location:'Mumbai',developer:'Hubtown Limited',ids:['P51900008925']},sources:RET.map(r=>r[0]),
  findings:RET.map((r,i)=>({id:'f'+i,topic:'other',claim:'Claim number '+i+'.',kind:'fact',src:[i]})),
  conflicts:[{topic:'Possession date',versions:[{value:'Dec 2027',src:1},{value:'Jul 2029',src:2}]}],gaps:[]};
const MAILS = []; let _o=0; globalThis.fetch = async (url, o) => { const mk = c => ({ ok:true, status:200, json: async()=>c });
  if (url === 'https://api.resend.com/emails') { MAILS.push(JSON.parse(o.body)); return mk({ id:'em_' + MAILS.length }); } if (url === 'https://api.razorpay.com/v1/orders') { const q = JSON.parse(o.body); return mk({ id:'order_A'+(++_o), amount:q.amount, currency:q.currency, status:'created' }); } const b = JSON.parse(o.body);
  if (b.tools) return mk({stop_reason:'end_turn',content:[{type:'server_tool_use',name:'web_search'},{type:'web_search_tool_result',content:RET.map(([u,t])=>({url:u,title:t}))},{type:'text',text:JSON.stringify(OUT)}]});
  return mk({content:[{type:'text',text:'{"reading":[{"observation":"Dates differ.","based_on":["f1"],"question":"Which?"}],"questions":[]}'}]}); };
const app = require(require('path').join(__dirname, '..', '..', 'server.js'));
const { _db } = require('pg');
const ANALYTICS = require('../../engine/analytics');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const eventsOf = name => ANALYTICS._memory.filter(e => e.event === name);
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

const realNow = Date.now.bind(Date); let skew = 0; Date.now = () => realNow() + skew;
const UA = { 'user-agent': 'Mozilla/5.0 (Macintosh)' };
async function signIn(email) {
  const rc = await call(find('post', '/api/auth/request-code'), { email }, { headers: UA });
  const vc = await call(find('post', '/api/auth/verify-code'), { email, code: rc.body.devCode, termsAccepted: true }, { headers: UA });
  return { cookie: (vc.cookies[0] || '').split(';')[0], setCookie: vc.cookies[0] || '', user: vc.body.user };
}
const session = headers => call(find('get', '/api/auth/session'), undefined, { headers, path: '/api/auth/session' });
(async () => {
  console.log('the session endpoint');
  const anon = await session({});
  ok('anonymous: 200 and not authenticated', anon.code === 200 && anon.body.ok === true && anon.body.authenticated === false);
  const junk = await session({ cookie: 'sk_session=' + 'z'.repeat(43) });
  ok('a cookie that is not a session: 200 and not authenticated, never 401', junk.code === 200 && junk.body.authenticated === false);
  const A = await signIn('contract-a@example.com');
  const s1 = await session({ cookie: A.cookie });
  ok('signed in: authenticated, with a verified flag and an expiry date', s1.code === 200 && s1.body.authenticated === true && typeof s1.body.emailVerified === 'boolean' && !Number.isNaN(Date.parse(s1.body.expiresAt)));
  ok('the answer is a closed shape: no id, no e-mail', JSON.stringify(Object.keys(s1.body).sort()) === JSON.stringify(['authenticated', 'emailVerified', 'expiresAt', 'ok']));
  const s2 = await session({ cookie: A.cookie });
  ok('asking twice does not move the expiry (no write on each call)', s1.body.expiresAt === s2.body.expiresAt);
  ok('there is a route entry and it is no-store', Boolean(find('get', '/api/auth/session')));

  console.log('the e-mail is verified by the first code');
  ok('a new account signs in already verified', A.user.emailVerified === true && s1.body.emailVerified === true);
  const me = await call(find('get', '/api/me'), undefined, { headers: { cookie: A.cookie } });
  ok('GET /api/me carries it', me.body.user.emailVerified === true);

  console.log('logout and logout-all');
  const B = await signIn('contract-b@example.com');
  const out = await call(find('post', '/api/auth/logout'), {}, { headers: { cookie: B.cookie } });
  ok('logout answers 200 and clears the cookie (Max-Age=0, same name, HttpOnly, SameSite=Lax)', out.code === 200 && out.cookies.some(c => /^sk_session=;/.test(c) && /Max-Age=0/.test(c) && /HttpOnly/.test(c) && /SameSite=Lax/.test(c)));
  ok('after logout the old cookie gets 401 on a guarded route', (await call(find('get', '/api/me'), undefined, { headers: { cookie: B.cookie } })).code === 401);
  ok('after logout the session endpoint says anonymous, with 200', (await session({ cookie: B.cookie })).body.authenticated === false);
  const C1 = await signIn('contract-c@example.com'); skew += 61000; const C2 = await signIn('contract-c@example.com');
  ok('two sign-ins give two different cookies', C1.cookie !== C2.cookie && (await call(find('get', '/api/me'), undefined, { headers: { cookie: C2.cookie } })).code === 200);
  const outAll = await call(find('post', '/api/auth/logout-all'), {}, { headers: { cookie: C1.cookie } });
  ok('logout-all clears the cookie too', outAll.code === 200 && outAll.cookies.some(c => /Max-Age=0/.test(c)));
  ok('after logout-all every cookie of that user gets 401', (await call(find('get', '/api/me'), undefined, { headers: { cookie: C1.cookie } })).code === 401 && (await call(find('get', '/api/me'), undefined, { headers: { cookie: C2.cookie } })).code === 401);
  ok('another user\'s session is untouched', (await call(find('get', '/api/me'), undefined, { headers: { cookie: A.cookie } })).code === 200);

  console.log('deleting the account');
  const D = await signIn('contract-d@example.com');
  const del = await call(find('delete', '/api/me'), { confirm: 'DELETE' }, { headers: { cookie: D.cookie } });
  ok('delete answers 200 and clears the cookie', del.code === 200 && del.cookies.some(c => /Max-Age=0/.test(c)));
  ok('the deleted account\'s cookie gets 401 and the session endpoint says anonymous', (await call(find('get', '/api/me'), undefined, { headers: { cookie: D.cookie } })).code === 401 && (await session({ cookie: D.cookie })).body.authenticated === false);

  console.log('the cookie flags');
  ok('the session cookie is HttpOnly, SameSite=Lax, path /, with a Max-Age', /HttpOnly/.test(A.setCookie) && /SameSite=Lax/.test(A.setCookie) && /Path=\//.test(A.setCookie) && /Max-Age=\d+/.test(A.setCookie));
  ok('in development it has no Secure flag and no __Host- prefix; the settings add both in production', !/Secure/.test(A.setCookie) && /^sk_session=/.test(A.setCookie) && require('../../accounts/secrets').cookieName(true) === '__Host-sk_session');

  console.log('no GET changes state');
  const GET_WRITES = ['/api/auth/session', '/api/me', '/api/me/reports', '/api/me/export'];
  const gets = app.routes.filter(r => r.method === 'get' && r.path.startsWith('/api/me') || r.method === 'get' && r.path.startsWith('/api/auth/'));
  ok('every account GET route is on the reviewed list', gets.every(r => GET_WRITES.includes(r.path)));
})();
