'use strict';
/**
 * ShelterKart -- the provider-neutral payment layer.
 *
 * Every provider sits behind the same five operations, so pricing and tax never live inside an adapter:
 *
 *   capabilities(env)                 which currencies and methods it accepts, and whether it handles tax itself
 *   createCheckout(quote, ctx)        opens a payment for EXACTLY the quote's gross total and currency
 *   verifyWebhook(rawBody, headers)   checks the provider's signature before anything else
 *   parseEvent(event)                 normalises: order, payment, amount, currency, fee, card origin
 *   refund(purchase, amountMinor)     refunds in the ORIGINAL currency
 *
 * Which provider serves a country and currency is DATA (backend/data/payment-routes.json).
 * A Merchant of Record adapter plugs in here later; nothing else changes.
 */
const rzp = require('../engine/razorpay');
const morEngine = require('../engine/mor');
const { toMinor } = require('../pricing/quote');

const razorpay = {
  id: 'razorpay', handlesTax: false,
  capabilities: (env) => ({ configured: rzp.configured(env), methods: ['card', 'upi', 'netbanking'], handlesTax: false, international: env.RAZORPAY_INTERNATIONAL === 'true' }),
  async createCheckout(quote, ctx) {
    const o = await rzp.createOrder({ amount: quote.gross, currency: quote.currency, purchaseId: ctx.purchaseId, ref: quote.ref,
      notes: { quoteId: quote.id, buyerCountry: quote.buyer.country, billingCountry: ctx.billingCountry || quote.buyer.country } }, { env: ctx.env, fetchImpl: ctx.fetchImpl });
    return { provider: 'razorpay', orderId: o.orderId, amountSubunits: o.amountSubunits, currency: quote.currency, publicKey: ctx.env.RAZORPAY_KEY_ID };
  },
  verifyWebhook: (rawBody, headers, env) => rzp.verifyWebhookSignature(rawBody, headers['x-razorpay-signature'], env.RAZORPAY_WEBHOOK_SECRET),
  parseEvent(event) {
    const p = rzp.parseWebhook(event); if (!p) return null;
    return { kind: p.kind, orderId: p.orderId, paymentId: p.paymentId, amountMinor: p.amountSubunits, currency: p.currency, feeMinor: p.feeSubunits, international: p.international, method: p.method, notes: p.notes };
  },
  async refund({ paymentId, amountMinor, notes }, ctx) { const r = await rzp.refundPayment({ paymentId, amountSubunits: amountMinor, notes }, { env: ctx.env, fetchImpl: ctx.fetchImpl }); return { providerRef: r.refundId, status: r.status, amountMinor: r.amountSubunits }; },
};

/* The Merchant of Record: the legal seller. It collects the buyer's tax, so ShelterKart adds none (handlesTax). One hosted checkout
   per purchase; the buyer returns to the site and the webhook (or the server's own check of the session) settles it. */
const mor = {
  id: 'mor', handlesTax: true,
  capabilities: (env) => ({ configured: morEngine.configured(env), methods: ['card', 'wallet', 'local'], handlesTax: true, international: true }),
  async createCheckout(quote, ctx) {
    const s = await morEngine.createCheckout({ quote, purchaseId: ctx.purchaseId, productId: ctx.productId, returnUrl: ctx.returnUrl, cancelUrl: ctx.cancelUrl, billingCountry: ctx.billingCountry },
      { env: ctx.env, fetchImpl: ctx.fetchImpl });
    return { provider: 'mor', orderId: s.sessionId, checkoutUrl: s.checkoutUrl, amountMinor: quote.grossMinor, currency: quote.currency };
  },
  verifyWebhook: (rawBody, headers, env) => morEngine.verifyWebhook(rawBody, headers, env.DODO_WEBHOOK_KEY),
  parseEvent: (event) => morEngine.parseWebhook(event),
  async refund({ paymentId, amountMinor, notes }, ctx) {
    const r = await morEngine.refundPayment({ paymentId, amountMinor, reason: notes && notes.reason, metadata: notes }, { env: ctx.env, fetchImpl: ctx.fetchImpl });
    return { providerRef: r.providerRef, status: r.status };
  },
};

const PROVIDERS = { razorpay, mor };
/** The adapter for a route's provider, or null. */
const adapterFor = (route) => (route && PROVIDERS[route.provider]) || null;

module.exports = { PROVIDERS, adapterFor, razorpay };
