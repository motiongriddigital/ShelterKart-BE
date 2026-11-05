'use strict';
/**
 * AI engine usage kept per day (UTC), engine and role, so a restart does not reset it. The meter feeds every call to record();
 * counts are held for a moment and written in one go (and on shutdown). A failed write never reaches an engine call: it is logged
 * and tried again with the next write. Without a database the history lives in memory and starts again at each start.
 * Never stores prompts or answers. Latency is a histogram, so p50 and p95 are the upper bound of the bucket they fall in.
 */
const BOUNDS = [100, 250, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000];
const OVER = 120000;
const SLOTS = BOUNDS.length + 1;
const dayOf = t => new Date(t).toISOString().slice(0, 10);
const bucket = ms => { const i = BOUNDS.findIndex(b => ms <= b); return i < 0 ? SLOTS - 1 : i; };
const blank = () => ({ calls: 0, failures: 0, rescues: 0, tokensIn: 0, tokensOut: 0, searches: 0, msTotal: 0, costUsd: 0, costedCalls: 0, lat: new Array(SLOTS).fill(0) });
const num = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

function add(a, b) {
  for (const k of ['calls', 'failures', 'rescues', 'tokensIn', 'tokensOut', 'searches', 'msTotal', 'costUsd', 'costedCalls']) a[k] += b[k];
  for (let i = 0; i < SLOTS; i++) a.lat[i] += b.lat[i];
  return a;
}
function percentile(lat, p) {
  const n = lat.reduce((s, x) => s + x, 0);
  if (!n) return 0;
  const need = Math.ceil(n * p); let seen = 0;
  for (let i = 0; i < SLOTS; i++) { seen += lat[i]; if (seen >= need) return i < BOUNDS.length ? BOUNDS[i] : OVER; }
  return OVER;
}
const present = (day, engine, role, c) => ({ day, engine, role, calls: c.calls, failures: c.failures, rescues: c.rescues, tokensIn: c.tokensIn, tokensOut: c.tokensOut, searches: c.searches,
  costUsd: Math.round(c.costUsd * 1e4) / 1e4, costedCalls: c.costedCalls, avgMs: c.calls ? Math.round(c.msTotal / c.calls) : 0, p50Ms: percentile(c.lat, 0.5), p95Ms: percentile(c.lat, 0.95) });

function createHistory({ pool = null, now = () => Date.now(), flushMs = 3000, log = console } = {}) {
  let pending = new Map();                   // 'day|engine|role' -> counts not yet written
  const mem = new Map();                     // the same, kept for good, when there is no database
  let timer = null, writing = null;
  const key = (d, e, r) => d + '|' + e + '|' + r;

  function record(ev) {
    try {
      if (!ev || !ev.engine) return;
      const k = key(dayOf(now()), String(ev.engine).slice(0, 40), String(ev.role || 'unknown').slice(0, 40));
      const c = pending.get(k) || blank(); pending.set(k, c);
      const ms = num(ev.ms);
      c.calls++; c.msTotal += ms; c.lat[bucket(ms)]++;
      if (ev.ok) { c.rescues += ev.rescued ? 1 : 0; c.tokensIn += num(ev.tokensIn); c.tokensOut += num(ev.tokensOut); c.searches += num(ev.searches); if (ev.costUsd != null && Number.isFinite(Number(ev.costUsd))) { c.costUsd += num(ev.costUsd); c.costedCalls++; } }
      else c.failures++;
      if (!timer && flushMs > 0) { timer = setTimeout(() => { timer = null; flush(); }, flushMs); if (timer.unref) timer.unref(); }
    } catch (e) { log.error('[engine-history] could not count a call:', e && e.message); }
  }

  async function write(batch) {
    if (!pool) { for (const [k, c] of batch) { const m = mem.get(k) || blank(); mem.set(k, add(m, c)); } return; }
    for (const [k, c] of batch) {
      const [day, engine, role] = k.split('|');
      await pool.query(
        `INSERT INTO engine_usage_daily AS t (day, engine, role, calls, failures, rescues, tokens_in, tokens_out, searches, ms_total, cost_usd, costed_calls, lat)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::int[])
         ON CONFLICT (day, engine, role) DO UPDATE SET calls = t.calls + EXCLUDED.calls, failures = t.failures + EXCLUDED.failures, rescues = t.rescues + EXCLUDED.rescues,
           tokens_in = t.tokens_in + EXCLUDED.tokens_in, tokens_out = t.tokens_out + EXCLUDED.tokens_out, searches = t.searches + EXCLUDED.searches, ms_total = t.ms_total + EXCLUDED.ms_total,
           cost_usd = t.cost_usd + EXCLUDED.cost_usd, costed_calls = t.costed_calls + EXCLUDED.costed_calls,
           lat = (SELECT array_agg(a + b ORDER BY i) FROM unnest(t.lat, EXCLUDED.lat) WITH ORDINALITY AS u(a, b, i))`,
        [day, engine, role, c.calls, c.failures, c.rescues, c.tokensIn, c.tokensOut, c.searches, c.msTotal, c.costUsd, c.costedCalls, c.lat]);
    }
  }

  /** Write what is held. Overlapping calls wait for the one running. On failure the counts go back, to be written with the next batch. */
  function flush() {
    if (writing) return writing;
    if (!pending.size) return Promise.resolve();
    const batch = pending; pending = new Map();
    writing = write(batch).catch(e => {
      log.error('[engine-history] could not save usage, will try again:', e && e.message);
      for (const [k, c] of batch) { const p = pending.get(k); pending.set(k, p ? add(p, c) : c); }
      if (pending.size > 5000) pending = new Map([...pending].slice(-5000));
    }).finally(() => { writing = null; });
    return writing;
  }

  /** Rows for the last `days` days (today included), oldest first, with what is not yet written added in. */
  async function rows(days) {
    await flush();
    const from = dayOf(now() - (days - 1) * 24 * 3600 * 1000), out = new Map();
    if (pool) {
      const r = await pool.query(`SELECT to_char(day, 'YYYY-MM-DD') AS day, engine, role, calls, failures, rescues, tokens_in, tokens_out, searches, ms_total, cost_usd, costed_calls, lat FROM engine_usage_daily WHERE day >= $1::date ORDER BY day, engine, role`, [from]);
      for (const x of r.rows) out.set(key(x.day, x.engine, x.role), { calls: Number(x.calls), failures: Number(x.failures), rescues: Number(x.rescues), tokensIn: Number(x.tokens_in), tokensOut: Number(x.tokens_out), searches: Number(x.searches),
        msTotal: Number(x.ms_total), costUsd: Number(x.cost_usd), costedCalls: Number(x.costed_calls), lat: (x.lat || []).map(Number).concat(new Array(SLOTS).fill(0)).slice(0, SLOTS) });
    } else for (const [k, c] of mem) if (k.split('|')[0] >= from) out.set(k, c);
    for (const [k, c] of pending) if (k.split('|')[0] >= from) { const m = out.get(k); out.set(k, m ? add(m, c) : c); }
    return [...out].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, c]) => { const [d, e, r] = k.split('|'); return present(d, e, r, c); });
  }

  async function purge(days = 400) { if (pool) await pool.query(`DELETE FROM engine_usage_daily WHERE day < (now() AT TIME ZONE 'utc')::date - $1::int`, [days]); }

  return { record, flush, rows, purge, _pending: () => pending, BOUNDS };
}

module.exports = { createHistory, percentile, dayOf, BOUNDS, OVER };
