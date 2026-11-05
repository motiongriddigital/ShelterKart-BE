'use strict';
/** The error log: scrubbing, grouping, counting, throttling, the hourly series, retention and the admin routes, with memory storage and a fake clock. */
const assert = require('assert');
const { createErrorLog, scrub, fingerprint } = require('../engine/errorlog');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const HOUR = 3600e3, DAY = 24 * HOUR;
const mk = (start = Date.parse('2026-11-04T12:00:00Z')) => { const c = { t: start }; return { c, log: createErrorLog({ now: () => c.t }) }; };
const settle = () => new Promise(r => setImmediate(r));

(async () => {
  console.log('scrubbing');
  await t('an e-mail address, an IP address, a token and a query string never survive', async () => {
    const s = scrub('failed for a.b@x.com from 10.1.2.3 GET /r/SK-1?t=abcdef0123456789 Bearer abcdefgh12345678 key abcdefghijklmnopqrstuvwxyz0123456789');
    assert(!/a\.b@x|10\.1\.2\.3|abcdef0123456789|abcdefgh12345678|abcdefghijklmnopqrstuvwxyz/.test(s), s);
    assert(s.includes('[email]') && s.includes('[ip]') && s.includes('[token]') && s.includes('?[query]'), s);
  });
  await t('control characters are removed and the text is capped', async () => assert(scrub('a\u0000b\u001fc').indexOf('\u0000') < 0 && scrub('ab '.repeat(2000), 100).length <= 100));

  console.log('grouping');
  await t('the same problem with other numbers and ids is one group', async () => {
    assert.strictEqual(fingerprint('delivery', 'Resend answered 500 for SK-ABCDEF123456'), fingerprint('delivery', 'Resend answered 503 for SK-FEDCBA654321'));
    assert.notStrictEqual(fingerprint('delivery', 'Resend answered 500'), fingerprint('engine', 'Resend answered 500'));
  });
  await t('repeats are counted in one row, and an error beats a warning', async () => {
    const { c, log } = mk();
    log.record({ level: 'warn', source: 'delivery', message: 'bounce 452' }); await settle();
    c.t += 2000; log.record({ level: 'error', source: 'delivery', message: 'bounce 453' }); await settle();
    const rows = await log.list({});
    assert.strictEqual(rows.length, 1); assert.strictEqual(rows[0].count, 2); assert.strictEqual(rows[0].level, 'error');
  });
  await t('a short burst is not left uncounted: a timer writes what was held', async () => {
    const c = { t: Date.parse('2026-11-04T12:00:00Z') }, timers = [], log = createErrorLog({ now: () => c.t, setTimer: fn => timers.push(fn) });
    for (let i = 0; i < 3; i++) log.record({ source: 'x', message: 'boom' });
    await settle();
    assert.strictEqual((await log.list({}))[0].count, 1);
    assert.strictEqual(timers.length, 1);
    c.t += 1000; timers.shift()(); await settle();
    assert.strictEqual((await log.list({}))[0].count, 3);
    assert.strictEqual((await log.summary(24)).totals.error, 3);
  });
  await t('a flood inside one second is counted, not written again', async () => {
    const { c, log } = mk();
    for (let i = 0; i < 50; i++) log.record({ source: 'x', message: 'boom' });
    await settle(); c.t += 1500; log.record({ source: 'x', message: 'boom' }); await settle();
    assert.strictEqual((await log.list({}))[0].count, 51);
  });

  console.log('reading');
  await t('level, search and window filters', async () => {
    const { c, log } = mk();
    log.record({ level: 'error', source: 'engine:openai', message: 'rate limit' }); c.t += 5000;
    log.record({ level: 'warn', source: 'delivery', message: 'bounce' }); await settle();
    assert.strictEqual((await log.list({ level: 'warn' })).length, 1);
    assert.strictEqual((await log.list({ q: 'OPENAI' })).length, 1);
    assert.strictEqual((await log.list({ since: new Date(c.t - 1000) })).length, 1);
  });
  await t('the summary has one bucket per hour, totals by level and the noisiest sources', async () => {
    const { c, log } = mk();
    log.record({ level: 'error', source: 'engine:openai', message: 'rate limit' }); await settle();
    c.t -= 0; c.t += 2 * HOUR; log.record({ level: 'warn', source: 'delivery', message: 'bounce' }); await settle();
    const s = await log.summary(24);
    assert.strictEqual(s.series.length, 24); assert.strictEqual(s.totals.error, 1); assert.strictEqual(s.totals.warn, 1);
    assert.strictEqual(s.series.reduce((a, b) => a + b.errors + b.warnings, 0), 2);
    assert.deepStrictEqual(s.topSources.map(x => x.source).sort(), ['delivery', 'engine:openai']);
  });
  await t('one group has its last occurrences', async () => {
    const { c, log } = mk();
    log.record({ source: 'x', message: 'boom' }); c.t += 2000; log.record({ source: 'x', message: 'boom' }); await settle();
    const g = await log.store.get((await log.list({}))[0].id);
    assert.strictEqual(g.hits.length, 2);
  });

  console.log('the console');
  await t('console.error and console.warn are mirrored, with a [tag] as the source, and still print', async () => {
    const { log } = mk(); const seen = [], fake = { error: (...a) => seen.push(a), warn: (...a) => seen.push(a) };
    log.hookConsole(fake);
    fake.error('[delivery] failed for a@b.com: 500'); fake.warn('[investigate] slow'); fake.error(new Error('plain'));
    await settle();
    const rows = await log.list({});
    assert.strictEqual(seen.length, 3);
    assert(rows.some(r => r.source === 'delivery' && r.level === 'error' && !/a@b\.com/.test(r.message)));
    assert(rows.some(r => r.source === 'investigate' && r.level === 'warn'));
    assert(rows.some(r => r.source === 'server' && r.message === 'plain' && /Error: plain/.test(r.detail)));
  });
  await t('hooking twice does not double-count', async () => {
    const { log } = mk(); const fake = { error() {}, warn() {} };
    log.hookConsole(fake); log.hookConsole(fake); fake.error('[a] once'); await settle();
    assert.strictEqual((await log.list({}))[0].count, 1);
  });
  await t('a broken store never throws into the caller', async () => {
    const log = createErrorLog({ now: () => 1 }); log.store.upsert = async () => { throw new Error('db down'); };
    log.record({ source: 'x', message: 'y' }); await settle();
  });
  await t('switching it off records nothing', async () => {
    const log = createErrorLog({ enabled: false }); log.record({ source: 'x', message: 'y' }); await settle();
    assert.strictEqual((await log.list({})).length, 0);
  });

  console.log('retention');
  await t('groups and hits older than 30 days are deleted, newer ones stay', async () => {
    const { c, log } = mk();
    log.record({ source: 'old', message: 'a' }); await settle();
    c.t += 31 * DAY; log.record({ source: 'new', message: 'b' }); await settle();
    const r = await log.purge();
    assert.strictEqual(r.groups, 1); assert.deepStrictEqual((await log.list({})).map(x => x.source), ['new']);
  });

  console.log('the admin routes');
  const routes = []; const app = {}; for (const m of ['get']) app[m] = (path, ...h) => routes.push({ method: m, path, handlers: h });
  const { c, log } = mk();
  log.mountAdmin(app, { adminAuth: (req, res, next) => (req.headers.authorization === 'ok' ? next() : res.status(401).json({ ok: false })), ah: f => (q, r, n) => Promise.resolve(f(q, r, n)).catch(n) });
  const call = (path, req = {}) => new Promise(resolve => {
    const route = routes.find(r => r.path === path); const res = { code: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(x) { this.code = x; return this; }, json(b) { resolve({ code: this.code, body: b, headers: this.headers }); } };
    const rq = { headers: {}, query: {}, params: {}, ...req }; let i = 0; const next = e => { if (e) return resolve({ code: 500, body: { error: e.message } }); const h = route.handlers[i++]; if (h) h(rq, res, next); }; next();
  });
  log.record({ level: 'error', source: 'engine:openai', message: 'rate limit' }); await settle();
  const id = (await log.list({}))[0].id;
  await t('they need the operator login', async () => { for (const p of ['/api/admin/errors', '/api/admin/errors/summary', '/api/admin/errors/:id']) assert.strictEqual((await call(p)).code, 401); });
  await t('the list, the summary and one error answer, uncached', async () => {
    const A = { headers: { authorization: 'ok' } };
    const l = await call('/api/admin/errors', { ...A, query: { level: 'error' } });
    assert.strictEqual(l.code, 200); assert.strictEqual(l.body.errors.length, 1); assert.strictEqual(l.headers['Cache-Control'], 'no-store');
    assert.strictEqual((await call('/api/admin/errors/summary', { ...A, query: { hours: '12' } })).body.series.length, 12);
    const one = await call('/api/admin/errors/:id', { ...A, params: { id: String(id) } });
    assert.strictEqual(one.body.error.hits.length, 1);
    assert.strictEqual((await call('/api/admin/errors/:id', { ...A, params: { id: '999' } })).code, 404);
    assert.strictEqual((await call('/api/admin/errors/:id', { ...A, params: { id: 'abc' } })).code, 400);
  });

  console.log(failed ? `\n${failed} FAILED` : '\nall passing'); if (failed) process.exitCode = 1;
})();
