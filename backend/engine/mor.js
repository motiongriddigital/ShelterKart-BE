'use strict';
/**
 * ShelterKart -- the Merchant of Record adapter (Dodo Payments).
 *
 * A Merchant of Record is the legal seller. It collects and remits the sales tax (VAT, GST) in the buyer's country, so
 * ShelterKart holds no tax registration there. India is never routed here: it is the company's own country and carries
 * its own GST registration (see pricing/data.js).
 *
 * CONFIRMED from the provider's documentation (October 2026):
 *   - POST {base}/checkouts creates a hosted checkout session. Bearer API key. Body: product_cart [{product_id, quantity,
 *     amount}], billing_address {country}, return_url, cancel_url, metadata, feature_flags. Response {session_id, checkout_url}.
 *     test base https://test.dodopayments.com
 *   - product_cart[].amount is a PAY-WHAT-YOU-WANT amount in the smallest currency unit. It applies only to a product created
 *     with pay-what-you-want pricing. The charge currency comes from the PRODUCT's price currency (billing_currency applies only
 *     when adaptive pricing is on). So: ONE product per currency, mapped in data/mor-products.json (or env MOR_PRODUCTS).
 *   - A session expires after 24 hours and its checkout_url is single-use.
 *   - GET {base}/checkouts/{id} returns payment_id and payment_status (null until the buyer submits).
 *   - Webhooks follow the Standard Webhooks specification: headers webhook-id, webhook-timestamp, webhook-signature
 *     ("v1,<base64>", space separated); signed content is "{id}.{timestamp}.{raw body}"; HMAC-SHA256 with the secret
 *     (the part after "whsec_", base64-decoded); 5 minute tolerance; webhook-id is the idempotency key.
 *   - Event body: { business_id, type, timestamp, data:{ payload_type, payment_id, total_amount, tax, currency, metadata, status } }.
 *     total_amount INCLUDES tax, in the smallest currency unit.
 *   - POST {base}/refunds, required payment_id; the payment must have succeeded.
 *
 * TO VERIFY IN THE SANDBOX BEFORE GO-LIVE (each is a line in HANDOVER.md; none can be checked without credentials):
 *   1. Session metadata comes back on payment.succeeded as data.metadata. (If it does not, the buyer's return still settles the
 *      purchase through getSession/getPayment below, so no payment is lost.)
 *   2. Each product is tax-INCLUSIVE, so total_amount equals the quote's gross. If tax is added on top the amounts differ and
 *      the webhook refuses to unlock (see server.js): fix the product, not the code.
 *   3. The live base URL (default https://live.dodopayments.com) and the partial-refund item shape.
 *   4. The exact refund webhook event name (any type starting "refund." is recorded, not acted on).
 */
const crypto = require('crypto');

const TOLERANCE_SEC = 300;
const TIMEOUT_MS = 20000;

const baseUrl = env => String(env.DODO_BASE_URL || (env.DODO_MODE === 'live' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com')).replace(/\/+$/, '');
const configured = env => Boolean(env && env.DODO_API_KEY && env.DODO_WEBHOOK_KEY);

/* ---------- webhook signature: Standard Webhooks ---------- */
const signingKey = secret => { const s = String(secret || ''); return Buffer.from(s.startsWith('whsec_') ? s.slice(6) : s, 'base64'); };
/** The signature header value for a body, as the provider computes it ("v1,<base64>"). Used by tests and the sandbox tool. */
function sign(id, timestamp, rawBody, secret) {
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  return 'v1,' + crypto.createHmac('sha256', signingKey(secret)).update(`${id}.${timestamp}.${body}`).digest('base64');
}
/** True only for a correctly signed, recent webhook. Constant-time comparison; a stale timestamp is refused (replay). */
function verifyWebhook(rawBody, headers, secret, { now = Date.now(), toleranceSec = TOLERANCE_SEC } = {}) {
  const id = headers && headers['webhook-id'], ts = headers && headers['webhook-timestamp'], sigs = headers && headers['webhook-signature'];
  if (!id || !ts || !sigs || !secret || !Buffer.isBuffer(rawBody)) return false;
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const want = Buffer.from(sign(id, ts, rawBody, secret).slice(3));
  return String(sigs).split(' ').some(part => {
    const i = part.indexOf(','); if (i < 0 || part.slice(0, i) !== 'v1') return false;
    const got = Buffer.from(part.slice(i + 1));
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  });
}

/* ---------- the provider's API ---------- */
async function api(method, pathname, body, { env, fetchImpl = globalThis.fetch }) {
  if (!configured(env)) throw Object.assign(new Error('The Merchant of Record is not configured.'), { code: 'not_configured' });
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(baseUrl(env) + pathname, {
      method, signal: ctl.signal,
      headers: { Authorization: 'Bearer ' + env.DODO_API_KEY, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null; try { data = await r.json(); } catch { /* an empty body is fine */ }
    if (!r.ok) throw Object.assign(new Error(`merchant API ${method} ${pathname} answered ${r.status}`), { status: r.status, detail: data });   // never includes the key
    return data;
  } finally { clearTimeout(timer); }
}

/** Metadata the provider accepts: strings, numbers and booleans only. */
const meta = o => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 200) : v]));

