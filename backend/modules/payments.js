'use strict';
const express = require('express');
const { getByRefAsync } = require('../engine/research');
const REVIEW = require('../engine/review');
const ANALYTICS = require('../engine/analytics');
const { pickLanguage } = require('../engine/languages');
const { paywallActive, REF_RE } = require('../engine/access');
const PRICING = require('../pricing');
const PAYMENTS = require('../payments');
const morEngine = require('../engine/mor');
const rzp = require('../engine/razorpay');
const { claimEvent, finishEvent } = require('../payments/events');
const crypto = require('crypto');
const { ah } = require('../middleware/asyncHandler');

module.exports = function register(app, c) {
  const { ACCOUNTS, buyerOf, checkoutResearchLimiter, grantOf, markPurchasePaid, ownsPurchase, pool, pricingData, pricingStore, reconcileMor, reconcileRazorpay, researchLimiter, sessionOf, startMor, track } = c;

  /* Start a purchase of one brief. Records the purchase as pending; only
     the signed webhook can mark it paid. No contact details are needed:
     access is delivered by token to whoever holds the purchase id. */
  const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
  app.post('/api/research/checkout', ACCOUNTS.guard, checkoutResearchLimiter, ah(async (req, res) => {
    if (!paywallActive(process.env)) return res.status(503).json({ ok: false, error: 'Payments are not enabled yet.' });
    const { ref, idempotencyKey, quoteId, billingCountry, buyerKind, taxId } = req.body || {};
    if (!REF_RE.test(String(ref || ''))) return res.status(400).json({ ok: false, error: 'Unknown report reference.' });
    if (!IDEMPOTENCY_KEY_RE.test(String(idempotencyKey || '')))
      return res.status(400).json({ ok: false, error: 'Missing or invalid idempotency key.' });

    // A retried checkout -- the same key seen before -- returns the SAME
    // purchase and order rather than starting a second one. This is the
    // whole fix: nothing below this block runs for a genuine retry.
    const existing = await pool.query(
      `SELECT id, amount, currency, provider, provider_order_id, status, quote_id, billing_country FROM report_purchases WHERE idempotency_key=$1`,
      [idempotencyKey]);
    if (existing.rows.length) {
      const row = existing.rows[0];
      if (row.status !== 'pending_payment' || !row.provider_order_id) {
        // Already paid, refunded, or the order step never completed last
        // time -- not a safe thing to silently hand back as if it were new.
        return res.status(409).json({ ok: false, error: 'This checkout attempt has already been used. Please start again.' });
      }
      if (row.provider === 'mor') {
        // A merchant checkout link is single-use: a retry of the same attempt opens a fresh session for the SAME pending purchase.
        const q0 = await pricingStore.getQuote(row.quote_id);
        if (!q0) return res.status(409).json({ ok: false, error: 'This checkout attempt has already been used. Please start again.' });
        try {
          const o = await startMor(q0, row.id, row.billing_country || q0.buyer.country);
          await pool.query(`UPDATE report_purchases SET provider_order_id=$2 WHERE id=$1`, [row.id, o.orderId]);
          return res.json({ ok: true, purchaseId: row.id, amount: Number(row.amount), currency: row.currency, quoteId: q0.id, mor: { checkoutUrl: o.checkoutUrl } });
        } catch (e) { console.error('[checkout] merchant session failed', e.message); return res.status(503).json({ ok: false, error: 'Payment could not be started right now. Please try again in a moment.' }); }
      }
      return res.json({ ok: true, purchaseId: row.id, amount: Number(row.amount), currency: row.currency,
        razorpay: { keyId: process.env.RAZORPAY_KEY_ID, orderId: row.provider_order_id,
                    amountSubunits: rzp.toSubunits(row.amount, row.currency) } });
    }

    // The quote the buyer reviewed and confirmed. Its total is what is charged: never a number recomputed here,
    // and never one the browser sent. A refused quote asks the page to show the current price again.
    if (!/^q_[0-9a-f]{20}$/.test(String(quoteId || ''))) return res.status(400).json({ ok: false, code: 'quote_required', error: 'Please review your price before paying.' });
    const quote = await pricingStore.getQuote(quoteId);
    if (!quote || quote.ref !== ref) return res.status(404).json({ ok: false, code: 'quote_unknown', requote: true, error: 'That price is no longer available. Please review the current price.' });
    const verdict = PRICING.verifyQuote(quote, process.env);
    if (!verdict.ok) {
      await pricingStore.addEvent('quote_refused', { quoteId, ref, details: { reason: verdict.reason } });
      const why = { expired: 'This price has expired. Please review the current price.', superseded: 'A newer price replaced this one. Please review it.', used: 'This price was already used. Please review the current price.', signature: 'This price could not be verified.' }[verdict.reason];
      return res.status(verdict.reason === 'signature' ? 400 : 409).json({ ok: false, code: 'quote_' + verdict.reason, requote: verdict.reason !== 'signature', error: why });
    }
    // Verify the country before any money moves. The billing country decides tax (and, for a card issued in India, that the
    // charge must be in rupees). If it differs from the quote, the buyer sees the new total and confirms it first.
    const billing = PRICING.cleanCode(billingCountry);
    if (!billing) return res.status(400).json({ ok: false, code: 'billing_required', error: 'Please confirm your billing country.' });
    if (billing !== quote.buyer.country) {
      const reportBrief = await getByRefAsync(ref);
      if (!reportBrief) return res.status(404).json({ ok: false, error: 'This report is no longer available. Search again, then unlock the new report.' });
      const nb = await buyerOf({ body: { country: billing }, headers: req.headers }, { billing });
      await pricingStore.addEvent('billing_mismatch', { quoteId, ref, details: { quoted: quote.buyer.country, billing, onSale: nb.onSale } });
      if (!nb.onSale) return res.status(409).json({ ok: false, code: 'not_on_sale', reason: nb.reason, country: billing, error: 'Reports are not on sale in that country yet.' });
      const nq = await PRICING.issueQuote({ data: pricingData, store: pricingStore, brief: reportBrief, buyer: nb, session: quote.session, supersedes: quote.id, details: { trigger: 'billing_mismatch' } });
      await pricingStore.addEvent('requote', { quoteId: nq.id, ref, details: { from: quote.id, previous: { country: quote.buyer.country, currency: quote.currency, grossMinor: quote.grossMinor } } });
      return res.status(409).json({ ok: false, code: 'billing_country', requote: true, error: 'Your billing country differs from the price you were shown.',
        previous: { country: quote.buyer.country, currency: quote.currency, gross: quote.gross }, quote: PRICING.publicQuote(nq) });
    }
    const route = PRICING.routeFor(pricingData, quote.buyer.country, quote.currency), adapter = PAYMENTS.adapterFor(route);
    if (!adapter) return res.status(503).json({ ok: false, code: 'not_on_sale', reason: 'no_payment_route', error: 'Reports are not on sale in your country yet.' });
    let purchaseId;
    try {
      const r = await pool.query(
        `INSERT INTO report_purchases (report_ref, amount, currency, status, provider, idempotency_key, quote_id, buyer_country, billing_country, amount_net, tax_amount, tax_rate_bps, tax_mode, price_book_version, buyer_kind, tax_id)
       VALUES ($1,$2,$3,'pending_payment',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        // V1 treats every buyer as a consumer: a business tax ID is kept for the invoice, not validated, and changes no tax.
        [ref, quote.gross, quote.currency, adapter.id, idempotencyKey, quote.id, quote.buyer.country, billing, quote.net, quote.tax, quote.taxRateBps, quote.taxMode, quote.priceBookVersion,
         buyerKind === 'business' ? 'business' : 'individual', String(taxId || '').toUpperCase().split(/[^A-Z0-9 .\-]/)[0].replace(/[^A-Z0-9]/g, '').slice(0, 20) || null]);   // ends at the first character a tax ID can't contain
      purchaseId = r.rows[0].id;
      if (ACCOUNTS.enabled) {
        try { const owner = await ACCOUNTS.user(req); await pool.query(`UPDATE report_purchases SET user_id=$2 WHERE id=$1`, [purchaseId, owner.id]); }
        catch (e2) { console.error('[accounts] purchase owner not saved:', e2 && e2.message); return res.status(503).json({ ok: false, error: 'Payment could not be started right now. Please try again.' }); }
      }
    } catch (e) {
      // A concurrent request with the same key beat this one to the insert
      // -- the unique index caught it. Treat it the same as the read-first
      // path above: fetch and return what the winner created.
      if (e && e.code === '23505') {
        const again = await pool.query(
          `SELECT id, amount, currency, provider_order_id FROM report_purchases WHERE idempotency_key=$1`, [idempotencyKey]);
        const row = again.rows[0];
        if (row && row.provider_order_id) {
          return res.json({ ok: true, purchaseId: row.id, amount: Number(row.amount), currency: row.currency,
            razorpay: { keyId: process.env.RAZORPAY_KEY_ID, orderId: row.provider_order_id,
                        amountSubunits: rzp.toSubunits(row.amount, row.currency) } });
        }
      }
      throw e;
    }
    await pricingStore.setQuoteStatus(quote.id, 'used');

    let order;
    try {
      // The amount is the quote's gross total, set on the server -- never anything the browser sent.
      order = adapter.id === 'mor' ? await startMor(quote, purchaseId, billing) : await adapter.createCheckout(quote, { purchaseId, env: process.env, billingCountry: billing });
    } catch (e) {
      console.error('[checkout] provider order failed', e.message);
      return res.status(503).json({ ok: false, error: 'Payment could not be started right now. Please try again in a moment.' });
    }
    // Razorpay's docs: store the order id against the transaction, and
    // verify every payment against THIS stored id.
    await pool.query(`UPDATE report_purchases SET provider_order_id=$2 WHERE id=$1`, [purchaseId, order.orderId]);
    // Where this buyer came from (the browser's first page of the visit) and the property's market, kept with the purchase so the
    // payment, which arrives later from the provider's webhook, can be traced to its channel on the marketing dashboard. Best effort:
    // a database without the column (migration purchase_attribution.sql not yet run) loses the trace, never the payment.
    const source = ANALYTICS.sourceOf(req.body && req.body.source), forMarket = await getByRefAsync(ref).catch(() => null), attribution = { market: (forMarket && forMarket.market) || '', ...(source || {}) };
    try { await pool.query(`UPDATE report_purchases SET attribution=$2 WHERE id=$1`, [purchaseId, JSON.stringify(attribution)]); } catch (e) { console.error('[checkout] attribution not saved:', e && e.message); }
    track('checkout_started', req, { ref, value: quote.gross, currency: quote.currency, lang: pickLanguage(req.body && req.body.lang), market: attribution.market, ...(source ? { utm: source.utm, referrer: source.referrer } : {}) });      // new attempts only, not idempotent retries
    if (adapter.id === 'mor') return res.json({ ok: true, purchaseId, amount: quote.gross, currency: quote.currency, quoteId: quote.id, mor: { checkoutUrl: order.checkoutUrl } });
    res.json({ ok: true, purchaseId, amount: quote.gross, currency: quote.currency, quoteId: quote.id,
               razorpay: { keyId: order.publicKey, orderId: order.orderId, amountSubunits: order.amountSubunits } });
  }));

  /* Where a buyer can be, and what is on sale there: feeds the country selector.
     Never cached: the suggestion depends on the visitor's network country. */
  app.get('/api/pricing/countries', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const list = [...pricingData.countries.values()].filter(c => !c.blocked).map(c => {
      const q = PRICING.quoteCurrency(pricingData, c.iso), s = PRICING.saleStatus(pricingData, c.iso);
      return { iso: c.iso, name: c.name, currency: q.currency, onSale: s.onSale, reason: s.reason };
    }).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ ok: true, countries: list, network: PRICING.networkCountry(req.headers || {}), priceBookVersion: pricingData.book.version });
  });

  /* Issue a signed quote for this report and buyer, locked for 30 minutes. Any earlier open quote for the same
     report and session is superseded, so a buyer who changes country is never left holding two live prices. */
  app.post('/api/research/quote', ACCOUNTS.guard, researchLimiter, ah(async (req, res) => {
    const { ref, previousQuoteId } = req.body || {};
    if (!REF_RE.test(String(ref || ''))) return res.status(400).json({ ok: false, error: 'Unknown report reference.' });
    const brief = await getByRefAsync(ref);
    if (!brief) return res.status(404).json({ ok: false, error: 'This report is no longer available. Search again, then unlock the new report.' });
    if (REVIEW.isHeld(brief)) return res.status(409).json({ ok: false, code: 'held', error: 'A person is checking one or more findings in this report before it can be unlocked. Please try again later.' });
    if (brief.kind === 'dossier' && !brief.dossier) return res.status(409).json({ ok: false, code: 'not_ready', error: 'The first findings are still coming in. Please try again in a minute.' });
    const buyer = await buyerOf(req, { billing: req.body && req.body.billingCountry });
    res.set('Cache-Control', 'no-store');
    try {
      const q = await PRICING.issueQuote({ data: pricingData, store: pricingStore, brief, buyer, session: sessionOf(req), details: { trigger: previousQuoteId ? 'country_changed' : 'unlock' } });
      if (/^q_[0-9a-f]{20}$/.test(String(previousQuoteId || ''))) await pricingStore.addEvent('country_changed', { quoteId: q.id, ref, details: { from: previousQuoteId, to: q.buyer.country } });
      res.json({ ok: true, quote: PRICING.publicQuote(q) });
    } catch (e) {
      if (e instanceof PRICING.PricingError) return res.status(409).json({ ok: false, code: e.code, reason: e.reason, country: e.country, error: e.message });
      throw e;
    }
  }));

  /* The checkout's success handler. Instant unlock: the signature is
     checked against the order id stored on OUR server for this purchase,
     so a browser cannot pair a real payment with someone else's order. */
  app.post('/api/research/razorpay/verify', ACCOUNTS.guard, checkoutResearchLimiter, ah(async (req, res) => {
    if (!paywallActive(process.env)) return res.status(503).json({ ok: false, error: 'Payments are not enabled yet.' });
    const { ref, purchaseId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
    if (!REF_RE.test(String(ref || '')) || !/^[0-9a-f-]{36}$/i.test(String(purchaseId || '')) || !/^pay_\w+$/.test(String(paymentId || '')))
      return res.status(400).json({ ok: false, error: 'Invalid request.' });
    const q = await pool.query(`SELECT status, provider_order_id FROM report_purchases WHERE id=$1 AND report_ref=$2`, [purchaseId, ref]);
    if (!q.rows.length || !q.rows[0].provider_order_id) return res.status(404).json({ ok: false, error: 'Purchase not found.' });
    if (ACCOUNTS.enabled && !(await ownsPurchase(req, purchaseId))) return res.status(403).json({ ok: false, code: 'not_entitled', error: 'This purchase belongs to another account.' });
    const valid = rzp.verifyCheckoutSignature({ serverOrderId: q.rows[0].provider_order_id, paymentId, signature, keySecret: process.env.RAZORPAY_KEY_SECRET });
    if (!valid) return res.status(400).json({ ok: false, error: 'This payment could not be verified. If you were charged, write to us with your receipt.' });
    if (q.rows[0].status !== 'paid') await markPurchasePaid(pool, { purchaseId, ref, provider: 'razorpay', paymentId }, { req });
    res.json(grantOf(ref));
  }));

  /* Razorpay's webhook: the backstop if the buyer closes the tab before
     the checkout handler runs. Verified over the raw body, as Razorpay's
     docs require. Always answers 2xx once the signature is valid, so
     Razorpay doesn't retry forever; what it DID is recorded instead. */
  app.post('/api/payments/razorpay/webhook', express.raw({ type: 'application/json', limit: '1mb' }), ah(async (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ ok: false });
    if (!Buffer.isBuffer(req.body) || !rzp.verifyWebhookSignature(req.body, req.get('x-razorpay-signature'), secret))
      return res.status(401).json({ ok: false, error: 'Invalid signature' });
    let event;
    try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).json({ ok: false }); }
    const p = rzp.parseWebhook(event);
    if (!p || !p.paymentId) return res.json({ ok: true, ignored: event && event.event });

    // One claim per payment (or refund) and event type. A redelivery of an event that already ended does nothing; one that was received
    // and never finished (an error below answers 500, so Razorpay sends it again) is processed again.
    const claim = await claimEvent(pool, 'razorpay', `${p.refundId || p.paymentId}:${p.kind}`, crypto.createHash('sha256').update(req.body).digest('hex'));
    if (!claim.claimed) return res.json({ ok: true, duplicate: true });
    const done = status => finishEvent(pool, claim.id, status);
    if (p.kind === 'payment.failed') {
      await pricingStore.addEvent('razorpay_payment_failed', { details: { orderId: p.orderId, paymentId: p.paymentId, code: p.errorCode } });
      await done('processed'); return res.json({ ok: true, noted: p.kind });
    }
    if (/^refund\./.test(p.kind)) {
      await pricingStore.addEvent('razorpay_refund_event', { details: { type: p.kind, refundId: p.refundId, paymentId: p.paymentId, amountSubunits: p.amountSubunits, currency: p.currency, status: p.status } });
      await done('processed'); return res.json({ ok: true, noted: p.kind });
    }

    const q = await pool.query(`SELECT id, report_ref, amount, currency, status FROM report_purchases WHERE provider='razorpay' AND provider_order_id=$1`, [p.orderId]);
    if (!q.rows.length) { await done('ignored'); return res.json({ ok: true, unknown_order: true }); }
    const row = q.rows[0];
    let expected;
    try { expected = rzp.toSubunits(row.amount, row.currency); } catch { expected = NaN; }
    // The webhook can only CONFIRM the quote's total. Any difference, even one unit, and nothing unlocks.
    if (p.currency !== row.currency || p.amountSubunits !== expected) {
      await pricingStore.addEvent('webhook_amount_mismatch', { ref: row.report_ref, details: { purchaseId: row.id, expected, got: p.amountSubunits, currency: p.currency, expectedCurrency: row.currency } });
      await done('failed'); return res.json({ ok: true, mismatch: true });
    }
    // An authorized payment (auto-capture off) is captured here, for exactly the quote's total in its currency; the payment.captured event that follows settles it.
    if (p.kind === 'payment.authorized') {
      await rzp.capturePayment({ paymentId: p.paymentId, amountSubunits: expected, currency: row.currency }, { env: process.env });
      await done('processed'); return res.json({ ok: true, captured: true });
    }
    // A card issued in India can only be charged in rupees: a foreign-currency payment on an Indian card is flagged for review.
    if (p.international === false && row.currency !== 'INR') await pricingStore.addEvent('card_origin_mismatch', { ref: row.report_ref, details: { purchaseId: row.id, currency: row.currency } });
    await markPurchasePaid(pool, { purchaseId: row.id, ref: row.report_ref, provider: 'razorpay', paymentId: p.paymentId });
    if (p.feeSubunits != null && row.currency === 'INR') {
      // Net revenue is written ONCE, from the provider's own figure. (Foreign-currency fees settle in rupees at a rate we do not see here: reconcile those from the settlement report.)
      const m = 100, fee = p.feeSubunits / m;
      await pool.query(`UPDATE report_purchases SET provider_fee=$2, net_revenue=amount_net-$2 WHERE id=$1 AND net_revenue IS NULL`, [row.id, fee]);
    }
    await done('processed');
    res.json({ ok: true });
  }));

  /* The Merchant of Record's webhook. Verified over the RAW body (Standard Webhooks: id, timestamp, signature; five minute tolerance),
     de-duplicated by the webhook-id header, and able only to CONFIRM the quote's total: the same currency and the same amount in the
     smallest unit, or nothing unlocks. Always answers 2xx once the signature is valid so the merchant does not retry forever; what
     it did is recorded. A payment with no usable metadata is recorded as unmatched and settled by the buyer's return (reconcileMor). */
  app.post('/api/payments/mor/webhook', express.raw({ type: 'application/json', limit: '1mb' }), ah(async (req, res) => {
    const secret = process.env.DODO_WEBHOOK_KEY;
    if (!secret) return res.status(503).json({ ok: false });
    const headers = { 'webhook-id': req.get('webhook-id'), 'webhook-timestamp': req.get('webhook-timestamp'), 'webhook-signature': req.get('webhook-signature') };
    if (!Buffer.isBuffer(req.body) || !morEngine.verifyWebhook(req.body, headers, secret)) return res.status(401).json({ ok: false, error: 'Invalid signature' });
    let event;
    try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).json({ ok: false }); }
    const p = morEngine.parseWebhook(event);
    if (!p) return res.json({ ok: true, ignored: event && event.type });
    const claim = await claimEvent(pool, 'mor', headers['webhook-id'], crypto.createHash('sha256').update(req.body).digest('hex'));
    if (!claim.claimed) return res.json({ ok: true, duplicate: true });
    const done = status => finishEvent(pool, claim.id, status);
    if (p.kind === 'failed') await pricingStore.addEvent('mor_payment_failed', { details: { purchaseId: p.purchaseId, paymentId: p.paymentId, type: p.type } });
    if (p.kind === 'refund') await pricingStore.addEvent('mor_refund_event', { details: { type: p.type, paymentId: p.paymentId, amountMinor: p.amountMinor, currency: p.currency, status: p.status } });
    if (p.kind !== 'paid') { await done('processed'); return res.json({ ok: true, noted: p.type }); }       // failed and refund events are recorded, not acted on here
    if (!p.paymentId || !/^[0-9a-f-]{36}$/i.test(String(p.purchaseId || ''))) {
      await pricingStore.addEvent('mor_unmatched_payment', { details: { paymentId: p.paymentId, type: p.type } });
      await done('ignored'); return res.json({ ok: true, unmatched: true });
    }
    const q = await pool.query(`SELECT id, report_ref, amount, currency, status FROM report_purchases WHERE id=$1 AND provider='mor'`, [p.purchaseId]);
    if (!q.rows.length) { await done('ignored'); return res.json({ ok: true, unknown_purchase: true }); }
    const row = q.rows[0], expected = PRICING.toMinor(pricingData, Number(row.amount), row.currency);
    // The webhook can only CONFIRM the quote's total. Any difference, even one unit, and nothing unlocks. (A mismatch usually means the
    // merchant's product is not tax-inclusive: fix the product. The buyer is NOT unlocked and the event is recorded for support.)
    if (p.currency !== row.currency || p.amountMinor !== expected) {
      console.error(`[mor] amount mismatch on purchase ${row.id}: expected ${expected} ${row.currency}, got ${p.amountMinor} ${p.currency}`);
      await pricingStore.addEvent('webhook_amount_mismatch', { ref: row.report_ref, details: { purchaseId: row.id, expected, got: p.amountMinor, currency: p.currency, expectedCurrency: row.currency } });
      await done('failed'); return res.json({ ok: true, mismatch: true });
    }
    await markPurchasePaid(pool, { purchaseId: row.id, ref: row.report_ref, provider: 'mor', paymentId: p.paymentId });
    if (p.taxMinor != null) await pricingStore.addEvent('mor_tax_collected', { ref: row.report_ref, details: { purchaseId: row.id, taxMinor: p.taxMinor, currency: row.currency } });
    await done('processed');
    res.json({ ok: true });
  }));

  /* Exchange a paid purchase for an access token. The purchase id is a
     random UUID known only to the buyer who started it. */
  app.post('/api/research/access', ACCOUNTS.guard, checkoutResearchLimiter, ah(async (req, res) => {
    if (!paywallActive(process.env)) return res.status(503).json({ ok: false, error: 'Payments are not enabled yet.' });
    const { ref, purchaseId } = req.body || {};
    if (!REF_RE.test(String(ref || '')) || !/^[0-9a-f-]{36}$/i.test(String(purchaseId || '')))
      return res.status(400).json({ ok: false, error: 'Invalid request.' });
    const r = await pool.query(`SELECT status, provider, provider_order_id, amount, currency FROM report_purchases WHERE id=$1 AND report_ref=$2`, [purchaseId, ref]);
    if (r.rows.length && r.rows[0].status === 'pending_payment' && r.rows[0].provider === 'mor' && r.rows[0].provider_order_id) {
      try { if (await reconcileMor(purchaseId, ref, r.rows[0])) r.rows[0].status = 'paid'; } catch (e) { console.error('[mor] could not confirm the payment yet:', e && e.message); }
    }
    if (r.rows.length && r.rows[0].status === 'pending_payment' && r.rows[0].provider === 'razorpay' && r.rows[0].provider_order_id && rzp.configured(process.env)) {
      try { if (await reconcileRazorpay(purchaseId, ref, r.rows[0])) r.rows[0].status = 'paid'; } catch (e) { console.error('[razorpay] could not confirm the payment yet:', e && e.message); }
    }
    if (!r.rows.length || r.rows[0].status !== 'paid') return res.status(402).json({ ok: false, error: 'Payment has not been confirmed yet.' });
    if (ACCOUNTS.enabled && !(await ownsPurchase(req, purchaseId))) return res.status(403).json({ ok: false, code: 'not_entitled', error: 'This purchase belongs to another account.' });
    res.json(grantOf(ref));
  }));

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

  class PaymentEventError extends Error {}

  /* Prices live in pricing/ only: a versioned price book, a quote per buyer, stored on the purchase at checkout. */

  /* Raw body is required for signature verification: any re-serialisation
     changes the bytes and invalidates the HMAC. This must be registered
     BEFORE the global express.json() parser for this path. */
  app.post('/api/payments/webhook',
    express.raw({ type: 'application/json', limit: '1mb' }),
    ah(async (req, res) => {
      if (!Buffer.isBuffer(req.body)) return res.status(415).json({ ok: false, error: 'Unsupported content type' });
      const provider = String(req.get('x-sk-provider') || 'unknown');
      const signature = req.get('x-sk-signature') || '';
      const secret = process.env.PAYMENT_WEBHOOK_SECRET;

      if (!secret) {
        console.error('[webhook] PAYMENT_WEBHOOK_SECRET unset — refusing.');
        return res.status(503).json({ ok: false });
      }

      // 1. Verify the signature over the raw bytes, timing-safely.
      const expected = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
      let signatureOk = false;
      try {
        const a = Buffer.from(signature, 'hex');
        const b = Buffer.from(expected, 'hex');
        signatureOk = a.length === b.length && crypto.timingSafeEqual(a, b);
      } catch { signatureOk = false; }

      let event;
      try { event = JSON.parse(req.body.toString('utf8')); }
      catch { return res.status(400).json({ ok: false, error: 'Malformed payload' }); }

      const payloadHash = crypto.createHash('sha256').update(req.body).digest('hex');
      const eventId = String(event?.id || '');
      if (!eventId) return res.status(400).json({ ok: false, error: 'Missing event id' });

      // 2. Record the event before acting on it. The UNIQUE constraint on
      //    (provider, event_id) is what makes replay impossible: a
      //    duplicate delivery collides here and is acknowledged without
      //    granting anything a second time. Recording rejected signatures
      //    too gives an audit trail of forgery attempts.
      let inserted;
      try {
        inserted = await pool.query(
          `INSERT INTO payment_events (provider, event_id, payload_hash, signature_ok, process_status)
         VALUES ($1,$2,$3,$4,'received')
         ON CONFLICT (provider, event_id) DO NOTHING
         RETURNING id`,
          [provider, eventId, payloadHash, signatureOk]
        );
      } catch (e) {
        return res.status(500).json({ ok: false, error: 'Event log failed' });
      }

      if (inserted.rows.length === 0) {
        // Already seen. Acknowledge so the provider stops retrying.
        return res.json({ ok: true, duplicate: true });
      }
      const eventRowId = inserted.rows[0].id;

      // 3. Only now reject bad signatures — after logging the attempt.
      if (!signatureOk) {
        await pool.query(`UPDATE payment_events SET process_status='ignored', processed_at=NOW() WHERE id=$1`, [eventRowId]);
        return res.status(401).json({ ok: false, error: 'Invalid signature' });
      }

      if (event.type !== 'payment.succeeded') {
        await pool.query(`UPDATE payment_events SET process_status='ignored', processed_at=NOW() WHERE id=$1`, [eventRowId]);
        return res.json({ ok: true, ignored: event.type });
      }

      // 4. Grant, inside a transaction, re-deriving price server-side and
      //    confirming the amount actually captured matches it.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const purchaseRef = event?.data?.reportRef;
        const paid        = Number(event?.data?.amount);

        // Live research purchases. Many buyers share one ref (one per
        // project), so the purchase is marked paid by its OWN id. The
        // generic "WHERE report_ref = $1" below would have marked every
        // pending purchase of that project paid on one buyer's payment.
        if (REF_RE.test(String(purchaseRef || ''))) {
          const purchaseId = String(event?.data?.purchaseId || '');
          if (!/^[0-9a-f-]{36}$/i.test(purchaseId)) throw new PaymentEventError('Missing purchase id');
          // Compare with the price THIS purchase was sold at (stored at
          // checkout), not today's price list.
          const row = await client.query(`SELECT amount FROM report_purchases WHERE id=$1 AND report_ref=$2`, [purchaseId, purchaseRef]);
          const expected = row.rows.length ? Number(row.rows[0].amount) : NaN;
          if (!Number.isFinite(paid) || !Number.isFinite(expected) || paid < expected) {
            await client.query(`UPDATE payment_events SET process_status='failed', processed_at=NOW() WHERE id=$1`, [eventRowId]);
            await client.query('COMMIT');
            return res.status(400).json({ ok: false, error: 'Amount does not match report price' });
          }
          // Same single path as Razorpay's handler and webhook, so the rules
          // for becoming "paid" can never drift apart between providers.
          const settled = await markPurchasePaid(client, { purchaseId, ref: purchaseRef, provider, paymentId: eventId });
          if (!settled) throw new PaymentEventError('No matching pending purchase');
          await client.query(`UPDATE payment_events SET process_status='processed', processed_at=NOW() WHERE id=$1`, [eventRowId]);
          await client.query('COMMIT');
          return res.json({ ok: true });
        }

        // Only ShelterKart research reports are sold. The older purchase type that
        // used a tiered price table can no longer be created (its routes return 410).
        throw new PaymentEventError('Unknown purchase type');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        await pool.query(`UPDATE payment_events SET process_status='failed', processed_at=NOW() WHERE id=$1`, [eventRowId]).catch(() => {});
        return res.status(400).json({ ok: false, error: 'Could not process payment event' });
      } finally {
        client.release();
      }
    })
  );
};
