'use strict';
/**
 * ShelterKart -- refunds.
 *
 * A refund is always in the ORIGINAL currency and the ORIGINAL amount: it reads the purchase, never the current
 * price book or any exchange rate. Tax is reversed in proportion, the sales ledger is adjusted, and the purchase's
 * net revenue is reduced by the net share refunded. A purchase can be refunded in parts, never beyond what was paid.
 * The amount is recorded as pending BEFORE the provider is asked, so a failure afterwards can never let a retry refund it twice;
 * a provider that cannot be reached leaves it counted ('unconfirmed') for an operator to check.
 */
const { adapterFor } = require('./index');
const PRICING = require('../pricing');

class RefundError extends Error { constructor(code, message) { super(message); this.code = code; } }

/**
 * @param db        the database (query)
 * @param amount    major units in the purchase's currency; omitted = everything still refundable
 */
/* Refunds of one purchase run one after another. Each reads what is already refunded, calls the provider, then records the refund: two at once would both
   read the same remainder and both reach the provider. This is a lock inside this server, which is right while there is one instance (as the saved
   investigations already assume); several instances would need a database lock on the purchase row. */
const queues = new Map();
function refundPurchase(args) {
  const key = String(args.purchaseId), run = (queues.get(key) || Promise.resolve()).then(() => refundOnce(args));
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}

async function refundOnce({ db, data, store, purchaseId, amount, reason = '', env = process.env, fetchImpl, now = new Date() }) {
  const r = await db.query(
    `SELECT id, report_ref, amount, currency, status, provider, provider_payment_id, buyer_country, amount_net, tax_amount, net_revenue, quote_id FROM report_purchases WHERE id=$1`, [purchaseId]);
  if (!r.rows.length) throw new RefundError('not_found', 'Purchase not found.');
  const p = r.rows[0];
  if (!['paid', 'refunded'].includes(p.status) || !p.provider_payment_id) throw new RefundError('not_paid', 'Only a paid purchase can be refunded.');
  const gross = Number(p.amount), tax = Number(p.tax_amount || 0), minor = PRICING.minorOf(data, p.currency), m = Math.pow(10, minor);
  const already = await store.refundedTotal(p.id), remaining = Math.round((gross - already) * m) / m;
  if (remaining <= 0) {
    if (p.status === 'paid') await db.query(`UPDATE report_purchases SET status=$2 WHERE id=$1`, [p.id, 'refunded']);
    throw new RefundError('already_refunded', 'This purchase has already been refunded in full.');
  }
  const amt = amount == null ? remaining : Math.round(Number(amount) * m) / m;
  if (!(amt > 0) || amt > remaining + 1e-9) throw new RefundError('exceeds', `Refund must be between 0 and ${remaining} ${p.currency}.`);
  const taxReversed = Math.round(tax * (amt / gross) * m) / m, netPart = Math.round((amt - taxReversed) * m) / m;
  const amountMinor = Math.round(amt * m);
  const adapter = adapterFor({ provider: p.provider });
  if (!adapter) throw new RefundError('no_provider', 'No payment provider is available for this purchase.');
  const hold = await store.reserveRefund({ purchaseId: p.id, amount: amt, currency: p.currency, taxReversed, reason });
  let out;
  try {
    out = await adapter.refund({ paymentId: p.provider_payment_id, amountMinor, notes: { reason: String(reason).slice(0, 100), purchaseId: String(p.id) } }, { env, fetchImpl });
  } catch (e) {
    const refused = (e && e.status >= 400) || (e && e.code === 'not_configured');
    if (refused) { await store.releaseRefund(hold).catch(() => {}); throw e; }
    throw new RefundError('unconfirmed', 'The payment provider did not confirm this refund. The amount stays counted as refunded until an operator checks the provider.');
  }
  try { await store.settleRefund(hold, { providerRef: out.providerRef, status: out.status }); }
  catch (e) { console.error('[refund] the provider refunded purchase ' + p.id + ' (' + out.providerRef + ') but the record could not be completed:', e && e.message); }
  return finishRefund({ db, data, store, p, amt, taxReversed, providerRef: out.providerRef, already, now, remaining });
}

