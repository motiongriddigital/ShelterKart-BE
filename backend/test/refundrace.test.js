'use strict';
/**
 * Two refunds of one purchase at the same moment (suspected item 2 of the 2026-10 security review). Each used to read the same remainder and
 * both reached the provider; now they run one after another, so the second sees the first and is refused locally.
 */
const assert = require('assert');
const PAY = require('../payments');
const providerCalls = [];
PAY.adapterFor = () => ({ refund: async req => { providerCalls.push(req); await new Promise(r => setTimeout(r, 40)); return { providerRef: 'rf_' + providerCalls.length, status: 'processed' }; } });
const { refundPurchase, RefundError } = require('../payments/refunds');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const data = { currencies: { INR: { minor: 2 } } };
function rig(amount = '1000') {
  const row = { id: 'pur-1', report_ref: 'SK-ABC123', amount, currency: 'INR', status: 'paid', provider: 'mor', provider_payment_id: 'pay_1', buyer_country: 'IN', amount_net: amount, tax_amount: '0', net_revenue: null, quote_id: null };
  const refunds = [], updates = [];
  const db = { query: async (sql, p) => { if (/^\s*SELECT/i.test(sql)) return { rows: [row] }; updates.push(p); return { rows: [] }; } };
  const store = { refundedTotal: async () => refunds.reduce((a, r) => a + r.amount, 0), saveRefund: async r => { refunds.push(r); }, addEvent: async () => {} };
  providerCalls.length = 0;
  return { db, store, refunds, updates, go: (extra = {}) => refundPurchase({ db, data, store, purchaseId: 'pur-1', reason: 'x', env: {}, ...extra }) };
}

(async () => {
  console.log('refunds of one purchase');
  await t('two full refunds at once: one reaches the provider, the other is refused as already refunded', async () => {
    const r = rig();
    const out = await Promise.allSettled([r.go(), r.go()]);
    assert.strictEqual(providerCalls.length, 1, 'provider calls');
    assert.strictEqual(r.refunds.length, 1);
    const good = out.filter(o => o.status === 'fulfilled'), bad = out.filter(o => o.status === 'rejected');
    assert.strictEqual(good.length, 1); assert.strictEqual(bad.length, 1);
    assert(bad[0].reason instanceof RefundError && bad[0].reason.code === 'already_refunded');
  });
  await t('two part refunds that together exceed the price: the second is refused with what is left', async () => {
    const r = rig();
    const out = await Promise.allSettled([r.go({ amount: 700 }), r.go({ amount: 700 })]);
    assert.strictEqual(providerCalls.length, 1);
    assert(out[1].status === 'rejected' && out[1].reason.code === 'exceeds' && /300/.test(out[1].reason.message));
  });
  await t('two part refunds that fit are both made, in order', async () => {
    const r = rig();
    const out = await Promise.all([r.go({ amount: 400 }), r.go({ amount: 600 })]);
    assert.strictEqual(providerCalls.length, 2); assert.strictEqual(out[0].full, false); assert.strictEqual(out[1].full, true);
  });
  await t('a failure in the first does not block the second', async () => {
    const r = rig(); const save = r.store.saveRefund; let first = true;
    r.store.saveRefund = async x => { if (first) { first = false; throw new Error('db down'); } return save(x); };
    const out = await Promise.allSettled([r.go({ amount: 100 }), r.go({ amount: 100 })]);
    assert.strictEqual(out[0].status, 'rejected'); assert.strictEqual(out[1].status, 'fulfilled');
  });
  await t('different purchases are not held up by each other', async () => {
    const a = rig();
    const b = rig();
    const start = Date.now();
    await Promise.all([a.go(), refundPurchase({ db: b.db, data, store: b.store, purchaseId: 'pur-2', env: {} })]);
    assert(Date.now() - start < 75, 'they ran at the same time');
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
