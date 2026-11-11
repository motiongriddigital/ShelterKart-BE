'use strict';
/**
 * The Merchant of Record: pricing behaviour and the adapter.
 *  - A market opens only when the merchant is configured (API key and webhook key) AND the currency has a product; otherwise it
 *    stays as it was. India is never served by the merchant. Sanctioned countries stay blocked.
 *  - Where the merchant serves a country ShelterKart adds no tax of its own, even if the company registers there later.
 *  - The adapter: Standard Webhooks signatures (including replay and tampering), the checkout request, refunds, event parsing.
 */
const assert = require('assert');
const D = require('../pricing/data.js');
const M = require('../engine/mor.js');
const PAY = require('../payments');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const SECRET = 'whsec_' + Buffer.from('a-test-signing-key-0123456789').toString('base64');
const KEYS = { DODO_API_KEY: 'dk_test_secret_value', DODO_WEBHOOK_KEY: SECRET };
const withMor = (products, env = {}) => { const d = D.load({ ...KEYS, ...env }); d.morProducts = products; return d; };
const status = (d, iso) => D.saleStatus(d, iso);
const LISTED = ['GB', 'FR', 'DE', 'ES', 'IT', 'NL', 'AE', 'SA', 'SG', 'CA', 'US', 'AU', 'NZ', 'HK', 'CH', 'NO', 'SE', 'PL', 'TW', 'QA', 'BH', 'OM'];