/**
 * Open a hosted checkout for EXACTLY the quote's total. The amount is the quote's gross in the smallest unit, set on the
 * server; nothing the browser sent reaches here.
 */
async function createCheckout({ quote, purchaseId, productId, returnUrl, cancelUrl, billingCountry }, ctx) {
  if (!productId) throw Object.assign(new Error(`No merchant product is set for ${quote.currency}.`), { code: 'no_product' });
  const body = {
    product_cart: [{ product_id: productId, quantity: 1, amount: quote.grossMinor }],
    billing_address: { country: String(billingCountry || quote.buyer.country).toUpperCase() },
    return_url: returnUrl, cancel_url: cancelUrl,
    metadata: meta({ purchase_id: purchaseId, ref: quote.ref, quote_id: quote.id }),
    feature_flags: { allow_currency_selection: false, redirect_immediately: true },
  };
  const s = await api('POST', '/checkouts', body, ctx);
  if (!s || !s.session_id || !s.checkout_url) throw new Error('The merchant did not return a checkout session.');
  return { sessionId: s.session_id, checkoutUrl: s.checkout_url };
}

/** The session's own record: payment_id and payment_status (both null until the buyer submits). */
const getSession = (sessionId, ctx) => api('GET', `/checkouts/${encodeURIComponent(sessionId)}`, null, ctx);
/** The payment's own record: the authoritative amount, currency and status. */
const getPayment = (paymentId, ctx) => api('GET', `/payments/${encodeURIComponent(paymentId)}`, null, ctx);

/** Refund in the ORIGINAL currency. Full when the amount equals what was charged; otherwise a partial refund of one item. */
async function refundPayment({ paymentId, amountMinor, reason = '', metadata = {} }, ctx) {
  const pay = await getPayment(paymentId, ctx);
  if (!pay || pay.status !== 'succeeded') throw Object.assign(new Error('The payment has not succeeded, so it cannot be refunded.'), { code: 'not_succeeded' });
  const body = { payment_id: paymentId, reason: String(reason).slice(0, 200), metadata: meta(metadata) };
  if (Number.isFinite(Number(pay.total_amount)) && amountMinor < Number(pay.total_amount)) {
    const item = pay.product_cart && pay.product_cart[0] && pay.product_cart[0].product_id;
    if (!item) throw Object.assign(new Error('A partial refund needs the product on the payment.'), { code: 'no_item' });
    body.items = [{ item_id: item, amount: amountMinor, tax_inclusive: true }];
  }
  const r = await api('POST', '/refunds', body, ctx);
  return { providerRef: (r && (r.refund_id || r.id)) || null, status: (r && r.status) || 'pending' };
}

/** Normalise an event. kind: paid | failed | refund | null (an event we do not act on). */
function parseWebhook(event) {
  if (!event || typeof event.type !== 'string' || !event.data || typeof event.data !== 'object') return null;
  const d = event.data, t = event.type;
  const kind = t === 'payment.succeeded' ? 'paid' : t === 'payment.failed' ? 'failed' : t.startsWith('refund.') ? 'refund' : null;
  if (!kind) return null;
  const md = d.metadata || {}, num = v => (v == null || v === '' ? null : Number(v));
  return { kind, type: t, paymentId: d.payment_id || null, amountMinor: num(kind === 'refund' ? d.amount : d.total_amount), currency: d.currency || null,
    taxMinor: num(d.tax), purchaseId: md.purchase_id || null, ref: md.ref || null, quoteId: md.quote_id || null, status: d.status || null };
}

module.exports = { baseUrl, configured, sign, verifyWebhook, createCheckout, getSession, getPayment, refundPayment, parseWebhook, TOLERANCE_SEC };
