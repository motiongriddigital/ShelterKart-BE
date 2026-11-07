'use strict';
const rzp = require('../../engine/razorpay');
const { claimEvent, finishEvent } = require('../events');
const crypto = require('crypto');
const morEngine = require('../../engine/mor');
const PRICING = require('../../pricing');
const { paywallActive, REF_RE } = require('../../engine/access');

class PaymentEventError extends Error {}

module.exports = function create(c) {
  const { markPurchasePaid, pool, pricingData, pricingStore } = c;

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
      await done('processed'); return { status: 200, body: { ok: true, noted: p.kind } };
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
      await rzp.capturePayment({ paymentId: p.paymentId, amountSubunits: expected, currency: row.currency }, { env: process.env });
      await done('processed'); return { status: 200, body: { ok: true, captured: true } };
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
    if (p.kind !== 'paid') { await done('processed'); return { status: 200, body: { ok: true, noted: p.type } }; }       // failed and refund events are recorded, not acted on here
    if (!p.paymentId || !/^[0-9a-f-]{36}$/i.test(String(p.purchaseId || ''))) {
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
    await markPurchasePaid(pool, { purchaseId: row.id, ref: row.report_ref, provider: 'mor', paymentId: p.paymentId });
    if (p.taxMinor != null) await pricingStore.addEvent('mor_tax_collected', { ref: row.report_ref, details: { purchaseId: row.id, taxMinor: p.taxMinor, currency: row.currency } });
    await done('processed');
    return { status: 200, body: { ok: true } };
  }

  async function providerWebhook(req) {
      if (!Buffer.isBuffer(req.body)) return { status: 415, body: { ok: false, error: 'Unsupported content type' } };
      const provider = String(req.get('x-sk-provider') || 'unknown');
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

      let event;
      try { event = JSON.parse(req.body.toString('utf8')); }
      catch { return { status: 400, body: { ok: false, error: 'Malformed payload' } }; }

      const payloadHash = crypto.createHash('sha256').update(req.body).digest('hex');
      const eventId = String(event?.id || '');
      if (!eventId) return { status: 400, body: { ok: false, error: 'Missing event id' } };

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
        return { status: 500, body: { ok: false, error: 'Event log failed' } };
      }

      if (inserted.rows.length === 0) {
        // Already seen. Acknowledge so the provider stops retrying.
        return { status: 200, body: { ok: true, duplicate: true } };
      }
      const eventRowId = inserted.rows[0].id;

      // 3. Only now reject bad signatures — after logging the attempt.
      if (!signatureOk) {
        await pool.query(`UPDATE payment_events SET process_status='ignored', processed_at=NOW() WHERE id=$1`, [eventRowId]);
        return { status: 401, body: { ok: false, error: 'Invalid signature' } };
      }

      if (event.type !== 'payment.succeeded') {
        await pool.query(`UPDATE payment_events SET process_status='ignored', processed_at=NOW() WHERE id=$1`, [eventRowId]);
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
          if (!/^[0-9a-f-]{36}$/i.test(purchaseId)) throw new PaymentEventError('Missing purchase id');
          // Compare with the price THIS purchase was sold at (stored at
          // checkout), not today's price list.
          const row = await client.query(`SELECT amount FROM report_purchases WHERE id=$1 AND report_ref=$2`, [purchaseId, purchaseRef]);
          const expected = row.rows.length ? Number(row.rows[0].amount) : NaN;
          if (!Number.isFinite(paid) || !Number.isFinite(expected) || paid < expected) {
            await client.query(`UPDATE payment_events SET process_status='failed', processed_at=NOW() WHERE id=$1`, [eventRowId]);
            await client.query('COMMIT');
            return { status: 400, body: { ok: false, error: 'Amount does not match report price' } };
          }
          // Same single path as Razorpay's handler and webhook, so the rules
          // for becoming "paid" can never drift apart between providers.
          const settled = await markPurchasePaid(client, { purchaseId, ref: purchaseRef, provider, paymentId: eventId });
          if (!settled) throw new PaymentEventError('No matching pending purchase');
          await client.query(`UPDATE payment_events SET process_status='processed', processed_at=NOW() WHERE id=$1`, [eventRowId]);
          await client.query('COMMIT');
          return { status: 200, body: { ok: true } };
        }

        // Only ShelterKart research reports are sold. The older purchase type that
        // used a tiered price table can no longer be created (its routes return 410).
        throw new PaymentEventError('Unknown purchase type');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        await pool.query(`UPDATE payment_events SET process_status='failed', processed_at=NOW() WHERE id=$1`, [eventRowId]).catch(() => {});
        return { status: 400, body: { ok: false, error: 'Could not process payment event' } };
      } finally {
        client.release();
      }
    }

  return { razorpayWebhook, morWebhook, providerWebhook };
};
