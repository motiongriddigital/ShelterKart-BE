'use strict';
/** Admin routes for sales: revenue per day, orders, refunds and a summary against the period before. Everything outside is passed in. Contract: docs/api/openapi.yaml, tag Admin. */

const DAY = 24 * 3600 * 1000;
const COUNTRY = /^[A-Za-z]{2}$/;
const STATUSES = ['paid', 'refunded', 'pending_payment'];
const r2 = v => Math.round(v * 100) / 100;

function intIn(raw, fallback, min, max) {
  if (raw === undefined || raw === '') return fallback;
  const n = /^\d{1,6}$/.test(String(raw)) ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
}

const dayOf = ms => new Date(ms).toISOString().slice(0, 10);
const startOfDay = (ms, back) => Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), new Date(ms).getUTCDate()) - back * DAY;

function usdOf(fx, amount, currency) {
  const per = fx && fx[currency];
  return per ? amount / per : null;
}

/** sales: rows of {day, key, currency, orders, gross, tax, net}; refunds: rows of {day, key, currency, refunds, amount}. Adds usd and totals. */
function buildSeries(sales, refunds, { fx, from, days }) {
  const rows = new Map(), cell = (day, key, currency) => {
    const id = `${day}|${key}|${currency}`;
    if (!rows.has(id)) rows.set(id, { day, key, currency, orders: 0, gross: 0, tax: 0, net: 0, refunds: 0, refunded: 0 });
    return rows.get(id);
  };
  for (const s of sales) { const c = cell(s.day, s.key, s.currency); c.orders += Number(s.orders); c.gross += Number(s.gross); c.tax += Number(s.tax); c.net += Number(s.net); }
  for (const f of refunds) { const c = cell(f.day, f.key, f.currency); c.refunds += Number(f.refunds); c.refunded += Number(f.amount); }
  const out = [...rows.values()].sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key) || a.currency.localeCompare(b.currency));
  const daily = new Map(); for (let i = 0; i < days; i++) daily.set(dayOf(from + i * DAY), { day: dayOf(from + i * DAY), orders: 0, grossUsd: 0, refundedUsd: 0 });
  const totals = { orders: 0, refunds: 0, grossUsd: 0, refundedUsd: 0, unconvertedOrders: 0 }, byCurrency = new Map();
  for (const r of out) {
    const g = usdOf(fx, r.gross, r.currency), f = usdOf(fx, r.refunded, r.currency);
    r.grossUsd = g == null ? null : r2(g); r.refundedUsd = f == null ? null : r2(f);
    for (const k of ['gross', 'tax', 'net', 'refunded']) r[k] = r2(r[k]);
    const d = daily.get(r.day);
    totals.orders += r.orders; totals.refunds += r.refunds;
    if (g == null && r.orders) totals.unconvertedOrders += r.orders;
    if (g != null) totals.grossUsd += g;
    if (f != null) totals.refundedUsd += f;
    if (d) { d.orders += r.orders; if (g != null) d.grossUsd += g; if (f != null) d.refundedUsd += f; }
    const c = byCurrency.get(r.currency) || { currency: r.currency, orders: 0, gross: 0, tax: 0, net: 0, refunded: 0 };
    for (const k of ['orders', 'gross', 'tax', 'net', 'refunded']) c[k] += r[k];
    byCurrency.set(r.currency, c);
  }
  totals.grossUsd = r2(totals.grossUsd); totals.refundedUsd = r2(totals.refundedUsd);
  return {
    rows: out,
    daily: [...daily.values()].map(d => ({ ...d, grossUsd: r2(d.grossUsd), refundedUsd: r2(d.refundedUsd) })),
    byCurrency: [...byCurrency.values()].map(c => ({ ...c, gross: r2(c.gross), tax: r2(c.tax), net: r2(c.net), refunded: r2(c.refunded) })).sort((a, b) => b.gross - a.gross),
    totals,
  };
}

function pctChange(now, before) { return before ? Math.round((now - before) / before * 1000) / 10 : null; }

/** The window and the window before it, from one series over twice the days. pending: checkouts started in each window that never paid. */
function buildSummary(sales, refunds, { fx, now, days, pending }) {
  const from = startOfDay(now, days - 1), prevFrom = from - days * DAY;
  const cur = buildSeries(sales.filter(s => s.day >= dayOf(from)), refunds.filter(s => s.day >= dayOf(from)), { fx, from, days });
  const prev = buildSeries(sales.filter(s => s.day >= dayOf(prevFrom) && s.day < dayOf(from)), refunds.filter(s => s.day >= dayOf(prevFrom) && s.day < dayOf(from)), { fx, from: prevFrom, days });
  const rate = (a, b) => (b ? Math.round(a / b * 1000) / 1000 : null);
  const shape = (s, p) => ({
    orders: s.totals.orders, grossUsd: s.totals.grossUsd, refundedUsd: s.totals.refundedUsd, refunds: s.totals.refunds,
    avgOrderUsd: s.totals.orders > s.totals.unconvertedOrders ? r2(s.totals.grossUsd / (s.totals.orders - s.totals.unconvertedOrders)) : null,
    refundRate: rate(s.totals.refunds, s.totals.orders),
    unpaidCheckouts: p, checkoutToPaid: rate(s.totals.orders, s.totals.orders + p),
  });
  const now_ = shape(cur, pending.current), before = shape(prev, pending.previous);
  const byKey = new Map();
  for (const r of cur.rows) if (r.grossUsd != null) byKey.set(r.key, (byKey.get(r.key) || 0) + r.grossUsd);
  return {
    current: now_, previous: before,
    change: { orders: pctChange(now_.orders, before.orders), grossUsd: pctChange(now_.grossUsd, before.grossUsd) },
    unconvertedOrders: cur.totals.unconvertedOrders,
    top: [...byKey.entries()].map(([key, usd]) => ({ key, usd: r2(usd) })).sort((a, b) => b.usd - a.usd).slice(0, 5),
  };
}

