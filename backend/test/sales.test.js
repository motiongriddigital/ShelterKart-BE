'use strict';
/** Admin sales: the daily series, the summary against the period before, the orders and refunds lists, and the checks on every parameter. */
const assert = require('assert');
const { mountSalesAdmin, buildSeries, buildSummary } = require('../engine/salesAdmin');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const NOW = Date.parse('2026-11-10T15:00:00Z');
const FX = { USD: 1, INR: 90, EUR: 0.9 };
const routes = new Map(), app = { get: (p, ...h) => routes.set(p, h) };
const pass = (req, res, next) => next && next();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => { res.status(500).json({ error: e.message }); });
const seen = [];
const source = {
  async sales(since, by) { seen.push(['sales', since, by]); return [
    { day: '2026-11-09', key: by === 'country' ? 'IN' : 'INR', currency: 'INR', orders: '2', gross: '1800', tax: '274.58', net: '1525.42' },
    { day: '2026-11-10', key: by === 'country' ? 'DE' : 'EUR', currency: 'EUR', orders: '1', gross: '9', tax: '1.44', net: '7.56' },
    { day: '2026-10-25', key: by === 'country' ? 'IN' : 'INR', currency: 'INR', orders: '1', gross: '900', tax: '137.29', net: '762.71' },
    { day: '2026-11-10', key: by === 'country' ? 'ZZ' : 'XTS', currency: 'XTS', orders: '1', gross: '5', tax: '0', net: '5' }]; },
  async refunds(since, by) { return [{ day: '2026-11-10', key: by === 'country' ? 'IN' : 'INR', currency: 'INR', refunds: '1', amount: '900' }]; },
  async pending(from, to) { return from < '2026-10-30' ? 1 : 3; },
  async orders(o) { seen.push(['orders', o]); return [{ id: 'a'.repeat(8) + '-0000-4000-8000-000000000001', report_ref: 'SK-AAAAAA', status: 'paid', amount: '900', currency: 'INR', tax_amount: '137.29', amount_net: '762.71',
    buyer_country: 'IN', billing_country: 'IN', provider: 'razorpay', created_at: new Date('2026-11-09T10:00:00Z'), paid_at: new Date('2026-11-09T10:01:00Z'), user_id: null, refunded: '0', total: '7' }]; },
  async refundList(o) { seen.push(['refunds', o]); return [{ id: '4', purchase_id: 'p1', report_ref: 'SK-AAAAAA', amount: '900', currency: 'INR', tax_reversed: '137.29', reason: 'duplicate', status: 'processed',
    provider_ref: 'rfnd_1', created_at: new Date('2026-11-10T09:00:00Z'), buyer_country: 'IN', total: '1' }]; },
};
mountSalesAdmin(app, { adminAuth: pass, wrap, rateLimit: () => pass, source, fx: () => FX, now: () => NOW });
const call = (path, query = {}) => new Promise(resolve => {
  const res = { code: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b, headers: this.headers }); } };
  const hs = routes.get(path); let i = 0; const next = () => { const f = hs[i++]; if (f) f({ query }, res, next); }; next();
});

