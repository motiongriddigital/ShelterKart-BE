'use strict';
/** User accounts: the small pieces, the sign-in flow, sessions, the guards, export and deletion, with memory storage and a captured mailbox. */
const assert = require('assert');
const S = require('../accounts/secrets');
const C = require('../accounts/config');
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
    briefInfo: async ref => ({ projectName: 'Project ' + ref, market: 'in', pdfFilename: 'Dev_' + ref + '.pdf', previewPdfFilename: 'Dev_preview_' + ref + '.pdf' }), ...over });
  A.mount(app);
  const find = (m, p) => routes.find(r => r.method === m && r.path === p);
  async function call(m, p, { body, headers = {}, ip = '1.1.1.1' } = {}) {
    // request-code needs consent for a new address; default it so tests about other things
    // (rate limits, proof of work, mail delivery...) don't each have to supply it.
    if (m === 'post' && p === '/api/auth/request-code' && body) body = { termsAccepted: true, ...body };
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
    await call('post', '/api/auth/request-code', { body: { email, ...extra } });
    const r = await call('post', '/api/auth/verify-code', { body: { email, code: codeOf() } });
    return { r, cookie: cookieOf(r) };
  }
  const guarded = async (cookie, mw = A.guard) => new Promise(resolve => {
    const req = { headers: cookie ? { cookie } : {}, get: k => (k.toLowerCase() === 'cookie' ? cookie : undefined), originalUrl: '/r/SK-AAAAAAAAAAAA' };
    const res = { status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); }, redirect(c, u) { resolve({ code: c, location: u }); } };
    mw(req, res, () => resolve({ code: 'next', user: req.accountUser }));
  });
  return { A, call, mails, alerts, clock, codeOf, cookieOf, signIn, guarded, bought, env };
}

