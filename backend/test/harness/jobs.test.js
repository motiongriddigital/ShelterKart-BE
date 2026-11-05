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


const ADMIN = { authorization: 'Basic ' + Buffer.from('a:b').toString('base64') };
const get = (p, o = {}) => call(find('get', p), undefined, { headers: ADMIN, path: p, ...o });
const retry = (id, o = {}) => call(find('post', '/api/admin/jobs/:id/retry'), {}, { headers: ADMIN, path: '/api/admin/jobs/x/retry', params: { id }, ...o });

(async () => {
  console.log('failed jobs and register history, through the real server');
  for (const [m, p] of [['get', '/api/admin/jobs/failed'], ['post', '/api/admin/jobs/:id/retry'], ['get', '/api/admin/health/registers/history']])
    ok(m.toUpperCase() + ' ' + p + ' refuses a request with no admin login', (await call(find(m, p), {}, { path: p, params: { id: 'report:SK-1' } })).code === 401);

  const empty = await get('/api/admin/jobs/failed');
  ok('an empty system lists no failed jobs, with 200', empty.code === 200 && empty.body.ok === true && empty.body.total === 0 && Array.isArray(empty.body.jobs) && empty.body.jobs.length === 0);
  ok('retry answers 400 for ids that are not from the list', (await Promise.all(['abc', 'report:', 'delivery:SK-1', 'x:y', '../a'].map(id => retry(id)))).every(r => r.code === 400 && r.body.code === 'invalid'));
  const none = await retry('report:SK-NOPE');
  ok('retry of a report that does not exist is 404', none.code === 404 && none.body.code === 'not_found');
  const nf = await retry('delivery:SK-NOPE:email');
  ok('retry of a delivery that did not fail is 409', nf.code === 409 && nf.body.code === 'not_failed');
  ok('there is no GET for retry', !find('get', '/api/admin/jobs/:id/retry'));
  ok('no response carries a stack trace or SQL', ![empty, none, nf].some(r => /at .*\.js|SELECT|relation/.test(JSON.stringify(r.body))));

  const h = await get('/api/admin/health/registers/history');
  ok('history answers 200 with one series per market that has a register', h.code === 200 && h.body.days === 30 && h.body.registers.length === Object.values(require('../../engine/markets').MARKETS).filter(m => m.registry).length && h.body.registers.length > 0 && h.body.registers.every(r => r.market && Array.isArray(r.points) && r.checks === 0 && r.uptime === null));
  ok('every series has a name and no market without a register is in it', h.body.registers.every(r => typeof r.name === 'string' && r.name));
  for (const d of ['1', '7', '90']) ok('days=' + d + ' is accepted', (await get('/api/admin/health/registers/history', { query: { days: d } })).code === 200);
  for (const d of ['0', '-5', '91', '1000', 'abc', '1.5', '1e3', '7 ']) { const r = await get('/api/admin/health/registers/history', { query: { days: d } }); ok('days=' + JSON.stringify(d) + ' is refused with 400, not 500', r.code === 400 && r.body.code === 'invalid'); }
  ok('the history is not changed by an unknown parameter', (await get('/api/admin/health/registers/history', { query: { foo: '1' } })).code === 200);
})();
