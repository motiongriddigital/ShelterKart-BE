'use strict';
/** The rate limits count a signed-in request for its account and a report view or a quote apart from the start of a search; the admin limit counts only refused sign-ins. */
process.env.RESEARCH_HOURLY_PER_IP = '3'; process.env.REPORT_READS_HOURLY = '5'; process.env.QUOTES_HOURLY = '4';
const assert = require('assert');
const express = require('express');
const http = require('http');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const c = {}; require('../middleware/limiters')(c);
const app = express();
app.use((req, res, next) => { const u = req.get('x-user'); if (u) req.accountUser = { id: u }; next(); });
app.get('/read', c.reportReadLimiter, (req, res) => res.json({ ok: true }));
app.post('/quote', c.quoteLimiter, (req, res) => res.json({ ok: true }));
app.post('/start', express.json(), c.researchLimiter, (req, res) => res.json({ ok: true }));
app.use('/api/admin', c.adminLimiter);
app.get('/api/admin/ok', (req, res) => res.json({ ok: true }));
app.get('/api/admin/unavailable', (req, res) => res.status(503).json({ ok: false }));
app.get('/api/admin/missing', (req, res) => res.status(404).json({ ok: false }));
app.get('/api/admin/login', (req, res) => res.status(401).json({ ok: false }));

(async () => {
  const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const hit = async (method, path, user, body) => (await fetch(base + path, { method, headers: { ...(user ? { 'x-user': user } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })).status;
  const many = async (n, ...a) => { const out = []; for (let i = 0; i < n; i++) out.push(await hit(...a)); return out; };

  console.log('every visitor reaches the server from one address');
  await t('two signed-in users each get their own count for viewing reports', async () => {
    assert.deepStrictEqual(await many(6, 'GET', '/read', 'A'), [200, 200, 200, 200, 200, 429]);
    assert.deepStrictEqual(await many(5, 'GET', '/read', 'B'), [200, 200, 200, 200, 200]);
  });
  await t('viewing reports does not use up the budget for starting searches', async () => {
    assert.deepStrictEqual(await many(4, 'POST', '/start', 'C', { query: 'x', location: '' }), [200, 200, 200, 429]);
    assert.deepStrictEqual(await many(5, 'GET', '/read', 'C'), [200, 200, 200, 200, 200]);
  });
  await t('a start by one user does not count against another user from the same address', async () => {
    assert.deepStrictEqual(await many(3, 'POST', '/start', 'D', { query: 'y', location: '' }), [200, 200, 200]);
    assert.deepStrictEqual(await many(3, 'POST', '/start', 'E', { query: 'z', location: '' }), [200, 200, 200]);
  });
  await t('a quote has its own count, apart from starting a search', async () => {
    assert.deepStrictEqual(await many(5, 'POST', '/quote', 'F'), [200, 200, 200, 200, 429]);
    assert.deepStrictEqual(await many(3, 'POST', '/start', 'F', { query: 'q', location: '' }), [200, 200, 200]);
  });
  await t('visitors with no account share the count of their address, as before', async () => {
    assert.deepStrictEqual(await many(4, 'POST', '/start', null, { query: 'anon', location: '' }), [200, 200, 200, 429]);
  });
  await t('the limit message says what was limited', async () => {
    const r = await fetch(base + '/read', { headers: { 'x-user': 'A' } }); const j = await r.json();
    assert.strictEqual(r.status, 429); assert(/reports/.test(j.error));
  });

  console.log('the admin console');
  await t('a panel that answers 503 or 404, or an admin who is signed in, is never counted', async () => {
    const out = [...await many(15, 'GET', '/api/admin/unavailable'), ...await many(15, 'GET', '/api/admin/missing'), ...await many(5, 'GET', '/api/admin/ok')];
    assert(out.every(s => s !== 429), 'a 429 appeared: ' + [...new Set(out)]);
  });
  await t('refused sign-ins still count, and after twenty the answer is 429', async () => {
    const out = await many(22, 'GET', '/api/admin/login'); assert.strictEqual(out.filter(s => s === 401).length, 20); assert.strictEqual(out[21], 429);
  });
  await t('once the limit is reached even the console\'s ordinary calls wait, which is the lock on guessing', async () => {
    assert.strictEqual(await hit('GET', '/api/admin/ok'), 429);
  });

  console.log('the sign-in limits');
  await t('request-code: refused requests (a bad e-mail, a weak password) do not use up the hourly count, and the limit answer says how long to wait', async () => {
    const { createAccounts } = require('../accounts'), { makeAccountStore } = require('../accounts/store');
    const A = createAccounts({ env: { ACCOUNTS_ENABLED: 'on', AUTH_PEPPER: 'p'.repeat(40), ACCOUNTS_ALLOW_MEMORY: 'true', NODE_ENV: 'test' }, store: makeAccountStore(null), rateLimit: require('../middleware/rateLimit').rateLimit, mail: async () => true, alert: async () => {}, mailConfigured: true, entitled: async () => false, purchasesOf: async () => [], briefInfo: async () => null });
    const a2 = express(); a2.use(express.json()); A.mount(a2); const s2 = http.createServer(a2); await new Promise(r => s2.listen(0, '127.0.0.1', r));
    const b2 = 'http://127.0.0.1:' + s2.address().port;
    const post = async body => { const r = await fetch(b2 + '/api/auth/request-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
    for (let i = 0; i < 30; i++) assert.strictEqual((await post({ email: 'not-an-address', password: 'x' })).status, 400);
    assert.strictEqual((await post({ email: 'real@example.com', password: 'a fine password 12345', termsAccepted: true })).status, 202);
    let last; for (let i = 0; i < 25; i++) last = await post({ email: `n${i}@example.com`, password: 'a fine password 12345', termsAccepted: true });
    assert.strictEqual(last.status, 429); assert.strictEqual(last.json.code, 'rate_limited'); assert(last.json.retryAfter > 0, 'no retryAfter: ' + JSON.stringify(last.json));
    s2.close();
  });

  server.close(); console.log(`${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
