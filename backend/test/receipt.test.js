'use strict';
process.env.NODE_ENV = 'test';
const assert = require('assert');
const delivery = require('../engine/delivery');
const { receiptMessage } = require('../engine/receipt');
const setup = require('../services/pricing');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const sent = [];
let sendResult = true;
delivery.sendEmail = async (env, m) => { sent.push(m); if (sendResult === 'throw') throw new Error('boom'); return sendResult; };

function world({ accounts = true, open = true } = {}) {
  let pending = open;
  const pool = { async query(sql) {
    if (/UPDATE report_purchases SET status='paid'/.test(sql)) { const rows = pending ? [{ id: 'p-1', amount: '499', currency: 'INR', quote_id: null, buyer_country: 'IN', billing_country: 'IN', buyer_kind: 'consumer', tax_id: null }] : []; pending = false; return { rows }; }
    if (/SELECT attribution/.test(sql)) return { rows: [{ attribution: {} }] };
    if (/SELECT u\.email/.test(sql)) return { rows: [{ email: 'buyer@example.com' }] };
    return { rows: [] };
  } };
  const c = { ACCOUNTS: { enabled: accounts }, SITE_BASE: 'https://shelterkart.test', pool, track() {}, onReportPaid() {} };
  setup(c);
  return c;
}
const settle = (c, provider = 'razorpay') => c.markPurchasePaid(c.pool, { purchaseId: 'p-1', ref: 'SK-ABCDEF123456', provider, paymentId: 'pay_1' }, {});
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  await t('the message names the amount, the order and the report, and carries no payment details', async () => {
    const m = receiptMessage({ ref: 'SK-ABCDEF123456', amount: '499', currency: 'INR', purchaseId: 'p-1', site: 'https://shelterkart.test' });
    assert.ok(m.subject.includes('receipt'));
    assert.ok(m.text.includes('499 INR'));
    assert.ok(m.text.includes('SK-ABCDEF123456'));
    assert.ok(m.text.includes('p-1'));
    assert.ok(!/card|cvv|upi/i.test(m.text));
  });
  await t('a payment that settles sends one receipt to the payer', async () => {
    sent.length = 0; sendResult = true;
    const c = world(); assert.strictEqual(await settle(c), true); await tick();
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].to, 'buyer@example.com');
  });
  await t('a replayed settlement sends nothing', async () => {
    sent.length = 0;
    const c = world(); await settle(c); await tick();
    assert.strictEqual(await settle(c), false); await tick();
    assert.strictEqual(sent.length, 1);
  });
  await t('a purchase already settled elsewhere sends nothing', async () => {
    sent.length = 0;
    const c = world({ open: false }); assert.strictEqual(await settle(c), false); await tick();
    assert.strictEqual(sent.length, 0);
  });
  await t('the merchant of record sends its own receipt, so we send none', async () => {
    sent.length = 0;
    const c = world(); await settle(c, 'mor'); await tick();
    assert.strictEqual(sent.length, 0);
  });
  await t('without accounts there is no payer address and nothing is sent', async () => {
    sent.length = 0;
    const c = world({ accounts: false }); assert.strictEqual(await settle(c), true); await tick();
    assert.strictEqual(sent.length, 0);
  });
  await t('a mail failure never fails the payment', async () => {
    sent.length = 0; sendResult = 'throw';
    const c = world(); assert.strictEqual(await settle(c), true); await tick();
    sendResult = false; const c2 = world(); assert.strictEqual(await settle(c2), true); await tick();
    sendResult = true;
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
