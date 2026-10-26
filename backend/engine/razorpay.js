'use strict';
/**
 * ShelterKart — Razorpay.
 *
 * Built from Razorpay's own documentation, not from memory:
 *   orders     POST https://api.razorpay.com/v1/orders, Basic auth with
 *              key_id:key_secret. amount in the currency's SMALLEST unit
 *              (Rs 299 -> 29900). receipt <= 40 chars; notes <= 15 pairs.
 *   checkout   signature = HMAC_SHA256(order_id + "|" + razorpay_payment_id,
 *              key_secret), where order_id comes from OUR server -- the
 *              docs say never to use the order id the browser returns.
 *   webhook    X-Razorpay-Signature = HMAC_SHA256(raw request body,
 *              webhook secret). The docs warn not to parse or re-serialise
 *              the body before hashing it.
 *
 * Nothing here decides access on its own. It verifies; server.js acts
 * only on what verifies.
 */
const crypto = require('crypto');

const API = 'https://api.razorpay.com/v1';

// Razorpay documents JPY as zero-decimal and KWD, BHD and OMR as
// three-decimal (last digit must be 0). Everything else: two decimals.
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'PYG', 'UGX', 'XAF', 'XOF']);
const THREE_DECIMAL = new Set(['KWD', 'BHD', 'OMR']);

/** Major units -> the integer Razorpay expects. Rounded, never floored:
 *  499.99 * 100 is 49998.99999... in floating point. */
function toSubunits(amount, currency) {
  const n = Number(amount), c = String(currency || '').toUpperCase();
  if (!Number.isFinite(n) || n <= 0) throw new Error('invalid amount');
  if (ZERO_DECIMAL.has(c)) return Math.round(n);
  if (THREE_DECIMAL.has(c)) return Math.round(n * 100) * 10;   // last digit 0, as Razorpay requires
  return Math.round(n * 100);
}

function hmacHex(key, message) {
  return crypto.createHmac('sha256', key).update(message).digest('hex');
}
function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !/^[0-9a-f]+$/i.test(a) || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** @param serverOrderId  the order id stored in OUR database for this purchase */
function verifyCheckoutSignature({ serverOrderId, paymentId, signature, keySecret }) {
  if (!serverOrderId || !paymentId || !signature || !keySecret) return false;
  return safeEqualHex(String(signature), hmacHex(keySecret, `${serverOrderId}|${paymentId}`));
}

/** @param rawBody Buffer -- the exact bytes received, never a re-serialised object */
function verifyWebhookSignature(rawBody, signature, webhookSecret) {
  if (!Buffer.isBuffer(rawBody) || !signature || !webhookSecret) return false;
  return safeEqualHex(String(signature), hmacHex(webhookSecret, rawBody));
}

/** Pull out only what settles a purchase. Unknown events return null. */
function parseWebhook(event) {
  if (!event || typeof event !== 'object') return null;
  const pay = event.payload && event.payload.payment && event.payload.payment.entity;
  const ord = event.payload && event.payload.order && event.payload.order.entity;
  if (event.event === 'payment.captured' && pay && pay.order_id) {
    // fee and international are what Razorpay reports about THIS payment; used for settlement records and the card-origin check, never for the price.
    return { kind: event.event, orderId: pay.order_id, paymentId: pay.id, amountSubunits: Number(pay.amount), currency: pay.currency,
             feeSubunits: pay.fee == null ? null : Number(pay.fee), international: typeof pay.international === 'boolean' ? pay.international : (pay.card && typeof pay.card.international === 'boolean' ? pay.card.international : null),
             method: pay.method || null, notes: pay.notes || {} };
  }
  if (event.event === 'order.paid' && ord && ord.id) {
    return { kind: event.event, orderId: ord.id, paymentId: pay && pay.id, amountSubunits: Number(ord.amount_paid), currency: ord.currency };
  }
  return null;
}

/** Create one order for one purchase. The amount is set here, on the
 *  server, from our own price -- never from anything the browser sent. */
async function createOrder({ amount, currency, purchaseId, ref, notes = {} }, { env, fetchImpl = globalThis.fetch }) {
  const subunits = toSubunits(amount, currency);
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try {
    res = await fetchImpl(`${API}/orders`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: 'Basic ' + auth },
      body: JSON.stringify({ amount: subunits, currency, receipt: String(purchaseId).slice(0, 40),
                             notes: { ...notes, purchaseId: String(purchaseId), reportRef: String(ref) } })
    });
  } finally { clearTimeout(timer); }
  if (!res.ok) throw new Error('razorpay order creation failed: ' + res.status);
  const o = await res.json();
  // Trust nothing about the response we didn't ask for.
  if (!o || typeof o.id !== 'string' || !o.id.startsWith('order_') || Number(o.amount) !== subunits || o.currency !== currency)
    throw new Error('razorpay order response did not match the request');
  return { orderId: o.id, amountSubunits: subunits };
}

/** Refund a captured payment, in the payment's own currency. @param amountSubunits  a partial amount, or omitted for the full payment */
async function refundPayment({ paymentId, amountSubunits, notes = {} }, { env, fetchImpl = globalThis.fetch }) {
  if (!/^pay_\w+$/.test(String(paymentId || ''))) throw new Error('invalid payment id');
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const body = { notes }; if (amountSubunits != null) body.amount = Number(amountSubunits);
  const res = await fetchImpl(`${API}/payments/${paymentId}/refund`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + auth }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error('razorpay refund failed: ' + res.status);
  const r = await res.json();
  if (!r || typeof r.id !== 'string' || !r.id.startsWith('rfnd_')) throw new Error('razorpay refund response did not match the request');
  if (amountSubunits != null && Number(r.amount) !== Number(amountSubunits)) throw new Error('razorpay refunded a different amount than requested');
  return { refundId: r.id, status: r.status || 'processed', amountSubunits: Number(r.amount) };
}

function configured(env) {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

module.exports = { toSubunits, verifyCheckoutSignature, verifyWebhookSignature, parseWebhook, createOrder, refundPayment, configured, hmacHex };
