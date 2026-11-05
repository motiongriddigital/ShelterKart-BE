'use strict';
/** Accounts: the settings, read once, and the startup problems that must stop a production boot. */

const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
const on = v => String(v || '').toLowerCase() === 'on' || String(v || '').toLowerCase() === 'true';

function settings(env = process.env) {
  const production = env.NODE_ENV === 'production';
  return {
    enabled: on(env.ACCOUNTS_ENABLED),
    production,
    secure: production || on(env.ACCOUNTS_COOKIE_SECURE),
    pepper: String(env.AUTH_PEPPER || ''),
    edgeCountryHeader: (/^[A-Za-z0-9-]{1,60}$/.test(String(env.EDGE_COUNTRY_HEADER || '')) ? String(env.EDGE_COUNTRY_HEADER) : 'cf-ipcountry').toLowerCase(),
    allowMemory: on(env.ACCOUNTS_ALLOW_MEMORY),
    devEcho: on(env.ACCOUNTS_DEV_ECHO),
    sessionDays: num(env.SESSION_DAYS, 30, 1, 365),
    sessionMaxDays: num(env.SESSION_MAX_DAYS, 90, 1, 730),
    codeMinutes: num(env.AUTH_CODE_MINUTES, 10, 1, 60),
    codeAttempts: num(env.AUTH_CODE_ATTEMPTS, 5, 1, 20),
    csrf: ['off', 'report', 'on'].includes(String(env.ACCOUNTS_CSRF || '').toLowerCase()) ? String(env.ACCOUNTS_CSRF).toLowerCase() : 'report',
    searchGate: String(env.ACCOUNTS_SEARCH_GATE || 'view').toLowerCase() === 'start' ? 'start' : 'view',
    termsVersion: String(env.TERMS_VERSION || '2026-11'),
    privacyVersion: String(env.PRIVACY_VERSION || '2026-11'),
  };
}

/** What is wrong with the configuration. Empty when accounts are off or everything is in place. */
function validate(env = process.env, { hasDatabase = Boolean(env.DATABASE_URL), mailConfigured = false } = {}) {
  const s = settings(env), out = [];
  if (!s.enabled) return out;
  if (s.pepper.length < 32) out.push('AUTH_PEPPER must be set to at least 32 characters when ACCOUNTS_ENABLED is on');
  if (!hasDatabase && !s.allowMemory) out.push('accounts need DATABASE_URL (or ACCOUNTS_ALLOW_MEMORY=true for development)');
  if (s.production && !mailConfigured) out.push('accounts need an e-mail provider (RESEND_API_KEY or POSTMARK_TOKEN) to send sign-in codes');
  if (s.production && s.devEcho) out.push('ACCOUNTS_DEV_ECHO must not be set in production');
  if (s.production && !String(env.ALLOWED_ORIGINS || '').trim()) out.push('accounts need ALLOWED_ORIGINS in production');
  return out;
}

module.exports = { settings, validate };