/** The Postgres source. Every figure is read from report_purchases and refunds; nothing personal (no e-mail, no name) leaves it. */
function pgSource(pool) {
  const when = 'COALESCE(p.paid_at, p.created_at)';
  const keyOf = by => (by === 'country' ? `COALESCE(NULLIF(UPPER(p.buyer_country), ''), 'unknown')` : 'p.currency');
  return {
    async sales(since, by) {
      const r = await pool.query(
        `SELECT to_char(${when} AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, ${keyOf(by)} AS key, p.currency, COUNT(*) AS orders, SUM(p.amount) AS gross,
                SUM(COALESCE(p.tax_amount, 0)) AS tax, SUM(COALESCE(p.amount_net, p.amount - COALESCE(p.tax_amount, 0))) AS net
           FROM report_purchases p WHERE p.status IN ('paid', 'refunded') AND ${when} >= $1 GROUP BY 1, 2, 3`, [since]);
      return r.rows;
    },
    async refunds(since, by) {
      const r = await pool.query(
        `SELECT to_char(f.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, ${keyOf(by)} AS key, f.currency, COUNT(*) AS refunds, SUM(f.amount) AS amount
           FROM refunds f JOIN report_purchases p ON p.id = f.purchase_id WHERE f.created_at >= $1 GROUP BY 1, 2, 3`, [since]);
      return r.rows;
    },
    async pending(from, to) {
      const r = await pool.query(`SELECT COUNT(*) AS n FROM report_purchases WHERE status = 'pending_payment' AND created_at >= $1 AND created_at < $2`, [from, to]);
      return Number(r.rows[0].n);
    },
    async orders({ since, status, country, q, limit, offset }) {
      const args = [since], where = [`p.created_at >= $1`];
      if (status) { args.push(status); where.push(`p.status = $${args.length}`); } else where.push(`p.status IN ('paid', 'refunded')`);
      if (country) { args.push(country.toUpperCase()); where.push(`UPPER(p.buyer_country) = $${args.length}`); }
      if (q) { args.push(`%${q.replace(/[\\%_]/g, c => '\\' + c)}%`); where.push(`(p.report_ref ILIKE $${args.length} OR p.id::text ILIKE $${args.length} OR p.provider_payment_id ILIKE $${args.length})`); }
      args.push(limit, offset);
      const r = await pool.query(
        `SELECT p.id, p.report_ref, p.status, p.amount, p.currency, p.tax_amount, p.amount_net, p.buyer_country, p.billing_country, p.provider, p.created_at, p.paid_at, p.user_id,
                COALESCE((SELECT SUM(f.amount) FROM refunds f WHERE f.purchase_id = p.id), 0) AS refunded, COUNT(*) OVER () AS total
           FROM report_purchases p WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC, p.id LIMIT $${args.length - 1} OFFSET $${args.length}`, args);
      return r.rows;
    },
    async refundList({ since, limit, offset }) {
      const r = await pool.query(
        `SELECT f.id, f.purchase_id, p.report_ref, f.amount, f.currency, f.tax_reversed, f.reason, f.status, f.provider_ref, f.created_at, p.buyer_country, COUNT(*) OVER () AS total
           FROM refunds f LEFT JOIN report_purchases p ON p.id = f.purchase_id WHERE f.created_at >= $1 ORDER BY f.created_at DESC, f.id DESC LIMIT $2 OFFSET $3`, [since, limit, offset]);
      return r.rows;
    },
  };
}

const iso = v => (v ? new Date(v).toISOString() : null);

