'use strict';
const bodyGuard = require('../middleware/body');
const { getByRefAsync } = require('../engine/research');
const REVIEW = require('../engine/review');
const BOT = require('../engine/botguard');             // proof-of-work before NEW research (BOT_GUARD)         // licence credits for the official registers a report used          // adverse findings held for a person (ADVERSE_HOLD_MARKETS)
const { paywallActive, REF_RE } = require('../engine/access');
const PRICING = require('../pricing');
const INVESTIGATOR = require('../engine/investigator');
const { renderDossier } = require('../engine/dossierHtml');
const DOSSIER_BRIEF = require('../engine/dossierBrief');
const PAGES = require('../engine/reportPages');
const PDF = require('../engine/pdf');
const { registerBrief, pausedReason } = require('../engine/research');
const { adminAuth } = require('../middleware/adminAuth');
const { ah } = require('../middleware/asyncHandler');
const { stripPII } = require('../lib/pii');

module.exports = function register(app, c) {
  const { ACCOUNTS, SEARCH, buyerOf, checkoutResearchLimiter, completeLive, fullAccess, investigateCap, investigateDaily, liveEmit, liveIndex, liveJobs, marketCap, newLiveJob, notifyOps, onReportPaid, overDailyMax, persistJob, previewPanel, pricingData, publicEvent, researchLimiter } = c;

  /* Which AI engine serves each agent, in what fail-over order, and what each did since the server started. Never shows a key. Admin only. */
  /* ------------------------------------------------------------------
   * The investigator (pilot, admin only): a panel of AI engines investigates a property, follows every lead,
   * and produces the questions-first due-diligence report. Progress streams as Server-Sent Events.
   * Jobs live in memory for a day; INVESTIGATE_CONCURRENCY caps how many run at once (default 2).
   * ------------------------------------------------------------------ */
  const investigations = new Map();
  const INVESTIGATION_TTL = 24 * 3600 * 1000;
  function sweepInvestigations() { const cut = Date.now() - INVESTIGATION_TTL; for (const [id, j] of investigations) if (j.created < cut && j.status !== 'running') investigations.delete(id); }
  function pushInvestigationEvent(job, ev) {
    const slim = ev.dossier ? { type: ev.type, stage: ev.stage, round: ev.round, counts: ev.dossier.counts } : ev;
    job.events.push({ at: Date.now(), ...slim });
    if (ev.dossier) job.dossier = ev.dossier;
    for (const res of job.listeners) { try { res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev.dossier ? { ...slim, dossier: ev.dossier } : slim)}\n\n`); } catch { /* client gone */ } }
  }
  app.post('/api/admin/investigate', adminAuth, bodyGuard.json({ limit: '20kb' }), (req, res) => {
    sweepInvestigations();
    const b = req.body || {};
    const query = String(b.query || '').trim().slice(0, 200);
    if (query.length < 3) return res.status(400).json({ ok: false, error: 'Name the property to investigate.' });
    const running = [...investigations.values()].filter(j => j.status === 'running').length;
    if (running >= (Number(process.env.INVESTIGATE_CONCURRENCY) || 2)) return res.status(429).json({ ok: false, error: 'Investigations are already running. Try again when one finishes.' });
    const id = require('crypto').randomBytes(9).toString('base64url');
    const job = { id, query, status: 'running', created: Date.now(), events: [], listeners: new Set(), dossier: null, error: '' };
    investigations.set(id, job);
    const languages = Array.isArray(b.languages) ? b.languages.slice(0, 4).map(String) : [];
    INVESTIGATOR.investigate({ query, location: String(b.location || '').slice(0, 120), market: String(b.market || '').slice(0, 60), languages }, { onEvent: ev => pushInvestigationEvent(job, ev) })
      .then(d => { job.status = 'done'; job.dossier = d; })
      .catch(e => { notifyOps('a paid report failed', `Report ${job.ref} failed while running after payment. The buyer has paid and has not received a complete report. Error: ${String((e && e.message) || e).slice(0, 160)}`); job.status = 'failed'; job.error = String((e && e.message) || e).slice(0, 200); pushInvestigationEvent(job, { type: 'error', message: job.error }); })
      .finally(() => { for (const r of job.listeners) { try { r.end(); } catch { /* gone */ } } job.listeners.clear(); });
    res.status(202).json({ ok: true, id, events: `/api/admin/investigate/${id}/events`, report: `/api/admin/investigate/${id}/report` });
  });
  app.get('/api/admin/investigate/:id', adminAuth, (req, res) => {
    const job = investigations.get(req.params.id); if (!job) return res.status(404).json({ ok: false, error: 'No such investigation.' });
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, id: job.id, query: job.query, status: job.status, error: job.error, events: job.events, dossier: job.dossier });
  });
  app.get('/api/admin/investigate/:id/events', adminAuth, (req, res) => {
    const job = investigations.get(req.params.id); if (!job) return res.status(404).json({ ok: false, error: 'No such investigation.' });
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders && res.flushHeaders();
    for (const ev of job.events) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    if (job.dossier) res.write(`event: update\ndata: ${JSON.stringify({ type: 'update', dossier: job.dossier })}\n\n`);
    if (job.status !== 'running') return res.end();
    job.listeners.add(res); req.on('close', () => job.listeners.delete(res));
  });
  app.get('/api/admin/investigate/:id/report', adminAuth, (req, res) => {
    const job = investigations.get(req.params.id); if (!job || !job.dossier) return res.status(404).json({ ok: false, error: 'No report yet.' });
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.send(renderDossier(job.dossier));
  });
  app.get('/start', ah(async (req, res) => {
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.send(PAGES.startPage({ botGuard: BOT.enabled(process.env), country: (await buyerOf(req)).country }));
  }));
  app.get('/assets/report-live.js', (req, res) => { res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300' }); res.send(PAGES.SCRIPT); });
  app.post('/api/investigate', ACCOUNTS.guardStart, researchLimiter, ah(async (req, res) => {
    const b = req.body || {};
    const query = String(b.query || '').trim(), location = String(b.location || '').trim().slice(0, 120), country = PRICING.cleanCode(b.country) || '';
    if (query.length < 3 || query.length > 120) return res.status(400).json({ ok: false, error: 'Name the project, in 3 to 120 characters.' });
    const paused = pausedReason(process.env, country.toLowerCase());
    if (paused) return res.status(503).json({ ok: false, code: 'paused', error: paused });
    const key = DOSSIER_BRIEF.keyOf(query, location, country), seen = liveIndex.get(key);
    if (seen && Date.now() - seen.at < 30 * 24 * 3600 * 1000 && (liveJobs.has(seen.ref) || await getByRefAsync(seen.ref))) {
      try { SEARCH.observeInvestigate({ query: stripPII(query), location: stripPII(location), market: SEARCH.marketOfCountry(country), reused: true }); } catch {}
      ACCOUNTS.touch(req, seen.ref);
      return res.json({ ok: true, ref: seen.ref, reused: true });
    }
    if (BOT.enabled(process.env)) { const v = BOT.verify(b.pow, process.env); if (!v.ok) return res.status(428).json({ ok: false, code: 'challenge', error: 'Please complete the quick check and try again.' }); }
    const today = new Date().toISOString().slice(0, 10);
    if (investigateDaily.day !== today) { investigateDaily.day = today; investigateDaily.count = 0; investigateDaily.byMarket = {}; }
    if (investigateCap() <= 0 || investigateDaily.count >= investigateCap()) return res.status(503).json({ ok: false, code: 'paused', error: 'New investigations are paused for today. Projects already investigated are still available.' });
    if (overDailyMax()) return res.status(503).json({ ok: false, code: 'paused', error: 'New investigations are paused for today. Projects already investigated are still available.' });
    const mk = country || '??';
    if ((investigateDaily.byMarket[mk] || 0) >= marketCap()) return res.status(503).json({ ok: false, code: 'paused', error: 'New investigations in this market are paused for today. Projects already investigated are still available.' });
    const running = [...liveJobs.values()].filter(j => j.status === 'sweeping' || j.status === 'completing').length;
    if (running >= (Number(process.env.INVESTIGATE_CONCURRENCY) || 2) * 2) return res.status(429).json({ ok: false, error: 'Many investigations are running. Please try again in a few minutes.' });
    investigateDaily.count++; investigateDaily.byMarket[mk] = (investigateDaily.byMarket[mk] || 0) + 1;
    const ref = DOSSIER_BRIEF.newRef(), input = { query, location, country, market: String(b.market || '').slice(0, 60) };
    ACCOUNTS.touch(req, ref);
    registerBrief(DOSSIER_BRIEF.briefOf({ ref, query, location, country, marketLabel: input.market, phase: 'starting' }));
    liveIndex.set(key, { ref, at: Date.now() });
    const job = newLiveJob(ref, input); job.key = key;
    try { SEARCH.observeInvestigate({ query: stripPII(query), location: stripPII(location), market: SEARCH.marketOfCountry(country), reused: false }); } catch {}   // the new search, in the shadow
    job.inv.sweep({ panel: previewPanel() })
      .then(() => { job.status = 'preview'; persistJob(job); if (job.paid) completeLive(job); getByRefAsync(ref).then(b => SEARCH.afterInvestigation(b, SEARCH.marketOfCountry(country))).catch(() => {}); })
      .catch(e => { job.status = 'failed'; persistJob(job); console.error('[investigate] sweep failed for ' + ref + ':', e && e.message); liveEmit(job, { type: 'error', message: 'The investigation could not run just now. Please try again later.' }); });
    res.status(202).json({ ok: true, ref });
  }));
  app.get('/api/investigate/:ref/events', ACCOUNTS.guard, ah(async (req, res) => {
    const ref = String(req.params.ref || ''); if (!REF_RE.test(ref)) return res.status(400).json({ ok: false });
    ACCOUNTS.touch(req, ref);
    const job = liveJobs.get(ref), full = await fullAccess(req, ref, req.query && req.query.t);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    if (res.flushHeaders) res.flushHeaders();
    for (const e of (job ? job.events : [])) res.write(`event: ${e.type}\ndata: ${JSON.stringify(full ? e : publicEvent(e))}\n\n`);
    const open = job && (job.status === 'sweeping' || (full && job.status === 'completing'));
    if (!open) return res.end();
    const l = { res, full }; job.listeners.add(l); req.on('close', () => job.listeners.delete(l));
  }));
  app.post('/api/investigate/:ref/contact', ACCOUNTS.guard, checkoutResearchLimiter, ah(async (req, res) => {
    const ref = String(req.params.ref || ''); if (!REF_RE.test(ref)) return res.status(400).json({ ok: false, error: 'Unknown report reference.' });
    const brief = await getByRefAsync(ref); if (!brief || brief.kind !== 'dossier') return res.status(404).json({ ok: false, error: 'Unknown report.' });
    if (ACCOUNTS.enabled) return res.json({ ok: true });
    const c = DOSSIER_BRIEF.cleanContact(req.body || {}); if (c.error) return res.status(400).json({ ok: false, error: c.error });
    const job = liveJobs.get(ref); if (job) { job.contact = c.contact; persistJob(job); }
    registerBrief({ ...brief, contact: c.contact });
    res.json({ ok: true });
  }));
  app.get('/r/:ref', ACCOUNTS.guardPage, ah(async (req, res) => {
    const ref = String(req.params.ref || '');
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    const brief = REF_RE.test(ref) ? await getByRefAsync(ref) : null;
    if (!brief || brief.kind !== 'dossier') return res.status(404).send(PAGES.startPage({ botGuard: BOT.enabled(process.env) }).replace('Know who you are paying, before you pay.', 'That report was not found. Start a new one.'));
    if (!brief.dossier) return res.send(PAGES.workingPage({ ref, query: brief.project.name }));
    ACCOUNTS.touch(req, ref);
    const t = String((req.query && req.query.t) || '');
    if (await fullAccess(req, ref, t)) {
      if (brief.dossier.phase !== 'complete') onReportPaid(ref);   // a paid report that is not yet complete (for example after a restart) continues
      return res.send(PAGES.fullPage(brief.dossier, { ref, token: t, pdf: PDF.available() }));
    }
    // An unknown visitor is priced in the project's own country; a visitor whose country is known keeps their own.
    let buyer = await buyerOf(req);
    if (buyer.source === 'default' && brief.market) buyer = await buyerOf({ ...req, body: {}, query: { country: brief.market.toUpperCase() } });
    let price = null;
    try { const f = PRICING.previewFee(pricingData, brief, buyer); price = { display: f.currency === 'INR' ? '₹' + Number(f.price).toLocaleString('en-IN') : `${f.currency} ${f.price}`, line: 'Set by the property\'s value and the depth of the research. The amount you pay is confirmed before payment.' }; } catch { price = null; }
    res.send(PAGES.previewPage(brief.dossier, { ref, price, country: buyer.country, held: REVIEW.isHeld(brief), payments: paywallActive(process.env) }));
  }));
  app.get('/r/:ref/pdf', ACCOUNTS.guard, ah(async (req, res) => {
    const ref = String(req.params.ref || ''); const t = String((req.query && req.query.t) || '');
    if (!REF_RE.test(ref) || !(await fullAccess(req, ref, t))) return res.status(403).json({ ok: false, error: 'This link has expired or is not valid.' });
    const brief = await getByRefAsync(ref); if (!brief || !brief.dossier) return res.status(404).json({ ok: false, error: 'No report yet.' });
    try {
      const pdf = await PDF.renderPdf(renderDossier(brief.dossier), { footer: `ShelterKart report: ${brief.project.name}. ${ref}. Research, not advice.` });
      const name = 'ShelterKart-Report-' + String(brief.project.name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.pdf';
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
      res.send(pdf);
    } catch (e) {
      if (e && e.code === 'pdf_unavailable') return res.status(503).json({ ok: false, error: 'PDF download is not available yet. Open the report and use your browser\'s print to save a PDF.' });
      throw e;
    }
  }));
};
