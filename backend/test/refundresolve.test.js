'use strict';
const assert = require('assert');
const PAY = require('../payments');
const PRICING = require('../pricing');
let adapter = null;
PAY.adapterFor = () => adapter;
const { refundPurchase, resolveRefund, RefundError } = require('../payments/refunds');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const data = { currencies: { INR: { minor: 2 } } };
function rig({ provider = 'mor', tax = '0' } = {}) {
  const row = { id: 'pur-1', report_ref: 'SK-ABC123', amount: '500', currency: 'INR', status: 'paid', provider, provider_payment_id: 'pay_1', buyer_country: 'IN', amount_net: '500', tax_amount: tax, net_revenue: '500', quote_id: null };
  const updates = [];
  const db = { query: async (sql, p) => { if (/^\s*SELECT/i.test(sql)) return { rows: [{ ...row }] }; updates.push({ sql, p }); if (/SET status/.test(sql)) row.status = p[1]; return { rows: [] }; } };
  const store = PRICING.makeStore({});
  const later = new Date(Date.now() + 10 * 60 * 1000);
  return {
    db, store, row, updates,
    stuck: async (amount) => {
      adapter = { refund: async () => { throw new Error('socket hang up'); } };
      await assert.rejects(refundPurchase({ db, data, store, purchaseId: 'pur-1', amount, reason: 'x', env: {} }), e => e.code === 'unconfirmed');
      return (await store.listPendingRefunds())[0];
    },
    resolve: (extra) => resolveRefund({ db, data, store, now: later, ...extra }),
    statusWrites: () => updates.filter(u => /SET status/.test(u.sql)),
  };
}