(async () => {
  console.log('series');
  await t('rows add up per currency and are valued in US dollars with the book rates', async () => {
    const r = await call('/api/admin/sales/series', { days: '30' });
    assert.strictEqual(r.code, 200); assert.strictEqual(r.headers['Cache-Control'], 'no-store');
    const inr = r.body.byCurrency.find(c => c.currency === 'INR');
    assert.deepStrictEqual([inr.orders, inr.gross, inr.refunded], [3, 2700, 900]);
    assert.strictEqual(r.body.totals.orders, 5); assert.strictEqual(r.body.totals.refunds, 1);
    assert.strictEqual(r.body.totals.grossUsd, 40); assert.strictEqual(r.body.totals.refundedUsd, 10);
  });
  await t('a currency with no rate is counted, never guessed', async () => {
    const r = await call('/api/admin/sales/series', { days: '30' });
    assert.strictEqual(r.body.totals.unconvertedOrders, 1);
    assert.strictEqual(r.body.rows.find(x => x.currency === 'XTS').grossUsd, null);
  });
  await t('the daily list has one entry for every day, zero where nothing sold, oldest first', async () => {
    const r = await call('/api/admin/sales/series', { days: '7' });
    assert.strictEqual(r.body.daily.length, 7); assert.strictEqual(r.body.daily[0].day, '2026-11-04'); assert.strictEqual(r.body.daily[6].day, '2026-11-10');
    assert.deepStrictEqual(r.body.daily.map(d => d.orders), [0, 0, 0, 0, 0, 2, 2]);
    assert.strictEqual(r.body.daily[6].refundedUsd, 10);
  });
  await t('by=country asks the source for countries; the default is currency; anything else is refused', async () => {
    seen.length = 0; await call('/api/admin/sales/series', { by: 'country' }); assert.strictEqual(seen[0][2], 'country');
    seen.length = 0; await call('/api/admin/sales/series', {}); assert.strictEqual(seen[0][2], 'currency');
    assert.strictEqual((await call('/api/admin/sales/series', { by: 'user' })).code, 400);
  });
  await t('the window starts at midnight UTC of the first day', async () => {
    seen.length = 0; await call('/api/admin/sales/series', { days: '3' });
    assert.strictEqual(seen[0][1], '2026-11-08T00:00:00.000Z');
  });
  await t('days must be a whole number from 1 to 400', async () => {
    for (const d of ['0', '401', '-1', '1.5', 'x', '1e2']) assert.strictEqual((await call('/api/admin/sales/series', { days: d })).code, 400, d);
    assert.strictEqual((await call('/api/admin/sales/series', { days: '400' })).code, 200);
  });

  console.log('summary');
  await t('this period against the one before, with the change in percent', async () => {
    const r = await call('/api/admin/sales/summary', { days: '10' });
    assert.strictEqual(r.code, 200);
    assert.strictEqual(r.body.current.orders, 4); assert.strictEqual(r.body.previous.orders, 1);
    assert.strictEqual(r.body.change.orders, 300);
    assert.strictEqual(r.body.current.grossUsd, 30); assert.strictEqual(r.body.previous.grossUsd, 10); assert.strictEqual(r.body.change.grossUsd, 200);
  });
  await t('average order, refund rate and checkout-to-paid are worked out from the counts', async () => {
    const r = await call('/api/admin/sales/summary', { days: '10' });
    assert.strictEqual(r.body.current.avgOrderUsd, 10); assert.strictEqual(r.body.current.refundRate, 0.25);
    assert.strictEqual(r.body.current.unpaidCheckouts, 3); assert.strictEqual(r.body.current.checkoutToPaid, 0.571);
  });
  await t('with nothing in the earlier period the change is null, not infinity', async () => {
    const s = buildSummary([{ day: '2026-11-10', key: 'IN', currency: 'USD', orders: 2, gross: 20, tax: 0, net: 20 }], [], { fx: FX, now: NOW, days: 5, pending: { current: 0, previous: 0 } });
    assert.strictEqual(s.change.orders, null); assert.strictEqual(s.previous.avgOrderUsd, null); assert.strictEqual(s.previous.refundRate, null); assert.strictEqual(s.current.checkoutToPaid, 1);
  });
  await t('the top list ranks countries by US dollars, five at most', async () => {
    const r = await call('/api/admin/sales/summary', { days: '10' });
    assert.deepStrictEqual(r.body.top.map(x => x.key), ['IN', 'DE']); assert.strictEqual(r.body.top[0].usd, 20);
  });

  console.log('orders and refunds');
  await t('orders come back with the buyer reduced to an id: no e-mail, no name, no payment id', async () => {
    const r = await call('/api/admin/sales/orders', {});
    assert.strictEqual(r.body.total, 7); const o = r.body.orders[0];
    assert.deepStrictEqual([o.reportRef, o.status, o.amount, o.currency, o.tax, o.net, o.buyerCountry, o.provider], ['SK-AAAAAA', 'paid', 900, 'INR', 137.29, 762.71, 'IN', 'razorpay']);
    assert.strictEqual(o.createdAt, '2026-11-09T10:00:00.000Z');
    assert(!JSON.stringify(r.body).match(/email|provider_payment|providerPayment/i));
  });
  await t('the filters reach the source as they were given', async () => {
    seen.length = 0; await call('/api/admin/sales/orders', { days: '7', status: 'refunded', country: 'in', q: 'SK-A', limit: '10', offset: '20' });
    assert.deepStrictEqual(seen[0][1], { since: '2026-11-04T00:00:00.000Z', status: 'refunded', country: 'in', q: 'SK-A', limit: 10, offset: 20 });
  });
  await t('a bad status, country, limit, offset or search is a 400', async () => {
    for (const q of [{ status: 'active' }, { country: 'India' }, { country: '1N' }, { limit: '0' }, { limit: '201' }, { offset: '-1' }, { days: '0' }, { q: 'x'.repeat(81) }, { q: ['a', 'b'] }])
      assert.strictEqual((await call('/api/admin/sales/orders', q)).code, 400, JSON.stringify(q));
  });
  await t('refunds list the money returned with the reason, and nothing about the buyer', async () => {
    const r = await call('/api/admin/sales/refunds', {});
    assert.strictEqual(r.body.total, 1); const f = r.body.refunds[0];
    assert.deepStrictEqual([f.id, f.purchaseId, f.amount, f.currency, f.taxReversed, f.reason, f.status], [4, 'p1', 900, 'INR', 137.29, 'duplicate', 'processed']);
    assert.strictEqual(f.createdAt, '2026-11-10T09:00:00.000Z');
    assert.strictEqual((await call('/api/admin/sales/refunds', { limit: '500' })).code, 400);
  });
  await t('without a database every route answers stored:false with empty lists', async () => {
    const r2 = new Map(), a2 = { get: (p, ...h) => r2.set(p, h) };
    mountSalesAdmin(a2, { adminAuth: pass, wrap, rateLimit: () => pass, source: null, fx: FX, now: () => NOW });
    for (const p of ['series', 'summary', 'orders', 'refunds']) {
      const out = await new Promise(resolve => { const res = { set() { return this; }, status() { return this; }, json: resolve }; const hs = r2.get('/api/admin/sales/' + p); let i = 0; const next = () => { const f = hs[i++]; if (f) f({ query: {} }, res, next); }; next(); });
      assert.strictEqual(out.ok, true); assert.strictEqual(out.stored, false);
    }
  });
  await t('buildSeries merges the same day and currency from sales and refunds into one row', async () => {
    const s = buildSeries([{ day: '2026-11-10', key: 'INR', currency: 'INR', orders: 1, gross: 100, tax: 0, net: 100 }], [{ day: '2026-11-10', key: 'INR', currency: 'INR', refunds: 1, amount: 100 }], { fx: FX, from: Date.UTC(2026, 10, 10), days: 1 });
    assert.strictEqual(s.rows.length, 1); assert.deepStrictEqual([s.rows[0].orders, s.rows[0].refunds, s.rows[0].gross, s.rows[0].refunded], [1, 1, 100, 100]);
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
