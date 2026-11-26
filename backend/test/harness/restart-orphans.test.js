const fs = require('fs'), os = require('os'), nodePath = require('path');
const env = { ANTHROPIC_API_KEY: 'k', AI_PERSONAL_DATA_ENGINES: 'anthropic', ACCESS_TOKEN_SECRET: 'tok-secret', ACCOUNTS_ENABLED: 'on', AUTH_PEPPER: 'x'.repeat(40), ACCOUNTS_ALLOW_MEMORY: 'true', ACCOUNTS_DEV_ECHO: 'on', ADMIN_USERNAME: 'a', ADMIN_PASSWORD: 'b' };
Object.assign(process.env, env);
const DIR = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'sk-restart-')); process.env.LIVE_JOBS_DIR = DIR; process.env.PDF_DIR = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'sk-restart-pdf-')); process.env.PDF_AUTO = 'off';
const REFS = { free: 'SK-AAAAAAAAAAA1', paid: 'SK-AAAAAAAAAAA2', done: 'SK-AAAAAAAAAAA3' };
const base = ref => ({ ref, input: { query: 'Marigold Heights', location: 'Pune', country: 'IN', market: 'India' }, contact: null, costUsd: 0, capUsd: null, createdAt: Date.now() - 60000, updatedAt: Date.now() - 60000 });
fs.writeFileSync(nodePath.join(DIR, REFS.free + '.json'), JSON.stringify({ ...base(REFS.free), status: 'sweeping', paid: false }));
fs.writeFileSync(nodePath.join(DIR, REFS.paid + '.json'), JSON.stringify({ ...base(REFS.paid), status: 'sweeping', paid: true, capUsd: 5 }));
fs.writeFileSync(nodePath.join(DIR, REFS.done + '.json'), JSON.stringify({ ...base(REFS.done), status: 'failed', paid: false, failReason: 'engines_unavailable', previewFailedAt: Date.now() - 30000 }));
globalThis.fetch = async () => { throw new Error('no network in this test'); };
const logs = []; const realLog = console.log; console.log = (...a) => { logs.push(a.join(' ')); realLog(...a); };
const app = require(nodePath.join(__dirname, '..', '..', 'server.js'));
console.log = realLog;
const onDisk = ref => JSON.parse(fs.readFileSync(nodePath.join(DIR, ref + '.json'), 'utf8'));
const afterBoot = { free: onDisk(REFS.free), paid: onDisk(REFS.paid), done: onDisk(REFS.done) };

const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route, body, { headers = {}, params = {}, query = {}, path = '' } = {}) { return new Promise(resolve => {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), chunks = [];
  const res = { code: 200, headers: {}, cookies: [], status(c) { this.code = c; return this; }, set(k, v) { if (typeof k === 'object') Object.assign(this.headers, k); else this.headers[k] = v; return this; },
    append(k, v) { if (k === 'Set-Cookie') this.cookies.push(v); return this; }, json(o) { resolve({ code: this.code, body: o, cookies: this.cookies, headers: this.headers }); },
    send(o) { resolve({ code: this.code, body: o, cookies: this.cookies, headers: this.headers }); }, redirect(c, u) { resolve({ code: c, location: u }); },
    write(x) { chunks.push(String(x)); }, flushHeaders() {}, end() { resolve({ code: this.code, ended: true, stream: chunks.join(''), headers: this.headers }); } };
  const req = { body, params, query, ip: '3.3.3.3', path, headers: h, originalUrl: path, get: k => h[k.toLowerCase()], on() {} };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const fn = hs[i++]; if (fn) fn(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });

(async () => {
  console.log('a restart settles the free searches that were running');
  ok('the start-up log says how many were marked failed', logs.some(l => /1 free search running when the server stopped was marked failed \(reason restarted\)/.test(l)));
  ok('the saved file of the unpaid unfinished search is now failed, reason restarted, with a time', afterBoot.free.status === 'failed' && afterBoot.free.failReason === 'restarted' && afterBoot.free.previewFailedAt > 0);
  ok('a paid search is not failed: it is left to resume', afterBoot.paid.status !== 'failed' && !afterBoot.paid.failReason);
  ok('a search that had already failed keeps its own reason', afterBoot.done.failReason === 'engines_unavailable');

  const ua = { 'user-agent': 'Mozilla/5.0 (Macintosh)' };
  const rc = await call(find('post', '/api/auth/request-code'), { email: 'restart@example.com', password: 'restart test password 1', termsAccepted: true }, { headers: ua });
  const vc = await call(find('post', '/api/auth/verify-code'), { email: 'restart@example.com', code: rc.body.devCode }, { headers: ua });
  const h = { cookie: (vc.cookies[0] || '').split(';')[0] };

  console.log('what the buyer sees');
  const rep = await call(find('get', '/api/report/:ref'), undefined, { headers: h, params: { ref: REFS.free }, path: '/api/report/' + REFS.free });
  ok('the report answers 200 unavailable with the reason restarted and a time to retry, not 202 for ever, not 404', rep.code === 200 && rep.body.state === 'unavailable' && rep.body.reason === 'restarted' && rep.body.ready === false && rep.body.phase === 'failed' && Boolean(rep.body.retryAt));
  ok('the message says nothing was charged and to search again', /Nothing was charged/.test(rep.body.error) && /search again/i.test(rep.body.error));
  const ev = await call(find('get', '/api/investigate/:ref/events'), undefined, { headers: h, params: { ref: REFS.free }, path: '/api/investigate/' + REFS.free + '/events' });
  ok('the progress stream sends one error event with the reason and ends, instead of staying empty', ev.ended === true && /event: error/.test(ev.stream) && /"reason":"restarted"/.test(ev.stream) && ev.stream.split('event: error').length === 2);
  const old = await call(find('get', '/api/report/:ref'), undefined, { headers: h, params: { ref: REFS.done }, path: '/api/report/' + REFS.done });
  ok('an earlier failure still says engines_unavailable', old.body.state === 'unavailable' && old.body.reason === 'engines_unavailable');
  const none = await call(find('get', '/api/report/:ref'), undefined, { headers: h, params: { ref: 'SK-BBBBBBBBBBBB' }, path: '/api/report/SK-BBBBBBBBBBBB' });
  ok('a reference nobody started is still 404', none.code === 404);
  const adm = await call(find('get', '/api/admin/delivery'), undefined, { headers: { authorization: 'Basic ' + Buffer.from('a:b').toString('base64') }, path: '/api/admin/delivery' });
  ok('the operator counters count the settled search as a failed free preview', adm.code === 200 && adm.body.freePreview && adm.body.freePreview.failed >= 1);
  setTimeout(() => process.exit(), 200);
})();
