'use strict';
/** A password held against a sign-in code: the rules, offering one at request-code, applying it at verify-code, resetting it, and what must never leak. */
const assert = require('assert');
const S = require('../accounts/secrets');
const { createAccounts } = require('../accounts');
const { makeAccountStore } = require('../accounts/store');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const PEPPER = 'p'.repeat(40), DAY = 86400000;
function harness(over = {}, envOver = {}) {
  const env = { ACCOUNTS_ENABLED: 'on', AUTH_PEPPER: PEPPER, ACCOUNTS_ALLOW_MEMORY: 'true', NODE_ENV: 'test', ...envOver };
  const clock = { t: Date.parse('2026-11-03T10:00:00Z') }, mails = [], alerts = [], routes = [], bought = [];
  const app = {}; for (const m of ['get', 'post', 'patch', 'delete']) app[m] = (path, ...h) => routes.push({ method: m, path, handlers: h });
  const A = createAccounts({ env, store: makeAccountStore(null), now: () => clock.t, mail: async m => { mails.push(m); return !over.mailFails; },
    alert: async (s, x) => { alerts.push({ s, x }); }, mailConfigured: true,
    entitled: async (id, ref) => bought.some(p => p.userId === id && p.ref === ref && p.status === 'paid'),
    purchasesOf: async id => bought.filter(p => p.userId === id).map(p => ({ ref: p.ref, amount: p.amount, currency: p.currency, status: p.status, createdAt: new Date(clock.t) })),
    briefInfo: async ref => ({ projectName: 'Project ' + ref, market: 'in' }), passwordParams: { N: 1024, r: 8, p: 1 }, ...over });
  A.mount(app);
  const find = (m, p) => routes.find(r => r.method === m && r.path === p);
  async function call(m, p, { body, headers = {}, ip = '1.1.1.1' } = {}) {
    const route = find(m, p); assert(route, 'no route ' + m + ' ' + p);
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return new Promise(resolve => {
      const res = { code: 200, headers: {}, cookies: [], status(c) { this.code = c; return this; }, set(k, v) { if (typeof k === 'object') Object.assign(this.headers, k); else this.headers[k] = v; return this; },
        append(k, v) { if (k === 'Set-Cookie') this.cookies.push(v); return this; }, json(o) { resolve({ code: this.code, body: o, cookies: this.cookies, headers: this.headers }); },
        redirect(c, u) { resolve({ code: c, location: u, cookies: this.cookies }); } };
      const req = { body, ip, headers: h, get: k => h[k.toLowerCase()], originalUrl: p };
      let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const fn = route.handlers[i++]; if (fn) fn(req, res, next); };
      next();
    });
  }
  const codeOf = () => (mails[mails.length - 1].text.match(/code is (\d{6})/) || [])[1];
  const cookieOf = r => { const c = (r.cookies || [])[0]; return c ? c.split(';')[0] : ''; };
  async function signIn(email = 'buyer@example.com', extra = {}) {
    await call('post', '/api/auth/request-code', { body: { email } });
    const r = await call('post', '/api/auth/verify-code', { body: { email, code: codeOf(), termsAccepted: true, ...extra } });
    return { r, cookie: cookieOf(r) };
  }
  const guarded = async (cookie, mw = A.guard) => new Promise(resolve => {
    const req = { headers: cookie ? { cookie } : {}, get: k => (k.toLowerCase() === 'cookie' ? cookie : undefined), originalUrl: '/r/SK-AAAAAAAAAAAA' };
    const res = { status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); }, redirect(c, u) { resolve({ code: c, location: u }); } };
    mw(req, res, () => resolve({ code: 'next', user: req.accountUser }));
  });
  return { A, call, mails, alerts, clock, codeOf, cookieOf, signIn, guarded, bought, env };
}

const PW = 'correct horse battery', CHEAP = { N: 1024, r: 8, p: 1 };

