'use strict';
/**
 * SHEL-43: a misconfigured production server must refuse to start, and CORS must be closed unless NODE_ENV is development or test.
 * The check itself, then the real server started as a child process (real Express, no stand-ins).
 */
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const { check } = require('../engine/configCheck');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const A = 'a'.repeat(32), Q = 'q'.repeat(32);
const GOOD = { NODE_ENV: 'production', ADMIN_USERNAME: 'owner', ADMIN_PASSWORD: 'correct horse battery staple', ACCESS_TOKEN_SECRET: A, QUOTE_SECRET: Q,
  DATABASE_URL: 'postgres://u:p@127.0.0.1:1/db', ALLOWED_ORIGINS: 'https://shelterkart.example', TRUST_PROXY: '1' };
const without = (o, ...ks) => { const c = { ...o }; ks.forEach(k => delete c[k]); return c; };

function run(env, { port, wait = 3500 } = {}) {
  return new Promise(resolve => {
    const clean = { PATH: process.env.PATH, PORT: String(port), ...Object.fromEntries(['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'ACCESS_TOKEN_SECRET', 'QUOTE_SECRET', 'DATABASE_URL', 'ALLOWED_ORIGINS', 'TRUST_PROXY', 'NODE_ENV', 'PAYMENTS_ENABLED', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'DODO_API_KEY', 'DODO_WEBHOOK_KEY', 'ACCOUNTS_ENABLED'].map(k => [k, ''])), ...env };
    const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: clean });
    let out = '', err = '', exited = null;
    child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
    child.on('exit', code => { exited = code; });
    const done = async () => {
      let health = null, cors = {};
      if (exited === null) {
        try { health = (await fetch(`http://127.0.0.1:${port}/api/health`)).status; } catch { health = null; }
        for (const origin of ['https://shelterkart.example', 'https://evil.example']) {
          try { const r = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { origin } }); cors[origin] = r.status === 200 ? r.headers.get('access-control-allow-origin') || 'no-header' : r.status; } catch { cors[origin] = 'error'; }
        }
        child.kill();
      }
      resolve({ exited, out, err, health, cors });
    };
    setTimeout(done, wait);
  });
}

(async () => {
  console.log('\nthe check');
  await t('production with nothing set lists every problem, by name', () => {
    const r = check({ NODE_ENV: 'production' }); const all = r.errors.join(' | ');
    for (const k of ['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'ACCESS_TOKEN_SECRET', 'QUOTE_SECRET', 'DATABASE_URL', 'ALLOWED_ORIGINS']) assert(all.includes(k), k + ' not named: ' + all);
    assert.strictEqual(r.errors.length, 6);
  });
  await t('a fully configured production server has no errors', () => assert.deepStrictEqual(check(GOOD).errors, []));
  await t('a short admin password, a short secret, and two equal secrets are refused', () => {
    assert(check({ ...GOOD, ADMIN_PASSWORD: 'short' }).errors.some(e => /ADMIN_PASSWORD/.test(e)));
    assert(check({ ...GOOD, ACCESS_TOKEN_SECRET: 'tooshort' }).errors.some(e => /ACCESS_TOKEN_SECRET/.test(e)));
    assert(check({ ...GOOD, QUOTE_SECRET: A }).errors.some(e => /must be different/.test(e)));
  });
  await t('a mistyped ACCESS_TOKEN_SECRET with payments on is an error in production, naming the paywall', () => {
    const r = check({ ...without(GOOD, 'ACCESS_TOKEN_SECRET'), PAYMENTS_ENABLED: 'true', RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w' });
    assert(r.errors.some(e => /ACCESS_TOKEN_SECRET/.test(e) && /paywall/.test(e))); assert(r.warnings.some(w => /will NOT lock reports/.test(w)));
  });
  await t('payments on needs a whole provider; half a provider is named', () => {
    const base = { ...GOOD, PAYMENTS_ENABLED: 'true' };
    assert(check(base).errors.some(e => /no payment provider is fully configured/.test(e)));
    assert(check({ ...base, RAZORPAY_KEY_ID: 'k' }).errors.some(e => /Razorpay is half configured: RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET/.test(e)));
    assert.deepStrictEqual(check({ ...base, RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w' }).errors, []);
    assert.deepStrictEqual(check({ ...base, DODO_API_KEY: 'k', DODO_WEBHOOK_KEY: 'w' }).errors, []);
  });
  await t('outside production the same findings are only advice', () => {
    const r = check({ NODE_ENV: 'development' }); assert.deepStrictEqual(r.errors, []); assert(r.warnings.length >= 6 && r.warnings.every(w => w.length > 10));
    assert.deepStrictEqual(check({}).errors, []);
  });
  await t('no message ever contains a secret value', () => {
    const r = check({ ...GOOD, ADMIN_PASSWORD: 'hunter2', ACCESS_TOKEN_SECRET: 'tok-short-secret-value', QUOTE_SECRET: 'tok-short-secret-value' });
    assert(!JSON.stringify(r).match(/hunter2|tok-short-secret-value/));
  });
  await t('a blank value counts as not set', () => assert(check({ ...GOOD, ADMIN_USERNAME: '   ' }).errors.some(e => /ADMIN_USERNAME/.test(e))));

  console.log('\nthe real server');
  await t('production with nothing configured exits with 1 and lists the problems; it never listens', async () => {
    const r = await run({ NODE_ENV: 'production' }, { port: 47311, wait: 2500 });
    assert.strictEqual(r.exited, 1); assert(/will not start in production/.test(r.err) && /ADMIN_PASSWORD/.test(r.err), r.err); assert.strictEqual(r.health, null);
  });
  await t('production configured: it starts; the listed website is allowed, any other is refused', async () => {
    const r = await run(GOOD, { port: 47312, wait: 4000 });
    assert.strictEqual(r.exited, null, 'it should still be running: ' + r.err); assert.strictEqual(r.health, 200);
    assert.strictEqual(r.cors['https://shelterkart.example'], 'https://shelterkart.example'); assert.strictEqual(r.cors['https://evil.example'], 403);
  });
  await t('development with no ALLOWED_ORIGINS: open for the developer, with a warning that says so', async () => {
    const r = await run({ NODE_ENV: 'development' }, { port: 47313, wait: 3000 });
    assert.strictEqual(r.exited, null); assert.strictEqual(r.cors['https://evil.example'], 'https://evil.example'); assert(/ALLOWED_ORIGINS is not set/.test(r.err + r.out) || /\[config\]/.test(r.err));
  });
  await t('NODE_ENV unset with no ALLOWED_ORIGINS: CORS is closed (it used to be open), and the log says why', async () => {
    const r = await run({}, { port: 47314, wait: 3000 });
    assert.strictEqual(r.exited, null); assert.strictEqual(r.cors['https://evil.example'], 403); assert(/ALLOWED_ORIGINS is empty and NODE_ENV is not "development"/.test(r.err), r.err);
  });

  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
