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
const post = (path, o = {}) => call(find('post', path), {}, { headers: ADMIN, path, ...o });
const audit = (q = {}) => call(find('get', '/api/admin/audit'), undefined, { headers: ADMIN, path: '/api/admin/audit', query: q });
const ID = '5f0c1c1e-8a3b-4c52-9d3a-1b2c3d4e5f60';

(async () => {
  console.log('the audit ledger of legal actions, through the real server');
  const none = await call(find('get', '/api/admin/audit'), undefined, { path: '/api/admin/audit' });
  ok('the ledger refuses a request with no admin login', none.code === 401);
  const empty = await audit();
  ok('it starts empty, 200', empty.code === 200 && Array.isArray(empty.body.rows) && empty.body.rows.length === 0);

  const d = await post('/api/admin/disputes/:id/resolve', { params: { id: ID } });
  ok('resolving a dispute still answers 200 and says it was audited', d.code === 200 && d.body.ok === true && d.body.audited === true);
  const ap = await post('/api/admin/responses/:id/approve', { params: { id: ID } });
  const rj = await post('/api/admin/responses/:id/reject', { params: { id: ID } });
  ok('approving and rejecting a developer reply are audited', ap.body.audited === true && rj.body.audited === true);
  const pg = await post('/api/admin/purge', { body: undefined });
  ok('a purge with nothing to purge is still refused with 400 and writes no row', pg.code === 400);
  const purge = await call(find('post', '/api/admin/purge'), { host: 'example.test' }, { headers: ADMIN, path: '/api/admin/purge' });
  ok('a purge of a host answers 200 and is audited', purge.code === 200 && purge.body.audited === true);
  const held = await post('/api/admin/held/:ref/approve', { params: { ref: 'SK-ABCDEF123456' } });
  ok('releasing the held findings of a report that does not exist is 404 and writes no row', held.code === 404);
  const bad = await post('/api/admin/disputes/:id/resolve', { params: { id: 'not-a-uuid' } });
  ok('a malformed id is refused with 400 and writes no row', bad.code === 400);
  const noauth = await call(find('post', '/api/admin/disputes/:id/resolve'), {}, { path: '/x', params: { id: ID } });
  ok('with no login the action is refused and writes no row', noauth.code === 401);

  const all = await audit();
  ok('there are exactly four rows: dispute, two replies, purge', all.body.rows.length === 4);
  ok('each says who: the username of the admin login', all.body.rows.every(r => r.actor === 'admin:a'));
  const byAction = Object.fromEntries(all.body.rows.map(r => [r.action, r]));
  ok('the actions are named and the objects are right', byAction.DISPUTE_RESOLVED.objectType === 'dispute' && byAction.DISPUTE_RESOLVED.objectId === ID && byAction.REPLY_APPROVED.objectType === 'developer_reply' && byAction.REPLY_REJECTED.after.status === 'rejected' && byAction.SOURCE_PURGED.reason === 'host example.test');
  ok('newest first', all.body.rows[0].action === 'SOURCE_PURGED');
  ok('a filter by action works', (await audit({ action: 'REPLY_APPROVED' })).body.rows.length === 1);
  for (const l of ['0', '201', 'abc', '1.5', '-1']) ok('limit=' + l + ' is refused with 400', (await audit({ limit: l })).code === 400);
  ok('limit=2 returns two rows', (await audit({ limit: '2' })).body.rows.length === 2);
})();
