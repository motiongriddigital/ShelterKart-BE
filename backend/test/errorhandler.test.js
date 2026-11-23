'use strict';
const assert = require('assert');
const express = require('express');
const http = require('http');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const app = express();
app.get('/r/:ref', (req, res) => res.json({ ref: req.params.ref }));
app.get('/boom', () => { throw new Error('database says secret-table is missing'); });
app.post('/json', express.json({ limit: '1kb' }), (req, res) => res.json({ ok: true }));
require('../middleware/errors').install(app, {});
const realErr = console.error; console.error = () => {};

(async () => {
  const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  console.log('the error handler');
  await t('a malformed percent-escape in the path is 400, not 500', async () => {
    const r = await fetch(base + '/r/%ZZ'); const j = await r.json();
    assert.strictEqual(r.status, 400); assert.strictEqual(j.ok, false); assert(!/URIError|decode|stack/i.test(JSON.stringify(j)));
  });
  await t('a good path still works', async () => { const r = await fetch(base + '/r/SK-1'); assert.strictEqual(r.status, 200); });
  await t('a real failure is still 500 and leaks nothing', async () => {
    const r = await fetch(base + '/boom'); const j = await r.json(); assert.strictEqual(r.status, 500); assert.strictEqual(j.error, 'Internal server error'); assert(!/secret-table/.test(JSON.stringify(j)));
  });
  await t('malformed JSON stays 400 and a body that is too large stays 413', async () => {
    const bad = await fetch(base + '/json', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":' });
    const big = await fetch(base + '/json', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 'x'.repeat(5000) }) });
    assert.strictEqual(bad.status, 400); assert.strictEqual(big.status, 413);
  });
  server.close(); console.error = realErr; console.log(`${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
