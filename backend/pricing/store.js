'use strict';
/**
 * ShelterKart -- the pricing store.
 *
 * One interface, two implementations: in memory (tests, local use) and Postgres
 * (pricing_v2.sql). Everything money-related that must survive a restart goes
 * through here: quotes, the audit trail, the per-country sales ledger (for tax
 * thresholds), refunds, and invoice numbers.
 *
 * Invoice numbers come from a counter that increments atomically in a single
 * statement, so the series has no gaps and no duplicates even under concurrency.
 */
const memory = () => {
  const quotes = new Map(), events = [], ledger = new Map(), refunds = [], counters = new Map(), invoices = [];
  const monthKey = (country, month, currency) => country + '|' + month + '|' + currency;
  return {
    kind: 'memory',
    async saveQuote(q) { quotes.set(q.id, JSON.parse(JSON.stringify(q))); },
    async getQuote(id) { const q = quotes.get(id); return q ? JSON.parse(JSON.stringify(q)) : null; },
    async setQuoteStatus(id, status) { const q = quotes.get(id); if (q) q.status = status; },
    async claimQuote(id) { const q = quotes.get(id); if (!q || q.status !== 'open') return false; q.status = 'used'; return true; },
    async supersedeOpen({ ref, session, exceptId }) {
      for (const q of quotes.values()) if (q.ref === ref && q.session === session && q.status === 'open' && q.id !== exceptId) q.status = 'superseded';
    },
    async addEvent(type, { quoteId = null, ref = null, details = {} } = {}) { events.push({ at: new Date().toISOString(), type, quoteId, ref, details }); },
    async listEvents(filter = {}) { return events.filter(e => (!filter.type || e.type === filter.type) && (!filter.quoteId || e.quoteId === filter.quoteId)).map(e => ({ ...e })); },
    async addSale({ country, month, gross, tax, currency }) {
      const k = monthKey(country, month, currency), cur = ledger.get(k) || { country, month, gross: 0, tax: 0, currency };
      cur.gross += gross; cur.tax += tax; ledger.set(k, cur);
    },
    async salesSince(month) { return [...ledger.values()].filter(r => r.month >= month).map(r => ({ ...r })); },
    async saveRefund(r) { refunds.push({ ...r }); },
    async refundedTotal(purchaseId) { return refunds.filter(r => r.purchaseId === purchaseId).reduce((a, r) => a + r.amount, 0); },
    async nextInvoiceNumber(series) { const n = (counters.get(series) || 0) + 1; counters.set(series, n); return n; },
    async saveInvoice(inv) { invoices.push({ ...inv }); },
    async listInvoices() { return invoices.map(i => ({ ...i })); },
    _raw: { quotes, events, ledger, refunds, invoices },
  };
};

