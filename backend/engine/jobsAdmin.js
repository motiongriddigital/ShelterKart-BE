'use strict';
/**
 * Failed jobs for the operator: paid reports that stopped early, and deliveries that gave up after every automatic retry.
 * One list, one retry. A retry never charges anyone and never runs twice: it only works on a job that is failed right now.
 * Everything outside is passed in. Contract: docs/api/openapi.yaml, tag Admin.
 */
const { scrub } = require('./errorlog');

const ID = /^(report|delivery):([A-Za-z0-9_-]{1,80})(?::(email|whatsapp))?$/;
const iso = v => (v ? new Date(v).toISOString() : null);

function listFailed({ liveJobs, delivery, limit = 200 }) {
  const rows = [];
  for (const job of liveJobs.values()) {
    if (!job.paid || job.status !== 'failed') continue;
    rows.push({ id: 'report:' + job.ref, kind: 'report', ref: job.ref, channel: null, to: null, failedAt: iso(job.failedAt || job.updatedAt), reason: job.failError ? scrub(job.failError, 200) : null, attempts: null, retryable: true });
  }
  for (const f of delivery.failed()) rows.push({ id: 'delivery:' + f.ref + ':' + f.channel, kind: 'delivery', ref: f.ref, channel: f.channel, to: f.to, failedAt: f.at, reason: scrub(f.error, 200), attempts: f.attempts, retryable: true });
  rows.sort((a, b) => String(b.failedAt || '').localeCompare(String(a.failedAt || '')));
  return { total: rows.length, jobs: rows.slice(0, limit) };
}

/** retryReport(ref) starts the report again from its saved state and answers { ok } or { ok: false, code }. */
function retryFailed(id, { liveJobs, delivery, retryReport }) {
  const m = ID.exec(String(id || ''));
  if (!m) return { ok: false, code: 'invalid' };
  const [, kind, ref, channel] = m;
  if (kind === 'report') return channel ? { ok: false, code: 'invalid' } : retryReport(ref);
  if (!channel) return { ok: false, code: 'invalid' };
  const r = delivery.retry(ref, channel);
  return r.ok ? { ok: true } : r;
}

/** history: [{ market, state, reason, at }] oldest first. One series per market that has a live register, even if it has no checks yet. */
function registerSeries(history, markets) {
  const by = new Map();
  for (const h of history) { if (!by.has(h.market)) by.set(h.market, []); by.get(h.market).push({ at: h.at, state: h.state, reason: h.reason || null }); }
  return Object.keys(markets).filter(k => markets[k].registry).map(k => {
    const points = (by.get(k) || []).sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const counted = points.filter(p => p.state !== 'skipped'), healthy = counted.filter(p => p.state === 'healthy').length;
    return { market: k, name: markets[k].label, checks: points.length, healthy, uptime: counted.length ? Math.round(healthy / counted.length * 1000) / 1000 : null, latest: points.length ? points[points.length - 1].state : null, points };
  });
}

function mountJobsAdmin(app, { adminAuth, wrap, rateLimit, liveJobs, delivery, retryReport, history, markets }) {
  const A = [rateLimit({ windowMs: 15 * 60e3, max: 300, message: { ok: false, error: 'Too many requests. Please try again later.' } }), adminAuth];
  const reply = (res, status, body) => { res.set('Cache-Control', 'no-store'); res.status(status).json(body); };

  app.get('/api/admin/jobs/failed', ...A, wrap(async (req, res) => {
    const limit = Math.min(500, Math.max(1, parseInt((req.query || {}).limit, 10) || 200));
    reply(res, 200, { ok: true, ...listFailed({ liveJobs, delivery, limit }) });
  }));

  app.get('/api/admin/health/registers/history', ...A, wrap(async (req, res) => {
    const raw = (req.query || {}).days;
    const days = raw === undefined || raw === '' ? 30 : (/^\d{1,4}$/.test(String(raw)) ? Number(raw) : NaN);
    if (!Number.isInteger(days) || days < 1 || days > 90) return reply(res, 400, { ok: false, code: 'invalid', error: 'days must be a whole number from 1 to 90.' });
    reply(res, 200, { ok: true, days, registers: registerSeries(await history(days), markets) });
  }));

  app.post('/api/admin/jobs/:id/retry', ...A, wrap(async (req, res) => {
    const r = retryFailed(req.params.id, { liveJobs, delivery, retryReport });
    if (r.ok) return reply(res, 202, { ok: true, id: req.params.id, message: 'Started again. Check the list in a moment.' });
    if (r.code === 'invalid') return reply(res, 400, { ok: false, code: 'invalid', error: 'Not a job id from the failed list.' });
    if (r.code === 'not_found') return reply(res, 404, { ok: false, code: 'not_found', error: 'No such job.' });
    return reply(res, 409, { ok: false, code: r.code, error: r.code === 'busy' ? 'It is already being retried.' : 'That job is not failed, so there is nothing to retry.' });
  }));
}

module.exports = { listFailed, retryFailed, registerSeries, mountJobsAdmin };
