'use strict';
const { paywallActive, REF_RE } = require('../../engine/access');
const rzp = require('../../engine/razorpay');
const PRICING = require('../../pricing');
const { getByRefAsync } = require('../../engine/research');
const PAYMENTS = require('..');
const ANALYTICS = require('../../engine/analytics');
const { pickLanguage } = require('../../engine/languages');

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

module.exports = function create(c) {
  const { ACCOUNTS, buyerOf, pool, pricingData, pricingStore, startMor, track } = c;

  async function start(req) {
    if (!paywallActive(process.env)) return { status: 503, body: { ok: false, error: 'Payments are not enabled yet.' } };
    const { ref, idempotencyKey, quoteId, billingCountry, buyerKind, taxId } = req.body || {};
    if (!REF_RE.test(String(ref || ''))) return { status: 400, body: { ok: false, error: 'Unknown report reference.' } };
    if (!IDEMPOTENCY_KEY_RE.test(String(idempotencyKey || '')))
      return { status: 400, body: { ok: false, error: 'Missing or invalid idempotency key.' } };

    // A retried checkout -- the same key seen before -- returns the SAME
    // purchase and order rather than starting a second one. This is the
    // whole fix: nothing below this block runs for a genuine retry.
    const USED = { status: 409, body: { ok: false, error: 'This checkout attempt has already been used. Please start again.' } };
    // A key is only a retry of the same attempt: for the same report and, with accounts on, the same signed-in buyer. Anything else is somebody
    // else's key (or a client bug) and must not hand back that purchase's order.
    const notMine = async row => {
      if (row.report_ref !== ref) return true;
      if (ACCOUNTS.enabled && row.user_id) { const owner = await ACCOUNTS.user(req).catch(() => null); if (!owner || owner.id !== row.user_id) return true; }
      return false;
    };
    const existing = await pool.query(
      `SELECT id, report_ref, user_id, amount, currency, provider, provider_order_id, status, quote_id, billing_country FROM report_purchases WHERE idempotency_key=$1`,
      [idempotencyKey]);
    if (existing.rows.length) {
      const row = existing.rows[0];
      if (await notMine(row)) return USED;
      if (row.status !== 'pending_payment' || !row.provider_order_id) {
        // Already paid, refunded, or the order step never completed last
        // time -- not a safe thing to silently hand back as if it were new.
        return { status: 409, body: { ok: false, error: 'This checkout attempt has already been used. Please start again.' } };
      }
      if (row.provider === 'mor') {
        // A merchant checkout link is single-use: a retry of the same attempt opens a fresh session for the SAME pending purchase.
        const q0 = await pricingStore.getQuote(row.quote_id);
        if (!q0) return { status: 409, body: { ok: false, error: 'This checkout attempt has already been used. Please start again.' } };
        try {
          const o = await startMor(q0, row.id, row.billing_country || q0.buyer.country);
          await pool.query(`UPDATE report_purchases SET provider_order_id=$2 WHERE id=$1`, [row.id, o.orderId]);
          return { status: 200, body: { ok: true, purchaseId: row.id, amount: Number(row.amount), currency: row.currency, quoteId: q0.id, mor: { checkoutUrl: o.checkoutUrl } } };
        } catch (e) { console.error('[checkout] merchant session failed', e.message); return { status: 503, body: { ok: false, error: 'Payment could not be started right now. Please try again in a moment.' } }; }
      }
      return { status: 200, body: { ok: true, purchaseId: row.id, amount: Number(row.amount), currency: row.currency,
        razorpay: { keyId: process.env.RAZORPAY_KEY_ID, orderId: row.provider_order_id,
                    amountSubunits: rzp.toSubunits(row.amount, row.currency) } } };
    }

    // The quote the buyer reviewed and confirmed. Its total is what is charged: never a number recomputed here,
    // and never one the browser sent. A refused quote asks the page to show the current price again.
    if (!/^q_[0-9a-f]{20}$/.test(String(quoteId || ''))) return { status: 400, body: { ok: false, code: 'quote_required', error: 'Please review your price before paying.' } };
    const quote = await pricingStore.getQuote(quoteId);
    if (!quote || quote.ref !== ref) return { status: 404, body: { ok: false, code: 'quote_unknown', requote: true, error: 'That price is no longer available. Please review the current price.' } };
    const verdict = PRICING.verifyQuote(quote, process.env);
    if (!verdict.ok) {
      await pricingStore.addEvent('quote_refused', { quoteId, ref, details: { reason: verdict.reason } });
      const why = { expired: 'This price has expired. Please review the current price.', superseded: 'A newer price replaced this one. Please review it.', used: 'This price was already used. Please review the current price.', signature: 'This price could not be verified.' }[verdict.reason];
      return { status: verdict.reason === 'signature' ? 400 : 409, body: { ok: false, code: 'quote_' + verdict.reason, requote: verdict.reason !== 'signature', error: why } };
    }
    // Verify the country before any money moves. The billing country decides tax (and, for a card issued in India, that the
    // charge must be in rupees). If it differs from the quote, the buyer sees the new total and confirms it first.
    const billing = PRICING.cleanCode(billingCountry);
    if (!billing) return { status: 400, body: { ok: false, code: 'billing_required', error: 'Please confirm your billing country.' } };
    if (billing !== quote.buyer.country) {
      const reportBrief = await getByRefAsync(ref);
      if (!reportBrief) return { status: 404, body: { ok: false, error: 'This report is no longer available. Search again, then unlock the new report.' } };
      const nb = await buyerOf({ body: { country: billing }, headers: req.headers }, { billing });
      await pricingStore.addEvent('billing_mismatch', { quoteId, ref, details: { quoted: quote.buyer.country, billing, onSale: nb.onSale } });
      if (!nb.onSale) return { status: 409, body: { ok: false, code: 'not_on_sale', reason: nb.reason, country: billing, error: 'Reports are not on sale in that country yet.' } };
      const nq = await PRICING.issueQuote({ data: pricingData, store: pricingStore, brief: reportBrief, buyer: nb, session: quote.session, supersedes: quote.id, details: { trigger: 'billing_mismatch' } });
      await pricingStore.addEvent('requote', { quoteId: nq.id, ref, details: { from: quote.id, previous: { country: quote.buyer.country, currency: quote.currency, grossMinor: quote.grossMinor } } });
      return { status: 409, body: { ok: false, code: 'billing_country', requote: true, error: 'Your billing country differs from the price you were shown.',
        previous: { country: quote.buyer.country, currency: quote.currency, gross: quote.gross }, quote: PRICING.publicQuote(nq) } };
    }
    const route = PRICING.routeFor(pricingData, quote.buyer.country, quote.currency), adapter = PAYMENTS.adapterFor(route);
    if (!adapter) return { status: 503, body: { ok: false, code: 'not_on_sale', reason: 'no_payment_route', error: 'Reports are not on sale in your country yet.' } };
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
        catch (e2) { console.error('[accounts] purchase owner not saved:', e2 && e2.message); return { status: 503, body: { ok: false, error: 'Payment could not be started right now. Please try again.' } }; }
      }
    } catch (e) {
      // A concurrent request with the same key beat this one to the insert
      // -- the unique index caught it. Treat it the same as the read-first
      // path above: fetch and return what the winner created.
      if (e && e.code === '23505') {
        const again = await pool.query(
          `SELECT id, report_ref, user_id, amount, currency, provider_order_id FROM report_purchases WHERE idempotency_key=$1`, [idempotencyKey]);
        const row = again.rows[0];
        if (row && await notMine(row)) return USED;
        if (row && row.provider_order_id) {
          return { status: 200, body: { ok: true, purchaseId: row.id, amount: Number(row.amount), currency: row.currency,
            razorpay: { keyId: process.env.RAZORPAY_KEY_ID, orderId: row.provider_order_id,
                        amountSubunits: rzp.toSubunits(row.amount, row.currency) } } };
        }
        if (row) return { status: 409, body: { ok: false, code: 'in_progress', error: 'This payment is being set up. Please try again in a moment.' } };
      }
      throw e;
    }
    // The quote is verified above and taken here, in one atomic step: two checkouts at once with the same quote and different keys cannot both have it.
    // The loser's purchase row has no order yet and is removed.
    if (!(await pricingStore.claimQuote(quote.id))) {
      await pool.query(`DELETE FROM report_purchases WHERE id=$1 AND status='pending_payment' AND provider_order_id IS NULL`, [purchaseId]).catch(e => console.error('[checkout] could not remove the unused purchase:', e && e.message));
      return { status: 409, body: { ok: false, code: 'quote_used', requote: true, error: 'This price was already used. Please review the current price.' } };
    }

    let order;
    try {
      // The amount is the quote's gross total, set on the server -- never anything the browser sent.
      order = adapter.id === 'mor' ? await startMor(quote, purchaseId, billing) : await adapter.createCheckout(quote, { purchaseId, env: process.env, billingCountry: billing });
    } catch (e) {
      console.error('[checkout] provider order failed', e.message);
      return { status: 503, body: { ok: false, error: 'Payment could not be started right now. Please try again in a moment.' } };
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
    if (adapter.id === 'mor') return { status: 200, body: { ok: true, purchaseId, amount: quote.gross, currency: quote.currency, quoteId: quote.id, mor: { checkoutUrl: order.checkoutUrl } } };
    return { status: 200, body: { ok: true, purchaseId, amount: quote.gross, currency: quote.currency, quoteId: quote.id,
               razorpay: { keyId: order.publicKey, orderId: order.orderId, amountSubunits: order.amountSubunits } } };
  }

  return { start };
};
