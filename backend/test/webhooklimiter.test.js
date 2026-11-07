'use strict';
/**
 * The limiter on the legacy payment webhook (real express and express-rate-limit, a real socket): only REFUSALS count against an address.
 * Thirty unsigned requests a minute are allowed, then 429; the provider's own successful deliveries are never limited.
 */
const assert = require('assert');
const express = require('express');
const makeLimiter = () => { const c = {}; require('../middleware/limiters')(c); return c.webhookForgeryLimiter; };   // a fresh counter per test
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
const serve = () => new Promise(resolve => {
  const app = express(); app.post('/hook', makeLimiter(), (req, res) => res.status(Number(req.query.s)).json({ ok: Number(req.query.s) < 400 }));
  const srv = app.listen(0, '127.0.0.1', () => resolve({ srv, url: 'http://127.0.0.1:' + srv.address().port + '/hook' }));
});
const hit = async (url, s) => (await fetch(`${url}?s=${s}`, { method: 'POST' })).status;

(async () => {
  console.log('\nwebhook forgery limiter');
  await t('thirty refusals are answered 401, the thirty-first is 429', async () => {
    const { srv, url } = await serve();
    try { for (let i = 0; i < 30; i++) assert.strictEqual(await hit(url, 401), 401, 'request ' + (i + 1)); assert.strictEqual(await hit(url, 401), 429); } finally { srv.close(); }
  });
  await t('successful deliveries never count: two hundred in a row all pass', async () => {
    const { srv, url } = await serve();
    try { for (let i = 0; i < 200; i++) assert.strictEqual(await hit(url, 200), 200, 'request ' + (i + 1)); } finally { srv.close(); }
  });
  await t('a few refusals from an address do not block a successful delivery from the same address', async () => {
    const { srv, url } = await serve();
    try { for (let i = 0; i < 10; i++) await hit(url, 401); assert.strictEqual(await hit(url, 200), 200); } finally { srv.close(); }
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
