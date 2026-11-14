'use strict';
const { UUID_RE } = require('../lib/ids');
const { pickLanguage } = require('../engine/languages');
const TRANSLATE = require('../engine/translate');
const { paywallActive, previewOf, tokenInfo } = require('../engine/access');
const PRICING = require('../pricing');
const PAYMENTS = require('../payments');
const morEngine = require('../engine/mor');
const rzp = require('../engine/razorpay');

module.exports = function setup(c) {
  const { ACCOUNTS, SITE_BASE, pool, track } = c;
  const pricingData = PRICING.load(process.env);
  { const problems = PRICING.validate(pricingData); if (problems.length) console.error('[pricing] data problems:\n  ' + problems.join('\n  ')); }
  const pricingStore = PRICING.makeStore({ pool: (process.env.DATABASE_URL || process.env.PRICING_STORE === 'pg') ? pool : null });
  { const on = [...pricingData.countries.keys()].filter(c => PRICING.saleStatus(pricingData, c).onSale);
    if (process.env.NODE_ENV !== 'test') console.log('[pricing] book ' + pricingData.book.version + '; on sale in ' + on.length + ' countries: ' + (on.join(' ') || 'none (set GSTIN for India; RAZORPAY_INTERNATIONAL=true and a tax profile for others)'));
    const fx = require('../engine/readiness').fxStatus(pricingData, process.env);
    if (fx.stale && process.env.NODE_ENV !== 'test') console.warn(fx.ageDays == null ? '[pricing] the price book has no exchange-rate date' : `[pricing] the price book's exchange rates are ${fx.ageDays} days old (from ${fx.asOf}; the limit is ${fx.maxAgeDays}). Run tools/fetch_fx.js and review the candidate.`); }

  /** The buyer for this request: their own selection, else the network's suggestion. A country that has reached its tax
   *  registration threshold stops selling until registration is configured. */
  async function buyerOf(req, { billing } = {}) {
    const body = req.body || {}, query = req.query || {};
    const b = PRICING.resolveBuyer(pricingData, { selected: body.country || query.country, network: PRICING.networkCountry(req.headers || {}), billing });
    if (b.onSale && await PRICING.ledger.thresholdReached({ data: pricingData, store: pricingStore, country: b.country })) return { ...b, onSale: false, reason: 'threshold_reached' };
    return b;
  }
  const sessionOf = req => String((req.body && req.body.session) || (req.query && req.query.session) || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'anon';

  /* The one place a purchase becomes paid. Both the checkout handler and
     the webhook come through here, so whichever arrives first settles it
     and the other finds nothing left to do. Keyed by the purchase's own
     id, never by report ref, which many buyers of one project share. */
  async function markPurchasePaid(db, { purchaseId, ref, provider, paymentId }, ctx = {}) {
    const r = await db.query(
      `UPDATE report_purchases SET status='paid', provider_payment_id=$3, paid_at=NOW()
      WHERE id=$1 AND report_ref=$2 AND status='pending_payment' RETURNING id, amount, currency, quote_id, buyer_country, billing_country, buyer_kind, tax_id`,
      [purchaseId, ref, paymentId]);
    if (r.rows.length) {
      // Recorded only here, where a purchase is actually settled, so revenue
      // on the dashboard can never exceed what was really paid.
      // The paid event carries the market and the source saved at checkout; 'provider:src' marks a payment whose source is known.
      let a = {}; try { const s = await db.query(`SELECT attribution FROM report_purchases WHERE id=$1`, [purchaseId]); a = (s.rows[0] && s.rows[0].attribution) || {}; if (typeof a === 'string') a = JSON.parse(a); } catch { a = {}; }
      track('purchase_paid', ctx.req, { ref, value: Number(r.rows[0].amount), currency: r.rows[0].currency, detail: provider + (a.captured ? ':src' : ''), market: a.market || '', ...(a.captured ? { utm: a.utm, referrer: a.referrer } : {}) }, { serverSide: !ctx.req });
      await db.query(`INSERT INTO audit_log (actor, action, object_type, object_id, reason) VALUES ('system','RESEARCH_PURCHASE_PAID','report_purchase',$1,$2)`,
        [purchaseId, `${provider} payment ${paymentId}`]);
      await recordSale(r.rows[0]);
      let payer = null;
      if (ACCOUNTS.enabled) { try { const u = await db.query(`SELECT u.email FROM report_purchases p JOIN users u ON u.id = p.user_id WHERE p.id=$1`, [purchaseId]); payer = (u.rows[0] && u.rows[0].email) || null; } catch { payer = null; } }
      if (payer && provider !== 'mor') require('../engine/receipt').sendReceipt(process.env, { to: payer, ref, amount: r.rows[0].amount, currency: r.rows[0].currency, purchaseId, site: SITE_BASE });
      try { c.onReportPaid(ref, payer, purchaseId); } catch (e) { console.error('[investigate] could not continue a paid report:', e && e.message); }
    }
    return r.rows.length === 1;
  }

  /* What a settled sale adds to the books: the country's sales ledger (tax thresholds) and an invoice with a gap-free number.
     A failure here never undoes a payment that really happened: it is logged and recorded for follow-up. */
  async function recordSale(row) {
    try {
      const q = row.quote_id ? await pricingStore.getQuote(row.quote_id) : null;
      if (!q) return;
      // Where the Merchant of Record is the seller, it issues the buyer's tax invoice and collects the tax. ShelterKart is not the seller
      // there: it books no sale in that country, issues no second invoice, and counts nothing toward a registration threshold (which would
      // raise false "register now" alerts). An audit event keeps the record.
      if (q.taxBy === 'merchant_of_record') {
        await pricingStore.addEvent('sale_via_merchant', { quoteId: q.id, ref: q.ref, details: { purchaseId: row.id, country: q.buyer.country, currency: q.currency, grossMinor: q.grossMinor } });
        return;
      }
      await PRICING.ledger.recordSale({ data: pricingData, store: pricingStore, country: q.buyer.country, grossMinor: q.grossMinor, taxMinor: q.taxMinor, currency: q.currency });
      await PRICING.invoice.issueInvoice({ data: pricingData, store: pricingStore, purchase: { id: row.id, billing_country: row.billing_country, buyer_kind: row.buyer_kind, tax_id: row.tax_id }, quote: q });
      await PRICING.ledger.checkThresholds({ data: pricingData, store: pricingStore, notify: async a => console.warn('[tax] ' + a.name + ' has reached ' + a.pct + '% of its registration threshold (' + a.level + ')') });
    } catch (e) {
      console.error('[pricing] settlement records failed for purchase ' + row.id + ':', e && e.message);
      try { await pricingStore.addEvent('settlement_records_failed', { details: { purchaseId: row.id, error: String(e && e.message).slice(0, 200) } }); } catch {}
    }
  }

  /** Full brief if the paywall is off or the caller holds a valid token for
   *  this brief; otherwise the allow-listed preview. Decided server-side. */
  /* The report in the reader's language, AFTER the paywall has decided what they
     may see: a preview is translated as a preview, never widened. Translation
     can only fail into English; it never fails the request (engine/translate.js). */
  async function localize(gated, req) {
    const lang = pickLanguage((req.body && req.body.lang) || (req.query && req.query.lang));
    if (lang === 'en') return gated;
    return { ...gated, brief: await TRANSLATE.translateBrief(gated.brief, lang) };
  }
  /* Does this access token open this report RIGHT NOW? It must be genuine, unexpired, and carry the purchase it was bought with, and that purchase must
     still be paid: a refund ends the access at once, not after the token's 30 days. A token without a purchase (older code) is not honoured.
     Any doubt, including a database error, is a no.
     Only used when accounts are off; with accounts the purchase itself is the entitlement (ACCOUNTS.entitled). */
  async function tokenGrants(token, ref) {
    const t = tokenInfo(token, ref, process.env.ACCESS_TOKEN_SECRET);
    if (!t || !t.pid || !UUID_RE.test(t.pid)) return false;
    try { const r = await pool.query(`SELECT status FROM report_purchases WHERE id=$1 AND report_ref=$2`, [t.pid, ref]); return Boolean(r.rows[0]) && r.rows[0].status === 'paid'; }
    catch { return false; }
  }
  async function gateBrief(brief, req) {
    const active = paywallActive(process.env);
    // The fee for THIS buyer: set by the property and the evidence depth, read in the buyer's currency (pricing/quote.js).
    // Nothing is stored or locked here; a quote is issued when the buyer unlocks.
    const fee = PRICING.previewFee(pricingData, brief, await buyerOf(req));
    const paywall = active ? { active: true, price: fee.price, currency: fee.currency, depth: fee.depth, depthLabel: fee.depthLabel, basis: fee.basis,
      fee: { net: fee.net, tax: fee.tax, taxName: fee.taxName, taxRateBps: fee.taxRateBps, taxInclusive: fee.taxInclusive }, buyer: fee.buyer, priceBookVersion: fee.priceBookVersion } : { active: false };
    const open = !active || (ACCOUNTS.enabled ? await ACCOUNTS.entitled(req, brief.ref) : await tokenGrants(req.get('x-report-access'), brief.ref));
    if (open) {
      // The contact on a report is whoever unlocked it, kept for delivery and corrections: another buyer of the same report must never read it.
      const full = { ...brief, locked: false };
      delete full.contact;
      return { brief: full, paywall };
    }
    return { brief: previewOf(brief), paywall };
  }

  /* The Merchant of Record's hosted checkout for a purchase. The buyer is sent to the merchant, pays there (the merchant adds and
     collects any tax, included in the total), and comes back to ?sk_ref=...&sk_purchase=..., where the page confirms the payment.
     A session is single-use, so a retry gets a fresh one for the same pending purchase. */
  function startMor(quote, purchaseId, billingCountry) {
    const base = require('../lib/origins').returnBase(process.env);
    if (!base) throw new Error('PUBLIC_BASE_URL (or PAYMENT_RETURN_BASE) is not set: the merchant checkout needs a return address');
    const ref = encodeURIComponent(quote.ref);
    return PAYMENTS.PROVIDERS.mor.createCheckout(quote, { purchaseId, env: process.env, billingCountry,
      productId: (pricingData.morProducts || {})[quote.currency], returnUrl: `${base}/?sk_ref=${ref}&sk_purchase=${encodeURIComponent(purchaseId)}`, cancelUrl: `${base}/?sk_ref=${ref}` });
  }

  /* Settle a pending merchant purchase from the merchant's OWN records, not from anything the browser or a webhook claimed:
     the session says which payment belongs to it, and the payment says what was charged. Used when the buyer comes back before
     the webhook has arrived, or when a webhook arrives without its metadata. Returns true when the purchase is now paid. */
  async function reconcileMor(purchaseId, ref, row) {
    const s = await morEngine.getSession(row.provider_order_id, { env: process.env });
    if (!s || s.payment_status !== 'succeeded' || !s.payment_id) return false;
    const pay = await morEngine.getPayment(s.payment_id, { env: process.env });
    const expected = PRICING.toMinor(pricingData, Number(row.amount), row.currency);
    if (!pay || pay.status !== 'succeeded' || pay.currency !== row.currency || Number(pay.total_amount) !== expected) {
      await pricingStore.addEvent('webhook_amount_mismatch', { ref, details: { purchaseId, expected, got: pay && pay.total_amount, currency: pay && pay.currency, expectedCurrency: row.currency, via: 'reconcile' } });
      return false;
    }
    return markPurchasePaid(pool, { purchaseId, ref, provider: 'mor', paymentId: s.payment_id });
  }

  /* The buyer came back and the webhook has not settled the purchase yet (or never will): ask Razorpay about OUR order. Only a payment on that
     order, for exactly the quote's total in its currency, settles it; an authorized one is captured first. Mirrors reconcileMor. */
  async function reconcileRazorpay(purchaseId, ref, row) {
    const expected = rzp.toSubunits(row.amount, row.currency);
    const items = await rzp.fetchOrderPayments(row.provider_order_id, { env: process.env });
    const m = rzp.matchPayment(items, { amountSubunits: expected, currency: row.currency });
    if (!m) {
      const odd = items.find(x => x && (x.status === 'captured' || x.status === 'authorized'));
      if (odd) await pricingStore.addEvent('webhook_amount_mismatch', { ref, details: { purchaseId, expected, got: Number(odd.amount), currency: odd.currency, expectedCurrency: row.currency, via: 'reconcile' } });
      return false;
    }
    if (m.needsCapture) await rzp.capturePayment({ paymentId: m.payment.id, amountSubunits: expected, currency: row.currency }, { env: process.env });
    return markPurchasePaid(pool, { purchaseId, ref, provider: 'razorpay', paymentId: m.payment.id });
  }
  Object.assign(c, { buyerOf, gateBrief, tokenGrants, localize, markPurchasePaid, pricingData, pricingStore, reconcileMor, reconcileRazorpay, sessionOf, startMor });
};