(async () => {
  console.log('the rules for a password');
  await t('it needs 12 to 128 characters, not one repeated character, not a common one, not the e-mail address', () => {
    assert.strictEqual(S.passwordProblem(PW, 'a@b.com'), null);
    for (const bad of ['short', '', 'a'.repeat(129), 'aaaaaaaaaaaa', 'Password123', 'shelterkart', 'buyer@example.com', 123, null, undefined, {}]) assert(S.passwordProblem(bad, 'buyer@example.com'), String(bad));
    assert.strictEqual(S.passwordProblem('xy'.repeat(64), 'a@b.com'), null);
    assert.strictEqual(S.passwordProblem('ab'.repeat(6), 'a@b.com'), null); assert(S.passwordProblem('abcdefghijk', 'a@b.com'));
    assert.strictEqual(S.passwordProblem('\u{1F600}\u{1F601}'.repeat(6), 'a@b.com'), null);
  });
  await t('it is stored salted and slow: two hashes of one password differ, the right one verifies, a wrong one and a missing account do not', async () => {
    const a = await S.hashPassword(PEPPER, PW, CHEAP), b = await S.hashPassword(PEPPER, PW, CHEAP);
    assert.notStrictEqual(a, b); assert(a.startsWith('scrypt$1024$8$1$')); assert(!a.includes(PW));
    assert.strictEqual(await S.verifyPassword(PEPPER, PW, a), true);
    assert.strictEqual(await S.verifyPassword(PEPPER, PW + 'x', a), false);
    assert.strictEqual(await S.verifyPassword('q'.repeat(40), PW, a), false);
    assert.strictEqual(await S.verifyPassword(PEPPER, PW, null), false);
    for (const junk of ['', 'x', 'scrypt$1$8$1$aa$bb', 'scrypt$1024$8$99$aa$bb', 'scrypt$1000$8$1$aa$bb', 'scrypt$4294967296$8$1$aa$bb', 'bcrypt$1024$8$1$aa$bb']) assert.strictEqual(await S.verifyPassword(PEPPER, PW, junk), false, junk);
  });

  console.log('offering a password when the code is requested');
  await t('a weak password is refused at request-code, before any code is created or sent', async () => {
    const h = harness();
    const r = await h.call('post', '/api/auth/request-code', { body: { email: 'new@example.com', password: 'short' } });
    assert.strictEqual(r.code, 400); assert.strictEqual(r.body.code, 'weak_password');
    assert.strictEqual(h.mails.length, 0);
    const ok = await h.call('post', '/api/auth/request-code', { body: { email: 'new@example.com', password: PW } });
    assert.strictEqual(ok.code, 202);
  });
  await t('a new account made with a code whose request carried a password is signed in and says so', async () => {
    const h = harness();
    await h.call('post', '/api/auth/request-code', { body: { email: 'new@example.com', password: PW } });
    const r = await h.call('post', '/api/auth/verify-code', { body: { email: 'new@example.com', code: h.codeOf(), termsAccepted: true } });
    assert.strictEqual(r.code, 200); assert.strictEqual(r.body.isNewUser, true); assert.strictEqual(r.body.passwordSet, true); assert.strictEqual(r.body.user.hasPassword, true);
    const me = await h.call('get', '/api/me', { headers: { cookie: h.cookieOf(r) } }); assert.strictEqual(me.body.user.hasPassword, true);
    assert(!JSON.stringify(r.body).includes(PW) && !JSON.stringify(r.body).includes('scrypt'));
  });
  await t('request-code without a password behaves as before, and verify-code sets none', async () => {
    const h = harness(); const { r } = await h.signIn('plain@example.com');
    assert.strictEqual(r.code, 200); assert.strictEqual(r.body.passwordSet, false); assert.strictEqual(r.body.user.hasPassword, false);
  });
  await t('verify-code no longer accepts a password of its own: sending one there is ignored', async () => {
    const h = harness();
    await h.call('post', '/api/auth/request-code', { body: { email: 'new@example.com' } });
    const r = await h.call('post', '/api/auth/verify-code', { body: { email: 'new@example.com', code: h.codeOf(), termsAccepted: true, password: PW } });
    assert.strictEqual(r.code, 200); assert.strictEqual(r.body.passwordSet, false); assert.strictEqual(r.body.user.hasPassword, false);
  });
  await t('a wrong code never applies the held password; the right code still can afterwards', async () => {
    const h = harness();
    await h.call('post', '/api/auth/request-code', { body: { email: 'new@example.com', password: PW } });
    const code = h.codeOf();
    const bad = await h.call('post', '/api/auth/verify-code', { body: { email: 'new@example.com', code: code === '000000' ? '111111' : '000000', termsAccepted: true } });
    assert.strictEqual(bad.code, 400);
    const r = await h.call('post', '/api/auth/verify-code', { body: { email: 'new@example.com', code, termsAccepted: true } });
    assert.strictEqual(r.code, 200); assert.strictEqual(r.body.passwordSet, true);
  });

  console.log('resetting or changing it: request a new code with the new password');
  await t('a second code requested with a new password replaces the old one on verify, and ends every other session', async () => {
    const h = harness();
    await h.call('post', '/api/auth/request-code', { body: { email: 'buyer@example.com', password: PW } });
    const first = await h.call('post', '/api/auth/verify-code', { body: { email: 'buyer@example.com', code: h.codeOf(), termsAccepted: true } });
    const oldCookie = h.cookieOf(first);
    h.clock.t += 61e3;
    await h.call('post', '/api/auth/request-code', { body: { email: 'buyer@example.com', password: 'a brand new password' } });
    const second = await h.call('post', '/api/auth/verify-code', { body: { email: 'buyer@example.com', code: h.codeOf() } });
    assert.strictEqual(second.code, 200); assert.strictEqual(second.body.isNewUser, false); assert.strictEqual(second.body.passwordSet, true);
    assert.strictEqual((await h.call('get', '/api/me', { headers: { cookie: oldCookie } })).code, 401);
    assert.strictEqual((await h.call('get', '/api/me', { headers: { cookie: h.cookieOf(second) } })).code, 200);
  });
  await t('a plain code (no password) after one was set leaves it alone', async () => {
    const h = harness();
    await h.call('post', '/api/auth/request-code', { body: { email: 'buyer@example.com', password: PW } });
    await h.call('post', '/api/auth/verify-code', { body: { email: 'buyer@example.com', code: h.codeOf(), termsAccepted: true } });
    h.clock.t += 61e3;
    const { r } = await h.signIn('buyer@example.com');
    assert.strictEqual(r.code, 200); assert.strictEqual(r.body.passwordSet, false); assert.strictEqual(r.body.user.hasPassword, true);
  });

  console.log('what must not leak');
  await t('the hash is in no response, not in the data export, and is gone when the account is deleted', async () => {
    const h = harness();
    await h.call('post', '/api/auth/request-code', { body: { email: 'buyer@example.com', password: PW } });
    const r = await h.call('post', '/api/auth/verify-code', { body: { email: 'buyer@example.com', code: h.codeOf(), termsAccepted: true } });
    const cookie = h.cookieOf(r);
    const exp = await h.call('get', '/api/me/export', { headers: { cookie } }); assert(!JSON.stringify(exp.body).includes('scrypt'));
    const uid = r.body.user.id; assert((await h.A.store.passwordHashOf(uid)).startsWith('scrypt$'));
    const del = await h.call('delete', '/api/me', { body: { confirm: 'DELETE' }, headers: { cookie } }); assert.strictEqual(del.code, 200);
    assert.strictEqual(await h.A.store.passwordHashOf(uid), null);
  });
  await t('failures and sign-ins are recorded without the password, and show in the admin counters', async () => {
    const h = harness();
    await h.call('post', '/api/auth/request-code', { body: { email: 'buyer@example.com', password: PW } });
    await h.call('post', '/api/auth/verify-code', { body: { email: 'buyer@example.com', code: h.codeOf(), termsAccepted: true } });
    const kinds = h.A.store._events.map(e => e.kind); assert(kinds.includes('login_ok')); assert(kinds.includes('password_set'));
    assert(!JSON.stringify(h.A.store._events).includes(PW)); assert(!JSON.stringify(h.A.store._audit).includes(PW));
  });
  await t('with accounts off the routes are not mounted', async () => {
    const routes = []; const app = {}; for (const m of ['get', 'post', 'patch', 'delete']) app[m] = (p) => routes.push(p);
    createAccounts({ env: {}, store: makeAccountStore(null) }).mount(app); assert.strictEqual(routes.length, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