async function finishRefund({ db, data, store, p, amt, taxReversed, providerRef, already, now, remaining }) {
  const gross = Number(p.amount), minor = PRICING.minorOf(data, p.currency), m = Math.pow(10, minor);
  const netPart = Math.round((amt - taxReversed) * m) / m, amountMinor = Math.round(amt * m);
  const full = Math.abs(already + amt - gross) < 1e-9;
  await db.query(`UPDATE report_purchases SET status=$2, net_revenue = COALESCE(net_revenue, 0) - $3 WHERE id=$1`, [p.id, full ? 'refunded' : 'paid', netPart]);
  // A sale the Merchant of Record made was never booked as ShelterKart's, so its refund is not reversed in ShelterKart's ledger either.
  if (p.provider !== 'mor') await PRICING.ledger.recordRefund({ data, store, country: p.buyer_country || 'IN', grossMinor: amountMinor, taxMinor: Math.round(taxReversed * m), currency: p.currency, now });
  await store.addEvent('refund', { quoteId: p.quote_id, ref: p.report_ref, details: { purchaseId: p.id, amount: amt, currency: p.currency, taxReversed, full, providerRef } });
  return { refundId: providerRef, amount: amt, currency: p.currency, taxReversed, remaining: Math.round((remaining - amt) * m) / m, full };
}

const UNCONFIRMED_MIN_AGE_MS = 5 * 60 * 1000;

function resolveRefund(args) {
  return Promise.resolve(args.store.getRefund(args.refundId)).then(row => {
    if (!row) throw new RefundError('not_found', 'Refund not found.');
    const key = String(row.purchaseId), run = (queues.get(key) || Promise.resolve()).then(() => resolveOnce(args));
    const tail = run.catch(() => {});
    queues.set(key, tail);
    tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
    return run;
  });
}

async function resolveOnce({ db, data, store, refundId, outcome, providerRef, minAgeMs = UNCONFIRMED_MIN_AGE_MS, now = new Date() }) {
  if (!['refunded', 'not_refunded'].includes(outcome)) throw new RefundError('bad_outcome', 'Outcome must be refunded or not_refunded.');
  const row = await store.getRefund(refundId);
  if (!row) throw new RefundError('not_found', 'Refund not found.');
  if (row.status !== 'pending') throw new RefundError('not_pending', 'This refund is not waiting for an operator.');
  if (row.createdAt && now.getTime() - new Date(row.createdAt).getTime() < minAgeMs) throw new RefundError('in_flight', 'This refund was recorded a moment ago and may still be with the provider.');
  if (outcome === 'not_refunded') {
    await store.releaseRefund(row.id);
    return { refundId: row.id, purchaseId: row.purchaseId, outcome, amount: row.amount, currency: row.currency };
  }
  const ref = String(providerRef || '').trim().slice(0, 100);
  if (!ref) throw new RefundError('provider_ref_required', 'Give the provider\'s refund reference from its dashboard.');
  const r = await db.query(
    `SELECT id, report_ref, amount, currency, status, provider, provider_payment_id, buyer_country, amount_net, tax_amount, net_revenue, quote_id FROM report_purchases WHERE id=$1`, [row.purchaseId]);
  if (!r.rows.length) throw new RefundError('not_found', 'Purchase not found.');
  const p = r.rows[0], minor = PRICING.minorOf(data, p.currency), m = Math.pow(10, minor);
  const total = await store.refundedTotal(p.id), already = Math.round((total - row.amount) * m) / m;
  await store.settleRefund(row.id, { providerRef: ref, status: 'processed' });
  const out = await finishRefund({ db, data, store, p, amt: row.amount, taxReversed: row.taxReversed, providerRef: ref, already, now, remaining: Math.round((Number(p.amount) - already) * m) / m });
  return { ...out, purchaseId: row.purchaseId, outcome };
}

module.exports = { refundPurchase, resolveRefund, RefundError, UNCONFIRMED_MIN_AGE_MS };
