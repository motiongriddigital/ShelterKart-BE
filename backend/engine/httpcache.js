'use strict';
/**
 * Cache-Control for routes that have none, behind HTTP_CACHE=on (default off).
 *
 *   public data, the same for everyone     public, max-age=300, stale-while-revalidate=60
 *   personal or admin                      no-store
 *
 * The header is set before the route runs, so a handler that sets its own Cache-Control keeps it. A route that is not
 * listed here is untouched. Express already adds a weak ETag to JSON replies, so a revalidation costs a 304.
 */
const PUBLIC_SHORT = 'public, max-age=300, stale-while-revalidate=60';
const PUBLIC_EXACT = new Map([['/api/markets', PUBLIC_SHORT]]);
const NEVER_STORE = ['/api/admin', '/api/me', '/api/auth'];

const onOf = env => /^(on|true|1)$/i.test(String(env.HTTP_CACHE || '').trim());

function policyFor(method, path) {
  const p = String(path).toLowerCase().replace(/\/+$/, '') || '/';
  if (NEVER_STORE.some(x => p === x || p.startsWith(x + '/'))) return 'no-store';
  if ((method === 'GET' || method === 'HEAD') && PUBLIC_EXACT.has(p)) return PUBLIC_EXACT.get(p);
  return null;
}

function createHttpCache({ env = process.env } = {}) {
  if (!onOf(env)) return { on: false, middleware: (req, res, next) => next() };
  return { on: true, middleware: (req, res, next) => { const v = policyFor(req.method, req.path); if (v && !res.getHeader('Cache-Control')) res.set('Cache-Control', v); next(); } };
}

module.exports = { createHttpCache, policyFor, onOf, PUBLIC_SHORT };
