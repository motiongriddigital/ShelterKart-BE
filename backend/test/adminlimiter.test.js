'use strict';
/**
 * The admin limiter and the address it counts (real express, the real adminAuth and limiter, a real socket).
 * SHEL-34: only refused requests count, so a signed-in console is never locked out by its own refreshes.
 * SHEL-35: with no proxy trusted a forged X-Forwarded-For changes nothing; with TRUST_PROXY=1 the proxy's header names the client.
 */
const assert = require('assert');
const express = require('express');
Object.assign(process.env, { ADMIN_USERNAME: 'ops', ADMIN_PASSWORD: 'ops-pass-1234567' });
const { adminAuth } = require('../middleware/adminAuth');
const TRUST = require('../engine/trustproxy');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
const serve = trust => new Promise(resolve => {
  const c = {}; require('../middleware/limiters')(c);   // a fresh counter per test
  const app = express(); app.set('trust proxy', TRUST.parse(trust).setting);
  app.use('/api/admin', c.adminLimiter);
  app.get('/api/admin/ping', adminAuth, (req, res) => res.json({ ok: true }));
  const srv = app.listen(0, '127.0.0.1', () => resolve({ srv, url: 'http://127.0.0.1:' + srv.address().port + '/api/admin/ping' }));
});
const basic = pass => 'Basic ' + Buffer.from('ops:' + pass).toString('base64');
const hit = async (url, pass, xff) => (await fetch(url, { headers: { authorization: basic(pass), ...(xff ? { 'x-forwarded-for': xff } : {}) } })).status;

(async () => {
  console.log('\nadmin limiter');
  await t('SHEL-34: sixty signed-in requests in a row all pass', async () => {
    const { srv, url } = await serve('');
    try { for (let i = 0; i < 60; i++) assert.strictEqual(await hit(url, 'ops-pass-1234567'), 200, 'request ' + (i + 1)); } finally { srv.close(); }
  });
  await t('SHEL-34: twenty wrong passwords are answered 401, the twenty-first is 429', async () => {
    const { srv, url } = await serve('');
    try { for (let i = 0; i < 20; i++) assert.strictEqual(await hit(url, 'wrong'), 401, 'attempt ' + (i + 1)); assert.strictEqual(await hit(url, 'wrong'), 429); } finally { srv.close(); }
  });
  await t('SHEL-34: signed-in requests between the wrong ones do not use up the allowance', async () => {
    const { srv, url } = await serve('');
    try { for (let i = 0; i < 19; i++) { assert.strictEqual(await hit(url, 'wrong'), 401); assert.strictEqual(await hit(url, 'ops-pass-1234567'), 200); } } finally { srv.close(); }
  });
  await t('SHEL-35: with no proxy trusted, a different forged X-Forwarded-For on every attempt still hits the limit', async () => {
    const { srv, url } = await serve('');
    try { for (let i = 0; i < 20; i++) assert.strictEqual(await hit(url, 'wrong', '9.9.9.' + i), 401, 'attempt ' + (i + 1)); assert.strictEqual(await hit(url, 'wrong', '9.9.9.200'), 429); } finally { srv.close(); }
  });
  await t('SHEL-35: TRUST_PROXY=1 counts per the address the proxy reports, so one client is limited and another is not', async () => {
    const { srv, url } = await serve('1');
    try { for (let i = 0; i < 20; i++) await hit(url, 'wrong', '8.8.8.8'); assert.strictEqual(await hit(url, 'wrong', '8.8.8.8'), 429); assert.strictEqual(await hit(url, 'wrong', '7.7.7.7'), 401); } finally { srv.close(); }
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
