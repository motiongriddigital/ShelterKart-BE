'use strict';
const { paywallActive, REF_RE } = require('../../engine/access');
const rzp = require('../../engine/razorpay');

module.exports = function create(c) {
  const { ACCOUNTS, grantOf, markPurchasePaid, ownsPurchase, pool, reconcileMor, reconcileRazorpay } = c;

  async function razorpayVerify(req) {
    if (!paywallActive(process.env)) return { status: 503, body: { ok: false, error: 'Payments are not enabled yet.' } };
    const { ref, purchaseId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
    if (!REF_RE.test(String(ref || '')) || !/^[0-9a-f-]{36}$/i.test(String(purchaseId || '')) || !/^pay_\w+$/.test(String(paymentId || '')))
      return { status: 400, body: { ok: false, error: 'Invalid request.' } };
    const q = await pool.query(`SELECT status, provider_order_id FROM report_purchases WHERE id=$1 AND report_ref=$2`, [purchaseId, ref]);
    if (!q.rows.length || !q.rows[0].provider_order_id) return { status: 404, body: { ok: false, error: 'Purchase not found.' } };
    if (ACCOUNTS.enabled && !(await ownsPurchase(req, purchaseId))) return { status: 403, body: { ok: false, code: 'not_entitled', error: 'This purchase belongs to another account.' } };
    const valid = rzp.verifyCheckoutSignature({ serverOrderId: q.rows[0].provider_order_id, paymentId, signature, keySecret: process.env.RAZORPAY_KEY_SECRET });
    if (!valid) return { status: 400, body: { ok: false, error: 'This payment could not be verified. If you were charged, write to us with your receipt.' } };
    if (q.rows[0].status !== 'paid') await markPurchasePaid(pool, { purchaseId, ref, provider: 'razorpay', paymentId }, { req });
    return { status: 200, body: grantOf(ref) };
  }

  async function access(req) {
    if (!paywallActive(process.env)) return { status: 503, body: { ok: false, error: 'Payments are not enabled yet.' } };
    const { ref, purchaseId } = req.body || {};
    if (!REF_RE.test(String(ref || '')) || !/^[0-9a-f-]{36}$/i.test(String(purchaseId || '')))
      return { status: 400, body: { ok: false, error: 'Invalid request.' } };
    const r = await pool.query(`SELECT status, provider, provider_order_id, amount, currency FROM report_purchases WHERE id=$1 AND report_ref=$2`, [purchaseId, ref]);
    if (r.rows.length && r.rows[0].status === 'pending_payment' && r.rows[0].provider === 'mor' && r.rows[0].provider_order_id) {
      try { if (await reconcileMor(purchaseId, ref, r.rows[0])) r.rows[0].status = 'paid'; } catch (e) { console.error('[mor] could not confirm the payment yet:', e && e.message); }
    }
    if (r.rows.length && r.rows[0].status === 'pending_payment' && r.rows[0].provider === 'razorpay' && r.rows[0].provider_order_id && rzp.configured(process.env)) {
      try { if (await reconcileRazorpay(purchaseId, ref, r.rows[0])) r.rows[0].status = 'paid'; } catch (e) { console.error('[razorpay] could not confirm the payment yet:', e && e.message); }
    }
    if (!r.rows.length || r.rows[0].status !== 'paid') return { status: 402, body: { ok: false, error: 'Payment has not been confirmed yet.' } };
    if (ACCOUNTS.enabled && !(await ownsPurchase(req, purchaseId))) return { status: 403, body: { ok: false, code: 'not_entitled', error: 'This purchase belongs to another account.' } };
    return { status: 200, body: grantOf(ref) };
  }

  return { razorpayVerify, access };
};
