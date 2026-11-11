'use strict';
const assert = require('assert');
const PAY = require('../payments');
const PRICING = require('../pricing');
let adapter = null;
PAY.adapterFor = () => adapter;
const { refundPurchase, RefundError } = require('../payments/refunds');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const data = { currencies: { INR: { minor: 2 } } };
function rig({ status = 'paid', provider = 'mor' } = {}) {
  const row = { id: 'pur-1', report_ref: 'SK-ABC123', amount: '500', currency: 'INR', status, provider, provider_payment_id: 'pay_1', buyer_country: 'IN', amount_net: '500', tax_amount: '0', net_revenue: null, quote_id: null };
  const updates = [];
  const db = { query: async (sql, p) => { if (/^\s*SELECT/i.test(sql)) return { rows: [{ ...row }] }; updates.push({ sql, p }); if (/SET status/.test(sql)) row.status = p[1]; return { rows: [] }; } };
  const store = PRICING.makeStore({});
  return { db, store, row, updates, go: (extra = {}) => refundPurchase({ db, data, store, purchaseId: 'pur-1', reason: 'x', env: {}, ...extra }) };
}
const rows = r => r.store.listRefundsForTest ? r.store.listRefundsForTest() : null;

(async () => {
  await t('the refund is recorded as pending before the provider is asked, and settled after', async () => {
    const r = rig(); const seen = [];
    adapter = { refund: async () => { seen.push(await r.store.refundedTotal('pur-1')); return { providerRef: 'rf_1', status: 'processed' }; } };
    const out = await r.go({ amount: 200 });
    assert.deepStrictEqual(seen, [200], 'the amount already counted while the provider was being called');
    assert.strictEqual(await r.store.refundedTotal('pur-1'), 200);
    assert.strictEqual(out.amount, 200);
  });
  await t('a retry after the record failed to settle does not refund again', async () => {
    const r = rig(); let calls = 0;
    adapter = { refund: async () => { calls++; return { providerRef: 'rf_' + calls, status: 'processed' }; } };
    const settle = r.store.settleRefund; r.store.settleRefund = async () => { throw new Error('db blip'); };
    await r.go({ amount: 300 });
    r.store.settleRefund = settle;
    await assert.rejects(r.go({ amount: 300 }), e => e instanceof RefundError && e.code === 'exceeds');
    assert.strictEqual(calls, 1);
  });
  await t('a provider that rejects the refund leaves nothing counted', async () => {
    const r = rig();
    adapter = { refund: async () => { throw Object.assign(new Error('razorpay answered 400'), { status: 400 }); } };
    await assert.rejects(r.go({ amount: 300 }), e => e.status === 400);
    assert.strictEqual(await r.store.refundedTotal('pur-1'), 0);
  });
  await t('a provider that cannot be reached leaves the amount counted and says so', async () => {
    const r = rig();
    adapter = { refund: async () => { throw new Error('socket hang up'); } };
    await assert.rejects(r.go({ amount: 300 }), e => e instanceof RefundError && e.code === 'unconfirmed');
    assert.strictEqual(await r.store.refundedTotal('pur-1'), 300);
    adapter = { refund: async () => { throw new Error('must not be called'); } };
    await assert.rejects(r.go({ amount: 300 }), e => e.code === 'exceeds');
  });
  await t('a failure to record before the provider is called means the provider is never called', async () => {
    const r = rig(); let calls = 0;
    adapter = { refund: async () => { calls++; return { providerRef: 'x', status: 'processed' }; } };
    r.store.reserveRefund = async () => { throw new Error('db down'); };
    await assert.rejects(r.go({ amount: 300 }), /db down/);
    assert.strictEqual(calls, 0);
  });
  await t('a purchase fully refunded but still marked paid is put right by the next attempt', async () => {
    const r = rig();
    adapter = { refund: async () => ({ providerRef: 'rf_1', status: 'processed' }) };
    const db = r.db; let fail = true; const q = db.query;
    db.query = async (sql, p) => { if (fail && /SET status/.test(sql)) { fail = false; throw new Error('db blip'); } return q(sql, p); };
    await assert.rejects(r.go(), /db blip/);
    assert.strictEqual(r.row.status, 'paid');
    await assert.rejects(r.go(), e => e.code === 'already_refunded');
    assert.strictEqual(r.row.status, 'refunded');
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
