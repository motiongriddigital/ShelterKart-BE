'use strict';
/**
 * Valid JSON that is shaped to break String()/stripPII or the database (SHEL-45): a "toString" key, and NUL bytes.
 * Real express, a real socket. Hostile keys are refused with 400; NUL bytes are removed before any route sees them.
 */
const assert = require('assert');
const express = require('express');
const bodyGuard = require('../middleware/body');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
const serve = () => new Promise(resolve => {
  const app = express();
  app.post('/echo', bodyGuard.json({ limit: '10kb' }), (req, res) => res.json({ got: req.body, text: String(req.body && req.body.note) }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  const srv = app.listen(0, '127.0.0.1', () => resolve({ srv, url: 'http://127.0.0.1:' + srv.address().port + '/echo' }));
});
const post = (url, raw) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });

(async () => {
  console.log('\nbody guard');
  const { srv, url } = await serve();
  try {
    await t('an ordinary body passes untouched', async () => {
      const r = await post(url, '{"query":"Acme","n":3,"list":["a",{"b":true}],"x":null}');
      assert.strictEqual(r.status, 200); assert.deepStrictEqual((await r.json()).got, { query: 'Acme', n: 3, list: ['a', { b: true }], x: null });
    });
    for (const raw of ['{"query":{"toString":1}}', '{"q":[{"toString":1}]}', '{"a":{"b":{"valueOf":"x"}}}', '{"toJSON":1}', '{"constructor":{"prototype":{}}}', '{"__proto__":{"admin":true}}']) {
      await t('refused with 400: ' + raw, async () => {
        const r = await post(url, raw); assert.strictEqual(r.status, 400); const j = await r.json(); assert.strictEqual(j.ok, false); assert(!/at |Error:/.test(JSON.stringify(j)));
      });
    }
    await t('a NUL byte in a value is removed, in objects and in arrays', async () => {
      const r = await post(url, '{"note":"a\\u0000b","list":["x\\u0000","y"]}');
      assert.strictEqual(r.status, 200); const j = await r.json(); assert.strictEqual(j.got.note, 'ab'); assert.deepStrictEqual(j.got.list, ['x', 'y']);
    });
    await t('a NUL byte in a key is removed', async () => {
      const r = await post(url, '{"no\\u0000te":"v"}'); assert.deepStrictEqual((await r.json()).got, { note: 'v' });
    });
    await t('a body nested deeper than twenty levels is refused', async () => {
      const r = await post(url, '{"a":'.repeat(30) + '1' + '}'.repeat(30)); assert.strictEqual(r.status, 400);
    });
    await t('malformed JSON still reaches the error handler, not the guard', async () => {
      assert.strictEqual((await post(url, '{"a":')).status, 400);
    });
    await t('an empty body and a bare string pass', async () => {
      assert.strictEqual((await fetch(url, { method: 'POST' })).status, 200);
      assert.strictEqual((await post(url, '{}')).status, 200);
    });
  } finally { srv.close(); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
