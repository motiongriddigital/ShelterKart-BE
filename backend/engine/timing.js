'use strict';
/**
 * Per-route timing: count, approximate p50 and p95 over the last samples, and one log line for a slow request.
 *
 *   SLOW_MS=1000     a request slower than this logs one line; 0 turns the line off (the table is still kept)
 *
 * Kept in memory, reset on restart, never holds a path parameter, query string, header or body: the key is the route pattern.
 * Event streams are skipped because they stay open on purpose.
 */
const SAMPLES = 200, MAX_ROUTES = 300;

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : 0;
const slowOf = env => { const n = Number(env.SLOW_MS); return env.SLOW_MS === undefined || env.SLOW_MS === '' || !Number.isFinite(n) || n < 0 ? 1000 : n; };

function createTiming({ env = process.env, log = console, now = () => Number(process.hrtime.bigint() / 1000n) / 1000 } = {}) {
  const slowMs = slowOf(env), rows = new Map();
  const middleware = (req, res, next) => {
    const start = now();
    res.on('finish', () => {
      if (/text\/event-stream/.test(String(res.getHeader('content-type') || ''))) return;
      const ms = now() - start, pattern = req.route ? (req.baseUrl || '') + req.route.path : 'unmatched';
      const key = `${req.method} ${pattern}`;
      let row = rows.get(key);
      if (!row) { if (rows.size >= MAX_ROUTES) return; row = { method: req.method, route: pattern, count: 0, slow: 0, last: [] }; rows.set(key, row); }
      row.count++; row.last.push(ms); if (row.last.length > SAMPLES) row.last.shift();
      if (slowMs > 0 && ms > slowMs) { row.slow++; log.warn(`[slow] ${key} ${res.statusCode} ${Math.round(ms)}ms`); }
    });
    next();
  };
  const stats = () => ({ slowMs, routes: [...rows.values()].map(r => { const s = [...r.last].sort((a, b) => a - b); return { method: r.method, route: r.route, count: r.count, slow: r.slow, p50: Math.round(pct(s, 0.5)), p95: Math.round(pct(s, 0.95)), max: Math.round(s[s.length - 1] || 0) }; }).sort((a, b) => b.p95 - a.p95) });
  return { middleware, stats };
}

module.exports = { createTiming, slowOf, pct };