(async () => {
  console.log('the small pieces');
  await t('an e-mail address is trimmed and lower-cased; broken ones are refused', () => {
    assert.strictEqual(S.normEmail('  Buyer@Example.COM '), 'buyer@example.com');
    for (const bad of ['', 'a', 'a@b', 'a@@b.com', '@b.com', 'a@.com', 'a b@c.com', 'a@b..com', 'a@-b.com', 'x'.repeat(250) + '@b.com', null, undefined]) assert.strictEqual(S.normEmail(bad), null, String(bad));
    assert.strictEqual(S.normEmail('a+tag@b.co'), 'a+tag@b.co');
  });
  await t('a code has six digits; its hash depends on the address, the code and the secret; comparison is exact', () => {
    for (let i = 0; i < 200; i++) assert(/^\d{6}$/.test(S.newCode()));
    const h = S.hashCode(PEPPER, 'a@b.com', '123456');
    assert.strictEqual(h, S.hashCode(PEPPER, 'a@b.com', '123456'));
    for (const other of [S.hashCode(PEPPER, 'a@b.com', '123457'), S.hashCode(PEPPER, 'c@b.com', '123456'), S.hashCode('q'.repeat(40), 'a@b.com', '123456')]) assert.notStrictEqual(h, other);
    assert(S.sameHash(h, h)); assert(!S.sameHash(h, h.slice(1))); assert(!S.sameHash(h, S.hashCode(PEPPER, 'a@b.com', '000000')));
  });
  await t('a session token is long and random; only its hash is stored form; it must look right to be read from a cookie', () => {
    const a = S.newToken(), b = S.newToken();
    assert(S.TOKEN_RE.test(a)); assert.notStrictEqual(a, b); assert.strictEqual(S.hashToken(a).length, 64); assert.notStrictEqual(S.hashToken(a), a);
  });
  await t('cookies: parsed safely, the first value wins, the session cookie has every protective attribute', () => {
    assert.deepStrictEqual(S.parseCookies('a=1; b=two%20words; a=2'), { a: '1', b: 'two words' });
    assert.deepStrictEqual(S.parseCookies(''), {}); assert.deepStrictEqual(S.parseCookies('novalue; =x'), {});
    const sec = S.sessionCookie('tok', { secure: true, maxAgeSeconds: 100 });
    for (const part of ['__Host-sk_session=tok', 'Max-Age=100', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure']) assert(sec.includes(part), part);
    assert(!sec.includes('Domain'));
    const dev = S.sessionCookie('tok', { secure: false, maxAgeSeconds: 100 }); assert(dev.startsWith('sk_session=tok')); assert(!dev.includes('Secure'));
    assert(S.clearedCookie(true).includes('Max-Age=0'));
  });
  await t('the return address stays on this site: other sites, scripts, protocol-relative and backslash tricks fall back', () => {
    assert.strictEqual(S.safeNext('/r/SK-ABC?x=1'), '/r/SK-ABC?x=1');
    for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', 'r/x', '', null, '/a\nb', '/' + 'x'.repeat(600)]) assert.strictEqual(S.safeNext(bad), '/', String(bad));
    assert.strictEqual(S.safeNext('//x', '/home'), '/home');
  });
  await t('the configuration: off means no problems; on needs a long secret, storage, a mailer in production, and no dev echo in production', () => {
    assert.deepStrictEqual(C.validate({}), []);
    assert(C.validate({ ACCOUNTS_ENABLED: 'on' }, { hasDatabase: true }).some(p => /AUTH_PEPPER/.test(p)));
    assert(C.validate({ ACCOUNTS_ENABLED: 'on', AUTH_PEPPER: PEPPER }, { hasDatabase: false }).some(p => /DATABASE_URL/.test(p)));
    assert.deepStrictEqual(C.validate({ ACCOUNTS_ENABLED: 'on', AUTH_PEPPER: PEPPER, ACCOUNTS_ALLOW_MEMORY: 'true' }, { hasDatabase: false }), []);
    const prod = { ACCOUNTS_ENABLED: 'on', AUTH_PEPPER: PEPPER, NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://shelterkart.test' };
    assert(C.validate(prod, { hasDatabase: true, mailConfigured: false }).some(p => /e-mail provider/.test(p)));
    assert(C.validate({ ...prod, ACCOUNTS_DEV_ECHO: 'on' }, { hasDatabase: true, mailConfigured: true }).some(p => /DEV_ECHO/.test(p)));
    assert(C.validate({ ...prod, ALLOWED_ORIGINS: '' }, { hasDatabase: true, mailConfigured: true }).some(p => /ALLOWED_ORIGINS/.test(p)));
    assert.deepStrictEqual(C.validate(prod, { hasDatabase: true, mailConfigured: true }), []);
    assert.strictEqual(C.settings({}).searchGate, 'view'); assert.strictEqual(C.settings({ ACCOUNTS_SEARCH_GATE: 'START' }).searchGate, 'start');
  });

  console.log('signing in');
  await t('asking for a code: a valid address gets a six-digit code by e-mail and a uniform reply; a bad address is refused', async () => {
    const h = harness();
    const bad = await h.call('post', '/api/auth/request-code', { body: { email: 'nope' } });
    assert.strictEqual(bad.code, 400); assert.strictEqual(bad.body.code, 'invalid_email'); assert.strictEqual(h.mails.length, 0);
    const ok = await h.call('post', '/api/auth/request-code', { body: { email: 'Buyer@Example.com' } });
    assert.strictEqual(ok.code, 202); assert.deepStrictEqual([ok.body.ok, ok.body.cooldownSeconds, ok.body.codeLength], [true, 60, 6]);
    assert.strictEqual(h.mails.length, 1); assert.strictEqual(h.mails[0].to, 'buyer@example.com'); assert(/^\d{6}$/.test(h.codeOf())); assert(!('devCode' in ok.body));
  });
  await t('the reply does not depend on whether the address has an account', async () => {
    const h = harness(); await h.signIn('known@example.com'); h.clock.t += 61000;
    const a = await h.call('post', '/api/auth/request-code', { body: { email: 'known@example.com' } }); h.clock.t += 61000;
    const b = await h.call('post', '/api/auth/request-code', { body: { email: 'stranger@example.com' } });
    assert.deepStrictEqual([a.code, a.body], [b.code, b.body]);
  });
  await t('one code a minute, five an hour for one address; the wait is reported', async () => {
    const h = harness(); const r = { body: { email: 'a@example.com' } };
    assert.strictEqual((await h.call('post', '/api/auth/request-code', r)).code, 202);
    const again = await h.call('post', '/api/auth/request-code', r); assert.strictEqual(again.code, 429); assert.strictEqual(again.body.code, 'cooldown'); assert(again.body.retryAfter > 0 && again.body.retryAfter <= 60);
    for (let i = 0; i < 4; i++) { h.clock.t += 61000; assert.strictEqual((await h.call('post', '/api/auth/request-code', r)).code, 202); }
    h.clock.t += 61000; const sixth = await h.call('post', '/api/auth/request-code', r); assert.strictEqual(sixth.code, 429); assert.strictEqual(sixth.body.code, 'rate_limited');
    h.clock.t += 3600000; assert.strictEqual((await h.call('post', '/api/auth/request-code', r)).code, 202);
  });
  await t('another address asking inside a minute of an open code gets the same reply and no mail, so a stranger cannot cancel the owner code', async () => {
    const h = harness(); const r = { body: { email: 'a@example.com' } };
    assert.strictEqual((await h.call('post', '/api/auth/request-code', r)).code, 202); const first = h.codeOf();
    const other = await h.call('post', '/api/auth/request-code', { ...r, ip: '2.2.2.2' });
    assert.strictEqual(other.code, 202); assert.deepStrictEqual(other.body, { ok: true, cooldownSeconds: 60, codeLength: 6 }); assert.strictEqual(h.mails.length, 1);
    assert.strictEqual((await h.call('post', '/api/auth/verify-code', { body: { email: 'a@example.com', code: first, termsAccepted: true } })).code, 200);
  });
  await t('after a minute a second address is sent a fresh code; each address has its own five an hour', async () => {
    const h = harness(); const r = ip => ({ body: { email: 'a@example.com' }, ip });
    await h.call('post', '/api/auth/request-code', r('1.1.1.1')); h.clock.t += 61000;
    assert.strictEqual((await h.call('post', '/api/auth/request-code', r('2.2.2.2'))).code, 202); assert.strictEqual(h.mails.length, 2);
    for (let i = 0; i < 4; i++) { h.clock.t += 61000; assert.strictEqual((await h.call('post', '/api/auth/request-code', r('1.1.1.1'))).code, 202); }
    h.clock.t += 61000; assert.strictEqual((await h.call('post', '/api/auth/request-code', r('1.1.1.1'))).body.code, 'rate_limited');
    h.clock.t += 61000; assert.strictEqual((await h.call('post', '/api/auth/request-code', r('3.3.3.3'))).code, 202);
  });
  await t('past the hourly limit of codes for one address (set to twenty here), requests are answered without mail while the last code is open, an operator is told once, and mail resumes when it expires', async () => {
    const h = harness({}, { AUTH_CODE_MINUTES: '10', AUTH_CODES_PER_ADDRESS_HOUR: '20' }); const ask = i => h.call('post', '/api/auth/request-code', { body: { email: 'a@example.com' }, ip: '10.0.0.' + i });
    for (let i = 0; i < 20; i++) { h.clock.t += 61000 * (i ? 1 : 0); assert.strictEqual((await ask(i)).code, 202); }
    assert.strictEqual(h.mails.length, 20); assert.strictEqual(h.alerts.length, 0);
    h.clock.t += 61000; assert.strictEqual((await ask(40)).code, 202); assert.strictEqual(h.mails.length, 20); assert.strictEqual(h.alerts.length, 1);
    h.clock.t += 61000; await ask(41); assert.strictEqual(h.mails.length, 20); assert.strictEqual(h.alerts.length, 1);
    h.clock.t += 11 * 60000; assert.strictEqual((await ask(42)).code, 202); assert.strictEqual(h.mails.length, 21);
  });
  await t('by default one address gets at most eight codes an hour whatever addresses ask, then quiet answers and one alert', async () => {
    const h = harness({}, { AUTH_CODE_MINUTES: '10' }); const ask = i => h.call('post', '/api/auth/request-code', { body: { email: 'bomb@example.com' }, ip: '10.1.0.' + i });
    for (let i = 0; i < 8; i++) { h.clock.t += i ? 61000 : 0; assert.strictEqual((await ask(i)).code, 202); }
    assert.strictEqual(h.mails.length, 8); assert.strictEqual(h.alerts.length, 0);
    h.clock.t += 61000; assert.strictEqual((await ask(50)).code, 202); assert.strictEqual(h.mails.length, 8); assert.strictEqual(h.alerts.length, 1); assert(/More than 8 codes/.test(h.alerts[0].x));
    for (let i = 51; i < 80; i++) { h.clock.t += 61000; await ask(i); if (h.clock.t - Date.parse('2026-11-03T10:00:00Z') > 9 * 61000 + 9 * 60000) break; }
    assert(h.mails.length <= 9, 'mails sent: ' + h.mails.length);
  });
  await t('the limit is set by AUTH_CODES_PER_ADDRESS_HOUR; a value out of range keeps the default', () => {
    assert.strictEqual(C.settings({ AUTH_CODES_PER_ADDRESS_HOUR: '12' }).codesPerAddressHour, 12);
    assert.strictEqual(C.settings({}).codesPerAddressHour, 8); assert.strictEqual(C.settings({ AUTH_CODES_PER_ADDRESS_HOUR: '1' }).codesPerAddressHour, 8);
  });
  await t('when the proof of work is on, a request without it is refused before any code exists', async () => {
    const bot = { enabled: () => true, verify: p => (p === 'good' ? { ok: true } : { ok: false, reason: 'missing' }) };
    const h = harness({ bot });
    assert.strictEqual((await h.call('post', '/api/auth/request-code', { body: { email: 'a@example.com' } })).code, 428); assert.strictEqual(h.mails.length, 0);
    assert.strictEqual((await h.call('post', '/api/auth/request-code', { body: { email: 'a@example.com', pow: 'good' } })).code, 202);
  });
  await t('the code expires after ten minutes and a newer code replaces an older one', async () => {
    const h = harness(); await h.call('post', '/api/auth/request-code', { body: { email: 'a@example.com' } }); const first = h.codeOf();
    h.clock.t += 61000; await h.call('post', '/api/auth/request-code', { body: { email: 'a@example.com' } }); const second = h.codeOf();
    if (first !== second) assert.strictEqual((await h.call('post', '/api/auth/verify-code', { body: { email: 'a@example.com', code: first, termsAccepted: true } })).body.code, 'invalid_code');
    h.clock.t += 11 * 60000;
    const late = await h.call('post', '/api/auth/verify-code', { body: { email: 'a@example.com', code: second, termsAccepted: true } }); assert.strictEqual(late.code, 400); assert.strictEqual(late.body.code, 'invalid_code');
  });
  await t('a right code signs a new person in: account created with the terms version, cookie set with every protection, hash stored not the token', async () => {
    const h = harness({}, { NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://shelterkart.test' });
    const { r, cookie } = await h.signIn('New@Example.com');
    assert.strictEqual(r.code, 200); assert.strictEqual(r.body.isNewUser, true); assert.strictEqual(r.body.user.email, 'new@example.com');
    assert(!('termsVersion' in r.body.user) && !('id' in {}) && r.body.user.id);
    assert(/^__Host-sk_session=[A-Za-z0-9_-]{43}$/.test(cookie)); const c = r.cookies[0];
    for (const part of ['HttpOnly', 'SameSite=Lax', 'Secure', 'Path=/', 'Max-Age=2592000']) assert(c.includes(part), part);
    const token = cookie.split('=')[1], hashes = [...h.A.store._sessions.keys()];
    assert.strictEqual(hashes.length, 1); assert.strictEqual(hashes[0], S.hashToken(token)); assert(!JSON.stringify([...h.A.store._sessions.values()]).includes(token));
    const u = [...h.A.store._users.values()][0]; assert.strictEqual(u.termsVersion, '2026-11'); assert(u.emailVerifiedAt && u.lastLoginAt);
    assert(h.A.store._audit.some(a => a.action === 'auth.login'));
  });
  await t('a new address must accept the terms at request-code: without it no code is sent, so ticking the box and trying again works', async () => {
    const h = harness();
    const no = await h.call('post', '/api/auth/request-code', { body: { email: 'new@example.com', termsAccepted: false } });
    assert.strictEqual(no.code, 400); assert.strictEqual(no.body.code, 'consent_required'); assert.strictEqual(h.mails.length, 0); assert.strictEqual(h.A.store._users.size, 0);
    const yes = await h.call('post', '/api/auth/request-code', { body: { email: 'new@example.com' } }); assert.strictEqual(yes.code, 202);
    const r = await h.call('post', '/api/auth/verify-code', { body: { email: 'new@example.com', code: h.codeOf() } }); assert.strictEqual(r.code, 200);
  });
  await t('a returning person needs no consent tick at request-code, and is not marked new', async () => {
    const h = harness(); await h.signIn('a@example.com'); h.clock.t += 61000;
    const again = await h.call('post', '/api/auth/request-code', { body: { email: 'A@example.com', termsAccepted: false } });
    assert.strictEqual(again.code, 202);
    const r = await h.call('post', '/api/auth/verify-code', { body: { email: 'a@example.com', code: h.codeOf() } });
    assert.strictEqual(r.code, 200); assert.strictEqual(r.body.isNewUser, false); assert.strictEqual(h.A.store._users.size, 1); assert.strictEqual(h.A.store._sessions.size, 2);
  });
  await t('a wrong code tells how many tries are left; the fifth wrong try uses the code up; the right code then no longer works', async () => {
    const h = harness(); await h.call('post', '/api/auth/request-code', { body: { email: 'a@example.com' } }); const right = h.codeOf(), wrong = right === '000000' ? '111111' : '000000';
    for (let i = 1; i <= 5; i++) { const r = await h.call('post', '/api/auth/verify-code', { body: { email: 'a@example.com', code: wrong, termsAccepted: true } }); assert.strictEqual(r.body.code, 'invalid_code'); assert.strictEqual(r.body.attemptsLeft, 5 - i); }
    const sixth = await h.call('post', '/api/auth/verify-code', { body: { email: 'a@example.com', code: wrong, termsAccepted: true } }); assert.strictEqual(sixth.code, 429); assert.strictEqual(sixth.body.code, 'too_many_attempts');
    assert.strictEqual((await h.call('post', '/api/auth/verify-code', { body: { email: 'a@example.com', code: right, termsAccepted: true } })).body.code, 'invalid_code');
  });
  await t('unknown address, no code asked, malformed code: all the same plain refusal', async () => {
    const h = harness();
    for (const body of [{ email: 'ghost@example.com', code: '123456' }, { email: 'ghost@example.com', code: 'abc' }, { email: 'bad', code: '123456' }, {}]) {
      const r = await h.call('post', '/api/auth/verify-code', { body }); assert.strictEqual(r.code, 400); assert.strictEqual(r.body.code, 'invalid_code'); assert(!('attemptsLeft' in r.body));
    }
  });
  await t('a failed e-mail still gets the uniform reply, is logged and alerted; the dev echo returns the code only outside production', async () => {
    const h = harness({ mailFails: true }); const r = await h.call('post', '/api/auth/request-code', { body: { email: 'a@example.com' } });
    assert.strictEqual(r.code, 202); assert.strictEqual(h.alerts.length, 1);
    const d = harness({}, { ACCOUNTS_DEV_ECHO: 'on' }); const echoed = await d.call('post', '/api/auth/request-code', { body: { email: 'a@example.com' } }); assert.strictEqual(echoed.body.devCode, d.codeOf());
    const p = harness({}, { ACCOUNTS_DEV_ECHO: 'on', NODE_ENV: 'production' }); assert(!('devCode' in (await p.call('post', '/api/auth/request-code', { body: { email: 'a@example.com' } })).body));
  });
  await t('a disabled account cannot sign in', async () => {
    const h = harness(); await h.signIn('a@example.com'); [...h.A.store._users.values()][0].disabledAt = new Date(); h.clock.t += 61000;
    await h.call('post', '/api/auth/request-code', { body: { email: 'a@example.com' } });
    const r = await h.call('post', '/api/auth/verify-code', { body: { email: 'a@example.com', code: h.codeOf() } }); assert.strictEqual(r.code, 403); assert.strictEqual(r.body.code, 'account_disabled');
  });

  console.log('sessions and the wall');
  await t('the guard: no cookie, a forged cookie or a revoked session is 401 auth_required; a real session passes with the user attached', async () => {
    const h = harness(); const { cookie } = await h.signIn('a@example.com');
    const none = await h.guarded(''); assert.strictEqual(none.code, 401); assert.strictEqual(none.body.code, 'auth_required');
    assert.strictEqual((await h.guarded('sk_session=' + 'A'.repeat(43))).code, 401); assert.strictEqual((await h.guarded('sk_session=short')).code, 401);
    const ok = await h.guarded(cookie); assert.strictEqual(ok.code, 'next'); assert.strictEqual(ok.user.email, 'a@example.com');
  });
  await t('the page guard sends a visitor to the sign-in route with a safe return address', async () => {
    const h = harness(); const r = await h.guarded('', h.A.guardPage); assert.strictEqual(r.code, 302); assert.strictEqual(r.location, '/signin?next=%2Fr%2FSK-AAAAAAAAAAAA');
  });
  await t('with accounts off every guard just lets the request through and no routes are mounted', async () => {
    const h = harness({}, { ACCOUNTS_ENABLED: 'off' }); assert.strictEqual(h.A.enabled, false);
    assert.strictEqual((await h.guarded('')).code, 'next'); assert.strictEqual((await h.guarded('', h.A.guardPage)).code, 'next'); assert.strictEqual(await h.A.user({ headers: {} }), null);
    await assert.rejects(() => h.call('post', '/api/auth/request-code', { body: {} }));
  });
  await t('the search gate: the default lets the search start without an account; "start" refuses it', async () => {
    const view = harness(); assert.strictEqual((await view.guarded('', view.A.guardStart)).code, 'next');
    const start = harness({}, { ACCOUNTS_SEARCH_GATE: 'start' }); assert.strictEqual((await start.guarded('', start.A.guardStart)).code, 401);
  });
  await t('a session lasts 30 days, slides forward once a day of use, never passes 90 days, and ends when it expires', async () => {
    const h = harness(); const { cookie } = await h.signIn('a@example.com'); const hash = [...h.A.store._sessions.keys()][0], s = h.A.store._sessions.get(hash), start = s.createdAt.getTime();
    assert.strictEqual(s.expiresAt.getTime(), start + 30 * DAY);
    h.clock.t += 2 * 3600000; await h.guarded(cookie); assert.strictEqual(s.expiresAt.getTime(), start + 30 * DAY, 'not moved within a day');
    h.clock.t = start + 20 * DAY; assert.strictEqual((await h.guarded(cookie)).code, 'next'); assert.strictEqual(s.expiresAt.getTime(), start + 50 * DAY);
    h.clock.t = start + 49 * DAY; assert.strictEqual((await h.guarded(cookie)).code, 'next');
    h.clock.t = start + 70 * DAY; assert.strictEqual((await h.guarded(cookie)).code, 'next'); assert.strictEqual(s.expiresAt.getTime(), start + 90 * DAY, 'capped at 90 days in all');
    h.clock.t = start + 91 * DAY; assert.strictEqual((await h.guarded(cookie)).code, 401);
    const idle = await h.signIn('idle@example.com'); h.clock.t += 31 * DAY; assert.strictEqual((await h.guarded(idle.cookie)).code, 401, 'unused for 30 days it ends');
  });
  await t('logout ends this session only and clears the cookie; logout everywhere ends them all', async () => {
    const h = harness(); const a = await h.signIn('a@example.com'); h.clock.t += 61000; const b = await h.signIn('a@example.com');
    const out = await h.call('post', '/api/auth/logout', { headers: { cookie: a.cookie } }); assert.strictEqual(out.code, 200); assert(/Max-Age=0/.test(out.cookies[0]));
    assert.strictEqual((await h.guarded(a.cookie)).code, 401); assert.strictEqual((await h.guarded(b.cookie)).code, 'next');
    h.clock.t += 61000; const c = await h.signIn('a@example.com');
    await h.call('post', '/api/auth/logout-all', { headers: { cookie: c.cookie } });
    for (const x of [b, c]) assert.strictEqual((await h.guarded(x.cookie)).code, 401);
    assert.strictEqual((await h.call('post', '/api/auth/logout', { headers: {} })).code, 401);
  });

  console.log('the account');
  await t('me: returns the user; the profile can be changed; a phone needs its own consent; bad values are refused', async () => {
    const h = harness(); const { cookie } = await h.signIn('a@example.com'); const hd = { cookie };
    const me = await h.call('get', '/api/me', { headers: hd }); assert.strictEqual(me.body.user.email, 'a@example.com'); assert.strictEqual(me.headers['Cache-Control'], 'no-store');
    assert.strictEqual((await h.call('get', '/api/me', {})).code, 401);
    const p = await h.call('patch', '/api/me', { headers: hd, body: { displayName: '  Asha  ', country: 'in', language: 'hi', email: 'x@y.com', id: 'zzz' } });
    assert.deepStrictEqual([p.body.user.displayName, p.body.user.country, p.body.user.language, p.body.user.email], ['Asha', 'IN', 'hi', 'a@example.com']);
    assert.strictEqual((await h.call('patch', '/api/me', { headers: hd, body: { country: 'India' } })).body.code, 'invalid_country');
    assert.strictEqual((await h.call('patch', '/api/me', { headers: hd, body: { phone: '+91 98765 43210' } })).body.code, 'consent_required');
    assert.strictEqual((await h.call('patch', '/api/me', { headers: hd, body: { phone: '12', whatsappConsent: true } })).body.code, 'invalid_phone');
    const ph = await h.call('patch', '/api/me', { headers: hd, body: { phone: '+91 98765 43210', whatsappConsent: true } }); assert.strictEqual(ph.body.user.phone, '+919876543210');
    const clear = await h.call('patch', '/api/me', { headers: hd, body: { phone: '' } }); assert.strictEqual(clear.body.user.phone, null); assert.strictEqual([...h.A.store._users.values()][0].phoneConsentAt, null);
  });
  await t('my reports: what I opened and what I bought, newest first, paid ones marked, never another person’s', async () => {
    const h = harness(); const a = await h.signIn('a@example.com'); h.clock.t += 61000; const b = await h.signIn('b@example.com');
    const ua = [...h.A.store._users.values()][0], ub = [...h.A.store._users.values()][1];
    await h.A.store.recordOpen(ua.id, 'SK-AAAAAAAAAAAA', new Date(h.clock.t)); h.clock.t += 1000; await h.A.store.recordOpen(ua.id, 'SK-BBBBBBBBBBBB', new Date(h.clock.t)); await h.A.store.recordOpen(ub.id, 'SK-CCCCCCCCCCCC', new Date(h.clock.t));
    h.bought.push({ userId: ua.id, ref: 'SK-AAAAAAAAAAAA', status: 'paid', amount: '3100', currency: 'INR' }, { userId: ua.id, ref: 'SK-DDDDDDDDDDDD', status: 'refunded', amount: '3100', currency: 'INR' });
    const r = await h.call('get', '/api/me/reports', { headers: { cookie: a.cookie } });
    assert.deepStrictEqual(r.body.reports.map(x => x.ref).sort(), ['SK-AAAAAAAAAAAA', 'SK-BBBBBBBBBBBB']);
    const paid = r.body.reports.find(x => x.ref === 'SK-AAAAAAAAAAAA'); assert.deepStrictEqual([paid.paid, paid.amount, paid.currency, paid.projectName], [true, 3100, 'INR', 'Project SK-AAAAAAAAAAAA']);
    assert.strictEqual(r.body.reports.find(x => x.ref === 'SK-BBBBBBBBBBBB').paid, false);
    assert.deepStrictEqual(paid.pdf, { url: '/r/SK-AAAAAAAAAAAA/pdf', filename: 'Dev_SK-AAAAAAAAAAAA.pdf' });
    assert.deepStrictEqual(paid.previewPdf, { url: '/r/SK-AAAAAAAAAAAA/preview.pdf', filename: 'Dev_preview_SK-AAAAAAAAAAAA.pdf' });
    const unpaid = r.body.reports.find(x => x.ref === 'SK-BBBBBBBBBBBB'); assert.strictEqual(unpaid.pdf, null); assert.strictEqual(unpaid.previewPdf.url, '/r/SK-BBBBBBBBBBBB/preview.pdf');
    const rb = await h.call('get', '/api/me/reports', { headers: { cookie: b.cookie } }); assert.deepStrictEqual(rb.body.reports.map(x => x.ref), ['SK-CCCCCCCCCCCC']);
  });
  await t('entitlement: a signed-in user with a paid purchase is entitled; a refund, another user, or no session is not', async () => {
    const h = harness(); const a = await h.signIn('a@example.com'); const ua = [...h.A.store._users.values()][0];
    const req = c => ({ headers: c ? { cookie: c } : {}, get: k => (k === 'cookie' ? c : undefined) });
    assert.strictEqual(await h.A.entitled(req(a.cookie), 'SK-AAAAAAAAAAAA'), false);
    h.bought.push({ userId: ua.id, ref: 'SK-AAAAAAAAAAAA', status: 'paid' });
    assert.strictEqual(await h.A.entitled(req(a.cookie), 'SK-AAAAAAAAAAAA'), true); assert.strictEqual(await h.A.entitled(req(a.cookie), 'SK-BBBBBBBBBBBB'), false);
    assert.strictEqual(await h.A.entitled(req(''), 'SK-AAAAAAAAAAAA'), false);
    h.clock.t += 61000; const b = await h.signIn('b@example.com'); assert.strictEqual(await h.A.entitled(req(b.cookie), 'SK-AAAAAAAAAAAA'), false);
    h.bought[0].status = 'refunded'; assert.strictEqual(await h.A.entitled(req(a.cookie), 'SK-AAAAAAAAAAAA'), false);
  });
  await t('export: the person’s own data as a download, with no token hashes and nobody else’s data', async () => {
    const h = harness(); const a = await h.signIn('a@example.com'); h.clock.t += 61000; await h.signIn('b@example.com');
    const ua = [...h.A.store._users.values()][0]; h.bought.push({ userId: ua.id, ref: 'SK-AAAAAAAAAAAA', status: 'paid', amount: '3100', currency: 'INR' });
    const r = await h.call('get', '/api/me/export', { headers: { cookie: a.cookie } });
    assert(/attachment/.test(r.headers['Content-Disposition'])); assert.strictEqual(r.body.user.email, 'a@example.com'); assert.strictEqual(r.body.purchases.length, 1); assert.strictEqual(r.body.consents.termsVersion, '2026-11');
    const text = JSON.stringify(r.body); assert(!text.includes('b@example.com')); assert(!/[0-9a-f]{64}/.test(text), 'no hashes'); assert(!text.includes(a.cookie.split('=')[1]));
  });
  await t('deleting the account needs the word DELETE, ends every session, erases the person’s data, keeps purchases without identity and frees the address', async () => {
    const h = harness(); const a = await h.signIn('a@example.com'); const ua = [...h.A.store._users.values()][0];
    await h.A.store.recordOpen(ua.id, 'SK-AAAAAAAAAAAA', new Date(h.clock.t)); await h.call('patch', '/api/me', { headers: { cookie: a.cookie }, body: { displayName: 'Asha', phone: '+919876543210', whatsappConsent: true } });
    assert.strictEqual((await h.call('delete', '/api/me', { headers: { cookie: a.cookie }, body: {} })).body.code, 'confirm_required'); assert.strictEqual((await h.guarded(a.cookie)).code, 'next');
    const del = await h.call('delete', '/api/me', { headers: { cookie: a.cookie }, body: { confirm: 'DELETE' } }); assert.strictEqual(del.code, 200); assert(/Max-Age=0/.test(del.cookies[0]));
    assert.strictEqual((await h.guarded(a.cookie)).code, 401);
    const row = h.A.store._users.get(ua.id); assert(row.deletedAt); assert(/^deleted-.+@deleted\.invalid$/.test(row.email)); for (const k of ['displayName', 'phone', 'country', 'language', 'termsVersion']) assert.strictEqual(row[k], null, k);
    assert.deepStrictEqual(await h.A.store.listOpened(ua.id, 10), []); assert.strictEqual(h.A.store._sessions.size, 0);
    assert(h.A.store._audit.some(x => x.action === 'account.delete'));
    h.clock.t += 61000; const again = await h.signIn('a@example.com'); assert.strictEqual(again.r.body.isNewUser, true); assert.notStrictEqual(again.r.body.user.id, ua.id);
  });
  await t('clean-up removes old codes and expired or long-revoked sessions and leaves live ones', async () => {
    const h = harness(); const a = await h.signIn('a@example.com'); h.clock.t += 2 * DAY;
    await h.call('post', '/api/auth/request-code', { body: { email: 'z@example.com' } });
    const r = await h.A.cleanup(); assert.strictEqual(r.codes, 1); assert.strictEqual(r.sessions, 0); assert.strictEqual((await h.guarded(a.cookie)).code, 'next');
    h.clock.t += 40 * DAY; const r2 = await h.A.cleanup(); assert.strictEqual(r2.sessions, 1);
  });
  await t('nothing secret is ever written to the server log', async () => {
    const lines = []; const log = console.error; console.error = (...a) => lines.push(a.join(' '));
    try { const h = harness({ mailFails: true }); await h.call('post', '/api/auth/request-code', { body: { email: 'a@example.com' } }); await h.signIn('b@example.com'); } finally { console.error = log; }
    assert(lines.every(l => !/\d{6}/.test(l) && !/sk_session/.test(l)), lines.join('|'));
  });

  await t('a display name is kept as one line of plain text: markup is removed (B8)', async () => {
    const h = harness(); const { cookie } = await h.signIn('a@example.com'); const hd = { cookie };
    const p = await h.call('patch', '/api/me', { headers: hd, body: { displayName: 'QA <img src=x onerror=alert(1)>Asha\nRao' } });
    assert.strictEqual(p.code, 200); assert.strictEqual(p.body.user.displayName, 'QA Asha Rao');
    const only = await h.call('patch', '/api/me', { headers: hd, body: { displayName: '<script>alert(1)</script>' } });
    assert.strictEqual(only.body.user.displayName, 'alert(1)');
    const empty = await h.call('patch', '/api/me', { headers: hd, body: { displayName: '<b></b>' } });
    assert.strictEqual(empty.body.user.displayName, null);
  });

  console.log('sign-in hardening: one address, many addresses of the attacker');
  await t('a code that is used in parallel signs in once; every other copy is refused', async () => {
    const h = harness(); await h.call('post', '/api/auth/request-code', { body: { email: 'race@example.com' } }); const code = h.codeOf();
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => h.call('post', '/api/auth/verify-code', { body: { email: 'race@example.com', code, termsAccepted: true }, ip: '9.9.9.' + i })));
    assert.strictEqual(rs.filter(r => r.code === 200).length, 1, JSON.stringify(rs.map(r => r.code)));
    assert(rs.every(r => [200, 400, 429].includes(r.code)), JSON.stringify(rs.map(r => r.code)));
  });
  await t('a signed-in user who is disabled keeps the code unused, and a returning user signs in once per code', async () => {
    const h = harness(); await h.signIn('again@example.com'); h.clock.t += 61000;
    await h.call('post', '/api/auth/request-code', { body: { email: 'again@example.com' } }); const code = h.codeOf();
    const rs = await Promise.all(Array.from({ length: 8 }, () => h.call('post', '/api/auth/verify-code', { body: { email: 'again@example.com', code } })));
    assert.strictEqual(rs.filter(r => r.code === 200).length, 1);
  });
  await t('requesting a new code does not reset the wrong-attempt count of the address, whatever the IP', async () => {
    const h = harness(); let guesses = 0, locked = false;
    for (let round = 0; round < 8 && !locked; round++) {
      await h.call('post', '/api/auth/request-code', { body: { email: 'victim@example.com' }, ip: '7.7.' + round + '.1' });
      h.clock.t += 61000;
      for (let g = 0; g < 6; g++) {
        const r = await h.call('post', '/api/auth/verify-code', { body: { email: 'victim@example.com', code: '00000' + g }, ip: '8.8.' + round + '.' + g }); guesses++;
        if (r.code === 429 && r.body.retryAfter === 3600) { locked = true; break; }
      }
    }
    assert(locked, 'never locked');
    assert(guesses <= 25, 'too many guesses before the lock: ' + guesses);
    const real = (h.mails[h.mails.length - 1].text.match(/code is (\d{6})/) || [])[1];
    const r = await h.call('post', '/api/auth/verify-code', { body: { email: 'victim@example.com', code: real, termsAccepted: true }, ip: '5.5.5.5' });
    assert.strictEqual(r.code, 429);
    h.clock.t += 3601000;
    await h.call('post', '/api/auth/request-code', { body: { email: 'victim@example.com' } });
    const ok = await h.call('post', '/api/auth/verify-code', { body: { email: 'victim@example.com', code: h.codeOf(), termsAccepted: true } });
    assert.strictEqual(ok.code, 200);
  });
  console.log('sign-in lock-out: a stranger cannot lock the owner out (B3)');
  const wrongOf = right => (right === '000000' ? '111111' : '000000');
  const verify = (h, email, code, ip) => h.call('post', '/api/auth/verify-code', { body: { email, code, termsAccepted: true }, ip });
  await t('one stranger guessing wrong codes is stopped at the per-connection cap and the owner still signs in', async () => {
    const h = harness(); await h.call('post', '/api/auth/request-code', { body: { email: 'owner@example.com' }, ip: '1.1.1.1' }); const right = h.codeOf(), wrong = wrongOf(right);
    const seen = []; for (let i = 0; i < 12; i++) seen.push((await verify(h, 'owner@example.com', wrong, '6.6.6.6')).code);
    assert.deepStrictEqual(seen, [400, 400, 400, 400, 400, 400, 400, 400, 429, 429, 429, 429], seen.join(','));
    const owner = await verify(h, 'owner@example.com', right, '1.1.1.1'); assert.strictEqual(owner.code, 200, JSON.stringify(owner.body));
  });
  await t('a stranger cannot use up the code: wrong guesses from another connection never consume it', async () => {
    const h = harness(); await h.call('post', '/api/auth/request-code', { body: { email: 'owner@example.com' }, ip: '1.1.1.1' }); const right = h.codeOf(), wrong = wrongOf(right);
    for (let i = 0; i < 8; i++) assert.strictEqual((await verify(h, 'owner@example.com', wrong, '6.6.6.6')).body.code, 'invalid_code');
    assert.strictEqual(h.A.store._codes.filter(c => !c.consumedAt).length, 1);
    assert.strictEqual((await verify(h, 'owner@example.com', right, '1.1.1.1')).code, 200);
  });
  await t('several strangers together use up the shared pool for other connections, but the connection that asked for the code still gets in', async () => {
    const h = harness(); await h.call('post', '/api/auth/request-code', { body: { email: 'owner@example.com' }, ip: '1.1.1.1' }); const right = h.codeOf(), wrong = wrongOf(right);
    let refused = 0;
    for (let ip = 0; ip < 5; ip++) for (let i = 0; i < 8; i++) { const r = await verify(h, 'owner@example.com', wrong, '6.6.6.' + ip); if (r.code === 429) refused++; }
    assert.strictEqual(h.A.store._attempts.filter(a => !a.isRequester).length, 24);
    assert.strictEqual(refused, 16);
    assert.strictEqual((await verify(h, 'owner@example.com', right, '7.7.7.7')).code, 429);
    assert.strictEqual((await verify(h, 'owner@example.com', right, '1.1.1.1')).code, 200);
  });
  await t('the owner mistyping a few times from the connection that asked is not slowed down by strangers', async () => {
    const h = harness(); await h.call('post', '/api/auth/request-code', { body: { email: 'owner@example.com' }, ip: '1.1.1.1' }); const right = h.codeOf(), wrong = wrongOf(right);
    for (let ip = 0; ip < 5; ip++) for (let i = 0; i < 8; i++) await verify(h, 'owner@example.com', wrong, '6.6.6.' + ip);
    for (let i = 1; i <= 3; i++) { const r = await verify(h, 'owner@example.com', wrong, '1.1.1.1'); assert.strictEqual(r.body.code, 'invalid_code'); assert.strictEqual(r.body.attemptsLeft, 5 - i); }
    assert.strictEqual((await verify(h, 'owner@example.com', right, '1.1.1.1')).code, 200);
  });
  await t('the ceiling for the whole address still holds when strangers ask for codes themselves: nobody is let in past it, the operator is told once', async () => {
    const h = harness({}, { AUTH_ADDRESS_HARD_ATTEMPTS_PER_HOUR: '10' }); const email = 'owner@example.com'; let guesses = 0;
    for (const [ip, n] of [['2.2.2.1', 4], ['2.2.2.2', 4], ['2.2.2.3', 2]]) {
      await h.call('post', '/api/auth/request-code', { body: { email }, ip }); h.clock.t += 61000;
      for (let i = 0; i < n; i++) { assert.strictEqual((await verify(h, email, wrongOf(h.codeOf()), ip)).body.code, 'invalid_code'); guesses++; }
    }
    assert.strictEqual(guesses, 10);
    const refused = await verify(h, email, wrongOf(h.codeOf()), '2.2.2.4'); assert.strictEqual(refused.code, 429); assert.strictEqual(refused.body.retryAfter, 3600);
    assert.strictEqual((await verify(h, email, h.codeOf(), '2.2.2.3')).code, 429);
    assert.strictEqual(h.alerts.filter(a => /ceiling/.test(a.s)).length, 1);
    h.clock.t += 3601000;
    await h.call('post', '/api/auth/request-code', { body: { email }, ip: '2.2.2.9' });
    assert.strictEqual((await verify(h, email, h.codeOf(), '2.2.2.9')).code, 200);
  });
  await t('fifty guesses sent at once from one connection let only the per-connection cap through', async () => {
    const h = harness(); await h.call('post', '/api/auth/request-code', { body: { email: 'owner@example.com' }, ip: '1.1.1.1' }); const wrong = wrongOf(h.codeOf());
    const rs = await Promise.all(Array.from({ length: 50 }, () => verify(h, 'owner@example.com', wrong, '6.6.6.6')));
    assert.strictEqual(rs.filter(r => r.code === 400).length, 8, JSON.stringify(rs.map(r => r.code)));
    assert.strictEqual(rs.filter(r => r.code === 429).length, 42);
  });
  await t('a successful sign-in clears the counters of the address', async () => {
    const h = harness(); await h.call('post', '/api/auth/request-code', { body: { email: 'owner@example.com' }, ip: '1.1.1.1' }); const right = h.codeOf();
    for (let i = 0; i < 3; i++) await verify(h, 'owner@example.com', wrongOf(right), '1.1.1.1');
    await verify(h, 'owner@example.com', wrongOf(right), '6.6.6.6');
    assert.strictEqual(h.A.store._attempts.length, 4);
    assert.strictEqual((await verify(h, 'owner@example.com', right, '1.1.1.1')).code, 200);
    assert.strictEqual(h.A.store._attempts.length, 0);
  });
  await t('attempts older than an hour stop counting, and a purge drops what is a day old', async () => {
    const h = harness(); await h.call('post', '/api/auth/request-code', { body: { email: 'owner@example.com' }, ip: '1.1.1.1' }); const wrong = wrongOf(h.codeOf());
    for (let i = 0; i < 8; i++) await verify(h, 'owner@example.com', wrong, '6.6.6.6');
    assert.strictEqual((await verify(h, 'owner@example.com', wrong, '6.6.6.6')).code, 429);
    h.clock.t += 3601000;
    await h.call('post', '/api/auth/request-code', { body: { email: 'owner@example.com' }, ip: '1.1.1.1' });
    assert.strictEqual((await verify(h, 'owner@example.com', wrongOf(h.codeOf()), '6.6.6.6')).code, 400);
    h.clock.t += 25 * 3600000; await h.A.store.purge(new Date(h.clock.t));
    assert.strictEqual(h.A.store._attempts.length, 0);
  });
  await t('a normal user is not slowed: three sign-ins in an hour all work', async () => {
    const h = harness();
    for (let i = 0; i < 3; i++) { const { r } = await h.signIn('normal@example.com'); assert.strictEqual(r.code, 200); h.clock.t += 61000; }
  });

  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
