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
const meter = require('../../engines').meter;

(async () => {
  console.log('engine history and costs, through the real server');
  for (const p of ['/api/admin/engines/history', '/api/admin/engines/costs']) ok('GET ' + p + ' refuses a request with no admin login', (await call(find('get', p), undefined, { path: p })).code === 401);
  const empty = await get('/api/admin/engines/history');
  ok('before any call the history is empty, 200, zero totals, 7 days', empty.code === 200 && empty.body.days === 7 && empty.body.rows.length === 0 && empty.body.totals.calls === 0 && empty.body.totals.costUsd === 0);
  const emptyCosts = await get('/api/admin/engines/costs');
  ok('costs on an empty system: 200, no reports, zero totals, 30 days', emptyCosts.code === 200 && emptyCosts.body.days === 30 && emptyCosts.body.reports.length === 0 && emptyCosts.body.totals.reports === 0 && emptyCosts.body.totals.avgCostUsd === 0);

  meter.ok('anthropic', 'research', { usage: { input: 1000, output: 400 }, searches: 2 }, 900, false, 0.02);
  meter.ok('anthropic', 'research', { usage: { input: 1000, output: 400 } }, 1100, true, 0.02);
  meter.fail('anthropic', 'research', new Error('overloaded for someone@example.com'), 300);
  meter.ok('gemini', 'read', { usage: { input: 50, output: 10 } }, 200, false, 0.001);
  const h = await get('/api/admin/engines/history', { query: { days: '1' } });
  const a = h.body.rows && h.body.rows.find(r => r.engine === 'anthropic');
  ok('calls through the meter show up: 3 calls, 1 failure, 1 rescue, 2000 tokens in, cost 0.04', h.code === 200 && a && a.calls === 3 && a.failures === 1 && a.rescues === 1 && a.tokensIn === 2000 && a.costUsd === 0.04);
  ok('two engines, rows in day order, totals add up', h.body.rows.length === 2 && h.body.totals.calls === 4 && h.body.totals.costUsd === 0.041 && h.body.byEngine.length === 2 && h.body.byEngine[0].engine === 'anthropic');
  ok('p50 does not exceed p95, and the average is a number', h.body.rows.every(r => r.p50Ms <= r.p95Ms && Number.isFinite(r.avgMs)));
  ok('no error text, e-mail address or prompt in the response', !/someone@|overloaded|prompt/i.test(JSON.stringify(h.body)));
  ok('the old route still answers with the in-memory snapshot', (await get('/api/admin/engines')).code === 200);
  for (const d of ['1', '30', '90']) ok('days=' + d + ' is accepted', (await get('/api/admin/engines/history', { query: { days: d } })).code === 200 && (await get('/api/admin/engines/costs', { query: { days: d } })).code === 200);
  for (const d of ['0', '-1', '91', '1000', 'abc', '1.5', '1e1']) {
    const x = await get('/api/admin/engines/history', { query: { days: d } }), y = await get('/api/admin/engines/costs', { query: { days: d } });
    ok('days=' + JSON.stringify(d) + ' is refused with 400 on both routes, not 500', x.code === 400 && y.code === 400 && x.body.code === 'invalid');
  }
  ok('an unknown parameter is ignored', (await get('/api/admin/engines/history', { query: { foo: '1' } })).code === 200);
  ok('there is no way to write: POST finds nothing', !find('post', '/api/admin/engines/history') && !find('post', '/api/admin/engines/costs'));
  meter.reset();
})();
