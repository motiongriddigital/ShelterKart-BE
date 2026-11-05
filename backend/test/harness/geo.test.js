const crypto = require('crypto');
const env = { ADMIN_USERNAME:'a', ADMIN_PASSWORD:'b', ANTHROPIC_API_KEY:'k', AI_PERSONAL_DATA_ENGINES:'anthropic', PAYMENT_WEBHOOK_SECRET:'whsec', ACCESS_TOKEN_SECRET:'tok-secret', GSTIN: '27ABCDE1234F1Z5', RAZORPAY_KEY_ID:'rzp_test_id', RAZORPAY_KEY_SECRET:'key_secret',
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
function call(route, body, { headers = {}, params = {}, query = {}, path = '', ip = '3.3.3.3' } = {}) { return new Promise(resolve => {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const res = { code: 200, headers: {}, cookies: [], status(c) { this.code = c; return this; }, set(k, v) { if (typeof k === 'object') Object.assign(this.headers, k); else this.headers[k] = v; return this; },
    append(k, v) { if (k === 'Set-Cookie') this.cookies.push(v); return this; }, json(o) { resolve({ code: this.code, body: o, cookies: this.cookies }); },
    send(o) { resolve({ code: this.code, body: o, cookies: this.cookies }); }, redirect(c, u) { resolve({ code: c, location: u }); }, write() {}, end() { resolve({ code: this.code, ended: true }); }, flushHeaders() {} };
  const req = { body, params, query, ip, path, headers: h, originalUrl: path, get: k => h[k.toLowerCase()], on() {} };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const fn = hs[i++]; if (fn) fn(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });


async function signInFrom(email, headers, ip) {
  const h = { 'user-agent': 'Mozilla/5.0 (Macintosh)', ...headers };
  const rc = await call(find('post', '/api/auth/request-code'), { email }, { headers: h, ip });
  const vc = await call(find('post', '/api/auth/verify-code'), { email, code: rc.body.devCode, termsAccepted: true }, { headers: h, ip });
  return { code: vc.code, user: vc.body.user, cookie: (vc.cookies[0] || '').split(';')[0] };
}
const ADMIN = { authorization: 'Basic ' + Buffer.from('a:b').toString('base64') };
const geo = (o = {}) => call(find('get', '/api/admin/geo/users'), undefined, { headers: ADMIN, path: '/api/admin/geo/users', ...o });
const mkt = (g, c) => g.body.markets.find(m => m.code === c);

(async () => {
  console.log('users by country, through the real server');
  const none = await call(find('get', '/api/admin/geo/users'), undefined, { path: '/api/admin/geo/users' });
  ok('the route refuses a request with no admin login', none.code === 401);
  const empty = await geo();
  ok('an empty system answers 200 with 36 markets and no users', empty.code === 200 && empty.body.markets.length === 36 && empty.body.totals.users === 0);

  const a = await signInFrom('geo-a@example.com', { 'cf-ipcountry': 'IN' }, '11.0.0.1');
  ok('a first sign-in with the edge country header works and the response is unchanged in shape', a.code === 200 && a.user && a.user.email === 'geo-a@example.com');
  ok('the new user\'s country is IN', a.user.country === 'IN');
  const b = await signInFrom('geo-b@example.com', { 'x-forwarded-for': '8.8.8.8' }, '8.8.8.8');
  ok('no edge header, a forged X-Forwarded-For and a real-looking address: country stays empty', b.code === 200 && b.user.country === null);
  const c = await signInFrom('geo-c@example.com', { 'cf-ipcountry': 'XX' }, '11.0.0.3');
  const d = await signInFrom('geo-d@example.com', { 'cf-ipcountry': 'India' }, '11.0.0.4');
  const e = await signInFrom('geo-e@example.com', { 'cf-ipcountry': 'gb' }, '11.0.0.5');
  const f = await signInFrom('geo-f@example.com', { 'cf-ipcountry': 'CN' }, '11.0.0.6');
  ok('the edge unknown code and a long name are not stored', c.user.country === null && d.user.country === null);
  ok('lower case is stored as upper case', e.user.country === 'GB');

  const realNow = Date.now; Date.now = () => realNow() + 120000;
  const again = await signInFrom('geo-a@example.com', { 'cf-ipcountry': 'US' }, '11.0.0.7');
  Date.now = realNow;
  ok('the same user signing in again from another country keeps the first one', again.code === 200 && again.user.country === 'IN');
  const body = await signInFrom('geo-g@example.com', {}, '11.0.0.8');
  ok('a country sent in a request body at sign-in has no effect', body.user.country === null);

  const g = await geo();
  ok('India has 1 user, the United Kingdom 1 (GB), a non-market country goes to other', mkt(g, 'in').users === 1 && mkt(g, 'uk').users === 1 && g.body.other.users === 1);
  ok('users with no country are in unknown (b, c, d, g)', g.body.unknown.users === 4);
  ok('the sum over markets, other and unknown equals the number of users', g.body.totals.users === 7 && g.body.markets.reduce((s, m) => s + m.users, g.body.other.users + g.body.unknown.users) === 7);
  ok('all seven are new this week', g.body.totals.newThisWeek === 7 && mkt(g, 'in').newThisWeek === 1);
  ok('a market with no users has conversion 0', mkt(g, 'jp').users === 0 && mkt(g, 'jp').conversion === 0);
  const text = JSON.stringify(g.body);
  ok('no e-mail address, IP address or user id in the response', !/@|geo-|8\.8\.8\.8|11\.0\.0|[0-9a-f]{8}-[0-9a-f]{4}-/.test(text));
  ok('every number in the response is a number', !/NaN|Infinity|null,"users"/.test(text) && g.body.markets.every(m => [m.users, m.newThisWeek, m.paid, m.conversion].every(Number.isFinite)));
  const odd = await geo({ query: { days: 'abc', foo: '1' } });
  ok('unknown query parameters are ignored, not a 500', odd.code === 200);
  ok('there is no route to change it: POST finds nothing', !find('post', '/api/admin/geo/users'));
})();
