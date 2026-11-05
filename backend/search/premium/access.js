'use strict';
/**
 * Who is premium. There is no membership in the product yet (docs/admin/BACKEND-PLAN.md, open question 1), so the default
 * says: a signed-in user, not disabled, with at least one paid purchase that has not been refunded (report_purchases.status
 * 'paid': a refund changes the status, as for entitlement). The test is injected, so a membership can replace it later.
 */
const makeIsPremium = ({ hasPaidPurchase, windowDays = 0, now = () => Date.now() } = {}) => async user => {
  if (!user || !user.id || user.disabledAt || typeof hasPaidPurchase !== 'function') return false;
  try { return Boolean(await hasPaidPurchase(user.id, windowDays > 0 ? new Date(now() - windowDays * 24 * 3600 * 1000) : null)); } catch { return false; }
};

module.exports = { makeIsPremium };
