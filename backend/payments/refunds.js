'use strict';
/**
 * ShelterKart -- refunds.
 *
 * A refund is always in the ORIGINAL currency and the ORIGINAL amount: it reads the purchase, never the current
 * price book or any exchange rate. Tax is reversed in proportion, the sales ledger is adjusted, and the purchase's
 * net revenue is reduced by the net share refunded. A purchase can be refunded in parts, never beyond what was paid.
 */
const { adapterFor } = require('./index');
const PRICING = require('../pricing');

class RefundError extends Error { constructor(code, message) { super(message); this.code = code; } }

/**
 * @param db        the database (query)
 * @param amount    major units in the purchase's currency; omitted = everything still refundable
 */
async function refundPurchase({ db, data, store, purchaseId, amount, reason = '', env = process.env, fetchImpl, now = new Date() }) {
  const r = await db.query(
    `SELECT id, report_ref, amount, currency, status, provider, provider_payment_id, buyer_country, amount_net, tax_amount, net_revenue, quote_id FROM report_purchases WHERE id=$1`, [purchaseId]);
  if (!r.rows.length) throw new RefundError('not_found', 'Purchase not found.');
  const p = r.rows[0];
  if (!['paid', 'refunded'].includes(p.status) || !p.provider_payment_id) throw new RefundError('not_paid', 'Only a paid purchase can be refunded.');
  const gross = Number(p.amount), tax = Number(p.tax_amount || 0), minor = PRICING.minorOf(data, p.currency), m = Math.pow(10, minor);
  const already = await store.refundedTotal(p.id), remaining = Math.round((gross - already) * m) / m;
  if (remaining <= 0) throw new RefundError('already_refunded', 'This purchase has already been refunded in full.');
  const amt = amount == null ? remaining : Math.round(Number(amount) * m) / m;
  if (!(amt > 0) || amt > remaining + 1e-9) throw new RefundError('exceeds', `Refund must be between 0 and ${remaining} ${p.currency}.`);
  const taxReversed = Math.round(tax * (amt / gross) * m) / m, netPart = Math.round((amt - taxReversed) * m) / m;
  const amountMinor = Math.round(amt * m);
  const adapter = adapterFor({ provider: p.provider });
  if (!adapter) throw new RefundError('no_provider', 'No payment provider is available for this purchase.');
  const out = await adapter.refund({ paymentId: p.provider_payment_id, amountMinor, notes: { reason: String(reason).slice(0, 100), purchaseId: String(p.id) } }, { env, fetchImpl });
  await store.saveRefund({ purchaseId: p.id, amount: amt, currency: p.currency, taxReversed, reason, providerRef: out.providerRef, status: out.status });
  const full = Math.abs(already + amt - gross) < 1e-9;
  await db.query(`UPDATE report_purchases SET status=$2, net_revenue = COALESCE(net_revenue, 0) - $3 WHERE id=$1`, [p.id, full ? 'refunded' : 'paid', netPart]);
  // A sale the Merchant of Record made was never booked as ShelterKart's, so its refund is not reversed in ShelterKart's ledger either.
  if (p.provider !== 'mor') await PRICING.ledger.recordRefund({ data, store, country: p.buyer_country || 'IN', grossMinor: amountMinor, taxMinor: Math.round(taxReversed * m), currency: p.currency, now });
  await store.addEvent('refund', { quoteId: p.quote_id, ref: p.report_ref, details: { purchaseId: p.id, amount: amt, currency: p.currency, taxReversed, full, providerRef: out.providerRef } });
  return { refundId: out.providerRef, amount: amt, currency: p.currency, taxReversed, remaining: Math.round((remaining - amt) * m) / m, full };
}

module.exports = { refundPurchase, RefundError };
