'use strict';
/** Admin routes for the AI engines' history and the cost of each paid report. Everything outside is passed in. Contract: docs/api/openapi.yaml, tag Admin. */

const { stageTotals } = require('./jobCosts');
const DAY = 24 * 3600 * 1000;
const r4 = v => Math.round(v * 1e4) / 1e4;

function daysOf(raw, fallback) {
  if (raw === undefined || raw === '') return fallback;
  const n = /^\d{1,4}$/.test(String(raw)) ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 90 ? n : NaN;
}

/** rows from history.rows(): one per day, engine and role. Adds totals and a per-engine summary. */
function summarise(rows) {
  const total = { calls: 0, failures: 0, rescues: 0, tokensIn: 0, tokensOut: 0, searches: 0, costUsd: 0, costedCalls: 0 }, by = new Map();
  for (const x of rows) {
    for (const k of Object.keys(total)) total[k] += x[k];
    const e = by.get(x.engine) || { engine: x.engine, calls: 0, failures: 0, rescues: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
    for (const k of ['calls', 'failures', 'rescues', 'tokensIn', 'tokensOut', 'costUsd']) e[k] += x[k];
    by.set(x.engine, e);
  }
  total.costUsd = r4(total.costUsd);
  return { totals: total, byEngine: [...by.values()].map(e => ({ ...e, costUsd: r4(e.costUsd) })).sort((a, b) => b.costUsd - a.costUsd || a.engine.localeCompare(b.engine)) };
}

/** jobs: iterable of saved or running investigations. prices: Map ref -> USD paid by buyers. Only paid reports, newest first. */
function costRows(jobs, prices, since) {
  const out = [];
  for (const j of jobs) {
    if (!j.paid) continue;
    const at = j.updatedAt || j.createdAt || 0;
    if (at < since) continue;
    const cost = Number(j.costUsd) || 0, stages = stageTotals(j.stageCosts), price = prices.get(j.ref);
    out.push({ ref: j.ref, market: (j.input && j.input.country) || null, status: j.status, at: at ? new Date(at).toISOString() : null, costUsd: r4(cost), stages, capUsd: j.capUsd == null ? null : r4(Number(j.capUsd)),
      priceUsd: price == null ? null : r4(price), costShare: price ? r4(cost / price) : null });
  }
  out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const priced = out.filter(r => r.priceUsd != null), totalCost = out.reduce((s, r) => s + r.costUsd, 0);
  return { reports: out, totals: { reports: out.length, costUsd: r4(totalCost), avgCostUsd: out.length ? r4(totalCost / out.length) : 0, priced: priced.length, priceUsd: r4(priced.reduce((s, r) => s + r.priceUsd, 0)) } };
}

function mountEnginesAdmin(app, { adminAuth, wrap, rateLimit, history, jobs, pricesFor, now = () => Date.now() }) {
  const A = [rateLimit({ windowMs: 15 * 60e3, max: 300, message: { ok: false, error: 'Too many requests. Please try again later.' } }), adminAuth];
  const reply = (res, status, body) => { res.set('Cache-Control', 'no-store'); res.status(status).json(body); };
  const bad = res => reply(res, 400, { ok: false, code: 'invalid', error: 'days must be a whole number from 1 to 90.' });

  app.get('/api/admin/engines/history', ...A, wrap(async (req, res) => {
    const days = daysOf((req.query || {}).days, 7); if (Number.isNaN(days)) return bad(res);
    const rows = await history.rows(days);
    reply(res, 200, { ok: true, days, ...summarise(rows), rows });
  }));

  app.get('/api/admin/engines/costs', ...A, wrap(async (req, res) => {
    const days = daysOf((req.query || {}).days, 30); if (Number.isNaN(days)) return bad(res);
    const since = now() - days * DAY, list = [...jobs()].filter(j => j.paid && (j.updatedAt || j.createdAt || 0) >= since);
    const prices = await pricesFor(list.map(j => j.ref));
    const out = costRows(list, prices, since);
    reply(res, 200, { ok: true, days, ...out, reports: out.reports.slice(0, 200) });
  }));
}

module.exports = { mountEnginesAdmin, summarise, costRows, daysOf };
