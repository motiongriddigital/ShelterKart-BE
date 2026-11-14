'use strict';
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const O = require('../lib/origins');
const { check } = require('../engine/configCheck');
const { reportLink } = require('../engine/delivery');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } }
const A = 'a'.repeat(32), Q = 'q'.repeat(32);
const GOOD = { NODE_ENV: 'production', ADMIN_USERNAME: 'owner', ADMIN_PASSWORD: 'correct horse battery staple', ACCESS_TOKEN_SECRET: A, QUOTE_SECRET: Q, DATABASE_URL: 'postgres://u:p@127.0.0.1:1/db', ALLOWED_ORIGINS: 'https://shelterkart.example', TRUST_PROXY: '1' };

function serve(env, port) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { PATH: process.env.PATH, PORT: String(port), ADMIN_USERNAME: 'a', ADMIN_PASSWORD: 'b', ...env } });
    let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    const ready = setInterval(async () => { try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.status === 200) { clearInterval(ready); resolve({ stop: () => child.kill(), get: origin => fetch(`http://127.0.0.1:${port}/api/health`, { headers: { origin } }), out: () => out }); } } catch { /* not up yet */ } }, 100);
    setTimeout(() => { clearInterval(ready); resolve(null); }, 8000);
  });
}

(async () => {
  console.log('the allowed origins');
  await t('the API\'s own origin is allowed without being listed, once, and a path on it does not matter', () => {
    assert.deepStrictEqual(O.allowedOrigins({ ALLOWED_ORIGINS: 'https://site.example', API_PUBLIC_URL: 'https://api.site.example/v1' }), ['https://site.example', 'https://api.site.example']);
    assert.deepStrictEqual(O.allowedOrigins({ ALLOWED_ORIGINS: 'https://site.example,https://api.site.example', API_PUBLIC_URL: 'https://api.site.example' }), ['https://site.example', 'https://api.site.example']);
    assert.deepStrictEqual(O.allowedOrigins({ ALLOWED_ORIGINS: ' https://a.example , ,https://b.example ' }), ['https://a.example', 'https://b.example']);
    assert.deepStrictEqual(O.allowedOrigins({ API_PUBLIC_URL: 'not a url' }), []); assert.deepStrictEqual(O.allowedOrigins({}), []);
  });
  await t('"configured" is what the owner listed: the API origin does not count, so a development machine with nothing listed stays open', () => {
    assert.deepStrictEqual(O.configured({ API_PUBLIC_URL: 'https://api.site.example' }), []);
  });

  console.log('the website address and its three jobs');
  await t('each job falls back to PUBLIC_BASE_URL (then SITE_URL), and each can be set on its own', () => {
    assert.deepStrictEqual([O.siteBase({ PUBLIC_BASE_URL: 'https://site.example/' }), O.linkBase({ PUBLIC_BASE_URL: 'https://site.example/' }), O.returnBase({ PUBLIC_BASE_URL: 'https://site.example/' })], ['https://site.example', 'https://site.example', 'https://site.example']);
    assert.strictEqual(O.siteBase({ SITE_URL: 'https://old.example' }), 'https://old.example');
    const env = { PUBLIC_BASE_URL: 'https://site.example', REPORT_LINK_BASE: 'https://app.site.example/', PAYMENT_RETURN_BASE: 'https://pay.site.example' };
    assert.deepStrictEqual([O.siteBase(env), O.linkBase(env), O.returnBase(env)], ['https://site.example', 'https://app.site.example', 'https://pay.site.example']);
    assert.deepStrictEqual([O.siteBase({}), O.linkBase({}), O.returnBase({})], ['', '', '']);
  });
  await t('the link e-mailed or sent by WhatsApp uses the link address, not the website\'s', () => {
    assert.strictEqual(reportLink({ PUBLIC_BASE_URL: 'https://site.example' }, 'SK-ABCDEF123456', 'tok'), 'https://site.example/r/SK-ABCDEF123456?t=tok');
    assert.strictEqual(reportLink({ PUBLIC_BASE_URL: 'https://site.example', REPORT_LINK_BASE: 'https://app.site.example' }, 'SK-ABCDEF123456', 'tok'), 'https://app.site.example/r/SK-ABCDEF123456?t=tok');
  });

  console.log('mistakes that fail silently');
  await t('a trailing slash, a path, a wildcard or a bare word in ALLOWED_ORIGINS is named, with the exact origin to write', () => {
    const p = e => O.originProblems({ NODE_ENV: 'development', ...e });
    assert.match(p({ ALLOWED_ORIGINS: 'https://site.example/' })[0], /write "https:\/\/site\.example"/); assert.match(p({ ALLOWED_ORIGINS: 'https://site.example/app' })[0], /no path/);
    assert.match(p({ ALLOWED_ORIGINS: '*' })[0], /"\*"/); assert.match(p({ ALLOWED_ORIGINS: 'site.example' })[0], /not an origin/);
    assert.deepStrictEqual(p({ ALLOWED_ORIGINS: 'https://site.example,http://localhost:3000' }), []);
  });
  await t('the other settings must be web addresses, and in production https (except localhost)', () => {
    assert.match(O.originProblems({ API_PUBLIC_URL: 'api.site.example' })[0], /API_PUBLIC_URL/);
    assert.deepStrictEqual(O.originProblems({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://site.example', REPORT_LINK_BASE: 'https://app.site.example' }), []);
    assert.match(O.originProblems({ NODE_ENV: 'production', PAYMENT_RETURN_BASE: 'http://pay.site.example' })[0], /not https/);
    assert.match(O.originProblems({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'http://site.example' })[0], /not https/);
  });
  await t('in production the server refuses to start on them; elsewhere they are warnings', () => {
    const bad = { ...GOOD, ALLOWED_ORIGINS: 'https://shelterkart.example/' };
    assert.ok(check(bad).errors.some(e => /exact origin/.test(e))); assert.deepStrictEqual(check(GOOD).errors, []);
    const dev = check({ ...bad, NODE_ENV: 'development' }); assert.deepStrictEqual(dev.errors, []); assert.ok(dev.warnings.some(w => /exact origin/.test(w)));
    assert.deepStrictEqual(check({ ...GOOD, API_PUBLIC_URL: 'https://api.shelterkart.example', REPORT_LINK_BASE: 'https://app.shelterkart.example' }).errors, []);
  });

  console.log('the session cookie guard (CSRF)');
  await t('with the guard on, a state-changing call from the API\'s own origin passes without it being listed; a stranger gets 403', () => {
    const { createAccounts } = require('../accounts');
    const accounts = createAccounts({ env: { NODE_ENV: 'development', ACCOUNTS_ENABLED: 'on', AUTH_PEPPER: 'p'.repeat(40), ACCOUNTS_ALLOW_MEMORY: 'true', ACCOUNTS_CSRF: 'on', ALLOWED_ORIGINS: 'https://shelterkart.example', API_PUBLIC_URL: 'https://api.shelterkart.example' } });
    const attempt = origin => { let code = 200, passed = false; accounts.csrf({ method: 'POST', path: '/api/me', headers: { cookie: 'sk_session=abc', origin, host: 'api.shelterkart.example' } }, { status(c) { code = c; return this; }, json() {} }, () => { passed = true; }); return passed ? 200 : code; };
    assert.strictEqual(attempt('https://shelterkart.example'), 200); assert.strictEqual(attempt('https://api.shelterkart.example'), 200); assert.strictEqual(attempt('https://evil.example'), 403);
  });

  console.log('a real server');
  await t('the website and the API\'s own origin are allowed, a stranger is not, and the API origin did not need to be listed', async () => {
    const s = await serve({ NODE_ENV: 'development', ALLOWED_ORIGINS: 'https://shelterkart.example', API_PUBLIC_URL: 'https://api.shelterkart.example' }, 4871);
    assert.ok(s, 'the server did not start');
    try {
      assert.strictEqual((await s.get('https://shelterkart.example')).headers.get('access-control-allow-origin'), 'https://shelterkart.example');
      assert.strictEqual((await s.get('https://api.shelterkart.example')).headers.get('access-control-allow-origin'), 'https://api.shelterkart.example');
      const evil = await s.get('https://evil.example'); assert.notStrictEqual(evil.headers.get('access-control-allow-origin'), 'https://evil.example'); assert.ok(evil.status >= 400, 'status ' + evil.status);
    } finally { s.stop(); }
  });
  await t('with nothing listed a development machine stays open, and setting only the API address does not close it', async () => {
    const s = await serve({ NODE_ENV: 'development', API_PUBLIC_URL: 'https://api.shelterkart.example' }, 4872);
    assert.ok(s, 'the server did not start');
    try { assert.strictEqual((await s.get('https://anything.example')).status, 200); } finally { s.stop(); }
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
