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
const ERRS = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const eventsOf = name => ANALYTICS._memory.filter(e => e.event === name);
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route, body, { headers = {}, params = {}, query = {}, path = '', ip = '3.3.3.3' } = {}) { return new Promise(resolve => {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const res = { code: 200, headers: {}, cookies: [], status(c) { this.code = c; return this; }, set(k, v) { if (typeof k === 'object') Object.assign(this.headers, k); else this.headers[k] = v; return this; },
    append(k, v) { if (k === 'Set-Cookie') this.cookies.push(v); return this; }, json(o) { resolve({ code: this.code, body: o, cookies: this.cookies }); return this; },
    send(o) { resolve({ code: this.code, body: o, cookies: this.cookies }); }, redirect(c, u) { resolve({ code: c, location: u }); }, write() {}, end() { resolve({ code: this.code, ended: true }); }, flushHeaders() {} };
  const req = { body, params, query, ip, path, headers: h, originalUrl: path, get: k => h[k.toLowerCase()], on() {} };
  const hs = route.handlers; let i = 0; const next = err => { if (err) { ERRS.push(err.message); return resolve({ code: 500, body: { error: err.message } }); } const fn = hs[i++]; if (fn) fn(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });

async function signIn(email, ip) {
  const ua = { 'user-agent': 'Mozilla/5.0 (Macintosh)' };
  const rc = await call(find('post', '/api/auth/request-code'), { email }, { headers: ua });
  const vc = await call(find('post', '/api/auth/verify-code'), { email, code: rc.body.devCode, termsAccepted: true }, { headers: ua });
  return { cookie: (vc.cookies[0] || '').split(';')[0], user: vc.body.user };
}

const ADMIN = { authorization: 'Basic ' + Buffer.from('a:b').toString('base64') };
const UA = { 'user-agent': 'Mozilla/5.0 (Macintosh)' };
const A = (m, p, params) => ({ route: find(m, p), params });
const admin = (m, p, body, o = {}) => call(find(m, p), body, { headers: ADMIN, path: p, ...o });

(async () => {
  console.log('the admin routes need the operator login');
  for (const [m, p] of [['get', '/api/admin/users'], ['get', '/api/admin/sessions'], ['get', '/api/admin/bans'], ['post', '/api/admin/bans'], ['get', '/api/admin/auth/summary']]) {
    const r = await call(find(m, p), {}, { path: p });
    ok(m.toUpperCase() + ' ' + p + ' refuses a request with no admin login', r.code === 401);
  }

  console.log('sign-in activity is counted');
  const email = 'tracked@example.com';
  const rc = await call(find('post', '/api/auth/request-code'), { email }, { headers: UA });
  ok('a code request is answered', rc.code === 202 && rc.body.devCode);
  const again = await call(find('post', '/api/auth/request-code'), { email }, { headers: UA });
  ok('asking again at once hits the cooldown (429)', again.code === 429 && again.body.code === 'cooldown');
  const w1 = await call(find('post', '/api/auth/verify-code'), { email, code: '000000', termsAccepted: true }, { headers: UA });
  const w2 = await call(find('post', '/api/auth/verify-code'), { email, code: '111111', termsAccepted: true }, { headers: UA });
  ok('two wrong codes are refused', w1.code === 400 && w2.code === 400);
  const vc = await call(find('post', '/api/auth/verify-code'), { email, code: rc.body.devCode, termsAccepted: true }, { headers: UA });
  const cookie = (vc.cookies[0] || '').split(';')[0];
  ok('the right code signs in', vc.code === 200 && cookie);

  const list = await admin('get', '/api/admin/users', undefined, { query: { q: 'tracked' } });
  const row = (list.body.users || []).find(u => u.email === email);
  ok('the user list finds the account by part of its address', list.code === 200 && row && row.activeSessions === 1 && row.disabled === false);

  const detail = await admin('get', '/api/admin/users/:id', undefined, { params: { id: row.id } });
  const s = detail.body.signIn && detail.body.signIn.last24h;
  ok('the user page counts the code request, the cooldown hit, two wrong codes and one sign-in', detail.code === 200 && s.codesRequested === 1 && s.cooldownHits === 1 && s.wrongCodes === 2 && s.signIns === 1 && s.locked === 0);
  const kinds = detail.body.signIn.events.map(e => e.kind);
  ok('the recent events are listed newest first, with no code and no raw address', kinds[0] === 'login_ok' && kinds.includes('code_wrong') && !JSON.stringify(detail.body.signIn.events).includes('3.3.3.3') && !JSON.stringify(detail.body.signIn.events).includes(rc.body.devCode));
  ok('the session shows a short address hash, never the address', detail.body.sessions.length === 1 && /^[0-9a-f]{12}$/.test(detail.body.sessions[0].ip));

  console.log('locking a code');
  const other = 'locked@example.com';
  const rc2 = await call(find('post', '/api/auth/request-code'), { email: other }, { headers: UA });
  for (let i = 0; i < 6; i++) await call(find('post', '/api/auth/verify-code'), { email: other, code: '123456', termsAccepted: true }, { headers: UA });
  const sum = await admin('get', '/api/admin/auth/summary', undefined, { query: { hours: '24' } });
  ok('the summary counts the lock and the wrong codes across everyone', sum.body.summary.locked === 1 && sum.body.summary.wrongCodes >= 7 && rc2.code === 202);

  console.log('disable and enable');
  const dis = await admin('post', '/api/admin/users/:id/disable', { reason: 'test' }, { params: { id: row.id } });
  ok('disabling ends the session at once', dis.code === 200 && (await call(find('get', '/api/me'), undefined, { headers: { cookie } })).code === 401);
  const en = await admin('post', '/api/admin/users/:id/enable', {}, { params: { id: row.id } });
  ok('enabling is accepted', en.code === 200 && en.body.disabled === false);

  console.log('banning an account');
  const bad1 = await admin('post', '/api/admin/bans', { kind: 'account', target: 'not-an-email', reason: 'long enough reason' });
  const bad2 = await admin('post', '/api/admin/bans', { kind: 'account', target: email, reason: 'short' });
  ok('a ban needs a real target and a reason', bad1.code === 400 && bad2.code === 400);
  const dayBad = await admin('post', '/api/admin/bans', { kind: 'account', target: 'days-bad@example.com', reason: 'long enough reason', days: 99999 });
  await sleep(30);
  ok('a refused ban answers once and raises no error afterwards', dayBad.code === 400 && ERRS.length === 0);
  const signed = (await signIn('ban-me@example.com')).cookie;
  ok('the account has a working session first', (await call(find('get', '/api/me'), undefined, { headers: { cookie: signed } })).code === 200);
  const ban = await admin('post', '/api/admin/bans', { kind: 'account', target: 'Ban-Me@Example.com', reason: 'chargeback and abuse', days: 7 });
  ok('the ban is created, with its end date', ban.code === 200 && ban.body.ban.active === true && ban.body.ban.expiresAt && ban.body.ban.target === 'ban-me@example.com');
  ok('banning ends its sessions', (await call(find('get', '/api/me'), undefined, { headers: { cookie: signed } })).code === 401);
  const blocked = await call(find('post', '/api/auth/request-code'), { email: 'ban-me@example.com' }, { headers: UA });
  ok('a banned account cannot ask for a code (403 account_banned)', blocked.code === 403 && blocked.body.code === 'account_banned');
  ok('the same ban twice is refused', (await admin('post', '/api/admin/bans', { kind: 'account', target: 'ban-me@example.com', reason: 'chargeback and abuse' })).code === 409);
  const lift = await admin('post', '/api/admin/bans/:id/lift', {}, { params: { id: ban.body.ban.id } });
  ok('lifting the ban works', lift.code === 200 && lift.body.ban.active === false);
  const after = await call(find('post', '/api/auth/request-code'), { email: 'ban-me@example.com' }, { headers: UA });
  ok('afterwards the address is no longer blocked (the cooldown answers instead)', after.code === 429 && after.body.code === 'cooldown');
  ok('the active list no longer has it, the full list does', !(await admin('get', '/api/admin/bans')).body.bans.some(b => b.target === 'ban-me@example.com') && (await admin('get', '/api/admin/bans', undefined, { query: { status: 'all' } })).body.bans.some(b => b.target === 'ban-me@example.com'));

  console.log('banning an IP address');
  ok('an address range wider than /8 is refused', (await admin('post', '/api/admin/bans', { kind: 'ip', target: '10.0.0.0/4', reason: 'too wide to be safe' })).code === 400);
  ok('the operator cannot ban the address in use', (await admin('post', '/api/admin/bans', { kind: 'ip', target: '3.3.3.0/24', reason: 'would lock me out' })).body.code === 'self_ban');
  const ipBan = await admin('post', '/api/admin/bans', { kind: 'ip', target: '9.9.9.0/24', reason: 'automated searches from this range' });
  ok('a range is banned', ipBan.code === 200 && ipBan.body.ban.target === '9.9.9.0/24');
  const fromBanned = await call(find('post', '/api/auth/request-code'), { email: 'x@example.com' }, { headers: UA, ip: '9.9.9.77' });
  ok('a request from inside the range is refused (403 ip_banned)', fromBanned.code === 403 && fromBanned.body.code === 'ip_banned');
  const fromOutside = await call(find('post', '/api/auth/request-code'), { email: 'y@example.com' }, { headers: UA, ip: '9.9.10.1' });
  ok('a request from outside it is not', fromOutside.code === 202);
  ok('the refusal is counted as a blocked attempt', (await admin('get', '/api/admin/auth/summary')).body.summary.blocked >= 2);

  console.log('banning from a session');
  await signIn('listed@example.com');
  const sess = await admin('get', '/api/admin/sessions');
  const one = (sess.body.sessions || []).find(x => x.email === 'listed@example.com');
  ok('the sessions list names the account and a short address hash', sess.code === 200 && one && one.email && /^[0-9a-f]{12}$/.test(one.ip));
  const own = await signIn('from-eight@example.com');
  const sessions2 = (await admin('get', '/api/admin/sessions')).body.sessions;
  const mine = sessions2.find(x => x.email === 'from-eight@example.com');
  const endOne = await admin('post', '/api/admin/sessions/:id/revoke', {}, { params: { id: mine.id } });
  ok('one session can be ended', endOne.code === 200 && (await call(find('get', '/api/me'), undefined, { headers: { cookie: own.cookie } })).code === 401);
  const own2 = await signIn('from-nine@example.com');
  const mine2 = (await admin('get', '/api/admin/sessions')).body.sessions.find(x => x.email === 'from-nine@example.com');
  const refusedIp = await admin('post', '/api/admin/sessions/:id/ban-ip', { reason: 'short' }, { params: { id: mine2.id } });
  await sleep(30);
  ok('a refused ban from a session leaves the session alive and raises no error', refusedIp.code === 400 && ERRS.length === 0 && (await call(find('get', '/api/me'), undefined, { headers: { cookie: own2.cookie } })).code === 200);
  const banHash = await admin('post', '/api/admin/sessions/:id/ban-ip', { reason: 'abuse seen on this session', days: 3 }, { params: { id: mine2.id } });
  ok('an address is banned from its session, by hash', banHash.code === 200 && /^hash:[0-9a-f]{12}$/.test(banHash.body.ban.target));
  ok('the banned address is refused from then on', (await call(find('post', '/api/auth/request-code'), { email: 'z@example.com' }, { headers: UA })).body.code === 'ip_banned' && own2.cookie);
})();
