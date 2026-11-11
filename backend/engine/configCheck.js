'use strict';
/**
 * The configuration check at start. A misconfigured production server used to boot anyway and fail open: a mistyped ACCESS_TOKEN_SECRET made
 * every paid report free while payments looked configured, an empty ALLOWED_ORIGINS let any website call the API, a short admin password
 * was accepted. In production the server now refuses to start; elsewhere the same problems are printed as warnings.
 * Messages name the variable and never print a value.
 */
const MIN_PASSWORD = 16, MIN_SECRET = 32;
const has = (env, k) => Boolean(String(env[k] || '').trim());

function check(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const errors = [], warnings = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };

  need(has(env, 'ADMIN_USERNAME'), 'ADMIN_USERNAME is not set: nobody could sign in to the admin pages.');
  need(has(env, 'ADMIN_PASSWORD') && String(env.ADMIN_PASSWORD).length >= MIN_PASSWORD, `ADMIN_PASSWORD must be set and at least ${MIN_PASSWORD} characters.`);
  need(has(env, 'ACCESS_TOKEN_SECRET') && String(env.ACCESS_TOKEN_SECRET).length >= MIN_SECRET, `ACCESS_TOKEN_SECRET must be set and at least ${MIN_SECRET} characters: it signs report access tokens, and without it the paywall is switched off.`);
  need(has(env, 'QUOTE_SECRET') && String(env.QUOTE_SECRET).length >= MIN_SECRET, `QUOTE_SECRET must be set and at least ${MIN_SECRET} characters: it signs the prices buyers are quoted.`);
  if (has(env, 'QUOTE_SECRET') && has(env, 'ACCESS_TOKEN_SECRET') && env.QUOTE_SECRET === env.ACCESS_TOKEN_SECRET) errors.push('QUOTE_SECRET and ACCESS_TOKEN_SECRET must be different values.');
  need(has(env, 'DATABASE_URL'), 'DATABASE_URL is not set: reports, purchases and sign-ins would live in memory and be lost on every restart.');
  need(has(env, 'ALLOWED_ORIGINS'), 'ALLOWED_ORIGINS is not set: list the website addresses allowed to call this API, comma separated.');

  if (env.PAYMENTS_ENABLED === 'true') {
    const razorpay = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'], dodo = ['DODO_API_KEY', 'DODO_WEBHOOK_KEY'];
    const set = list => list.filter(k => has(env, k)), whole = list => set(list).length === list.length;
    for (const [name, list] of [['Razorpay', razorpay], ['Dodo', dodo]]) if (set(list).length && !whole(list)) errors.push(`${name} is half configured: ${list.filter(k => !has(env, k)).join(', ')} missing.`);
    need(whole(razorpay) || whole(dodo), 'PAYMENTS_ENABLED is true but no payment provider is fully configured (Razorpay needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET; Dodo needs DODO_API_KEY and DODO_WEBHOOK_KEY).');
    // The paywall needs a Razorpay key pair AND the token secret (engine/access.js). A buyer outside India pays through Dodo, but the lock itself needs both.
    if (!(has(env, 'RAZORPAY_KEY_ID') && has(env, 'RAZORPAY_KEY_SECRET') && has(env, 'ACCESS_TOKEN_SECRET')))
      warnings.push('PAYMENTS_ENABLED is true but the paywall will NOT lock reports: it needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and ACCESS_TOKEN_SECRET together, so every report is free until they are set.');
  }
  if (!has(env, 'ALLOWED_ORIGINS') && !['development', 'test'].includes(env.NODE_ENV))
    warnings.push('ALLOWED_ORIGINS is empty and NODE_ENV is not "development": browsers on other websites are refused. Set ALLOWED_ORIGINS, or NODE_ENV=development on a developer machine.');
  if (production && /^(on|true|1|yes)$/i.test(String(env.ACCOUNTS_ENABLED || '')) && String(env.ACCOUNTS_CSRF || '').toLowerCase() !== 'on')
    warnings.push('ACCOUNTS_CSRF is not "on": the cross-site request guard only reports and refuses nothing. Set ACCOUNTS_CSRF=on once the frontend sends its Origin.');
  if (production && !has(env, 'TRUST_PROXY')) warnings.push('TRUST_PROXY is not set: behind a load balancer every visitor shares one rate limit.');

  // Outside production the same findings are advice, not a reason to stop (a developer machine has no payment keys).
  return production ? { production, errors, warnings } : { production, errors: [], warnings: [...errors.map(e => e + ' (not enforced outside production)'), ...warnings] };
}

module.exports = { check, MIN_PASSWORD, MIN_SECRET };
