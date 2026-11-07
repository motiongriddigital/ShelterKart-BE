'use strict';
/** Cache-Control for routes without one (HTTP_CACHE) and the per-route timing table (SLOW_MS). */
const assert = require('assert');
const http = require('http');
const express = require('express');
const { createHttpCache, policyFor, onOf, PUBLIC_SHORT } = require('../engine/httpcache');
const { createTiming, slowOf, pct } = require('../engine/timing');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } }

async function serve(setup) {
  const app = express(); setup(app);
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const get = (p, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}${p}`, { headers });
  const status = (p, headers) => new Promise((ok, no) => http.get({ port: server.address().port, path: p, headers }, r => { r.resume(); ok(r.statusCode); }).on('error', no));
  return { get, status, close: () => server.close() };
}

(async () => {
  console.log('cache policy');
  await t('HTTP_CACHE is off unless it says on', () => { assert.deepStrictEqual([onOf({}), onOf({ HTTP_CACHE: 'off' }), onOf({ HTTP_CACHE: 'ON' }), onOf({ HTTP_CACHE: 'true' })], [false, false, true, true]); });
  await t('the market list is public and short, personal and admin routes are never stored, the rest is untouched', () => {
    assert.strictEqual(policyFor('GET', '/api/markets'), PUBLIC_SHORT);
    assert.strictEqual(policyFor('GET', '/API/Markets/'), PUBLIC_SHORT);
    assert.strictEqual(policyFor('POST', '/api/markets'), null);
    for (const p of ['/api/me', '/api/me/reports', '/api/auth/session', '/api/admin/stats', '/api/admin']) assert.strictEqual(policyFor('GET', p), 'no-store', p);
    for (const p of ['/api/medical', '/api/authors', '/api/health', '/api/research/by-ref/SK-1', '/r/SK-1']) assert.strictEqual(policyFor('GET', p), null, p);
  });

  console.log('the middleware');
  await t('off sets nothing', async () => {
    const s = await serve(app => { app.use(createHttpCache({ env: {} }).middleware); app.get('/api/markets', (q, r) => r.json([1])); });
    assert.strictEqual((await s.get('/api/markets')).headers.get('cache-control'), null); s.close();
  });
  await t('on sets the header, keeps a handler\'s own, and a repeat request with the ETag gets a 304', async () => {
    const s = await serve(app => {
      app.use(createHttpCache({ env: { HTTP_CACHE: 'on' } }).middleware);
      app.get('/api/markets', (q, r) => r.json([1, 2]));
      app.get('/api/me', (q, r) => r.json({ me: 1 }));
      app.get('/api/admin/own', (q, r) => { r.set('Cache-Control', 'private, no-store'); r.json({}); });
      app.get('/api/health', (q, r) => r.json({ ok: true }));
    });
    const a = await s.get('/api/markets');
    assert.strictEqual(a.headers.get('cache-control'), PUBLIC_SHORT);
    const etag = a.headers.get('etag'); assert(etag);
    assert.strictEqual(await s.status('/api/markets', { 'if-none-match': etag }), 304);
    assert.strictEqual((await s.get('/api/me')).headers.get('cache-control'), 'no-store');
    assert.strictEqual((await s.get('/api/admin/own')).headers.get('cache-control'), 'private, no-store');
    assert.strictEqual((await s.get('/api/health')).headers.get('cache-control'), null); s.close();
  });

  console.log('timing');
  await t('SLOW_MS defaults to 1000, 0 is allowed, nonsense is 1000', () => { assert.deepStrictEqual([slowOf({}), slowOf({ SLOW_MS: '' }), slowOf({ SLOW_MS: '0' }), slowOf({ SLOW_MS: '250' }), slowOf({ SLOW_MS: 'x' }), slowOf({ SLOW_MS: '-5' })], [1000, 1000, 0, 250, 1000, 1000]); });
  await t('percentiles come from the sorted samples', () => { const s = Array.from({ length: 100 }, (_, i) => i + 1); assert.deepStrictEqual([pct(s, 0.5), pct(s, 0.95), pct([], 0.5), pct([7], 0.95)], [50, 95, 0, 7]); });
  await t('the table keys on the route pattern, never the real path, and a slow request logs one line', async () => {
    const lines = []; const timing = createTiming({ env: { SLOW_MS: '30' }, log: { warn: m => lines.push(m) } });
    const s = await serve(app => {
      app.use(timing.middleware);
      app.get('/r/:ref', (q, r) => r.json({}));
      app.get('/slow', (q, r) => setTimeout(() => r.json({}), 60));
      const router = express.Router(); router.get('/item/:id', (q, r) => r.json({})); app.use('/api/x', router);
    });
    await s.get('/r/SK-111'); await s.get('/r/SK-222'); await s.get('/slow'); await s.get('/api/x/item/9'); await s.get('/nothing');
    await new Promise(r => setTimeout(r, 30));
    const rows = timing.stats().routes, find = (m, r) => rows.find(x => x.method === m && x.route === r);
    assert.strictEqual(find('GET', '/r/:ref').count, 2);
    assert(find('GET', '/api/x/item/:id'), JSON.stringify(rows.map(x => x.route)));
    assert(find('GET', 'unmatched'));
    assert(!rows.some(x => /SK-1|\/9/.test(x.route)));
    assert.strictEqual(find('GET', '/slow').slow, 1);
    assert.strictEqual(lines.length, 1); assert(/^\[slow\] GET \/slow 200 \d+ms$/.test(lines[0]), lines[0]);
    assert.strictEqual(rows[0].route, '/slow', 'slowest p95 first'); s.close();
  });
  await t('SLOW_MS=0 keeps the table but logs nothing, and event streams are skipped', async () => {
    const lines = []; const timing = createTiming({ env: { SLOW_MS: '0' }, log: { warn: m => lines.push(m) } });
    const s = await serve(app => {
      app.use(timing.middleware);
      app.get('/slow', (q, r) => setTimeout(() => r.json({}), 40));
      app.get('/events', (q, r) => { r.set('Content-Type', 'text/event-stream'); r.end('data: 1\n\n'); });
    });
    await s.get('/slow'); await (await s.get('/events')).text(); await new Promise(r => setTimeout(r, 30));
    assert.strictEqual(lines.length, 0);
    assert.deepStrictEqual(timing.stats().routes.map(r => r.route), ['/slow']); s.close();
  });
  await t('the table is bounded', async () => {
    const timing = createTiming({ env: {}, log: { warn() {} } });
    const fake = (i) => { const handlers = {}; const res = { statusCode: 200, getHeader: () => '', on: (e, f) => { handlers[e] = f; } }; timing.middleware({ method: 'GET', route: { path: '/p' + i }, baseUrl: '' }, res, () => {}); handlers.finish(); };
    for (let i = 0; i < 350; i++) fake(i);
    assert.strictEqual(timing.stats().routes.length, 300);
  });

  console.log(`\n${failed ? failed + ' FAILED, ' : 'all passing, '}${passed} passed`);
  process.exit(failed ? 1 : 0);
})();
