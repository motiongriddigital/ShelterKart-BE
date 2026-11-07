'use strict';
/** The CSRF guard for cookie sessions: a state-changing request that carries the session cookie must come from an allowed origin. */
const S = require('./secrets');

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT = new Set(['/api/payments/webhook', '/api/payments/razorpay/webhook', '/api/payments/mor/webhook']);
const norm = o => String(o == null ? '' : o).trim().toLowerCase().replace(/\/+$/, '');
const pathOf = p => String(p || '').toLowerCase().split('?')[0].replace(/\/+$/, '');

function csrfDecision({ method, path, hasCookie, origin, secFetchSite, allowedOrigins = [], selfOrigin = '', openWhenEmpty = false }) {
  if (SAFE.has(String(method || '').toUpperCase())) return { allow: true };
  if (EXEMPT.has(pathOf(path))) return { allow: true };
  if (!hasCookie) return { allow: true };
  const allowed = new Set(allowedOrigins.map(norm).filter(Boolean));
  if (selfOrigin) allowed.add(norm(selfOrigin));
  if (origin !== undefined && origin !== '') {
    if (allowed.has(norm(origin)) || (openWhenEmpty && allowedOrigins.length === 0 && norm(origin) !== 'null')) return { allow: true };
    return { allow: false, reason: 'origin' };
  }
  const site = norm(secFetchSite);
  if (site === 'same-origin' || site === 'none') return { allow: true };
  if (site) return { allow: false, reason: 'site' };
  return { allow: false, reason: 'no_headers' };
}

/** mode: off (nothing), report (log what would be refused), on (refuse with 403). */
function csrfGuard({ mode = 'report', cookieName, allowedOrigins = [], openWhenEmpty = false, log = line => console.warn(line) } = {}) {
  return (req, res, next) => {
    if (mode === 'off') return next();
    const header = (req.headers && req.headers.cookie) || '';
    const hasCookie = Boolean(S.parseCookies(header)[cookieName]);
    const get = k => (req.headers && req.headers[k]) || undefined;
    const r = csrfDecision({ method: req.method, path: req.path || req.url, hasCookie, origin: get('origin'), secFetchSite: get('sec-fetch-site'), allowedOrigins, openWhenEmpty,
      selfOrigin: get('host') ? `${req.protocol || 'http'}://${get('host')}` : '' });
    if (r.allow) return next();
    if (mode === 'report') { log(`[csrf] would refuse ${String(req.method).toUpperCase()} ${pathOf(req.path || req.url)} (${r.reason}, origin ${get('origin') || 'none'})`); return next(); }
    return res.status(403).json({ ok: false, code: 'csrf', error: 'This request came from an origin that is not allowed.' });
  };
}

module.exports = { csrfDecision, csrfGuard };
