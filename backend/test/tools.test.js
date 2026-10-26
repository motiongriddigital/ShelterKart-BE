'use strict';
/** The two tools a developer runs to go live: the official exchange-rate fetcher and the merchant sandbox checker. */
const assert = require('assert');
const FX = require('../../tools/fetch_fx.js');
const SB = require('../../tools/mor_sandbox_check.js');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
const XML = `<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
<Cube><Cube time='2026-10-23'><Cube currency='USD' rate='1.2000'/><Cube currency='JPY' rate='180.00'/><Cube currency='MYR' rate='5.4000'/><Cube currency='INR' rate='108.00'/></Cube></Cube></gesmes:Envelope>`;
const quiet = () => { const lines = []; const log = s => lines.push(String(s)); log.lines = lines; return log; };
(async () => {
  console.log('exchange rates');
  await t('the ECB file is read: its date and every euro rate', () => { const p = FX.parseEcb(XML); assert.strictEqual(p.date, '2026-10-23'); assert.deepStrictEqual([p.rates.USD, p.rates.JPY, p.rates.MYR, p.rates.EUR], [1.2, 180, 5.4, 1]); });
  await t('rates become units per US dollar; the euro is the inverse; pegs are applied; what the ECB lacks is carried and listed', () => {
    const s = FX.buildSnapshot(FX.parseEcb(XML), { perUsd: { USD: 1, TWD: 32.1, INR: 94.4 } });
    assert.strictEqual(s.perUsd.JPY, 150); assert.strictEqual(s.perUsd.MYR, 4.5); assert.strictEqual(s.perUsd.INR, 90); assert.strictEqual(s.perUsd.EUR, 0.833333);
    assert.strictEqual(s.perUsd.AED, 3.6725); assert.strictEqual(s.perUsd.OMR, 0.3845); assert.strictEqual(s.perUsd.TWD, 32.1); assert.deepStrictEqual(s.carried, ['TWD']);
    assert.strictEqual(s.asOf, '2026-10-23'); assert.strictEqual(s.indicative, true);
  });
  await t('something that is not an ECB file is refused', () => { assert.throws(() => FX.parseEcb('<html>hello</html>'), /not an ECB/); assert.throws(() => FX.parseEcb(''), /not an ECB/); });

  console.log('merchant sandbox checker');
  const env = { DODO_API_KEY: 'dk_test', DODO_WEBHOOK_KEY: 'whsec_QUJD', DODO_MODE: 'test', MOR_PRODUCTS: JSON.stringify({ USD: 'pdt_usd', GBP: 'pdt_gbp' }), PUBLIC_BASE_URL: 'https://shelterkart.test' };
  await t('it opens one test checkout per mapped currency, for the cheapest price, and prints the address', async () => {
    const sent = []; const f = async (u, o) => { const b = JSON.parse(o.body); sent.push(b); return { ok: true, status: 200, json: async () => ({ session_id: 'cks_' + sent.length, checkout_url: 'https://test.checkout.dodopayments.com/session/cks_' + sent.length }) }; };
    const log = quiet(), r = await SB.run({ env, fetchImpl: f, log });
    assert.strictEqual(r.ok, true); assert.deepStrictEqual(sent.map(b => b.product_cart[0].product_id).sort(), ['pdt_gbp', 'pdt_usd']);
    assert(sent.every(b => b.product_cart[0].amount > 0 && b.return_url.startsWith('https://shelterkart.test')));
    assert(log.lines.some(l => /GBP/.test(l) && /session\/cks_/.test(l)));
  });
  await t('it refuses to run against live, and reports a missing USD product or missing keys', async () => {
    let called = false; const f = async () => { called = true; return { ok: true, json: async () => ({}) }; };
    assert.strictEqual((await SB.run({ env: { ...env, DODO_MODE: 'live' }, fetchImpl: f, log: quiet() })).ok, false);
    const noUsd = await SB.run({ env: { ...env, MOR_PRODUCTS: JSON.stringify({ GBP: 'pdt_gbp' }) }, fetchImpl: f, log: quiet() });
    assert(!noUsd.ok && noUsd.problems.some(p => /USD/.test(p)));
    const noKeys = await SB.run({ env: { ...env, DODO_API_KEY: '' }, fetchImpl: f, log: quiet() });
    assert(!noKeys.ok && noKeys.problems.some(p => /DODO_API_KEY/.test(p))); assert.strictEqual(called, false);
  });
  await t('a test payment is checked for the three things only the provider can show', async () => {
    const mk = pay => async () => ({ ok: true, status: 200, json: async () => pay });
    const good = await SB.checkPayment({ paymentId: 'pay_1', expectMinor: 1500, currency: 'USD', env, fetchImpl: mk({ status: 'succeeded', total_amount: 1500, tax: 250, currency: 'USD', metadata: { purchase_id: 'p1' } }), log: quiet() });
    assert.strictEqual(good.ok, true);
    const log = quiet(), onTop = await SB.checkPayment({ paymentId: 'pay_2', expectMinor: 1500, currency: 'USD', env, fetchImpl: mk({ status: 'succeeded', total_amount: 1750, tax: 250, currency: 'USD', metadata: { purchase_id: 'p1' } }), log });
    assert.strictEqual(onTop.ok, false); assert(log.lines.some(l => /tax-INCLUSIVE/.test(l)));
    const noMeta = await SB.checkPayment({ paymentId: 'pay_3', expectMinor: 1500, currency: 'USD', env, fetchImpl: mk({ status: 'succeeded', total_amount: 1500, tax: 0, currency: 'USD', metadata: {} }), log: quiet() });
    assert.strictEqual(noMeta.ok, false);
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
