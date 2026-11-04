'use strict';
/** AI engine usage kept per day: counting, the latency histogram, the UTC day, a failing database, the meter hook, and the cost-per-report rows. */
const assert = require('assert');
const { createHistory, percentile, BOUNDS, OVER } = require('../engines/history');
const meter = require('../engines/meter');
const { summarise, costRows, daysOf } = require('../engine/enginesAdmin');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const T0 = Date.parse('2026-11-04T12:00:00Z');
const quiet = { error() {} };
const mk = (o = {}) => { const c = { t: T0 }; return { c, h: createHistory({ now: () => c.t, flushMs: 0, log: quiet, ...o }) }; };
const okEv = (o = {}) => ({ engine: 'anthropic', role: 'research', ok: true, tokensIn: 100, tokensOut: 50, searches: 1, ms: 800, costUsd: 0.01, ...o });

(async () => {
  console.log('counting');
  await t('calls, failures, rescues, tokens, searches and cost add up per day, engine and role', async () => {
    const { h } = mk();
    for (let i = 0; i < 5; i++) h.record(okEv());
    h.record({ engine: 'anthropic', role: 'research', ok: false, ms: 300 }); h.record({ engine: 'anthropic', role: 'research', ok: false, ms: 300 });
    h.record(okEv({ rescued: true }));
    const [r] = await h.rows(1);
    assert.deepStrictEqual([r.day, r.engine, r.role, r.calls, r.failures, r.rescues], ['2026-11-04', 'anthropic', 'research', 8, 2, 1]);
    assert.deepStrictEqual([r.tokensIn, r.tokensOut, r.searches, r.costUsd, r.costedCalls], [600, 300, 6, 0.06, 6]);
  });
  await t('failures never exceed calls and rescues never exceed successes, and costs are numbers', async () => {
    const { h } = mk(); for (let i = 0; i < 20; i++) h.record(i % 3 ? okEv({ rescued: i % 5 === 0 }) : { engine: 'openai', role: 'read', ok: false, ms: 50 });
    for (const r of await h.rows(1)) { assert(r.failures <= r.calls); assert(r.rescues <= r.calls - r.failures); assert(r.p50Ms <= r.p95Ms); assert(Number.isFinite(r.costUsd) && r.costUsd >= 0); }
  });
  await t('two engines and two roles are separate rows, and the summary adds to the same totals', async () => {
    const { h } = mk(); h.record(okEv()); h.record(okEv({ engine: 'openai' })); h.record(okEv({ role: 'read' })); h.record(okEv({ role: 'read' }));
    const rows = await h.rows(1); assert.strictEqual(rows.length, 3);
    const s = summarise(rows); assert.strictEqual(s.totals.calls, 4); assert.strictEqual(s.totals.costUsd, 0.04); assert.strictEqual(s.byEngine.reduce((a, e) => a + e.calls, 0), 4);
  });
  await t('a call with no known price is counted but adds no cost and is not a costed call', async () => {
    const { h } = mk(); h.record(okEv({ costUsd: null })); const [r] = await h.rows(1); assert.deepStrictEqual([r.calls, r.costUsd, r.costedCalls], [1, 0, 0]);
  });
  await t('negative, missing and not-a-number values count as zero, never as NaN', async () => {
    const { h } = mk(); h.record({ engine: 'x', role: 'r', ok: true, tokensIn: -5, tokensOut: 'abc', searches: NaN, ms: undefined, costUsd: -1 });
    const [r] = await h.rows(1); assert(!/NaN|null/.test(JSON.stringify(r)), JSON.stringify(r)); assert.deepStrictEqual([r.tokensIn, r.tokensOut, r.searches, r.avgMs], [0, 0, 0, 0]);
  });
  await t('only counts are kept: extra fields such as a prompt never reach the rows', async () => {
    const { h } = mk(); h.record({ ...okEv(), prompt: 'SECRET PROMPT', answer: 'SECRET ANSWER', email: 'a@b.c' }); assert(!/SECRET|a@b\.c/.test(JSON.stringify(await h.rows(1))));
  });

  console.log('the day and the window');
  await t('the day is the UTC date: a call just before and just after midnight are on two days', async () => {
    const { c, h } = mk(); c.t = Date.parse('2026-11-04T23:59:59Z'); h.record(okEv()); c.t = Date.parse('2026-11-05T00:00:01Z'); h.record(okEv());
    const rows = await h.rows(2); assert.deepStrictEqual(rows.map(r => [r.day, r.calls]), [['2026-11-04', 1], ['2026-11-05', 1]]);
  });
  await t('days=1 is today only; a longer window includes earlier days, oldest first', async () => {
    const { c, h } = mk(); h.record(okEv()); c.t = T0 + 24 * 3600e3; h.record(okEv()); c.t = T0 + 2 * 24 * 3600e3; h.record(okEv());
    assert.strictEqual((await h.rows(1)).length, 1); assert.deepStrictEqual((await h.rows(3)).map(r => r.day), ['2026-11-04', '2026-11-05', '2026-11-06']);
  });
  await t('an empty history gives no rows and zero totals', async () => { const { h } = mk(); const rows = await h.rows(7); assert.deepStrictEqual(rows, []); assert.strictEqual(summarise(rows).totals.calls, 0); });

  console.log('latency');
  await t('p50 and p95 are the upper bound of the bucket they fall in', async () => {
    const lat = new Array(BOUNDS.length + 1).fill(0); lat[1] = 50; lat[3] = 45; lat[5] = 5;
    assert.strictEqual(percentile(lat, 0.5), BOUNDS[1]); assert.strictEqual(percentile(lat, 0.95), BOUNDS[3]); assert.strictEqual(percentile(lat, 1), BOUNDS[5]);
    assert.strictEqual(percentile(new Array(11).fill(0), 0.5), 0);
  });
  await t('a very slow call is in the last bucket and reports the cap', async () => { const { h } = mk(); h.record(okEv({ ms: 999999 })); assert.strictEqual((await h.rows(1))[0].p95Ms, OVER); });
  await t('the average is total time over calls', async () => { const { h } = mk(); h.record(okEv({ ms: 100 })); h.record(okEv({ ms: 300 })); assert.strictEqual((await h.rows(1))[0].avgMs, 200); });

  console.log('a database that fails');
  function fakePool() { const p = { up: true, calls: [], query: async (sql, args) => { if (!p.up) throw new Error('db down'); if (!/^\s*INSERT/.test(sql)) return { rows: [] }; p.calls.push(args); return { rows: [] }; } }; return p; }
  await t('a failing write is logged and does not throw; the counts are kept and written once the database is back', async () => {
    const pool = fakePool(), { h } = mk({ pool }); pool.up = false; h.record(okEv()); h.record(okEv());
    await h.flush(); assert.strictEqual(pool.calls.length, 0); assert.strictEqual(h._pending().size, 1);
    pool.up = true; await h.flush(); assert.strictEqual(pool.calls.length, 1); assert.strictEqual(pool.calls[0][3], 2); assert.strictEqual(h._pending().size, 0);
  });
  await t('counts that arrive while a write fails are added to the ones put back, none lost, none doubled', async () => {
    const pool = fakePool(), { h } = mk({ pool }); pool.up = false; h.record(okEv()); const w = h.flush(); h.record(okEv()); await w; h.record(okEv());
    pool.up = true; await h.flush(); assert.strictEqual(pool.calls.reduce((s, a) => s + a[3], 0), 3);
  });
  await t('after a failed write the counts are retried by themselves, after a growing pause, and written once the database is back', async () => {
    const pool = fakePool(), { h } = mk({ pool, flushMs: 10 }); pool.up = false; h.record(okEv());
    await new Promise(r => setTimeout(r, 60)); assert.strictEqual(pool.calls.length, 0); assert.strictEqual(h._pending().size, 1);
    pool.up = true; await new Promise(r => setTimeout(r, 120));
    assert.strictEqual(pool.calls.length, 1); assert.strictEqual(pool.calls[0][3], 1); assert.strictEqual(h._pending().size, 0);
  });
  await t('a flush with nothing held writes nothing; two at once write once', async () => {
    const pool = fakePool(), { h } = mk({ pool }); await h.flush(); assert.strictEqual(pool.calls.length, 0);
    h.record(okEv()); await Promise.all([h.flush(), h.flush()]); assert.strictEqual(pool.calls.length, 1);
  });
  await t('what is written is the day, engine, role and numbers only', async () => {
    const pool = fakePool(), { h } = mk({ pool }); h.record({ ...okEv(), prompt: 'SECRET' }); await h.flush();
    assert.deepStrictEqual(pool.calls[0].slice(0, 3), ['2026-11-04', 'anthropic', 'research']); assert(!/SECRET/.test(JSON.stringify(pool.calls)));
  });

  console.log('the meter hook');
  await t('every call through the meter reaches the history, and a failing sink never reaches the engine call', async () => {
    meter.reset(); const { h } = mk(); meter.setSink(h.record);
    meter.ok('gemini', 'research', { usage: { input: 10, output: 5 }, searches: 2 }, 120, false, 0.002); meter.ok('gemini', 'research', { usage: { input: 10, output: 5 } }, 80, true, null); meter.fail('gemini', 'research', new Error('boom'), 40);
    const [r] = await h.rows(1); assert.deepStrictEqual([r.engine, r.calls, r.failures, r.rescues, r.tokensIn, r.searches, r.costUsd, r.costedCalls], ['gemini', 3, 1, 1, 20, 2, 0.002, 1]);
    meter.setSink(() => { throw new Error('sink broke'); }); meter.ok('gemini', 'research', { usage: {} }, 1, false, 0); meter.fail('gemini', 'research', new Error('x'), 1);
    meter.setSink(null); meter.reset();
  });

  console.log('the days parameter and the cost rows');
  await t('days: default, 1 to 90, whole numbers only', async () => {
    assert.strictEqual(daysOf(undefined, 7), 7); assert.strictEqual(daysOf('', 30), 30); assert.strictEqual(daysOf('1', 7), 1); assert.strictEqual(daysOf('90', 7), 90);
    for (const v of ['0', '-1', '91', '1000', 'abc', '1.5', '1e1', ' 5', '5 ', '[]']) assert(Number.isNaN(daysOf(v, 7)), v);
  });
  const jobs = [
    { ref: 'SK-A', paid: true, status: 'done', input: { country: 'IN' }, costUsd: 0.5, capUsd: 2, updatedAt: T0 },
    { ref: 'SK-B', paid: true, status: 'failed', input: { country: 'AE' }, costUsd: 1, capUsd: 2, updatedAt: T0 - 1000 },
    { ref: 'SK-FREE', paid: false, status: 'done', input: { country: 'IN' }, costUsd: 0.3, updatedAt: T0 },
    { ref: 'SK-OLD', paid: true, status: 'done', input: { country: 'IN' }, costUsd: 9, updatedAt: T0 - 40 * 24 * 3600e3 },
  ];
  await t('only paid reports in the window are listed, newest first, with cost, share of price and totals', async () => {
    const out = costRows(jobs, new Map([['SK-A', 10]]), T0 - 30 * 24 * 3600e3);
    assert.deepStrictEqual(out.reports.map(r => r.ref), ['SK-A', 'SK-B']); assert.strictEqual(out.reports[0].costShare, 0.05); assert.strictEqual(out.reports[1].priceUsd, null); assert.strictEqual(out.reports[1].costShare, null);
    assert.deepStrictEqual(out.totals, { reports: 2, costUsd: 1.5, avgCostUsd: 0.75, priced: 1, priceUsd: 10 });
  });
  await t('no paid reports gives zero totals, not NaN', async () => { const out = costRows([], new Map(), 0); assert.deepStrictEqual(out.totals, { reports: 0, costUsd: 0, avgCostUsd: 0, priced: 0, priceUsd: 0 }); });

  console.log('\n' + (failed ? failed + ' FAILED' : 'all ' + passed + ' passing'));
  if (failed) process.exitCode = 1;
})();
