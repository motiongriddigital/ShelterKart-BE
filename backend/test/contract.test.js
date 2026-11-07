'use strict';
/** Request validation against the real contract: off, report, enforce by prefix, and a broken contract that fails open. */
const assert = require('assert');
const express = require('express');
const { createContract, modeOf, prefixesOf, enforced } = require('../engine/contract');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } }

const quiet = () => { const lines = []; return { lines, warn: m => lines.push(m), error: m => lines.push(m) }; };
async function serve(env, opts = {}) {
  const log = quiet(), contract = createContract({ env, log, ...opts }), reached = [];
  const app = express();
  app.use(express.json({ limit: '10kb' }));
  app.use(contract.middleware);
  app.all('*', (req, res) => { reached.push({ method: req.method, path: req.path, body: req.body, query: req.query }); res.json({ ok: true }); });
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const call = async (method, p, body, headers = {}) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${p}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  return { contract, log, reached, call, close: () => server.close() };
}

(async () => {
  console.log('settings');
  await t('the mode defaults to off and nonsense is off', () => { assert.deepStrictEqual([modeOf({}), modeOf({ API_VALIDATION: 'Report' }), modeOf({ API_VALIDATION: 'strict' })], ['off', 'report', 'off']); });
  await t('prefixes are trimmed and matched on a path boundary', () => {
    const p = prefixesOf({ API_VALIDATION_ENFORCE: ' /api/auth/, /API/me ,' });
    assert.deepStrictEqual(p, ['/api/auth', '/api/me']);
    assert.deepStrictEqual([enforced(p, '/api/auth/request-code'), enforced(p, '/api/auth'), enforced(p, '/api/authority'), enforced(p, '/api/ME/reports')], [true, true, false, true]);
  });

  console.log('off');
  await t('off loads nothing and passes an invalid request', async () => {
    const s = await serve({});
    const r = await s.call('POST', '/api/auth/request-code', {});
    assert.strictEqual(r.status, 200); assert.strictEqual(s.contract.stats().mode, 'off'); s.close();
  });

  console.log('report');
  await t('a valid request passes and is not counted', async () => {
    const s = await serve({ API_VALIDATION: 'report' });
    const r = await s.call('POST', '/api/auth/request-code', { email: 'a@b.co' });
    assert.strictEqual(r.status, 200); assert.strictEqual(s.contract.stats().mismatches.length, 0); s.close();
  });
  await t('an invalid request still reaches the route, unchanged, and is counted and logged once', async () => {
    const s = await serve({ API_VALIDATION: 'report' });
    const bad = { email: 5, extra: 'x' };
    for (let i = 0; i < 3; i++) assert.strictEqual((await s.call('POST', '/api/auth/request-code', bad)).status, 200);
    assert.deepStrictEqual(s.reached[0].body, bad);
    const m = s.contract.stats().mismatches;
    assert.strictEqual(m.length, 1); assert.strictEqual(m[0].count, 3); assert.strictEqual(m[0].path, '/api/auth/request-code');
    assert.strictEqual(s.log.lines.filter(l => /does not match the contract/.test(l)).length, 1); s.close();
  });
  await t('query strings are not coerced in report mode', async () => {
    const s = await serve({ API_VALIDATION: 'report' });
    await s.call('GET', '/api/admin/errors?q=123&limit=5');
    assert.strictEqual(s.reached[0].query.q, '123'); assert.strictEqual(s.reached[0].query.limit, '5'); s.close();
  });
  await t('webhooks and the document check are never checked', async () => {
    const s = await serve({ API_VALIDATION: 'enforce', API_VALIDATION_ENFORCE: '/api' });
    for (const p of ['/api/payments/webhook', '/api/payments/razorpay/webhook', '/api/payments/mor/webhook', '/api/research/document-check']) assert.strictEqual((await s.call('POST', p, { nonsense: [] })).status, 200, p);
    assert.strictEqual(s.contract.stats().mismatches.length, 0); s.close();
  });
  await t('undocumented paths pass', async () => {
    const s = await serve({ API_VALIDATION: 'enforce', API_VALIDATION_ENFORCE: '/' });
    assert.strictEqual((await s.call('GET', '/no/such/page')).status, 200); s.close();
  });

  console.log('enforce');
  await t('an enforced prefix answers 400 in the envelope the frontend renders', async () => {
    const s = await serve({ API_VALIDATION: 'enforce', API_VALIDATION_ENFORCE: '/api/auth' });
    const r = await s.call('POST', '/api/auth/request-code', {});
    assert.strictEqual(r.status, 400); assert.strictEqual(r.json.ok, false); assert.strictEqual(r.json.code, 'invalid_request');
    assert(Array.isArray(r.json.fields) && r.json.fields.length >= 1 && r.json.fields[0].message);
    assert.strictEqual(typeof r.json.error, 'string'); assert.strictEqual(s.reached.length, 0); s.close();
  });
  await t('a valid request passes an enforced prefix', async () => {
    const s = await serve({ API_VALIDATION: 'enforce', API_VALIDATION_ENFORCE: '/api/auth' });
    assert.strictEqual((await s.call('POST', '/api/auth/request-code', { email: 'a@b.co' })).status, 200); s.close();
  });
  await t('outside the enforced prefixes the same mistake is only reported', async () => {
    const s = await serve({ API_VALIDATION: 'enforce', API_VALIDATION_ENFORCE: '/api/me' });
    assert.strictEqual((await s.call('POST', '/api/auth/request-code', {})).status, 200);
    assert.strictEqual(s.contract.stats().mismatches.length, 1); s.close();
  });
  await t('enforce with no prefixes enforces nothing', async () => {
    const s = await serve({ API_VALIDATION: 'enforce' });
    assert.strictEqual((await s.call('POST', '/api/auth/request-code', {})).status, 200); s.close();
  });

  console.log('a broken contract');
  await t('a missing contract file is logged once and every request passes', async () => {
    const s = await serve({ API_VALIDATION: 'enforce', API_VALIDATION_ENFORCE: '/api' }, { spec: '/nonexistent/openapi.yaml' });
    assert.strictEqual((await s.call('POST', '/api/auth/request-code', {})).status, 200);
    assert.strictEqual((await s.call('POST', '/api/auth/request-code', {})).status, 200);
    assert.strictEqual(s.log.lines.filter(l => /could not be loaded/.test(l)).length, 1); s.close();
  });

  console.log('the contract file');
  await t('it has no duplicate keys and the validator accepts it', async () => {
    const YAML = require('yaml'), fs = require('fs');
    const doc = YAML.parseDocument(fs.readFileSync(require('../engine/contract').SPEC, 'utf8'), { uniqueKeys: true });
    assert.deepStrictEqual(doc.errors.map(e => e.message.split('\n')[0]), []);
    const s = await serve({ API_VALIDATION: 'report' });
    await s.call('POST', '/api/auth/request-code', { email: 'a@b.co' });
    assert(!s.log.lines.some(l => /could not be loaded/.test(l)), s.log.lines.join(' ')); s.close();
  });

  console.log(`\n${failed ? failed + ' FAILED, ' : 'all passing, '}${passed} passed`);
  process.exit(failed ? 1 : 0);
})();