(async () => {
  await t('an unconfirmed refund shows in the pending list with its purchase and amount', async () => {
    const r = rig(); const h = await r.stuck(300);
    const list = await r.store.listPendingRefunds();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].purchaseId, 'pur-1');
    assert.strictEqual(list[0].amount, 300);
    assert.strictEqual(h.status, 'pending');
  });
  await t('confirming a partial refund settles the row and books the purchase, revenue and event once', async () => {
    const r = rig(); const h = await r.stuck(200);
    assert.strictEqual(r.statusWrites().length, 0);
    const out = await r.resolve({ refundId: h.id, outcome: 'refunded', providerRef: 'rfnd_77' });
    assert.strictEqual(out.refundId, 'rfnd_77');
    assert.strictEqual(out.amount, 200);
    assert.strictEqual(out.full, false);
    assert.strictEqual(out.remaining, 300);
    assert.strictEqual(out.purchaseId, 'pur-1');
    assert.deepStrictEqual(r.statusWrites().map(u => u.p[1]), ['paid']);
    assert.strictEqual(r.statusWrites()[0].p[2], 200);
    const row = await r.store.getRefund(h.id);
    assert.strictEqual(row.status, 'processed');
    assert.strictEqual(row.providerRef, 'rfnd_77');
    assert.strictEqual(await r.store.refundedTotal('pur-1'), 200);
    assert.strictEqual((await r.store.listEvents({ type: 'refund' })).length, 1);
    assert.strictEqual((await r.store.listPendingRefunds()).length, 0);
  });
  await t('the tax in a confirmed refund is reversed in proportion and taken off net revenue', async () => {
    const r = rig({ tax: '90' }); const h = await r.stuck(100);
    assert.strictEqual(h.taxReversed, 18);
    await r.resolve({ refundId: h.id, outcome: 'refunded', providerRef: 'rfnd_t' });
    assert.strictEqual(r.statusWrites()[0].p[2], 82);
    assert.strictEqual((await r.store.listEvents({ type: 'refund' }))[0].details.taxReversed, 18);
  });
  await t('confirming a refund that covers everything marks the purchase refunded', async () => {
    const r = rig(); const h = await r.stuck();
    const out = await r.resolve({ refundId: h.id, outcome: 'refunded', providerRef: 'rfnd_1' });
    assert.strictEqual(out.full, true);
    assert.strictEqual(r.row.status, 'refunded');
  });
  await t('confirming after an earlier settled refund is partial or full by the real total', async () => {
    const r = rig();
    adapter = { refund: async () => ({ providerRef: 'rf_a', status: 'processed' }) };
    await refundPurchase({ db: r.db, data, store: r.store, purchaseId: 'pur-1', amount: 200, env: {} });
    const h = await r.stuck(300);
    const out = await r.resolve({ refundId: h.id, outcome: 'refunded', providerRef: 'rfnd_2' });
    assert.strictEqual(out.full, true);
    assert.strictEqual(r.row.status, 'refunded');
  });
  await t('a non-merchant-of-record refund is also reversed in the sales ledger, like a normal refund', async () => {
    const r = rig({ provider: 'razorpay', tax: '90' }); const h = await r.stuck(100);
    const before = r.store._raw.ledger.size;
    await r.resolve({ refundId: h.id, outcome: 'refunded', providerRef: 'rfnd_3' });
    const sales = await r.store.salesSince('0000-00');
    assert.ok(sales.length >= 1 && before >= 0, 'the ledger took the refund');
    assert.ok(sales.some(s => s.gross < 0), 'a negative gross was booked');
  });
  await t('saying the money did not go back releases the amount so the purchase can be refunded again', async () => {
    const r = rig(); const h = await r.stuck(300);
    assert.strictEqual(await r.store.refundedTotal('pur-1'), 300);
    const out = await r.resolve({ refundId: h.id, outcome: 'not_refunded' });
    assert.strictEqual(out.outcome, 'not_refunded');
    assert.strictEqual(await r.store.refundedTotal('pur-1'), 0);
    assert.strictEqual(r.statusWrites().length, 0);
    adapter = { refund: async () => ({ providerRef: 'rf_ok', status: 'processed' }) };
    const again = await refundPurchase({ db: r.db, data, store: r.store, purchaseId: 'pur-1', amount: 300, env: {} });
    assert.strictEqual(again.amount, 300);
  });
  await t('a refund recorded under five minutes ago may still be in flight and is refused', async () => {
    const r = rig(); const h = await r.stuck(300);
    await assert.rejects(resolveRefund({ db: r.db, data, store: r.store, refundId: h.id, outcome: 'not_refunded' }), e => e instanceof RefundError && e.code === 'in_flight');
    assert.strictEqual(await r.store.refundedTotal('pur-1'), 300);
  });
  await t('resolving twice books once: the second try says it is not pending', async () => {
    const r = rig(); const h = await r.stuck(200);
    await r.resolve({ refundId: h.id, outcome: 'refunded', providerRef: 'rfnd_9' });
    await assert.rejects(r.resolve({ refundId: h.id, outcome: 'refunded', providerRef: 'rfnd_9' }), e => e.code === 'not_pending');
    await assert.rejects(r.resolve({ refundId: h.id, outcome: 'not_refunded' }), e => e.code === 'not_pending');
    assert.strictEqual(r.statusWrites().length, 1);
    assert.strictEqual(await r.store.refundedTotal('pur-1'), 200);
  });
  await t('two resolutions at once book once', async () => {
    const r = rig(); const h = await r.stuck(200);
    const res = await Promise.allSettled([
      r.resolve({ refundId: h.id, outcome: 'refunded', providerRef: 'a' }),
      r.resolve({ refundId: h.id, outcome: 'refunded', providerRef: 'b' }),
    ]);
    assert.deepStrictEqual(res.map(x => x.status).sort(), ['fulfilled', 'rejected']);
    assert.strictEqual(r.statusWrites().length, 1);
  });
  await t('an unknown refund, a bad outcome and a missing provider reference are refused and change nothing', async () => {
    const r = rig(); const h = await r.stuck(200);
    await assert.rejects(r.resolve({ refundId: 999, outcome: 'refunded', providerRef: 'x' }), e => e.code === 'not_found');
    await assert.rejects(r.resolve({ refundId: h.id, outcome: 'maybe' }), e => e.code === 'bad_outcome');
    await assert.rejects(r.resolve({ refundId: h.id, outcome: 'refunded' }), e => e.code === 'provider_ref_required');
    await assert.rejects(r.resolve({ refundId: h.id, outcome: 'refunded', providerRef: '   ' }), e => e.code === 'provider_ref_required');
    assert.strictEqual((await r.store.getRefund(h.id)).status, 'pending');
    assert.strictEqual(r.statusWrites().length, 0);
  });
  await t('a settled refund is never listed as pending or released', async () => {
    const r = rig();
    adapter = { refund: async () => ({ providerRef: 'rf_s', status: 'processed' }) };
    await refundPurchase({ db: r.db, data, store: r.store, purchaseId: 'pur-1', amount: 100, env: {} });
    assert.strictEqual((await r.store.listPendingRefunds()).length, 0);
    await assert.rejects(r.resolve({ refundId: 1, outcome: 'not_refunded' }), e => e.code === 'not_pending');
    assert.strictEqual(await r.store.refundedTotal('pur-1'), 100);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
