'use strict';
/** Admin insights: each rule fires at its threshold and not before, the order is most urgent first, and a source that cannot be read leaves a hole, not a failure. */
const assert = require('assert');
const { generate, mountInsightsAdmin, RULES } = require('../engine/insights');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
const ids = list => list.map(i => i.id);
const one = (inputs, id) => generate(inputs).find(i => i.id === id);

(async () => {
  console.log('rules');
  await t('nothing to report gives one calm line, not an empty list', async () => {
    const r = generate({}); assert.deepStrictEqual(ids(r), ['quiet']); assert.strictEqual(r[0].tone, 'good');
    assert.deepStrictEqual(ids(generate({ backups: { level: 'ok', text: 'fine' }, errors: { totals: { error: 0 } }, queues: { disputes: 0, replies: 0 }, failedJobs: 0 })), ['quiet']);
  });
  await t('backups: error is bad, overdue is warn, not set up is info, ok says nothing', async () => {
    assert.strictEqual(one({ backups: { level: 'error', text: 'The last backup failed.' } }, 'backups').tone, 'bad');
    assert.strictEqual(one({ backups: { level: 'warn', text: 'overdue' } }, 'backups').tone, 'warn');
    assert.strictEqual(one({ backups: { level: 'off', text: 'Backups are not set up yet.' } }, 'backups').tone, 'info');
    assert.strictEqual(one({ backups: { level: 'ok', text: 'ok' } }, 'backups'), undefined);
    assert.strictEqual(one({ backups: { level: 'error', text: 'The last backup failed.' } }, 'backups').text, 'The last backup failed.');
  });
  await t('registers: down is bad and names them, degraded is warn, healthy and not yet checked say nothing', async () => {
    const reg = [{ market: 'in', label: 'India', state: 'down' }, { market: 'pl', label: 'Poland', state: 'degraded' }, { market: 'cz', label: 'Czechia', state: 'healthy' }, { market: 'ee', state: 'not_checked' }, { market: 'jp', state: 'unconfirmed' }];
    const r = generate({ registers: reg });
    assert.strictEqual(r.find(i => i.id === 'registers-down').tone, 'bad'); assert(/1 official register is down: India/.test(r.find(i => i.id === 'registers-down').text));
    assert(/Poland/.test(r.find(i => i.id === 'registers-degraded').text)); assert(!/Czechia|Japan|jp|ee/.test(JSON.stringify(r)));
  });
  await t('errors: warn at the first threshold, bad at the second, the busiest source is named', async () => {
    const e = n => ({ hours: 24, totals: { error: n }, topSources: [{ source: 'payments' }] });
    assert.strictEqual(one({ errors: e(RULES.errorsWarn - 1) }, 'errors'), undefined);
    assert.strictEqual(one({ errors: e(RULES.errorsWarn) }, 'errors').tone, 'warn');
    assert.strictEqual(one({ errors: e(RULES.errorsBad) }, 'errors').tone, 'bad'); assert(/payments/.test(one({ errors: e(50) }, 'errors').text));
  });
  await t('queues and failed jobs: singular and plural read correctly', async () => {
    assert(/^1 dispute is waiting/.test(one({ queues: { disputes: 1, replies: 0 } }, 'disputes').text));
    assert(/^3 disputes are waiting/.test(one({ queues: { disputes: 3, replies: 2 } }, 'disputes').text));
    assert(/^2 developer replies are/.test(one({ queues: { disputes: 0, replies: 2 } }, 'replies').text));
    assert(/^1 paid report or delivery has failed/.test(one({ failedJobs: 1 }, 'failed-jobs').text));
  });
  await t('traffic: needs a real earlier week, then flags a fall of 30% as warn and a rise of 30% as good', async () => {
    assert.strictEqual(one({ traffic: { current: 5, previous: 40 } }, 'traffic'), undefined);
    const down = one({ traffic: { current: 70, previous: 100 } }, 'traffic'); assert.strictEqual(down.tone, 'warn'); assert(/down 30%/.test(down.text));
    assert.strictEqual(one({ traffic: { current: 69, previous: 100 } }, 'traffic').tone, 'warn');
    assert.strictEqual(one({ traffic: { current: 71, previous: 100 } }, 'traffic'), undefined);
    assert.strictEqual(one({ traffic: { current: 130, previous: 100 } }, 'traffic').tone, 'good');
  });
  const S = (c, p, extra = {}) => ({ current: { orders: 10, refunds: 0, refundRate: 0, unpaidCheckouts: 0, checkoutToPaid: 1, ...c }, previous: { orders: 10, ...p }, unconvertedOrders: 0, ...extra });
  await t('sales: a quarter fewer or more paid reports, only when the earlier period had a few', async () => {
    assert.strictEqual(one({ sales: S({ orders: 7 }, { orders: 10 }) }, 'orders').tone, 'warn');
    assert.strictEqual(one({ sales: S({ orders: 8 }, { orders: 10 }) }, 'orders'), undefined);
    assert.strictEqual(one({ sales: S({ orders: 13 }, { orders: 10 }) }, 'orders').tone, 'good');
    assert.strictEqual(one({ sales: S({ orders: 0 }, { orders: 2 }) }, 'orders'), undefined);
  });
  await t('sales: refund rate needs five orders, checkout-to-paid needs ten checkouts, unconverted sales are an info line', async () => {
    assert.strictEqual(one({ sales: S({ orders: 4, refunds: 2, refundRate: 0.5 }, {}) }, 'refunds'), undefined);
    assert(/10% of paid reports were refunded/.test(one({ sales: S({ orders: 10, refunds: 1, refundRate: 0.1 }, {}) }, 'refunds').text));
    assert.strictEqual(one({ sales: S({ orders: 2, unpaidCheckouts: 8, checkoutToPaid: 0.2 }, {}) }, 'checkout').tone, 'warn');
    assert.strictEqual(one({ sales: S({ orders: 2, unpaidCheckouts: 7, checkoutToPaid: 0.222 }, {}) }, 'checkout'), undefined);
    assert.strictEqual(one({ sales: S({}, {}, { unconvertedOrders: 2 }) }, 'rates').tone, 'info');
  });
  await t('funnel: a weak sign-in wall, the biggest drop of new users, the paying share', async () => {
    const f = { visitors: { stages: [{ label: 'Sign-in wall shown', count: 100 }, { label: 'Code requested', count: 49 }] },
      newUsers: { stages: [{ count: 40 }], largestDrop: { from: 'Opened a report', to: 'Started checkout', lost: 20, percent: 66.7 } }, classes: { users: 200, premiumShare: 8 } };
    const r = generate({ funnel: f });
    assert(/Only 49% of the people who see the sign-in wall/.test(r.find(i => i.id === 'wall').text));
    assert(/66.7%/.test(r.find(i => i.id === 'funnel-drop').text)); assert(/8% of 200 accounts/.test(r.find(i => i.id === 'premium-share').text));
    f.visitors.stages[1].count = 50; assert.strictEqual(generate({ funnel: f }).find(i => i.id === 'wall'), undefined);
    f.newUsers.stages[0].count = 10; f.classes.users = 10; assert.strictEqual(generate({ funnel: f }).find(i => i.id === 'funnel-drop'), undefined);
  });
  await t('AI: a fifth of calls failing is warn; recent reports costing half their price is warn, all of it is bad', async () => {
    assert.strictEqual(one({ engineHistory: { calls: 20, failures: 4 } }, 'engine-failures').tone, 'warn');
    assert.strictEqual(one({ engineHistory: { calls: 19, failures: 19 } }, 'engine-failures'), undefined);
    const rep = c => [1, 2, 3].map(() => ({ costUsd: c, priceUsd: 10 }));
    assert.strictEqual(one({ engineCosts: rep(4.9) }, 'cost'), undefined);
    assert.strictEqual(one({ engineCosts: rep(5) }, 'cost').tone, 'warn'); assert.strictEqual(one({ engineCosts: rep(10) }, 'cost').tone, 'bad');
    assert.strictEqual(one({ engineCosts: [{ costUsd: 50, priceUsd: 10 }, { costUsd: 50, priceUsd: 10 }] }, 'cost'), undefined);
    assert.strictEqual(one({ engineCosts: [{ costUsd: 9, priceUsd: null }, { costUsd: 9, priceUsd: null }, { costUsd: 9, priceUsd: null }] }, 'cost'), undefined);
  });
  await t('order: bad before warn before info before good, then by id; at most twelve are returned', async () => {
    const r = generate({ backups: { level: 'error', text: 'x' }, traffic: { current: 200, previous: 100 }, queues: { disputes: 1, replies: 1 }, sales: S({}, {}, { unconvertedOrders: 1 }) });
    assert.deepStrictEqual(r.map(i => i.tone), ['bad', 'warn', 'warn', 'info', 'good']); assert.deepStrictEqual(ids(r).slice(1, 3), ['disputes', 'replies']);
    const many = generate({ backups: { level: 'error', text: 'x' }, registers: [{ market: 'a', state: 'down' }, { market: 'b', state: 'degraded' }], errors: { totals: { error: 500 } }, queues: { disputes: 1, replies: 1 }, failedJobs: 1,
      traffic: { current: 10, previous: 100 }, sales: S({ orders: 1, refunds: 1, refundRate: 1, unpaidCheckouts: 20, checkoutToPaid: 0.05 }, { orders: 10 }, { unconvertedOrders: 3 }), engineHistory: { calls: 100, failures: 90 },
      engineCosts: [1, 2, 3].map(() => ({ costUsd: 20, priceUsd: 10 })) });
    assert(many.length <= RULES.max);
  });
  await t('every insight has a tone from the list, a page, and text without placeholders', async () => {
    const r = generate({ backups: { level: 'error', text: 'x' }, traffic: { current: 1000, previous: 100 }, failedJobs: 2 });
    for (const i of r) { assert(['bad', 'warn', 'info', 'good'].includes(i.tone)); assert(i.page && i.text); assert(!/undefined|NaN|\[object/.test(i.text)); }
  });

  console.log('route');
  const routes = new Map(), app = { get: (p, ...h) => routes.set(p, h) };
  const pass = (req, res, next) => next && next(), wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => res.status(500).json({ error: e.message }));
  const quiet = console.error; const logged = []; console.error = (...a) => logged.push(a.join(' '));
  mountInsightsAdmin(app, { adminAuth: pass, wrap, rateLimit: () => pass, now: () => Date.parse('2026-11-10T12:00:00Z'), sources: {
    backups: async () => ({ level: 'error', text: 'The last backup failed.' }), errors: async () => { throw new Error('db down'); }, sales: async () => undefined, failedJobs: () => 2 } });
  const get = () => new Promise(resolve => { const res = { set(k, v) { this.h = { [k]: v }; return this; }, status() { return this; }, json: b => resolve({ b, h: res.h }) }; const hs = routes.get('/api/admin/insights'); let i = 0; const next = () => { const f = hs[i++]; if (f) f({ query: {} }, res, next); }; next(); });
  await t('the route returns the insights, the time, and names the sources it could not read', async () => {
    const r = await get();
    assert.strictEqual(r.b.ok, true); assert.strictEqual(r.b.at, '2026-11-10T12:00:00.000Z'); assert.deepStrictEqual(ids(r.b.insights), ['backups', 'failed-jobs']);
    assert.deepStrictEqual(r.b.missing, ['errors', 'sales']); assert.strictEqual(r.h['Cache-Control'], 'no-store');
  });
  console.error = quiet;
  await t('a failing source is logged once with its name and no stack', async () => {
    assert.strictEqual(logged.length, 1); assert(/^\[insights\] errors could not be read: db down$/.test(logged[0]));
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
