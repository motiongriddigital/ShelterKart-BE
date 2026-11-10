'use strict';
/** Admin free-versus-premium funnel: the step maths, the largest drop, the definition of free and premium, and the route's checks. */
const assert = require('assert');
const { mountFunnelAdmin, buildFunnel, chain, DEFINITION } = require('../engine/funnelAdmin');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const NOW = Date.parse('2026-11-10T15:00:00Z');
const ANALYTICS = { funnel: [{ label: 'Visited', count: 1000 }, { label: 'Searched', count: 400 }, { label: 'Saw a report', count: 400 }],
  signin_funnel: [{ label: 'Wall shown', count: 300 }, { label: 'Code requested', count: 150 }, { label: 'Signed in', count: 120 }] };
const COHORT = { users: '120', opened: '90', checkout: '30', paid: '12', repeat: '3', median_hours: '5.26' };
const CLASSES = { users: '500', premium: '40', active: '200', active_premium: '25' };
const calls = [];
const source = { async cohort(since) { calls.push(['cohort', since]); return COHORT; }, async classes(since) { calls.push(['classes', since]); return CLASSES; } };
const routes = new Map(), app = { get: (p, ...h) => routes.set(p, h) };
const pass = (req, res, next) => next && next();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => res.status(500).json({ error: e.message }));
mountFunnelAdmin(app, { adminAuth: pass, wrap, rateLimit: () => pass, source, analytics: async days => { calls.push(['analytics', days]); return ANALYTICS; }, now: () => NOW });
const call = (query = {}, r = routes) => new Promise(resolve => {
  const res = { code: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b, headers: this.headers }); } };
  const hs = r.get('/api/admin/funnel/users'); let i = 0; const next = () => { const f = hs[i++]; if (f) f({ query }, res, next); }; next();
});

(async () => {
  console.log('steps');
  await t('each step shows the share of the one before, the share of the first, and how many were lost', async () => {
    const c = chain([{ label: 'a', count: 200 }, { label: 'b', count: 50 }, { label: 'c', count: 10 }]);
    assert.deepStrictEqual(c.stages.map(s => [s.ofPrevious, s.ofFirst, s.lost]), [[null, null, null], [25, 25, 150], [20, 5, 40]]);
  });
  await t('the largest drop is the biggest share lost, not the biggest number', async () => {
    const c = chain([{ label: 'a', count: 1000 }, { label: 'b', count: 800 }, { label: 'c', count: 40 }, { label: 'd', count: 4 }]);
    assert.deepStrictEqual(c.largestDrop, { from: 'b', to: 'c', lost: 760, percent: 95 });
  });
  await t('an empty first step gives no percentages and no largest drop, never NaN or Infinity', async () => {
    const c = chain([{ label: 'a', count: 0 }, { label: 'b', count: 0 }]);
    assert.strictEqual(c.stages[1].ofPrevious, null); assert.strictEqual(c.largestDrop, null);
  });
  await t('a step that is larger than the one before (events against visitors) is not counted as a loss', async () => {
    const c = chain([{ label: 'a', count: 10 }, { label: 'b', count: 14 }]);
    assert.strictEqual(c.stages[1].lost, 0); assert.strictEqual(c.largestDrop, null);
  });

  console.log('route');
  await t('visitor stages come from the analytics funnel and the sign-in funnel, each labelled with its unit', async () => {
    const r = await call({ days: '30' });
    assert.strictEqual(r.code, 200); assert.strictEqual(r.headers['Cache-Control'], 'no-store');
    assert.deepStrictEqual(r.body.visitors.stages.map(s => [s.label, s.count, s.unit]), [['Visited', 1000, 'visitor-days'], ['Searched', 400, 'visitor-days'], ['Sign-in wall shown', 300, 'events'], ['Code requested', 150, 'events'], ['Signed in', 120, 'events']]);
    assert.deepStrictEqual(r.body.visitors.largestDrop, { from: 'Visited', to: 'Searched', lost: 600, percent: 60 });
  });
  await t('new users are followed from sign-up to a second purchase, with abandoned checkouts and the median time to pay', async () => {
    const r = await call({});
    assert.deepStrictEqual(r.body.newUsers.stages.map(s => [s.label, s.count]), [['Signed up', 120], ['Opened a report', 90], ['Started checkout', 30], ['Paid', 12], ['Paid again', 3]]);
    assert.strictEqual(r.body.newUsers.abandonedCheckout, 18); assert.strictEqual(r.body.newUsers.medianHoursToFirstPayment, 5.3);
    assert.deepStrictEqual(r.body.newUsers.largestDrop, { from: 'Paid', to: 'Paid again', lost: 9, percent: 75 });
  });
  await t('free and premium are counted from all live users, with who was active in the last 30 days', async () => {
    const r = await call({});
    assert.deepStrictEqual(r.body.classes, { users: 500, free: 460, premium: 40, premiumShare: 8, active30d: { free: 175, premium: 25 } });
    assert.strictEqual(r.body.definition, DEFINITION); assert(/no membership/i.test(r.body.definition));
  });
  await t('the window opens at midnight UTC of the first day, and activity is measured over the last 30 days', async () => {
    calls.length = 0; await call({ days: '7' });
    assert.deepStrictEqual(calls.find(c => c[0] === 'cohort'), ['cohort', '2026-11-04T00:00:00.000Z']);
    assert.deepStrictEqual(calls.find(c => c[0] === 'classes'), ['classes', '2026-10-11T15:00:00.000Z']);
    assert.deepStrictEqual(calls.find(c => c[0] === 'analytics'), ['analytics', 7]);
  });
  await t('days must be a whole number from 1 to 400, and defaults to 30', async () => {
    for (const d of ['0', '401', '-3', '2.5', 'abc', '1e1', '99999']) assert.strictEqual((await call({ days: d })).code, 400, d);
    assert.strictEqual((await call({ days: '400' })).code, 200);
    assert.strictEqual((await call({})).body.days, 30);
  });
  await t('without a database only the visitor stages are returned, and stored is false', async () => {
    const r2 = new Map(), a2 = { get: (p, ...h) => r2.set(p, h) };
    mountFunnelAdmin(a2, { adminAuth: pass, wrap, rateLimit: () => pass, source: null, analytics: async () => ANALYTICS, now: () => NOW });
    const r = await call({}, r2);
    assert.strictEqual(r.body.stored, false); assert(r.body.visitors); assert.strictEqual(r.body.newUsers, undefined); assert.strictEqual(r.body.classes, undefined);
  });
  await t('buildFunnel survives an analytics result with nothing in it', async () => {
    const f = buildFunnel({ analytics: {}, cohort: null, classes: null });
    assert.deepStrictEqual(f.visitors.stages.map(s => s.count), [0, 0, 0, 0, 0]);
  });
  await t('no personal field can appear in the answer', async () => {
    const r = await call({}); assert(!/email|name|phone|address/i.test(JSON.stringify(r.body).replace(/"definition":"[^"]*"/, '')));
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
