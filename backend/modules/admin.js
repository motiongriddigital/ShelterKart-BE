'use strict';
const { purgeDurably, getByRefAsync, listRecentReports, setReview } = require('../engine/research');
const REVIEW = require('../engine/review');
const { senderCheck, findingMatch } = require('../engine/reviews');
const ANALYTICS = require('../engine/analytics');
const { REF_RE } = require('../engine/access');
const PRICING = require('../pricing');
const ENGINES = require('../engines');               // which AI engine serves each agent (backend/engines)
const { refundPurchase, RefundError } = require('../payments/refunds');
const { MARKETS } = require('../engine/markets');
const HEALTH = require('../engine/health');
const PDF = require('../engine/pdf');
const { stageTotals } = require('../engine/jobCosts');
const { adminAuth, requireUuid } = require('../middleware/adminAuth');
const { ah } = require('../middleware/asyncHandler');
const { rateLimit } = require('../middleware/rateLimit');

module.exports = function register(app, c) {
  const { ACCOUNTS, ADMIN_AUDIT, BACKUPS, BULK_SPECS, CONTRACT, DELIVERY, ENGINE_HISTORY, ERRORLOG, REVIEWS, TIMING, auditAdmin, dayOf, investigateCap, liveJobs, marketCap, num, overDailyMax, pgStore, pool, previewBudget, previewPanel, pricingData, pricingStore, purgeLiveJobs, retryFailedReport, runBulk, runSourceHealth, spend } = c;

  // A named person or role who can act on a legal takedown notice. Wiring
  // purgeByUrl/purgeByHost to nothing, as they were, meant a real request
  // to remove a record would be acknowledged and then not actually happen
  // for up to 24 hours -- the exact failure their own comment warns about.
  app.post('/api/admin/purge', adminAuth, ah(async (req, res) => {
    const { url, host } = req.body || {};
    if (!url && !host) return res.status(400).json({ ok: false, error: 'Provide a url or a host.' });
    // Reported as purged only once storage has confirmed the deletion too.
    const { memory, stored } = await purgeDurably(url ? { url } : { host });
    const jobs = purgeLiveJobs(url ? { url } : { host });
    const audited = await auditAdmin(req, { action: 'SOURCE_PURGED', objectType: 'source', after: { purged: memory, purgedFromStorage: stored, savedInvestigations: jobs.removed, stillRunning: jobs.running }, reason: (url ? 'url ' : 'host ') + String(url || host).slice(0, 300) });
    res.json({ ok: true, purged: memory, purgedFromStorage: stored, purgedInvestigations: jobs.removed, investigationsStillRunning: jobs.running, audited });
  }));

  /* A refund, in the original currency and amount (payments/refunds.js). Admin only. */
  app.post('/api/admin/refunds', adminAuth, ah(async (req, res) => {
    const { purchaseId, amount, reason } = req.body || {};
    if (!/^[0-9a-f-]{36}$/i.test(String(purchaseId || ''))) return res.status(400).json({ ok: false, error: 'Invalid purchase id.' });
    try {
      const out = await refundPurchase({ db: pool, data: pricingData, store: pricingStore, purchaseId, amount, reason: String(reason || '').slice(0, 200), env: process.env });
      await pool.query(`INSERT INTO audit_log (actor, action, object_type, object_id, reason) VALUES ('admin','RESEARCH_PURCHASE_REFUNDED','report_purchase',$1,$2)`, [purchaseId, `${out.amount} ${out.currency}${out.full ? ' (full)' : ''}`]);
      res.json({ ok: true, ...out });
    } catch (e) {
      if (e instanceof RefundError) return res.status(409).json({ ok: false, code: e.code, error: e.message });
      throw e;
    }
  }));
  app.get('/api/admin/costs', adminAuth, (req, res) => {
    const r = x => Math.round((x || 0) * 10000) / 10000, jobs = [...liveJobs.values()];
    const paidDone = jobs.filter(j => j.paid && j.status === 'done');
    res.json({ ok: true, today: { date: spend.day || dayOf(), usd: r(spend.usd), byMarket: Object.fromEntries(Object.entries(spend.byMarket).map(([k, v]) => [k, r(v)])) },
      limits: { alertUsd: num('AI_DAILY_ALERT_USD', 0), maxUsd: num('AI_DAILY_MAX_USD', 0), paused: overDailyMax(), capShare: num('AI_CAP_SHARE', 0.30),
        dailyCap: investigateCap(), marketCap: marketCap(), preview: { panel: previewPanel(), ...previewBudget() } },
      perPaidReport: paidDone.length ? r(paidDone.reduce((t, j) => t + (j.costUsd || 0), 0) / paidDone.length) : null,
      reports: jobs.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)).slice(0, 25)
        .map(j => ({ ref: j.ref, market: j.input && j.input.country, status: j.status, paid: Boolean(j.paid), costUsd: r(j.costUsd), stages: stageTotals(j.stageCosts), capUsd: j.capUsd == null ? null : r(j.capUsd) })),
      pdf: PDF.queueState() });
  });
  app.get('/api/admin/delivery', adminAuth, (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ok: true, ...DELIVERY.status(), pdf: PDF.available() }); });
  app.get('/api/admin/engines', adminAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, ...ENGINES.status(process.env) });
  });

  /* Tax exposure: twelve-month sales per country against its registration threshold, and which countries sell and why not. Admin only. */
  app.get('/api/admin/tax', adminAuth, ah(async (req, res) => {
    const progress = await PRICING.ledger.progress({ data: pricingData, store: pricingStore });
    const countries = [...pricingData.countries.values()].filter(c => !c.blocked).map(c => ({ iso: c.iso, name: c.name, ...PRICING.saleStatus(pricingData, c.iso) }));
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, priceBookVersion: pricingData.book.version, progress, onSale: countries.filter(c => c.onSale).map(c => c.iso), off: countries.filter(c => !c.onSale) });
  }));

  /* What the nightly check currently believes about every register. */
  app.get('/api/admin/source-health', adminAuth, ah(async (req, res) => {
    res.json({ ok: true, markets: Object.entries(MARKETS).filter(([, m]) => m.registry).map(([code, m]) => {
      const h = HEALTH.getHealth(code);
      return { market: code, label: m.label, state: h ? h.state : 'not_checked', reason: h && h.reason, detail: h && h.detail,
               consecutiveFailures: h ? h.consecutiveFailures : 0, lastOkAt: h && h.lastOkAt, checkedAt: h && h.checkedAt };
    }) });
  }));
  /* Check now -- after fixing a connector, or when an alert says a register recovered. */
  app.post('/api/admin/source-health/run', adminAuth, ah(async (req, res) => {
    const results = await runSourceHealth();
    if (!results) return res.status(409).json({ ok: false, error: 'A health check is already running.' });
    res.json({ ok: true, results });
  }));

  /* The bulk registers: what each country's last load did, and a way to run one now. A load is one polite download; it never replaces data with a partial file. */
  app.get('/api/admin/bulk-registers', adminAuth, ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const out = [];
    for (const country of Object.keys(BULK_SPECS)) out.push({ country, source: BULK_SPECS[country].url, load: pgStore ? await pgStore.bulkStatus(country).catch(() => null) : null });
    res.json({ ok: true, registers: out });
  }));
  app.post('/api/admin/bulk-registers/run', adminAuth, ah(async (req, res) => {
    const country = String((req.body && req.body.country) || '').toLowerCase();
    if (!BULK_SPECS[country]) return res.status(400).json({ ok: false, error: 'Unknown country.' });
    const r = await runBulk(country, { force: Boolean(req.body && req.body.force) });
    res.status(r.status === 'failed' || r.status === 'busy' ? 409 : 200).json({ ok: r.status === 'ok' || r.status === 'unchanged', ...r });
  }));

  /* The admin Reports panel: recent reports, and any report in full --
     the owner's view, never the paywalled one. Admin-only, like every
     /api/admin route (rate-limited and behind adminAuth). */
  app.get('/api/admin/reports', adminAuth, ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, reports: listRecentReports(100) });
  }));
  app.get('/api/admin/reports/:ref', adminAuth, ah(async (req, res) => {
    const ref = String(req.params.ref || '');
    if (!REF_RE.test(ref)) return res.status(400).json({ ok: false, error: 'Not a valid report reference.' });
    const brief = await getByRefAsync(ref);
    if (!brief) return res.status(404).json({ ok: false, error: 'No such report is held.' });
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, brief });
  }));

  /* The dashboard's numbers, all computed from raw events in one pure
     function (engine/analytics.js aggregate), so every figure is testable. */
  app.get('/api/admin/analytics', adminAuth, ah(async (req, res) => {
    const days = Math.min(400, Math.max(1, parseInt((req.query || {}).days, 10) || 30));
    const now = new Date();
    const since = new Date(now.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10) + 'T00:00:00.000Z';
    const LIMIT = 250000;
    const rows = await ANALYTICS.loadRows(since, LIMIT);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, ...ANALYTICS.aggregate(rows, { days, now, truncated: rows.length >= LIMIT }), stored: Boolean(pgStore) });
  }));
  ACCOUNTS.mount(app);
  ACCOUNTS.mountAdmin(app, { adminAuth });
  ERRORLOG.mountAdmin(app, { adminAuth, ah, rateLimit });
  BACKUPS.mountAdmin(app, { adminAuth, ah, rateLimit });
  require('../engine/adminAudit').mountAudit(app, { adminAuth, wrap: ah, rateLimit, audit: ADMIN_AUDIT });
  require('../engine/jobsAdmin').mountJobsAdmin(app, { adminAuth, wrap: ah, rateLimit, liveJobs, delivery: DELIVERY, retryReport: retryFailedReport, markets: MARKETS, history: days => (pgStore ? pgStore.healthHistory(days) : HEALTH.memoryHistory(days)) });
  require('../engine/enginesAdmin').mountEnginesAdmin(app, { adminAuth, wrap: ah, rateLimit, history: ENGINE_HISTORY, jobs: () => liveJobs.values(),
    pricesFor: async refs => {
      const m = new Map(); if (!process.env.DATABASE_URL || !refs.length) return m;
      const r = await pool.query(`SELECT report_ref, amount, currency FROM report_purchases WHERE report_ref = ANY($1) AND status = 'paid'`, [refs]);
      for (const x of r.rows) { const per = pricingData.book.fx.perUsd[x.currency]; if (per) m.set(x.report_ref, (m.get(x.report_ref) || 0) + Number(x.amount) / per); }
      return m;
    } });
  require('../engine/funnelAdmin').mountFunnelAdmin(app, { adminAuth, wrap: ah, rateLimit, source: process.env.DATABASE_URL ? require('../engine/funnelAdmin').pgSource(pool) : null,
    analytics: async days => {
      const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10) + 'T00:00:00.000Z';
      return ANALYTICS.aggregate(await ANALYTICS.loadRows(since, 250000), { days, now: new Date() });
    } });
  app.get('/api/admin/timing', adminAuth, (req, res) => res.json({ ok: true, ...TIMING.stats() }));
  app.get('/api/admin/contract', adminAuth, (req, res) => res.json({ ok: true, ...CONTRACT.stats() }));
  app.get('/api/admin/stats', adminAuth, ah(async (req, res) => {
    try {
      // "Purchases" means PAID: a pending checkout is not a sale. Leads were
      // only ever created by the retired OTP routes, so they are no longer shown.
      const [paid, pending, openDisputes, pendingResponses] = await Promise.all([
        pool.query(`SELECT COUNT(*) FROM report_purchases WHERE status = 'paid'`),
        pool.query(`SELECT COUNT(*) FROM report_purchases WHERE status = 'pending_payment'`),
        pool.query(`SELECT COUNT(*) FROM disputes WHERE status = 'open'`),
        pool.query(`SELECT COUNT(*) FROM developer_responses WHERE status = 'pending'`),
      ]);
      res.json({
        paidPurchases: Number(paid.rows[0].count),
        pendingCheckouts: Number(pending.rows[0].count),
        openDisputes: Number(openDisputes.rows[0].count),
        pendingResponses: Number(pendingResponses.rows[0].count),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: 'Could not load stats.' });
    }
  }));
  app.get('/api/admin/disputes', adminAuth, ah(async (req, res) => { res.json(await REVIEWS.openDisputes()); }));
  app.post('/api/admin/disputes/:id/resolve', adminAuth, requireUuid, ah(async (req, res) => {
    await REVIEWS.resolveDispute(req.params.id);
    const audited = await auditAdmin(req, { action: 'DISPUTE_RESOLVED', objectType: 'dispute', objectId: req.params.id });
    res.json({ ok: true, audited });
  }));

  /* Pending developer replies, each with what the reviewer needs to judge it: whether the sender's email domain matches
     the developer's own website, and which finding the reply quotes (or that it quotes none of them). */
  app.get('/api/admin/responses', adminAuth, ah(async (req, res) => {
    const rows = await REVIEWS.pendingReplies(), briefs = new Map();
    for (const r of rows) if (!briefs.has(r.report_ref)) briefs.set(r.report_ref, await getByRefAsync(r.report_ref).catch(() => null));
    res.json(rows.map(r => { const b = briefs.get(r.report_ref), i = findingMatch(r.finding_text, b);
      return { ...r, sender_check: senderCheck(r.contact_email, b), developer_site: (b && b.project && b.project.developer_site) || null, finding_match: i, report_available: Boolean(b) }; }));
  }));
  app.post('/api/admin/responses/:id/approve', adminAuth, requireUuid, ah(async (req, res) => {
    await REVIEWS.setReply(req.params.id, 'approved');
    const audited = await auditAdmin(req, { action: 'REPLY_APPROVED', objectType: 'developer_reply', objectId: req.params.id, after: { status: 'approved' } });
    res.json({ ok: true, audited });
  }));
  app.post('/api/admin/responses/:id/reject', adminAuth, requireUuid, ah(async (req, res) => {
    await REVIEWS.setReply(req.params.id, 'rejected');
    const audited = await auditAdmin(req, { action: 'REPLY_REJECTED', objectType: 'developer_reply', objectId: req.params.id, after: { status: 'rejected' } });
    res.json({ ok: true, audited });
  }));

  /* Reports held for a person (ADVERSE_HOLD_MARKETS): the negative findings to check, with their sources. */
  app.get('/api/admin/held', adminAuth, ah(async (req, res) => {
    const out = [];
    for (const r of listRecentReports(300)) {
      const b = await getByRefAsync(r.ref).catch(() => null);
      if (!b || !REVIEW.isHeld(b)) continue;
      out.push({ ref: b.ref, project: b.project && b.project.name, developer: b.project && b.project.developer, market: b.market,
        adverse: REVIEW.adverseIndexes(b).map(i => ({ index: i, claim: b.findings[i].claim, topic: b.findings[i].topic, sources: (b.findings[i].sources || []).slice(0, 5) })) });
    }
    res.json({ ok: true, markets: REVIEW.holdMarkets(), held: out });
  }));
  app.post('/api/admin/held/:ref/approve', adminAuth, ah(async (req, res) => {
    const ref = String(req.params.ref || '');
    if (!REF_RE.test(ref)) return res.status(400).json({ ok: false, error: 'Unknown report reference.' });
    const b = await setReview(ref, { status: 'approved', adverse: REVIEW.adverseIndexes(await getByRefAsync(ref) || {}).length });
    if (!b) return res.status(404).json({ ok: false, error: 'No such report.' });
    const audited = await auditAdmin(req, { action: 'HELD_FINDINGS_RELEASED', objectType: 'report', after: { ref, status: 'approved', adverse: b.review && b.review.adverse }, reason: 'report ' + ref });
    res.json({ ok: true, ref, review: b.review, audited });
  }));
};
