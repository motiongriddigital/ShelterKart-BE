'use strict';
/** The CSRF guard: the decision for each header combination, the middleware modes, and the settings. */
const assert = require('assert');
const http = require('http');
const express = require('express');
const { csrfDecision, csrfGuard } = require('../accounts/csrf');
const { settings } = require('../accounts/config');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } }

const FE = 'https://app.example.com', API = 'https://api.example.com';
const base = { method: 'POST', path: '/api/auth/logout', hasCookie: true, allowedOrigins: [FE], selfOrigin: API };
const d = o => csrfDecision({ ...base, ...o });

(async () => {
  console.log('the decision');
  await t('a cookie and an allowed Origin passes', () => { assert.strictEqual(d({ origin: FE }).allow, true); });
  await t('the API\'s own origin passes', () => { assert.strictEqual(d({ origin: API }).allow, true); });
  await t('a cookie and a foreign Origin is refused', () => { const r = d({ origin: 'https://evil.example' }); assert.strictEqual(r.allow, false); assert.strictEqual(r.reason, 'origin'); });
  await t('the Origin "null" is refused', () => { assert.strictEqual(d({ origin: 'null' }).allow, false); });
  await t('a prefix of an allowed origin is not allowed', () => { assert.strictEqual(d({ origin: FE + '.evil.example' }).allow, false); assert.strictEqual(d({ origin: 'http://app.example.com' }).allow, false); });
  await t('no Origin and Sec-Fetch-Site cross-site is refused', () => { assert.strictEqual(d({ secFetchSite: 'cross-site' }).allow, false); });
  await t('no Origin and Sec-Fetch-Site same-site is refused (a sibling subdomain)', () => { assert.strictEqual(d({ secFetchSite: 'same-site' }).allow, false); });
  await t('no Origin and same-origin or none passes', () => { assert.strictEqual(d({ secFetchSite: 'same-origin' }).allow, true); assert.strictEqual(d({ secFetchSite: 'none' }).allow, true); });
  await t('a cookie and neither header is refused', () => { const r = d({}); assert.strictEqual(r.allow, false); assert.strictEqual(r.reason, 'no_headers'); });
  await t('an allowed Origin wins over a cross-site Sec-Fetch-Site (the split front end)', () => { assert.strictEqual(d({ origin: FE, secFetchSite: 'same-site' }).allow, true); });
  await t('no cookie passes whatever the headers say', () => { assert.strictEqual(d({ hasCookie: false, origin: 'https://evil.example' }).allow, true); assert.strictEqual(d({ hasCookie: false }).allow, true); });
  await t('GET, HEAD and OPTIONS are never refused', () => { for (const m of ['GET', 'HEAD', 'OPTIONS']) assert.strictEqual(d({ method: m, origin: 'https://evil.example' }).allow, true, m); });
  await t('POST, PUT, PATCH and DELETE are checked, in any letter case', () => { for (const m of ['POST', 'put', 'Patch', 'DELETE']) assert.strictEqual(d({ method: m, origin: 'https://evil.example' }).allow, false, m); });
  await t('the payment webhooks are exempt, with a trailing slash or other case', () => {
    for (const p of ['/api/payments/webhook', '/api/payments/razorpay/webhook', '/api/payments/mor/webhook', '/API/Payments/Webhook/']) assert.strictEqual(d({ path: p, origin: 'https://evil.example' }).allow, true, p);
  });
  await t('an empty allow list refuses a foreign Origin when closed and allows it when open (development)', () => {
    assert.strictEqual(d({ allowedOrigins: [], origin: 'http://localhost:3000' }).allow, false);
    assert.strictEqual(d({ allowedOrigins: [], origin: 'http://localhost:3000', openWhenEmpty: true }).allow, true);
  });
  await t('origins are compared without a trailing slash and in lower case', () => { assert.strictEqual(d({ allowedOrigins: [FE + '/'], origin: 'HTTPS://APP.EXAMPLE.COM' }).allow, true); });

  console.log('the middleware');
  const serve = (mode, extra = {}) => new Promise(resolve => {
    const logs = [];
    const app = express();
    app.use(csrfGuard({ mode, cookieName: 'sk_session', allowedOrigins: [FE], openWhenEmpty: false, log: l => logs.push(l), ...extra }));
    app.post('/api/auth/logout', (req, res) => res.json({ ok: true }));
    app.get('/api/me', (req, res) => res.json({ ok: true }));
    const srv = app.listen(0, () => resolve({ logs, port: srv.address().port, close: () => srv.close() }));
  });
  const send = (port, method, path, headers) => new Promise((resolve, reject) => {
    const r = http.request({ port, method, path, headers }, res => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => resolve({ code: res.statusCode, body: b ? JSON.parse(b) : null })); });
    r.on('error', reject); r.end();
  });
  const cookie = { cookie: 'sk_session=' + 'a'.repeat(43) };
  await t('on: a foreign Origin with the session cookie is a 403 csrf', async () => {
    const s = await serve('on'); const r = await send(s.port, 'POST', '/api/auth/logout', { ...cookie, origin: 'https://evil.example' }); s.close();
    assert.strictEqual(r.code, 403); assert.deepStrictEqual(r.body, { ok: false, code: 'csrf', error: 'This request came from an origin that is not allowed.' });
  });
  await t('on: the allowed Origin gets through', async () => {
    const s = await serve('on'); const r = await send(s.port, 'POST', '/api/auth/logout', { ...cookie, origin: FE }); s.close();
    assert.strictEqual(r.code, 200);
  });
  await t('on: no cookie, nothing to forge, passes', async () => {
    const s = await serve('on'); const r = await send(s.port, 'POST', '/api/auth/logout', { origin: 'https://evil.example' }); s.close();
    assert.strictEqual(r.code, 200);
  });
  await t('on: another cookie is not the session cookie', async () => {
    const s = await serve('on'); const r = await send(s.port, 'POST', '/api/auth/logout', { cookie: 'theme=dark', origin: 'https://evil.example' }); s.close();
    assert.strictEqual(r.code, 200);
  });
  await t('report: the request succeeds and one line is logged without the cookie', async () => {
    const s = await serve('report'); const r = await send(s.port, 'POST', '/api/auth/logout', { ...cookie, origin: 'https://evil.example' }); s.close();
    assert.strictEqual(r.code, 200); assert.strictEqual(s.logs.length, 1);
    assert(/csrf/.test(s.logs[0]) && /origin/.test(s.logs[0]) && !/aaaa/.test(s.logs[0]), s.logs[0]);
  });
  await t('off: nothing is checked and nothing is logged', async () => {
    const s = await serve('off'); const r = await send(s.port, 'POST', '/api/auth/logout', { ...cookie, origin: 'https://evil.example' }); s.close();
    assert.strictEqual(r.code, 200); assert.strictEqual(s.logs.length, 0);
  });
  await t('a GET with a foreign Origin is untouched', async () => {
    const s = await serve('on'); const r = await send(s.port, 'GET', '/api/me', { ...cookie, origin: 'https://evil.example' }); s.close();
    assert.strictEqual(r.code, 200);
  });
  await t('the API\'s own origin, from the Host header, passes', async () => {
    const s = await serve('on'); const r = await send(s.port, 'POST', '/api/auth/logout', { ...cookie, origin: 'http://localhost:' + s.port }); s.close();
    assert.strictEqual(r.code, 200);
  });

  console.log('the setting');
  await t('ACCOUNTS_CSRF defaults to report on a developer machine and to on in production, accepts off and on, and ignores anything else', () => {
    assert.strictEqual(settings({ NODE_ENV: 'production' }).csrf, 'on'); assert.strictEqual(settings({ NODE_ENV: 'production', ACCOUNTS_CSRF: 'yes' }).csrf, 'on');
    assert.strictEqual(settings({ NODE_ENV: 'production', ACCOUNTS_CSRF: 'report' }).csrf, 'report'); assert.strictEqual(settings({ NODE_ENV: 'production', ACCOUNTS_CSRF: 'off' }).csrf, 'off');
    assert.strictEqual(settings({}).csrf, 'report'); assert.strictEqual(settings({ ACCOUNTS_CSRF: 'on' }).csrf, 'on'); assert.strictEqual(settings({ ACCOUNTS_CSRF: 'OFF' }).csrf, 'off');
    assert.strictEqual(settings({ ACCOUNTS_CSRF: 'yes' }).csrf, 'report'); assert.strictEqual(settings({ ACCOUNTS_CSRF: '' }).csrf, 'report');
  });

  console.log('the contract document');
  const doc = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'docs', 'accounts', 'FRONTEND-CONTRACT.md'), 'utf8');
  for (const [label, re] of [['the production cookie name', /__Host-sk_session/], ['the development cookie name', /`sk_session`/], ['the flags', /HttpOnly[\s\S]*SameSite=Lax/], ['the lifetime in days', /30 days/], ['the absolute cap', /90 days/],
    ['credentials include', /credentials: "include"/], ['the 401 body', /auth_required/], ['the session endpoint', /GET \/api\/auth\/session/], ['the csrf reply', /403[\s\S]*csrf/], ['the verified flag', /emailVerified/],
    ['development on different URLs', /different URLs|different origins/i], ['ACCOUNTS_CSRF', /ACCOUNTS_CSRF/], ['ALLOWED_ORIGINS', /ALLOWED_ORIGINS/]]) {
    await t('the contract names ' + label, () => assert(re.test(doc), String(re)));
  }

  console.log('\n' + (failed ? failed + ' FAILED' : 'all ' + passed + ' passing'));
  if (failed) process.exitCode = 1;
})();
