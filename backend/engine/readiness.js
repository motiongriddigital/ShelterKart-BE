'use strict';
/**
 * What is still missing before each part of the product can run: the payment providers, the company registration, the e-mail sender,
 * the SEC identity, and, for every country that does not sell, the settings that would open it. The report names settings, never values.
 */
const PRICING = require('../pricing');

const has = (env, k) => Boolean(String(env[k] || '').trim());
const lacking = (env, names) => names.filter(k => !has(env, k));
const RAZORPAY = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'];
const MERCHANT = ['DODO_API_KEY', 'DODO_WEBHOOK_KEY'];
const MAIL_KEYS = ['RESEND_API_KEY', 'POSTMARK_SERVER_TOKEN'];

function report(env, data) {
  const merchantMissing = [...lacking(env, MERCHANT), ...(Object.keys(data.morProducts || {}).length ? [] : ['MOR_PRODUCTS'])];
  const intlMissing = env.RAZORPAY_INTERNATIONAL === 'true' ? [] : ['RAZORPAY_INTERNATIONAL'];
  const razorpayMissing = lacking(env, RAZORPAY);
  const mailProvider = require('./delivery').emailProvider(env);

  const groups = new Map(); const onSale = [];
  for (const c of data.countries.values()) {
    if (c.blocked) continue;
    const s = PRICING.saleStatus(data, c.iso);
    if (s.onSale) { onSale.push(c.iso); continue; }
    const tax = data.tax[c.tax] || {};
    if (!groups.has(s.reason)) groups.set(s.reason, { reason: s.reason, countries: [], options: [], registrationSettings: {} });
    const g = groups.get(s.reason); g.countries.push(c.iso);
    if (tax.registrationEnv) g.registrationSettings[c.iso] = tax.registrationEnv;
  }
  for (const g of groups.values()) {
    if (g.reason === 'registration_missing') g.options = [[...Object.values(g.registrationSettings).filter((v, i, a) => a.indexOf(v) === i), ...razorpayMissing]];
    else if (g.reason === 'registration_required') g.options = [['the country registration number (see registrationSettings)', ...intlMissing], merchantMissing];
    else if (g.reason === 'unverified') g.options = [['TAX_PROFILES (override after the tax adviser confirms the country)', ...intlMissing], merchantMissing];
    else if (g.reason === 'no_payment_route') g.options = [intlMissing, merchantMissing];
    if (!Object.keys(g.registrationSettings).length || g.reason === 'registration_missing') delete g.registrationSettings;
  }

  return {
    onSale,
    company: { missing: lacking(env, ['GSTIN']) },
    providers: {
      razorpay: { ready: !razorpayMissing.length, missing: razorpayMissing },
      razorpayInternational: { ready: !intlMissing.length, missing: intlMissing },
      merchantOfRecord: { ready: !merchantMissing.length, missing: merchantMissing },
    },
    mail: { provider: mailProvider || '', ready: Boolean(mailProvider), missing: mailProvider ? [] : [...lacking(env, ['DELIVERY_FROM']), `one of ${MAIL_KEYS.join(', ')}`] },
    ops: { missing: lacking(env, ['OPS_ALERT_EMAIL', 'PUBLIC_BASE_URL']) },
    sec: { missing: lacking(env, ['SEC_USER_AGENT']) },
    countries: [...groups.values()],
  };
}

function summaryLines(env, data) {
  const r = report(env, data), out = [];
  out.push(`${r.onSale.length} countries on sale${r.onSale.length ? ': ' + r.onSale.join(' ') : ''}`);
  if (r.company.missing.length) out.push('company registration missing: ' + r.company.missing.join(', '));
  for (const [name, p] of Object.entries(r.providers)) if (!p.ready) out.push(`${name} not ready, missing: ${p.missing.join(', ')}`);
  if (!r.mail.ready) out.push('e-mail sender not ready, missing: ' + r.mail.missing.join(', '));
  if (r.ops.missing.length) out.push('missing: ' + r.ops.missing.join(', '));
  if (r.sec.missing.length) out.push('SEC identity not set (the SEC connector stays off): ' + r.sec.missing.join(', '));
  return out;
}

function mountReadiness(app, { adminAuth, wrap, rateLimit, data, env }) {
  const A = [rateLimit({ windowMs: 15 * 60e3, max: 120, message: { ok: false, error: 'Too many requests. Please try again later.' } }), adminAuth];
  app.get('/api/admin/readiness', ...A, wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, ...report(env(), data()) });
  }));
}

module.exports = { report, summaryLines, mountReadiness };
