'use strict';
const { UUID_RE } = require('../../lib/ids');
const rzp = require('../../engine/razorpay');
const { claimEvent, claimExternalEvent, finishEvent } = require('../events');
const { recordProviderRefund } = require('../refunds');
const crypto = require('crypto');
const morEngine = require('../../engine/mor');
const PRICING = require('../../pricing');
const { paywallActive, REF_RE } = require('../../engine/access');

class PaymentEventError extends Error {}

module.exports = function create(c) {
  const { markPurchasePaid, pool, pricingData, pricingStore } = c;

  /* The same purchase paid twice (two checkout tabs, a retried session): the first payment settles it, the second is never unlocked again, but the buyer
     was charged and nothing said so. It is recorded and logged (the error log shows it to the operator) so that one of the two can be refunded. */
  async function flagDuplicatePayment(row, provider, paymentId, details) {
    const r = await pool.query(`SELECT status, provider_payment_id FROM report_purchases WHERE id=$1`, [row.id]);
    const cur = r.rows[0];
    if (!cur || !['paid', 'refunded'].includes(cur.status) || !cur.provider_payment_id || cur.provider_payment_id === paymentId) return false;
    await pricingStore.addEvent('duplicate_payment', { ref: row.report_ref, details: { purchaseId: row.id, provider, firstPaymentId: cur.provider_payment_id, secondPaymentId: paymentId, ...details } });
    console.error(`[payments] purchase ${row.id} was paid twice (${cur.provider_payment_id} and ${paymentId}, ${provider}): refund one of the two.`);
    return true;
  }

  /* How a refund made at the provider ended: booked (or already booked), not ours to book, or refused with a reason an operator must read. */
  async function providerRefundResult(out, done, evt) {
    if (out.outcome === 'in_flight') return { status: 503, body: { ok: false, retry: true } };
    if (out.outcome === 'recorded' || out.outcome === 'already_recorded') { await done('processed'); return { status: 200, body: { ok: true, refund: out.outcome } }; }
    if (out.outcome === 'unmatched') { await done('ignored'); return { status: 200, body: { ok: true, unmatched: true } }; }
    await pricingStore.addEvent('provider_refund_rejected', { details: { ...evt, outcome: out.outcome, purchaseId: out.purchaseId || null } });
    console.error(`[payments] a ${evt.provider} refund event was not booked (${out.outcome}) for purchase ${out.purchaseId || 'unknown'}: check the provider's dashboard against the books.`);
    await done('failed'); return { status: 200, body: { ok: true, rejected: out.outcome } };
  }

  async function razorpayWebhook(req) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return { status: 503, body: { ok: false } };
    if (!Buffer.isBuffer(req.body) || !rzp.verifyWebhookSignature(req.body, req.get('x-razorpay-signature'), secret))
      return { status: 401, body: { ok: false, error: 'Invalid signature' } };
    let event;
    try { event = JSON.parse(req.body.toString('utf8')); } catch { return { status: 400, body: { ok: false } }; }
    const p = rzp.parseWebhook(event);
    if (!p || !p.paymentId) return { status: 200, body: { ok: true, ignored: event && event.event } };

    // One claim per payment (or refund) and event type. A redelivery of an event that already ended does nothing; one that was received
    // and never finished (an error below answers 500, so Razorpay sends it again) is processed again.
    const claim = await claimEvent(pool, 'razorpay', `${p.refundId || p.paymentId}:${p.kind}`, crypto.createHash('sha256').update(req.body).digest('hex'));
    if (!claim.claimed) return { status: 200, body: { ok: true, duplicate: true } };
    const done = status => finishEvent(pool, claim.id, status);
    if (p.kind === 'payment.failed') {
      await pricingStore.addEvent('razorpay_payment_failed', { details: { orderId: p.orderId, paymentId: p.paymentId, code: p.errorCode } });
      await done('processed'); return { status: 200, body: { ok: true, noted: p.kind } };
    }
    if (/^refund\./.test(p.kind)) {
      await pricingStore.addEvent('razorpay_refund_event', { details: { type: p.kind, refundId: p.refundId, paymentId: p.paymentId, amountSubunits: p.amountSubunits, currency: p.currency, status: p.status } });
      if (p.kind !== 'refund.processed') { await done('processed'); return { status: 200, body: { ok: true, noted: p.kind } }; }
      const out = await recordProviderRefund({ db: pool, data: pricingData, store: pricingStore, provider: 'razorpay', paymentId: p.paymentId, providerRef: p.refundId, amountMinor: p.amountSubunits, currency: p.currency });
      return providerRefundResult(out, done, { provider: 'razorpay', refundId: p.refundId, paymentId: p.paymentId, amountMinor: p.amountSubunits, currency: p.currency });
    }

    const q = await pool.query(`SELECT id, report_ref, amount, currency, status FROM report_purchases WHERE provider='razorpay' AND provider_order_id=$1`, [p.orderId]);
    if (!q.rows.length) { await done('ignored'); return { status: 200, body: { ok: true, unknown_order: true } }; }
    const row = q.rows[0];
    let expected;
    try { expected = rzp.toSubunits(row.amount, row.currency); } catch { expected = NaN; }
    // The webhook can only CONFIRM the quote's total. Any difference, even one unit, and nothing unlocks.
    if (p.currency !== row.currency || p.amountSubunits !== expected) {
      await pricingStore.addEvent('webhook_amount_mismatch', { ref: row.report_ref, details: { purchaseId: row.id, expected, got: p.amountSubunits, currency: p.currency, expectedCurrency: row.currency } });
      await done('failed'); return { status: 200, body: { ok: true, mismatch: true } };
    }
    // An authorized payment (auto-capture off) is captured here, for exactly the quote's total in its currency; the payment.captured event that follows settles it.
    if (p.kind === 'payment.authorized') {
      try { await rzp.capturePayment({ paymentId: p.paymentId, amountSubunits: expected, currency: row.currency }, { env: process.env }); }
      catch (e) {
        const said = e && e.detail && String(e.detail.description || '');
        if (e && e.status === 400 && /already.*captured/i.test(said || '')) { await done('processed'); return { status: 200, body: { ok: true, alreadyCaptured: true } }; }
        throw e;
      }
      await done('processed'); return { status: 200, body: { ok: true, captured: true } };
    }
    // A card issued in India can only be charged in rupees: a foreign-currency payment on an Indian card is flagged for review.
    if (p.international === false && row.currency !== 'INR') await pricingStore.addEvent('card_origin_mismatch', { ref: row.report_ref, details: { purchaseId: row.id, currency: row.currency } });
    const settled = await markPurchasePaid(pool, { purchaseId: row.id, ref: row.report_ref, provider: 'razorpay', paymentId: p.paymentId });
    if (!settled) await flagDuplicatePayment(row, 'razorpay', p.paymentId, { amountSubunits: p.amountSubunits, currency: p.currency });
    if (settled && p.feeSubunits != null && row.currency === 'INR') {
      // Net revenue is written ONCE, from the provider's own figure. (Foreign-currency fees settle in rupees at a rate we do not see here: reconcile those from the settlement report.)
      const m = 100, fee = p.feeSubunits / m;
      await pool.query(`UPDATE report_purchases SET provider_fee=$2, net_revenue=amount_net-$2 WHERE id=$1 AND net_revenue IS NULL`, [row.id, fee]);
    }
    await done('processed');
    return { status: 200, body: { ok: true } };
  }

  async function morWebhook(req) {
    const secret = process.env.DODO_WEBHOOK_KEY;
    if (!secret) return { status: 503, body: { ok: false } };
    const headers = { 'webhook-id': req.get('webhook-id'), 'webhook-timestamp': req.get('webhook-timestamp'), 'webhook-signature': req.get('webhook-signature') };
    if (!Buffer.isBuffer(req.body) || !morEngine.verifyWebhook(req.body, headers, secret)) return { status: 401, body: { ok: false, error: 'Invalid signature' } };
    let event;
    try { event = JSON.parse(req.body.toString('utf8')); } catch { return { status: 400, body: { ok: false } }; }
    const p = morEngine.parseWebhook(event);
    if (!p) return { status: 200, body: { ok: true, ignored: event && event.type } };
    const claim = await claimEvent(pool, 'mor', headers['webhook-id'], crypto.createHash('sha256').update(req.body).digest('hex'));
    if (!claim.claimed) return { status: 200, body: { ok: true, duplicate: true } };
    const done = status => finishEvent(pool, claim.id, status);
    if (p.kind === 'failed') await pricingStore.addEvent('mor_payment_failed', { details: { purchaseId: p.purchaseId, paymentId: p.paymentId, type: p.type } });
    if (p.kind === 'refund') await pricingStore.addEvent('mor_refund_event', { details: { type: p.type, paymentId: p.paymentId, amountMinor: p.amountMinor, currency: p.currency, status: p.status } });
    if (p.kind === 'refund' && p.type === 'refund.succeeded' && p.paymentId && p.amountMinor > 0) {
      const out = await recordProviderRefund({ db: pool, data: pricingData, store: pricingStore, provider: 'mor', paymentId: p.paymentId, providerRef: p.refundId || ('mor-event:' + headers['webhook-id']), amountMinor: p.amountMinor, currency: p.currency });
      return providerRefundResult(out, done, { provider: 'mor', refundId: p.refundId || null, paymentId: p.paymentId, amountMinor: p.amountMinor, currency: p.currency });
    }
    if (p.kind !== 'paid') { await done('processed'); return { status: 200, body: { ok: true, noted: p.type } }; }       // failed events and any other refund event are recorded, not acted on
    if (!p.paymentId || !UUID_RE.test(String(p.purchaseId || ''))) {
      await pricingStore.addEvent('mor_unmatched_payment', { details: { paymentId: p.paymentId, type: p.type } });
      await done('ignored'); return { status: 200, body: { ok: true, unmatched: true } };
    }
    const q = await pool.query(`SELECT id, report_ref, amount, currency, status FROM report_purchases WHERE id=$1 AND provider='mor'`, [p.purchaseId]);
    if (!q.rows.length) { await done('ignored'); return { status: 200, body: { ok: true, unknown_purchase: true } }; }
    const row = q.rows[0], expected = PRICING.toMinor(pricingData, Number(row.amount), row.currency);
    // The webhook can only CONFIRM the quote's total. Any difference, even one unit, and nothing unlocks. (A mismatch usually means the
    // merchant's product is not tax-inclusive: fix the product. The buyer is NOT unlocked and the event is recorded for support.)
    if (p.currency !== row.currency || p.amountMinor !== expected) {
      console.error(`[mor] amount mismatch on purchase ${row.id}: expected ${expected} ${row.currency}, got ${p.amountMinor} ${p.currency}`);
      await pricingStore.addEvent('webhook_amount_mismatch', { ref: row.report_ref, details: { purchaseId: row.id, expected, got: p.amountMinor, currency: p.currency, expectedCurrency: row.currency } });
      await done('failed'); return { status: 200, body: { ok: true, mismatch: true } };
    }
    const settled = await markPurchasePaid(pool, { purchaseId: row.id, ref: row.report_ref, provider: 'mor', paymentId: p.paymentId });
    if (!settled) await flagDuplicatePayment(row, 'mor', p.paymentId, { amountMinor: p.amountMinor, currency: p.currency });
    if (settled && p.taxMinor != null) await pricingStore.addEvent('mor_tax_collected', { ref: row.report_ref, details: { purchaseId: row.id, taxMinor: p.taxMinor, currency: row.currency } });
    await done('processed');
    return { status: 200, body: { ok: true } };
  }

  async function providerWebhook(req) {
      if (!Buffer.isBuffer(req.body)) return { status: 415, body: { ok: false, error: 'Unsupported content type' } };
      const provider = /^[a-z0-9_-]{1,30}$/.test(String(req.get('x-sk-provider') || '')) ? String(req.get('x-sk-provider')) : 'unknown';
      const signature = req.get('x-sk-signature') || '';
      const secret = process.env.PAYMENT_WEBHOOK_SECRET;

      if (!secret) {
        console.error('[webhook] PAYMENT_WEBHOOK_SECRET unset — refusing.');
        return { status: 503, body: { ok: false } };
      }

      // 1. Verify the signature over the raw bytes, timing-safely.
      const expected = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
      let signatureOk = false;
      try {
        const a = Buffer.from(signature, 'hex');
        const b = Buffer.from(expected, 'hex');
        signatureOk = a.length === b.length && crypto.timingSafeEqual(a, b);
      } catch { signatureOk = false; }

      // A request that is not signed with our secret is refused HERE, before anything is parsed or written. It used to be recorded first, "for an
      // audit trail of forgery attempts", which let anyone who could reach the route fill payment_events with unlimited rows (SHEL-37). Refusals are
      // visible in the server log and are rate-limited per address (middleware/limiters.js).
      if (!signatureOk) { console.warn('[webhook] refused a request with a missing or wrong signature (' + provider.slice(0, 40) + ')'); return { status: 401, body: { ok: false, error: 'Invalid signature' } }; }

      let event;
      try { event = JSON.parse(req.body.toString('utf8')); }
      catch { return { status: 400, body: { ok: false, error: 'Malformed payload' } }; }

      const payloadHash = crypto.createHash('sha256').update(req.body).digest('hex');
      const eventId = String(event?.id || '');
      if (!eventId) return { status: 400, body: { ok: false, error: 'Missing event id' } };

      // 2. Record the event before acting on it. The UNIQUE constraint on
      //    (provider, event_id) is what makes replay impossible: a
      //    duplicate delivery collides here and is acknowledged without
      //    granting anything a second time. Only signed events get here.
      let claim;
      try { claim = await claimExternalEvent(pool, provider, eventId, payloadHash); }
      catch (e) { return { status: 500, body: { ok: false, error: 'Event log failed' } }; }

      if (!claim.claimed) {
        // Already settled, or another delivery is working on it. A delivery that was received and never finished is claimed again, so a failure is retried.
        return { status: 200, body: { ok: true, duplicate: true } };
      }
      const eventRowId = claim.id;

      if (event.type !== 'payment.succeeded') {
        await finishEvent(pool, eventRowId, 'ignored');
        return { status: 200, body: { ok: true, ignored: event.type } };
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
          if (!UUID_RE.test(purchaseId)) throw new PaymentEventError('Missing purchase id');
          // Compare with the price THIS purchase was sold at (stored at
          // checkout), not today's price list.
          const row = await client.query(`SELECT amount, currency FROM report_purchases WHERE id=$1 AND report_ref=$2`, [purchaseId, purchaseRef]);
          const expected = row.rows.length ? Number(row.rows[0].amount) : NaN;
          const currency = row.rows.length ? String(row.rows[0].currency || '').toUpperCase() : '';
          if (!Number.isFinite(paid) || !Number.isFinite(expected) || paid < expected || String(event?.data?.currency || '').toUpperCase() !== currency) {
            await finishEvent(client, eventRowId, 'failed');
            await client.query('COMMIT');
            return { status: 400, body: { ok: false, error: 'Amount does not match report price' } };
          }
          // Same single path as Razorpay's handler and webhook, so the rules
          // for becoming "paid" can never drift apart between providers.
          const settled = await markPurchasePaid(client, { purchaseId, ref: purchaseRef, provider, paymentId: eventId });
          if (!settled) throw new PaymentEventError('No matching pending purchase');
          await finishEvent(client, eventRowId, 'processed');
          await client.query('COMMIT');
          return { status: 200, body: { ok: true } };
        }

        // Only ShelterKart research reports are sold. The older purchase type that
        // used a tiered price table can no longer be created (its routes return 410).
        throw new PaymentEventError('Unknown purchase type');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        if (e instanceof PaymentEventError) {
          await finishEvent(pool, eventRowId, 'failed').catch(() => {});
          return { status: 400, body: { ok: false, error: 'Could not process payment event' } };
        }
        console.error('[webhook] a signed payment event could not be processed and will be redelivered:', e && e.message);
        return { status: 500, body: { ok: false, error: 'Could not process payment event' } };
      } finally {
        client.release();
      }
    }

  return { razorpayWebhook, morWebhook, providerWebhook };
};
