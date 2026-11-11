'use strict';
/** The payment receipt: one plain e-mail when a purchase settles. It states what was paid and for which report, never payment details. */

function receiptMessage({ ref, amount, currency, purchaseId, site }) {
  const base = String(site || '').replace(/\/+$/, '');
  const subject = 'Your ShelterKart receipt';
  const text = [
    'Thank you. We have received your payment.',
    '',
    `Amount: ${amount} ${currency}`,
    `Report: ${ref}`,
    `Order: ${purchaseId}`,
    '',
    'Your report is delivered by a separate e-mail as soon as it is ready.' + (base ? ` You can also open it at ${base}.` : ''),
    '',
    'If you did not make this payment, reply to this e-mail and we will look into it.',
  ].join('\n');
  return { subject, text };
}

function sendReceipt(env, { to, ref, amount, currency, purchaseId, site }) {
  const msg = receiptMessage({ ref, amount, currency, purchaseId, site });
  return Promise.resolve().then(() => require('./delivery').sendEmail(env, { to, ...msg })).catch(e => { console.error('[receipt] could not send:', e && e.message); return false; });
}

module.exports = { receiptMessage, sendReceipt };
