'use strict';
const express = require('express');
const { MARKETS } = require('../engine/markets');
const { adminAuth } = require('../middleware/adminAuth');
const { ah } = require('../middleware/asyncHandler');
const { stripPII } = require('../lib/pii');

module.exports = function register(app, c) {
  const { ACCOUNTS, SEARCH, addSpend, num, pool, researchLimiter } = c;
  SEARCH.mount(app, { adminAuth, ah, jsonParser: express.json({ limit: '2mb' }), limiter: researchLimiter, stripPII, markets: MARKETS });

  // Premium search (backend/search/premium): wider recall for readers who have bought a report, under a per-search dollar budget. Nothing is loaded or registered unless PREMIUM_SEARCH=on.
  if (String(process.env.PREMIUM_SEARCH || '').toLowerCase() === 'on') {
    const { createPremiumSearch, makeIsPremium } = require('../search/premium');
    const PREMIUM = createPremiumSearch({ env: process.env, index: SEARCH.index, onSpend: usd => addSpend({ input: { country: '' } }, usd),
      isPremium: makeIsPremium({ windowDays: num('PREMIUM_WINDOW_DAYS', 0),
        hasPaidPurchase: async (userId, since) => (await pool.query(`SELECT 1 FROM report_purchases WHERE user_id=$1 AND status='paid'${since ? ' AND created_at >= $2' : ''} LIMIT 1`, since ? [userId, since] : [userId])).rows.length > 0 }) });
    require('../search/premium/routes').mountPremium(app, { premium: PREMIUM, user: req => ACCOUNTS.user(req), ah, adminAuth, limiter: researchLimiter, jsonParser: express.json({ limit: '20kb' }), stripPII, marketOfCountry: SEARCH.marketOfCountry });
  }
};