function mountSalesAdmin(app, { adminAuth, wrap, rateLimit, source, fx, now = () => Date.now() }) {
  const A = [rateLimit({ windowMs: 15 * 60e3, max: 300, message: { ok: false, error: 'Too many requests. Please try again later.' } }), adminAuth];
  const reply = (res, status, body) => { res.set('Cache-Control', 'no-store'); res.status(status).json(body); };
  const bad = (res, error) => reply(res, 400, { ok: false, code: 'invalid', error });
  const rates = () => (typeof fx === 'function' ? fx() : fx) || {};

  app.get('/api/admin/sales/series', ...A, wrap(async (req, res) => {
    const q = req.query || {}, days = intIn(q.days, 30, 1, 400), by = q.by === undefined ? 'currency' : q.by;
    if (Number.isNaN(days)) return bad(res, 'days must be a whole number from 1 to 400.');
    if (by !== 'currency' && by !== 'country') return bad(res, 'by must be currency or country.');
    if (!source) return reply(res, 200, { ok: true, stored: false, days, by, rows: [], daily: [], byCurrency: [], totals: { orders: 0, refunds: 0, grossUsd: 0, refundedUsd: 0, unconvertedOrders: 0 } });
    const from = startOfDay(now(), days - 1), since = new Date(from).toISOString();
    const [sales, refunds] = await Promise.all([source.sales(since, by), source.refunds(since, by)]);
    reply(res, 200, { ok: true, stored: true, days, by, ...buildSeries(sales, refunds, { fx: rates(), from, days }) });
  }));

  app.get('/api/admin/sales/summary', ...A, wrap(async (req, res) => {
    const days = intIn((req.query || {}).days, 30, 1, 200);
    if (Number.isNaN(days)) return bad(res, 'days must be a whole number from 1 to 200.');
    if (!source) return reply(res, 200, { ok: true, stored: false, days });
    const t = now(), from = startOfDay(t, days - 1), prevFrom = from - days * DAY, since = new Date(prevFrom).toISOString();
    const [sales, refunds, current, previous] = await Promise.all([source.sales(since, 'country'), source.refunds(since, 'country'),
      source.pending(new Date(from).toISOString(), new Date(t + DAY).toISOString()), source.pending(since, new Date(from).toISOString())]);
    reply(res, 200, { ok: true, stored: true, days, ...buildSummary(sales, refunds, { fx: rates(), now: t, days, pending: { current, previous } }) });
  }));

  app.get('/api/admin/sales/orders', ...A, wrap(async (req, res) => {
    const q = req.query || {}, days = intIn(q.days, 30, 1, 400), limit = intIn(q.limit, 50, 1, 200), offset = intIn(q.offset, 0, 0, 100000);
    if ([days, limit, offset].some(Number.isNaN)) return bad(res, 'days (1 to 400), limit (1 to 200) and offset (0 or more) must be whole numbers.');
    if (q.status !== undefined && !STATUSES.includes(q.status)) return bad(res, `status must be one of ${STATUSES.join(', ')}.`);
    if (q.country !== undefined && !COUNTRY.test(q.country)) return bad(res, 'country must be a two-letter code.');
    if (q.q !== undefined && (typeof q.q !== 'string' || q.q.length > 80)) return bad(res, 'q must be text of at most 80 characters.');
    if (!source) return reply(res, 200, { ok: true, stored: false, days, total: 0, orders: [] });
    const rows = await source.orders({ since: new Date(startOfDay(now(), days - 1)).toISOString(), status: q.status, country: q.country, q: q.q, limit, offset });
    reply(res, 200, { ok: true, stored: true, days, limit, offset, total: rows.length ? Number(rows[0].total) : 0, orders: rows.map(o => ({
      id: o.id, reportRef: o.report_ref, status: o.status, amount: Number(o.amount), currency: o.currency, tax: o.tax_amount == null ? null : Number(o.tax_amount),
      net: o.amount_net == null ? null : Number(o.amount_net), refunded: Number(o.refunded), buyerCountry: o.buyer_country || null, billingCountry: o.billing_country || null,
      provider: o.provider || null, createdAt: iso(o.created_at), paidAt: iso(o.paid_at), userId: o.user_id || null })) });
  }));

  app.get('/api/admin/sales/refunds', ...A, wrap(async (req, res) => {
    const q = req.query || {}, days = intIn(q.days, 90, 1, 400), limit = intIn(q.limit, 50, 1, 200), offset = intIn(q.offset, 0, 0, 100000);
    if ([days, limit, offset].some(Number.isNaN)) return bad(res, 'days (1 to 400), limit (1 to 200) and offset (0 or more) must be whole numbers.');
    if (!source) return reply(res, 200, { ok: true, stored: false, days, total: 0, refunds: [] });
    const rows = await source.refundList({ since: new Date(startOfDay(now(), days - 1)).toISOString(), limit, offset });
    reply(res, 200, { ok: true, stored: true, days, limit, offset, total: rows.length ? Number(rows[0].total) : 0, refunds: rows.map(f => ({
      id: Number(f.id), purchaseId: f.purchase_id, reportRef: f.report_ref || null, amount: Number(f.amount), currency: f.currency, taxReversed: Number(f.tax_reversed),
      reason: f.reason || null, status: f.status || null, providerRef: f.provider_ref || null, buyerCountry: f.buyer_country || null, createdAt: iso(f.created_at) })) });
  }));
}

module.exports = { mountSalesAdmin, pgSource, buildSeries, buildSummary };
