'use strict';
/** Password sign-in on top of the e-mail code: the rules, setting it, signing in with it, locking it, resetting it, and what must never leak. */
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
const login = (h, email, password, extra = {}) => h.call('post', '/api/auth/login', { body: { email, password }, ...extra });

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

  console.log('the first sign-in, with a password');
  await t('a new account made with a code can set its password in the same call, and then sees hasPassword', async () => {
    const h = harness(); await h.call('post', '/api/auth/request-code', { body: { email: 'new@example.com' } });
    const r = await h.call('post', '/api/auth/verify-code', { body: { email: 'new@example.com', code: h.codeOf(), termsAccepted: true, password: PW } });
    assert.strictEqual(r.code, 200); assert.strictEqual(r.body.isNewUser, true); assert.strictEqual(r.body.passwordSet, true); assert.strictEqual(r.body.user.hasPassword, true);
    const me = await h.call('get', '/api/me', { headers: { cookie: h.cookieOf(r) } }); assert.strictEqual(me.body.user.hasPassword, true);
    assert(!JSON.stringify(r.body).includes(PW) && !JSON.stringify(r.body).includes('scrypt'));
  });
  await t('a weak password is refused before the code is used up, so the person can try again with the same code', async () => {
    const h = harness(); await h.call('post', '/api/auth/request-code', { body: { email: 'new@example.com' } });
    const code = h.codeOf();
    const weak = await h.call('post', '/api/auth/verify-code', { body: { email: 'new@example.com', code, termsAccepted: true, password: 'short' } });
    assert.strictEqual(weak.code, 400); assert.strictEqual(weak.body.code, 'weak_password');
    const ok = await h.call('post', '/api/auth/verify-code', { body: { email: 'new@example.com', code, termsAccepted: true, password: PW } });
    assert.strictEqual(ok.code, 200);
  });
  await t('verify-code without a password behaves as before and sets none', async () => {
    const h = harness(); const { r } = await h.signIn('plain@example.com');
    assert.strictEqual(r.code, 200); assert.strictEqual(r.body.passwordSet, false); assert.strictEqual(r.body.user.hasPassword, false);
  });
  await t('an account made without one can set a password afterwards while signed in', async () => {
    const h = harness(); const { cookie } = await h.signIn('later@example.com');
    const no = await h.call('post', '/api/auth/password', { body: { password: PW } }); assert.strictEqual(no.code, 401);
    const weak = await h.call('post', '/api/auth/password', { body: { password: 'short' }, headers: { cookie } }); assert.strictEqual(weak.body.code, 'weak_password');
    const r = await h.call('post', '/api/auth/password', { body: { password: PW }, headers: { cookie } });
    assert.strictEqual(r.code, 200); assert.strictEqual(r.body.hasPassword, true); assert.strictEqual(r.body.otherSessionsEnded, false);
    assert.strictEqual((await login(h, 'later@example.com', PW)).code, 200);
  });

  console.log('the next sign-ins, with e-mail and password');
  async function withPassword(email = 'buyer@example.com', over, envOver) {
    const h = harness(over, envOver); await h.call('post', '/api/auth/request-code', { body: { email } });
    const r = await h.call('post', '/api/auth/verify-code', { body: { email, code: h.codeOf(), termsAccepted: true, password: PW } });
    assert.strictEqual(r.code, 200); h.mails.length = 0; return { h, first: r };
  }
  await t('the right password signs in with a session cookie and sends no e-mail', async () => {
    const { h } = await withPassword();
    const r = await login(h, 'Buyer@Example.com', PW);
    assert.strictEqual(r.code, 200); assert.strictEqual(r.body.isNewUser, false); assert.strictEqual(r.body.user.email, 'buyer@example.com');
    const cookie = h.cookieOf(r); assert(cookie.startsWith('sk_session=')); assert(r.cookies[0].includes('HttpOnly')); assert(r.cookies[0].includes('SameSite=Lax'));
    assert.strictEqual(h.mails.length, 0);
    assert.strictEqual((await h.call('get', '/api/me', { headers: { cookie } })).body.user.email, 'buyer@example.com');
  });
  await t('a wrong password, an unknown address and an account with no password all get the same answer', async () => {
    const { h } = await withPassword(); await h.signIn('nopw@example.com');
    const a = await login(h, 'buyer@example.com', 'wrong password!'), b = await login(h, 'ghost@example.com', PW), c = await login(h, 'nopw@example.com', PW);
    for (const r of [a, b, c]) { assert.strictEqual(r.code, 401); assert.strictEqual(r.body.code, 'invalid_credentials'); assert.strictEqual(r.cookies.length, 0); }
    assert.strictEqual(a.body.error, b.body.error); assert.strictEqual(b.body.error, c.body.error);
    assert.deepStrictEqual(Object.keys(a.body).sort(), Object.keys(b.body).sort());
  });
  await t('malformed input is refused cleanly', async () => {
    const { h } = await withPassword();
    assert.strictEqual((await h.call('post', '/api/auth/login', { body: { email: 'nope', password: PW } })).body.code, 'invalid_email');
    for (const pw of [undefined, null, '', 5, {}, [], 'x'.repeat(5000)]) assert.strictEqual((await login(h, 'buyer@example.com', pw)).code, 401, String(pw));
    assert.strictEqual((await h.call('post', '/api/auth/login', { body: undefined })).code, 400);
  });
  await t('a disabled account cannot sign in with its password, and a banned address is stopped before any check', async () => {
    const { h, first } = await withPassword();
    await h.A.store.setDisabled(first.body.user.id, new Date());
    const r = await login(h, 'buyer@example.com', PW); assert.strictEqual(r.code, 403); assert.strictEqual(r.body.code, 'account_disabled'); assert.strictEqual(r.cookies.length, 0);
    const wrong = await login(h, 'buyer@example.com', 'wrong password!'); assert.strictEqual(wrong.code, 401);
  });
  await t('after 10 wrong passwords in an hour the address is locked even for the right password, and unlocks later; a code still works', async () => {
    const { h } = await withPassword();
    for (let i = 0; i < 10; i++) assert.strictEqual((await login(h, 'buyer@example.com', 'wrong password ' + i)).code, 401);
    const locked = await login(h, 'buyer@example.com', PW); assert.strictEqual(locked.code, 429); assert.strictEqual(locked.body.code, 'too_many_attempts'); assert.strictEqual(locked.body.retryAfter, 3600);
    h.clock.t += 61e3;
    const { r } = await h.signIn('buyer@example.com'); assert.strictEqual(r.code, 200);
    h.clock.t += 3600e3 + 1000;
    assert.strictEqual((await login(h, 'buyer@example.com', PW)).code, 200);
  });
  await t('guessing against an address that has no account is counted and locked the same way', async () => {
    const h = harness();
    for (let i = 0; i < 10; i++) assert.strictEqual((await login(h, 'ghost@example.com', 'guess number ' + i)).code, 401);
    assert.strictEqual((await login(h, 'ghost@example.com', 'guess number x')).code, 429);
  });
  await t('the lock is the setting, and one address locking does not lock another', async () => {
    const { h } = await withPassword('buyer@example.com', {}, { AUTH_PASSWORD_FAILS_PER_HOUR: '3' }); await h.signIn('other@example.com');
    for (let i = 0; i < 3; i++) await login(h, 'buyer@example.com', 'wrong password ' + i);
    assert.strictEqual((await login(h, 'buyer@example.com', PW)).code, 429);
    assert.strictEqual((await login(h, 'other@example.com', 'something else!')).code, 401);
  });
  await t('the quick check is asked for when it is on, as for the code request', async () => {
    const gate = { on: false };
    const { h } = await withPassword('buyer@example.com', { bot: { enabled: () => gate.on, verify: pow => ({ ok: pow === 'good' }) } }); gate.on = true;
    assert.strictEqual((await login(h, 'buyer@example.com', PW)).code, 428);
    const r = await h.call('post', '/api/auth/login', { body: { email: 'buyer@example.com', password: PW, pow: 'good' } }); assert.strictEqual(r.code, 200);
  });
  await t('failures and sign-ins are recorded without the password, and show in the admin counters', async () => {
    const { h } = await withPassword(); await login(h, 'buyer@example.com', 'wrong password!'); await login(h, 'buyer@example.com', PW);
    const kinds = h.A.store._events.map(e => e.kind); assert(kinds.includes('password_wrong')); assert(kinds.includes('login_ok')); assert(kinds.includes('password_set'));
    assert(!JSON.stringify(h.A.store._events).includes(PW)); assert(!JSON.stringify(h.A.store._audit).includes(PW));
  });

  console.log('changing and resetting');
  await t('changing needs the current password, ends the other sessions, and keeps this one', async () => {
    const { h } = await withPassword(); const s1 = h.cookieOf(await login(h, 'buyer@example.com', PW)), s2 = h.cookieOf(await login(h, 'buyer@example.com', PW));
    const noCur = await h.call('post', '/api/auth/password', { body: { password: 'brand new password' }, headers: { cookie: s1 } }); assert.strictEqual(noCur.code, 401);
    const wrongCur = await h.call('post', '/api/auth/password', { body: { password: 'brand new password', currentPassword: 'nope nope nope' }, headers: { cookie: s1 } }); assert.strictEqual(wrongCur.code, 401);
    const r = await h.call('post', '/api/auth/password', { body: { password: 'brand new password', currentPassword: PW }, headers: { cookie: s1 } });
    assert.strictEqual(r.code, 200); assert.strictEqual(r.body.otherSessionsEnded, true);
    assert.strictEqual((await h.call('get', '/api/me', { headers: { cookie: s2 } })).code, 401);
    assert.strictEqual((await h.call('get', '/api/me', { headers: { cookie: h.cookieOf(r) } })).code, 200);
    assert.strictEqual((await login(h, 'buyer@example.com', PW)).code, 401);
    assert.strictEqual((await login(h, 'buyer@example.com', 'brand new password')).code, 200);
  });
  await t('guessing the current password through the change form is counted against the same lock', async () => {
    const { h } = await withPassword(); const s = h.cookieOf(await login(h, 'buyer@example.com', PW));
    for (let i = 0; i < 10; i++) await h.call('post', '/api/auth/password', { body: { password: 'brand new password', currentPassword: 'guess ' + i + ' guess' }, headers: { cookie: s } });
    const r = await h.call('post', '/api/auth/password', { body: { password: 'brand new password', currentPassword: PW }, headers: { cookie: s } }); assert.strictEqual(r.code, 429);
  });
  await t('forgot it: a code proves the address and sets a new password, and every old session ends', async () => {
    const { h } = await withPassword(); const old = h.cookieOf(await login(h, 'buyer@example.com', PW)); h.clock.t += 61e3;
    await h.call('post', '/api/auth/request-code', { body: { email: 'buyer@example.com' } });
    const weak = await h.call('post', '/api/auth/verify-code', { body: { email: 'buyer@example.com', code: h.codeOf(), password: 'short' } }); assert.strictEqual(weak.body.code, 'weak_password');
    const r = await h.call('post', '/api/auth/verify-code', { body: { email: 'buyer@example.com', code: h.codeOf(), password: 'a fresh password!' } });
    assert.strictEqual(r.code, 200); assert.strictEqual(r.body.passwordSet, true); assert.strictEqual(r.body.isNewUser, false);
    assert.strictEqual((await h.call('get', '/api/me', { headers: { cookie: old } })).code, 401);
    assert.strictEqual((await h.call('get', '/api/me', { headers: { cookie: h.cookieOf(r) } })).code, 200);
    assert.strictEqual((await login(h, 'buyer@example.com', PW)).code, 401);
    assert.strictEqual((await login(h, 'buyer@example.com', 'a fresh password!')).code, 200);
  });
  await t('a wrong code never sets or changes a password', async () => {
    const { h } = await withPassword(); h.clock.t += 61e3; await h.call('post', '/api/auth/request-code', { body: { email: 'buyer@example.com' } });
    const bad = await h.call('post', '/api/auth/verify-code', { body: { email: 'buyer@example.com', code: '000000', password: 'an attacker password' } }); assert.strictEqual(bad.code, 400);
    assert.strictEqual((await login(h, 'buyer@example.com', 'an attacker password')).code, 401); assert.strictEqual((await login(h, 'buyer@example.com', PW)).code, 200);
  });

  console.log('what must not leak');
  await t('the hash is in no response, not in the data export, and is gone when the account is deleted', async () => {
    const { h } = await withPassword(); const r = await login(h, 'buyer@example.com', PW), cookie = h.cookieOf(r);
    const exp = await h.call('get', '/api/me/export', { headers: { cookie } }); assert(!JSON.stringify(exp.body).includes('scrypt'));
    const uid = r.body.user.id; assert((await h.A.store.passwordHashOf(uid)).startsWith('scrypt$'));
    const del = await h.call('delete', '/api/me', { body: { confirm: 'DELETE' }, headers: { cookie } }); assert.strictEqual(del.code, 200);
    assert.strictEqual(await h.A.store.passwordHashOf(uid), null);
    assert.strictEqual((await login(h, 'buyer@example.com', PW)).code, 401);
  });
  await t('with accounts off the routes are not mounted', async () => {
    const routes = []; const app = {}; for (const m of ['get', 'post', 'patch', 'delete']) app[m] = (p) => routes.push(p);
    createAccounts({ env: {}, store: makeAccountStore(null) }).mount(app); assert.strictEqual(routes.length, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