(async () => {
  console.log('pricing');
  await t('without the merchant\u2019s keys nothing changes: markets keep their old reasons', () => {
    const d = D.load({});
    assert.strictEqual(status(d, 'FR').reason, 'registration_required'); assert.strictEqual(status(d, 'AE').reason, 'unverified');
    assert.strictEqual(status(d, 'SG').reason, 'no_payment_route'); assert.strictEqual(status(d, 'IN').reason, 'registration_missing');
  });
  await t('keys but no product: still nothing opens (a market needs a product to be sold)', () => {
    const d = withMor({});
    for (const iso of ['FR', 'AE', 'SG', 'US']) assert.strictEqual(status(d, iso).onSale, false, iso);
  });
  await t('keys and a USD product: every listed market except India opens, in dollars, the merchant collects the tax', () => {
    const d = withMor({ USD: 'pdt_usd' });
    for (const iso of LISTED) { const s = status(d, iso); assert.strictEqual(s.onSale, true, iso + ': ' + s.reason); assert.strictEqual(s.taxBy, 'merchant_of_record', iso); assert.strictEqual(D.quoteCurrency(d, iso).currency, 'USD', iso); }
  });
  await t('a currency with a product is quoted in it; the others fall back to US dollars', () => {
    const d = withMor({ USD: 'pdt_usd', GBP: 'pdt_gbp', EUR: 'pdt_eur' });
    assert.strictEqual(D.quoteCurrency(d, 'GB').currency, 'GBP'); assert.strictEqual(D.quoteCurrency(d, 'FR').currency, 'EUR'); assert.strictEqual(D.quoteCurrency(d, 'AE').currency, 'USD');
    assert.strictEqual(D.quoteCurrency(d, 'AE').fallback, true);
  });
  await t('without a USD product a market whose own currency has none cannot be sold', () => {
    const d = withMor({ GBP: 'pdt_gbp' });
    assert.strictEqual(status(d, 'GB').onSale, true); assert.strictEqual(status(d, 'AE').onSale, false);
  });
  await t('India is never served by the merchant: it keeps its own GST registration and Razorpay', () => {
    const d = withMor({ USD: 'pdt_usd', INR: 'pdt_inr' });
    assert.strictEqual(D.morServes(d, 'IN'), false); assert.strictEqual(status(d, 'IN').reason, 'registration_missing');
    const reg = withMor({ USD: 'pdt_usd', INR: 'pdt_inr' }, { GSTIN: '27ABCDE1234F1Z5' });
    assert.strictEqual(status(reg, 'IN').onSale, true); assert.strictEqual(status(reg, 'IN').taxBy, 'shelterkart');
  });
  await t('sanctioned countries stay blocked, and an unknown country is refused', () => {
    const d = withMor({ USD: 'pdt_usd' });
    for (const iso of ['IR', 'KP', 'SY', 'CU', 'RU', 'BY']) assert.strictEqual(status(d, iso).reason, 'blocked', iso);
    assert.strictEqual(status(d, 'XX').reason, 'unknown_country');
  });
  await t('where the merchant serves, ShelterKart adds NO tax of its own, even if the company is registered there', () => {
    const own = D.load({ UK_VAT_NO: 'GB123456789' });                        // registered, no merchant: ShelterKart collects UK VAT itself
    assert.strictEqual(D.taxProfileFor(own, 'GB').mode, 'we_collect');
    const d = withMor({ USD: 'pdt_usd', GBP: 'pdt_gbp' }, { UK_VAT_NO: 'GB123456789' });   // registered AND the merchant serves: the merchant's tax only
    const p = D.taxProfileFor(d, 'GB'); assert.strictEqual(p.mode, 'merchant_of_record'); assert.strictEqual(p.rate, 0);
  });
  await t('the products come from the data file and the MOR_PRODUCTS setting; junk is ignored', () => {
    const d = D.load({ ...KEYS, MOR_PRODUCTS: JSON.stringify({ USD: 'pdt_x', gbp: 'bad-lowercase', EUR: '', CHF: 7 }) });
    assert.deepStrictEqual(d.morProducts, { USD: 'pdt_x' });
  });
  await t('a product mapped for a currency the price book has no ladder for is a data problem, found at startup', () => {
    const d = withMor({ USD: 'pdt_usd', MYR: 'pdt_myr' });
    assert(D.validate(d).some(p => /MYR/.test(p)), 'expected a validation problem for MYR');
    assert.deepStrictEqual(D.validate(withMor({ USD: 'pdt_usd' })), []);
  });

  console.log('webhook signature (Standard Webhooks)');
  const now = Date.now(), ts = Math.floor(now / 1000), body = Buffer.from(JSON.stringify({ type: 'payment.succeeded', data: { payment_id: 'pay_1' } }));
  const hdr = (id = 'wh_1', time = ts, b = body, secret = SECRET) => ({ 'webhook-id': id, 'webhook-timestamp': String(time), 'webhook-signature': M.sign(id, time, b, secret) });
  await t('a correctly signed, recent webhook is accepted', () => assert.strictEqual(M.verifyWebhook(body, hdr(), SECRET, { now }), true));
  await t('a changed body is refused', () => assert.strictEqual(M.verifyWebhook(Buffer.from(body.toString() + ' '), hdr(), SECRET, { now }), false));
  await t('the wrong secret is refused', () => assert.strictEqual(M.verifyWebhook(body, hdr(), 'whsec_' + Buffer.from('other-key-material-xx').toString('base64'), { now }), false));
  await t('a webhook older than five minutes is refused (replay), and so is one from the future', () => {
    assert.strictEqual(M.verifyWebhook(body, hdr('wh_1', ts - 301), SECRET, { now }), false);
    assert.strictEqual(M.verifyWebhook(body, hdr('wh_1', ts + 301), SECRET, { now }), false);
    assert.strictEqual(M.verifyWebhook(body, hdr('wh_1', ts - 299), SECRET, { now }), true);
  });
  await t('several signatures in one header: one valid is enough; an unknown version or a missing header is not', () => {
    const h = hdr(); assert.strictEqual(M.verifyWebhook(body, { ...h, 'webhook-signature': 'v1,AAAA ' + h['webhook-signature'] }, SECRET, { now }), true);
    assert.strictEqual(M.verifyWebhook(body, { ...h, 'webhook-signature': h['webhook-signature'].replace('v1,', 'v2,') }, SECRET, { now }), false);
    for (const k of ['webhook-id', 'webhook-timestamp', 'webhook-signature']) { const x = { ...h }; delete x[k]; assert.strictEqual(M.verifyWebhook(body, x, SECRET, { now }), false, k); }
    assert.strictEqual(M.verifyWebhook(String(body), h, SECRET, { now }), false, 'a parsed or re-serialised body is not the raw body');
  });

  console.log('adapter');
  const quote = { id: 'q_aaaaaaaaaaaaaaaaaaaa', ref: 'SK-ABC123', currency: 'GBP', grossMinor: 2500, buyer: { country: 'GB' } };
  const call = { env: { ...KEYS, DODO_MODE: 'test' }, fetchImpl: null };
  await t('a checkout is created for exactly the quote\u2019s total, in the smallest unit, with the purchase named in its metadata', async () => {
    let seen; call.fetchImpl = async (url, o) => { seen = { url, o, body: JSON.parse(o.body) }; return { ok: true, status: 200, json: async () => ({ session_id: 'cks_1', checkout_url: 'https://test.checkout.dodopayments.com/session/cks_1' }) }; };
    const s = await M.createCheckout({ quote, purchaseId: 'pur-1', productId: 'pdt_gbp', returnUrl: 'https://x.test/?a=1', cancelUrl: 'https://x.test/', billingCountry: 'gb' }, call);
    assert.strictEqual(seen.url, 'https://test.dodopayments.com/checkouts'); assert.strictEqual(seen.o.method, 'POST'); assert.strictEqual(seen.o.headers.Authorization, 'Bearer dk_test_secret_value');
    assert.deepStrictEqual(seen.body.product_cart, [{ product_id: 'pdt_gbp', quantity: 1, amount: 2500 }]);
    assert.strictEqual(seen.body.billing_address.country, 'GB'); assert.deepStrictEqual(seen.body.metadata, { purchase_id: 'pur-1', ref: 'SK-ABC123', quote_id: quote.id });
    assert.strictEqual(seen.body.feature_flags.allow_currency_selection, false);
    assert.deepStrictEqual(s, { sessionId: 'cks_1', checkoutUrl: 'https://test.checkout.dodopayments.com/session/cks_1' });
  });
  await t('live mode uses the live address; DODO_BASE_URL overrides both', () => {
    assert.strictEqual(M.baseUrl({ DODO_MODE: 'live' }), 'https://live.dodopayments.com'); assert.strictEqual(M.baseUrl({}), 'https://test.dodopayments.com');
    assert.strictEqual(M.baseUrl({ DODO_BASE_URL: 'https://example.test/' }), 'https://example.test');
  });
  await t('no product for the currency, or no keys: refused before any request is made', async () => {
    let called = false; const f = async () => { called = true; return { ok: true, json: async () => ({}) }; };
    await assert.rejects(() => M.createCheckout({ quote, purchaseId: 'p', productId: null, returnUrl: 'r', cancelUrl: 'c' }, { env: call.env, fetchImpl: f }), e => e.code === 'no_product');
    await assert.rejects(() => M.createCheckout({ quote, purchaseId: 'p', productId: 'pdt', returnUrl: 'r', cancelUrl: 'c' }, { env: {}, fetchImpl: f }), e => e.code === 'not_configured');
    assert.strictEqual(called, false);
  });
  await t('a provider error is raised without the API key in its message', async () => {
    const f = async () => ({ ok: false, status: 500, json: async () => ({ message: 'boom' }) });
    await assert.rejects(() => M.createCheckout({ quote, purchaseId: 'p', productId: 'pdt', returnUrl: 'r', cancelUrl: 'c' }, { env: call.env, fetchImpl: f }), e => e.status === 500 && !/dk_test/.test(e.message));
    const empty = async () => ({ ok: true, status: 200, json: async () => ({}) });
    await assert.rejects(() => M.createCheckout({ quote, purchaseId: 'p', productId: 'pdt', returnUrl: 'r', cancelUrl: 'c' }, { env: call.env, fetchImpl: empty }), /did not return/);
  });
  await t('events are normalised: paid, failed, refund; anything else is ignored', () => {
    const paid = M.parseWebhook({ type: 'payment.succeeded', data: { payment_id: 'pay_1', total_amount: 2500, currency: 'GBP', tax: 417, status: 'succeeded', metadata: { purchase_id: 'pur-1', ref: 'SK-ABC123' } } });
    assert.deepStrictEqual([paid.kind, paid.paymentId, paid.amountMinor, paid.currency, paid.taxMinor, paid.purchaseId], ['paid', 'pay_1', 2500, 'GBP', 417, 'pur-1']);
    assert.strictEqual(M.parseWebhook({ type: 'payment.failed', data: { payment_id: 'pay_2' } }).kind, 'failed');
    const rf = M.parseWebhook({ type: 'refund.succeeded', data: { payment_id: 'pay_1', amount: 900 } }); assert.deepStrictEqual([rf.kind, rf.amountMinor], ['refund', 900]);
    for (const e of [{ type: 'subscription.active', data: {} }, { type: 'payment.succeeded' }, null, 'x', {}]) assert.strictEqual(M.parseWebhook(e), null);
  });
  await t('a full refund names only the payment; a partial refund names the item and the amount, tax-inclusive', async () => {
    const calls = []; const f = async (url, o) => { calls.push({ url, method: o.method, body: o.body ? JSON.parse(o.body) : null });
      if (o.method === 'GET') return { ok: true, status: 200, json: async () => ({ status: 'succeeded', total_amount: 2500, product_cart: [{ product_id: 'pdt_gbp' }] }) };
      return { ok: true, status: 200, json: async () => ({ refund_id: 'ref_9', status: 'succeeded' }) }; };
    const full = await M.refundPayment({ paymentId: 'pay_1', amountMinor: 2500, reason: 'Not delivered' }, { env: call.env, fetchImpl: f });
    const fb = calls.find(c => c.method === 'POST').body; assert.strictEqual(fb.payment_id, 'pay_1'); assert.strictEqual(fb.items, undefined); assert.strictEqual(full.providerRef, 'ref_9');
    calls.length = 0; await M.refundPayment({ paymentId: 'pay_1', amountMinor: 1000 }, { env: call.env, fetchImpl: f });
    assert.deepStrictEqual(calls.find(c => c.method === 'POST').body.items, [{ item_id: 'pdt_gbp', amount: 1000, tax_inclusive: true }]);
  });
  await t('a payment that has not succeeded cannot be refunded', async () => {
    const f = async () => ({ ok: true, status: 200, json: async () => ({ status: 'processing', total_amount: 2500 }) });
    await assert.rejects(() => M.refundPayment({ paymentId: 'pay_1', amountMinor: 2500 }, { env: call.env, fetchImpl: f }), e => e.code === 'not_succeeded');
  });
  await t('the provider-neutral layer exposes the merchant, and says it handles tax itself', () => {
    const a = PAY.adapterFor({ provider: 'mor' }); assert(a && a.id === 'mor' && a.handlesTax === true && a.capabilities(KEYS).configured === true);
    assert.strictEqual(PAY.adapterFor({ provider: 'razorpay' }).handlesTax, false);
    assert.strictEqual(a.verifyWebhook(body, hdr(), { DODO_WEBHOOK_KEY: SECRET }), true);
  });

  await t('refunding a merchant sale does not reverse anything in ShelterKart\u2019s own sales ledger (it never booked it)', async () => {
    const { refundPurchase } = require('../payments/refunds');
    const data = withMor({ USD: 'pdt_usd', GBP: 'pdt_gbp' }), sales = [], saved = [], posts = [];
    const row = { id: 'pur-r1', report_ref: 'SK-ABC123', amount: '25', currency: 'GBP', status: 'paid', provider: 'mor', provider_payment_id: 'pay_9', buyer_country: 'GB', amount_net: '25', tax_amount: '0', net_revenue: null, quote_id: 'q_x' };
    const db = { query: async sql => (/^\s*SELECT/i.test(sql) ? { rows: [row] } : { rows: [] }) };
    const store = { refundedTotal: async () => 0, reserveRefund: async r => { saved.push(r); return saved.length; }, settleRefund: async () => {}, releaseRefund: async () => {}, addEvent: async () => {}, addSale: async s => { sales.push(s); } };
    const f = async (url, o) => { if (o.method === 'GET') return { ok: true, status: 200, json: async () => ({ status: 'succeeded', total_amount: 2500, product_cart: [{ product_id: 'pdt_gbp' }] }) }; posts.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ refund_id: 'ref_1', status: 'succeeded' }) }; };
    const out = await refundPurchase({ db, data, store, purchaseId: 'pur-r1', reason: 'Not delivered', env: { ...KEYS }, fetchImpl: f });
    assert.strictEqual(out.full, true); assert.strictEqual(posts[0].payment_id, 'pay_9'); assert.strictEqual(posts[0].items, undefined);
    assert.strictEqual(saved.length, 1); assert.strictEqual(sales.length, 0, 'no ledger reversal for a sale ShelterKart never booked');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
