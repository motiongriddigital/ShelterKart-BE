'use strict';
const express = require('express');
const { respond } = require('../middleware/respond');

module.exports = function register(app, c) {
  const { ACCOUNTS, checkoutResearchLimiter, researchLimiter, webhookForgeryLimiter } = c;
  const checkout = require('../payments/handlers/checkout')(c);
  const quote = require('../payments/handlers/quote')(c);
  const access = require('../payments/handlers/access')(c);
  const webhooks = require('../payments/handlers/webhooks')(c);

  /* Start a purchase of one brief. Records the purchase as pending; only
     the signed webhook can mark it paid. No contact details are needed:
     access is delivered by token to whoever holds the purchase id. */
  app.post('/api/research/checkout', ACCOUNTS.guard, checkoutResearchLimiter, respond(checkout.start));

  /* Where a buyer can be, and what is on sale there: feeds the country selector.
     Never cached: the suggestion depends on the visitor's network country. */
  app.get('/api/pricing/countries', respond(quote.countries));

  /* Issue a signed quote for this report and buyer, locked for 30 minutes. Any earlier open quote for the same
     report and session is superseded, so a buyer who changes country is never left holding two live prices. */
  app.post('/api/research/quote', ACCOUNTS.guard, researchLimiter, respond(quote.issue));

  /* The checkout's success handler. Instant unlock: the signature is
     checked against the order id stored on OUR server for this purchase,
     so a browser cannot pair a real payment with someone else's order. */
  app.post('/api/research/razorpay/verify', ACCOUNTS.guard, checkoutResearchLimiter, respond(access.razorpayVerify));

  /* Razorpay's webhook: the backstop if the buyer closes the tab before
     the checkout handler runs. Verified over the raw body, as Razorpay's
     docs require. Always answers 2xx once the signature is valid, so
     Razorpay doesn't retry forever; what it DID is recorded instead. */
  app.post('/api/payments/razorpay/webhook', express.raw({ type: 'application/json', limit: '1mb' }), respond(webhooks.razorpayWebhook));

  /* The Merchant of Record's webhook. Verified over the RAW body (Standard Webhooks: id, timestamp, signature; five minute tolerance),
     de-duplicated by the webhook-id header, and able only to CONFIRM the quote's total: the same currency and the same amount in the
     smallest unit, or nothing unlocks. Always answers 2xx once the signature is valid so the merchant does not retry forever; what
     it did is recorded. A payment with no usable metadata is recorded as unmatched and settled by the buyer's return (reconcileMor). */
  app.post('/api/payments/mor/webhook', express.raw({ type: 'application/json', limit: '1mb' }), respond(webhooks.morWebhook));

  /* Exchange a paid purchase for an access token. The purchase id is a
     random UUID known only to the buyer who started it. */
  app.post('/api/research/access', ACCOUNTS.guard, checkoutResearchLimiter, respond(access.access));

  // ============================================================
  // ONE-TIME REPORT UNLOCK — separate from the Watch subscription above.
  // Frontend's payAndUnlock() calls this after OTP verification, before
  // showing the download/WhatsApp-share screen. Recorded the same
  // pending_payment-until-webhook way as checkout, for the same reason.
  // ============================================================

  /* ============================================================
     PAYMENT INTEGRITY

     Three defects were present in the checkout path:

     1. `amount` was read from req.body. A buyer could POST amount: 1
        for a 5,999 report; validation only checked it was a positive
        number below 1,000,000. Price is now derived server-side from
        the report and the market, and the client-supplied figure is
        ignored entirely rather than validated — a number the client
        controls should never reach a ledger.

     2. Nothing anywhere inserted into `entitlements`, so the gate on
        /api/report could never open. A paying customer would have been
        charged and still shown the locked report.

     3. No webhook handler existed, so there was no path from "payment
        succeeded" to "access granted" at all.

     The webhook below is the only thing permitted to grant access. It
     is never called by our own frontend — a client-initiated grant is
     indistinguishable from a forged one.
     ============================================================ */


  /* Prices live in pricing/ only: a versioned price book, a quote per buyer, stored on the purchase at checkout. */

  /* Raw body is required for signature verification: any re-serialisation
     changes the bytes and invalidates the HMAC. This must be registered
     BEFORE the global express.json() parser for this path. */
  app.post('/api/payments/webhook', webhookForgeryLimiter, express.raw({ type: 'application/json', limit: '1mb' }), respond(webhooks.providerWebhook));
};
