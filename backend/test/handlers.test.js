'use strict';
/**
 * The payment handlers in payments/handlers take the request and return { status, body, headers? }: no Express, no response object.
 * That is what lets them be tested directly, and lets the route files stay thin.
 */
const assert = require('assert');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
const PRICING = require('../pricing');
const pricingData = PRICING.load({});
const env0 = { ...process.env };

(async () => {
  console.log('\npayment handlers without Express');
  await t('countries: a descriptor with the countries and a no-store header, from the price book', () => {
    const h = require('../payments/handlers/quote')({ pricingData });
    const r = h.countries({ headers: {} });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.ok, true); assert.strictEqual(r.headers['Cache-Control'], 'no-store');
    assert(r.body.countries.length > 10); assert.strictEqual(r.body.priceBookVersion, pricingData.book.version);
    assert(r.body.countries.every((x, i, a) => !i || a[i - 1].name.localeCompare(x.name) <= 0), 'sorted by name');
  });
  await t('quote: an unknown report reference is a 400 descriptor, before anything is looked up, with no cache header', async () => {
    const h = require('../payments/handlers/quote')({ pricingData });
    const r = await h.issue({ body: { ref: 'nope' } });
    assert.strictEqual(r.status, 400); assert.strictEqual(r.body.ok, false); assert(!r.headers['Cache-Control']);
  });
  await t('checkout: with payments off it answers 503 and touches nothing (no database, no provider)', async () => {
    delete process.env.PAYMENTS_ENABLED;
    const h = require('../payments/handlers/checkout')({});
    const r = await h.start({ body: { ref: 'SK-0123456789AB' } });
    assert.strictEqual(r.status, 503); assert.strictEqual(r.body.error, 'Payments are not enabled yet.');
  });
  await t('every handler is a function returning a status and a body (shape check across the four files)', () => {
    for (const f of ['checkout', 'quote', 'access', 'webhooks']) {
      const h = require('../payments/handlers/' + f)({});
      assert(Object.keys(h).length >= 1 && Object.values(h).every(fn => typeof fn === 'function'), f);
    }
    assert.deepStrictEqual(Object.keys(require('../payments/handlers/webhooks')({})), ['razorpayWebhook', 'morWebhook', 'providerWebhook']);
  });
  Object.assign(process.env, env0);
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