const postgres = (pool) => ({
  kind: 'postgres',
  async saveQuote(q) {
    await pool.query(
      `INSERT INTO quotes (id, report_ref, buyer_session, buyer_country, country_source, currency, property_value, property_currency, depth, rung,
                           amount_net, tax_amount, amount_gross, tax_rate_bps, tax_name, tax_mode, price_book_version, issued_at, expires_at, status, supersedes_id, signature, body)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [q.id, q.ref, q.session, q.buyer.country, q.buyer.source, q.currency, q.property ? q.property.value : null, q.property ? q.property.currency : null, q.depth, q.rung,
       q.netMinor, q.taxMinor, q.grossMinor, q.taxRateBps, q.taxName, q.taxMode, q.priceBookVersion, q.issuedAt, q.expiresAt, q.status, q.supersedes || null, q.signature, JSON.stringify(q)]);
  },
  async getQuote(id) {
    const r = await pool.query(`SELECT body, status FROM quotes WHERE id = $1`, [id]);
    if (!r.rows.length) return null;
    const q = typeof r.rows[0].body === 'string' ? JSON.parse(r.rows[0].body) : r.rows[0].body; q.status = r.rows[0].status; return q;
  },
  async setQuoteStatus(id, status) { await pool.query(`UPDATE quotes SET status = $2 WHERE id = $1`, [id, status]); },
  /** Take an open quote for one checkout. Atomic: of two requests at once, exactly one gets true. */
  async claimQuote(id) { const r = await pool.query(`UPDATE quotes SET status = 'used' WHERE id = $1 AND status = 'open' RETURNING id`, [id]); return r.rows.length > 0; },
  async supersedeOpen({ ref, session, exceptId }) {
    await pool.query(`UPDATE quotes SET status = 'superseded' WHERE report_ref = $1 AND buyer_session = $2 AND status = 'open' AND id <> $3`, [ref, session, exceptId]);
  },
  async addEvent(type, { quoteId = null, ref = null, details = {} } = {}) {
    await pool.query(`INSERT INTO pricing_events (at, type, quote_id, report_ref, details) VALUES (NOW(), $1, $2, $3, $4)`, [type, quoteId, ref, JSON.stringify(details)]);
  },
  async listEvents(filter = {}) {
    const r = await pool.query(`SELECT at, type, quote_id, report_ref, details FROM pricing_events WHERE ($1::text IS NULL OR type = $1) AND ($2::text IS NULL OR quote_id = $2) ORDER BY at ASC LIMIT 500`, [filter.type || null, filter.quoteId || null]);
    return r.rows.map(x => ({ at: x.at, type: x.type, quoteId: x.quote_id, ref: x.report_ref, details: typeof x.details === 'string' ? JSON.parse(x.details) : x.details }));
  },
  async addSale({ country, month, gross, tax, currency }) {
    await pool.query(
      `INSERT INTO tax_ledger (country, month, gross_sales, tax_collected, currency) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (country, month, currency) DO UPDATE SET gross_sales = tax_ledger.gross_sales + EXCLUDED.gross_sales, tax_collected = tax_ledger.tax_collected + EXCLUDED.tax_collected`,
      [country, month, gross, tax, currency]);
  },
  async salesSince(month) {
    const r = await pool.query(`SELECT country, month, gross_sales, tax_collected, currency FROM tax_ledger WHERE month >= $1`, [month]);
    return r.rows.map(x => ({ country: x.country, month: x.month, gross: Number(x.gross_sales), tax: Number(x.tax_collected), currency: x.currency }));
  },
  async saveRefund(r) {
    await pool.query(`INSERT INTO refunds (purchase_id, amount, currency, tax_reversed, reason, provider_ref, status) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [r.purchaseId, r.amount, r.currency, r.taxReversed, r.reason, r.providerRef, r.status]);
  },
  async refundedTotal(purchaseId) {
    const r = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS refunded FROM refunds WHERE purchase_id = $1`, [purchaseId]);
    return Number(r.rows[0].refunded);
  },
  async nextInvoiceNumber(series) {
    const r = await pool.query(`INSERT INTO invoice_counters (series, last) VALUES ($1, 1) ON CONFLICT (series) DO UPDATE SET last = invoice_counters.last + 1 RETURNING last`, [series]);
    return Number(r.rows[0].last);
  },
  async saveInvoice(i) {
    await pool.query(`INSERT INTO invoices (purchase_id, number, kind, country, currency, amount_net, tax_amount, amount_gross, tax_rate_bps, body, issued_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
      [i.purchaseId, i.number, i.kind, i.country, i.currency, i.net, i.tax, i.gross, i.taxRateBps, JSON.stringify(i.body)]);
  },
  async listInvoices() { const r = await pool.query(`SELECT number, kind, country, currency, amount_gross FROM invoices ORDER BY id ASC LIMIT 500`); return r.rows; },
});

function makeStore({ pool } = {}) { return pool ? postgres(pool) : memory(); }
module.exports = { makeStore, memory, postgres };
