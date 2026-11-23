'use strict';
const bodyGuard = require('../middleware/body');
const { getByRefAsync } = require('../engine/research');
const REVIEW = require('../engine/review');
const BOT = require('../engine/botguard');             // proof-of-work before NEW research (BOT_GUARD)         // licence credits for the official registers a report used          // adverse findings held for a person (ADVERSE_HOLD_MARKETS)
const { paywallActive, REF_RE } = require('../engine/access');
const PRICING = require('../pricing');
const INVESTIGATOR = require('../engine/investigator');
const { renderDossier, head: pageHead, esc: escHtml } = require('../engine/dossierHtml');
const DOSSIER = require('../engine/dossier');
const { rateLimit } = require('../middleware/rateLimit');
const DOSSIER_BRIEF = require('../engine/dossierBrief');
const { reportView } = require('../engine/reportView');
const PAGES = require('../engine/reportPages');
const PDF = require('../engine/pdf');
const { registerBrief, pausedReason } = require('../engine/research');
const PS = require('../engine/previewStates');
const { adminAuth } = require('../middleware/adminAuth');
const { ah } = require('../middleware/asyncHandler');
const { stripPII } = require('../lib/pii');

module.exports = function register(app, c) {
  const { ACCOUNTS, reportReadLimiter, FP, PDFS, makePreviewPdf, pdfCtx, SEARCH, buyerOf, checkoutResearchLimiter, completeLive, fullAccess, indexPreview, investigateCap, investigateDaily, liveEmit, liveIndex, liveJobs, marketCap, newLiveJob, notifyOps, onReportPaid, overDailyMax, persistJob, previewPanel, previewTwin, pricingData, publicEvent, researchLimiter } = c;

  const startsByUser = new Map(), userDailyCap = () => { const v = process.env.INVESTIGATE_PER_USER_DAILY; return v === undefined || v === '' ? 5 : Math.max(0, Math.floor(Number(v)) || 0); };
  const userStartsToday = id => { const today = new Date().toISOString().slice(0, 10), e = startsByUser.get(id); return e && e.day === today ? e.n : 0; };
  const countUserStart = id => { const today = new Date().toISOString().slice(0, 10), e = startsByUser.get(id); startsByUser.set(id, e && e.day === today ? { day: today, n: e.n + 1 } : { day: today, n: 1 }); if (startsByUser.size > 50000) for (const [k, v] of startsByUser) if (v.day !== today) startsByUser.delete(k); };
  const refuse = (res, reason, opts) => { const r = PS.refusal(reason, opts); try { FP.refused(reason); } catch { /* counters are optional */ } return res.status(r.status).json(r.body); };
  const streamsByIp = new Map(), streamCap = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? Math.floor(v) : d; };

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
    if (paused) return refuse(res, 'paused', { text: paused });
    const key = DOSSIER_BRIEF.keyOf(query, location, country), seen = liveIndex.get(key);
    if (seen && Date.now() - seen.at < 30 * 24 * 3600 * 1000 && !['failed', 'interrupted'].includes((liveJobs.get(seen.ref) || {}).status) && (liveJobs.has(seen.ref) || await getByRefAsync(seen.ref))) {
      try { SEARCH.observeInvestigate({ query: stripPII(query), location: stripPII(location), market: SEARCH.marketOfCountry(country), reused: true }); } catch {}
      ACCOUNTS.touch(req, seen.ref);
      return res.json({ ok: true, ref: seen.ref, reused: true });
    }
    const twin = previewTwin(query, location);
    if (twin) {
      try { SEARCH.observeInvestigate({ query: stripPII(query), location: stripPII(location), market: SEARCH.marketOfCountry(country), reused: true }); } catch {}
      ACCOUNTS.touch(req, twin);
      return res.json({ ok: true, ref: twin, reused: true });
    }
    if (BOT.enabled(process.env)) { const v = BOT.verify(b.pow, process.env); if (!v.ok) return res.status(428).json({ ok: false, code: 'challenge', error: 'Please complete the quick check and try again.' }); }
    const who = ACCOUNTS.enabled && typeof ACCOUNTS.user === 'function' ? await ACCOUNTS.user(req) : null;
    if (who && userDailyCap() > 0 && userStartsToday(who.id) >= userDailyCap()) return refuse(res, 'quota');
    const today = new Date().toISOString().slice(0, 10);
    if (investigateDaily.day !== today) { investigateDaily.day = today; investigateDaily.count = 0; investigateDaily.byMarket = {}; }
    if (investigateCap() <= 0) return refuse(res, 'paused', { text: PS.PAUSED_TODAY });
    if (investigateDaily.count >= investigateCap()) return refuse(res, 'daily_cap');
    if (overDailyMax()) return refuse(res, 'daily_budget');
    const mk = country || '??';
    if ((investigateDaily.byMarket[mk] || 0) >= marketCap()) return refuse(res, 'market_cap');
    const running = [...liveJobs.values()].filter(j => j.status === 'sweeping' || j.status === 'completing').length;
    if (running >= (Number(process.env.INVESTIGATE_CONCURRENCY) || 2) * 2) return refuse(res, 'busy');
    investigateDaily.count++; investigateDaily.byMarket[mk] = (investigateDaily.byMarket[mk] || 0) + 1;
    if (who) countUserStart(who.id);
    try { FP.started(); } catch { /* counters are optional */ }
    const ref = DOSSIER_BRIEF.newRef(), input = { query, location, country, market: String(b.market || '').slice(0, 60) };
    ACCOUNTS.touch(req, ref);
    registerBrief(DOSSIER_BRIEF.briefOf({ ref, query, location, country, marketLabel: input.market, phase: 'starting' }));
    liveIndex.set(key, { ref, at: Date.now() });
    const job = newLiveJob(ref, input); job.key = key;
    try { SEARCH.observeInvestigate({ query: stripPII(query), location: stripPII(location), market: SEARCH.marketOfCountry(country), reused: false }); } catch {}   // the new search, in the shadow
    job.inv.sweep({ panel: previewPanel() })
      .then(() => { if (emptyFirstLook(job.inv && job.inv.dossier)) throw new Error('the first look found nothing'); job.status = 'preview'; indexPreview(job, job.inv && job.inv.dossier); persistJob(job); makePreviewPdf(ref); if (job.paid) completeLive(job); getByRefAsync(ref).then(b => SEARCH.afterInvestigation(b, SEARCH.marketOfCountry(country))).catch(() => {}); })
      .catch(e => {
        const note = PS.failureNote('engines_unavailable');
        job.status = 'failed'; job.failReason = note.reason; job.previewFailedAt = Date.now();
        if ((liveIndex.get(key) || {}).ref === ref) liveIndex.delete(key);
        try { FP.failed(); } catch { /* counters are optional */ }
        persistJob(job); console.error('[investigate] sweep failed for ' + ref + ':', e && e.message);
        liveEmit(job, { type: 'error', message: note.error, reason: note.reason, retryAt: note.retryAt });
      });
    res.status(202).json({ ok: true, ref });
  }));
  app.get('/api/investigate/:ref/events', ACCOUNTS.guard, ah(async (req, res) => {
    const ref = String(req.params.ref || ''); if (!REF_RE.test(ref)) return res.status(400).json({ ok: false });
    ACCOUNTS.touch(req, ref);
    const job = liveJobs.get(ref), full = await fullAccess(req, ref, req.query && req.query.t);
    // A stream holds a socket until the job ends, and this route is open to anyone with a reference: cap how many one address and one report may hold.
    const ip = String(req.ip || ''), mine = streamsByIp.get(ip) || 0;
    if (job && (job.listeners.size >= streamCap('EVENT_STREAMS_PER_JOB', 25) || mine >= streamCap('EVENT_STREAMS_PER_IP', 6))) return res.status(429).json({ ok: false, error: 'Too many progress streams are open. Close one and try again.' });
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    if (res.flushHeaders) res.flushHeaders();
    if (job && job.status === 'failed' && !job.paid && !job.events.length && job.previewFailedAt) { const note = PS.failureNote(job.failReason || 'engines_unavailable', { now: job.previewFailedAt }); res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', message: note.error, reason: note.reason, ...(note.retryAt ? { retryAt: note.retryAt } : {}) })}\n\n`); }
    for (const e of (job ? job.events : [])) res.write(`event: ${e.type}\ndata: ${JSON.stringify(full ? e : publicEvent(e))}\n\n`);
    const open = job && (job.status === 'sweeping' || (full && job.status === 'completing'));
    if (!open) return res.end();
    const l = { res, full }; job.listeners.add(l); streamsByIp.set(ip, mine + 1);
    req.on('close', () => { job.listeners.delete(l); const n = (streamsByIp.get(ip) || 1) - 1; if (n > 0) streamsByIp.set(ip, n); else streamsByIp.delete(ip); });
  }));
  app.post('/api/investigate/:ref/contact', ACCOUNTS.guard, checkoutResearchLimiter, ah(async (req, res) => {
    const ref = String(req.params.ref || ''); if (!REF_RE.test(ref)) return res.status(400).json({ ok: false, error: 'Unknown report reference.' });
    const brief = await getByRefAsync(ref); if (!brief || brief.kind !== 'dossier') return res.status(404).json({ ok: false, error: 'Unknown report.' });
    if (ACCOUNTS.enabled) return res.json({ ok: true });
    const c = DOSSIER_BRIEF.cleanContact(req.body || {}); if (c.error) return res.status(400).json({ ok: false, error: c.error });
    const job = liveJobs.get(ref);
    if (job && job.paid && !(await fullAccess(req, ref, req.query && req.query.t))) return res.status(403).json({ ok: false, code: 'contact_locked', error: 'This report is paid for. Open it from your link to change where it is sent.' });
    if (job) { job.contact = c.contact; persistJob(job); }
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
    res.send(PAGES.previewPage(brief.dossier, { ref, price, country: buyer.country, held: REVIEW.isHeld(brief), payments: paywallActive(process.env), pdf: PDF.available() }));
  }));
  app.get('/api/report/:ref', ACCOUNTS.guard, reportReadLimiter, ah(async (req, res) => {
    const ref = String(req.params.ref || '');
    if (!REF_RE.test(ref)) return res.status(400).json({ ok: false, error: 'Not a valid report reference.' });
    const brief = await getByRefAsync(ref);
    const failedJob = liveJobs.get(ref);
    if ((!brief || brief.kind !== 'dossier') && !(failedJob && failedJob.status === 'failed' && !failedJob.paid && failedJob.previewFailedAt)) return res.status(404).json({ ok: false, error: 'That report was not found.' });
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    if (failedJob && failedJob.status === 'failed' && !failedJob.paid && (failedJob.previewFailedAt || !(brief && brief.dossier))) {
      const note = PS.failureNote(failedJob.failReason || 'engines_unavailable', { now: failedJob.previewFailedAt || Date.now() });
      return res.json({ ok: true, ready: false, state: 'unavailable', ref, phase: 'failed', ...note });
    }
    if (!brief.dossier) {
      return res.status(202).json({ ok: true, ready: false, state: 'working', ref, phase: brief.phase || 'starting' });
    }
    ACCOUNTS.touch(req, ref);
    const full = !paywallActive(process.env) || await fullAccess(req, ref, (req.query && req.query.t) || req.get('x-report-access'));
    const held = REVIEW.isHeld(brief);
    res.json({ ok: true, ready: true, held, report: reportView(brief.dossier, { locked: !full, ref }), pdf: PDFS.describe(brief, { kind: full ? 'full' : 'preview', ctx: pdfCtx(ref), held }) });
  }));
  const emptyFirstLook = d => !d || !d.counts || !((d.counts.facts || 0) > 0 || (d.counts.questions || 0) > 0);
  const sendPdf = async (res, out, name, extra = {}) => {
    const buf = out.buffer || await require('fs').promises.readFile(out.path);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': String(buf.length), 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', ...extra });
    res.send(buf);
  };
  const pdfProblem = (res, e) => {
    const map = { pdf_unavailable: [503, 'PDF download is not available yet. Open the report and use your browser\'s print to save a PDF.'], pdf_pending: [404, 'No report yet.'], pdf_held: [423, 'A person is checking this report before it can be released.'] };
    const hit = e && map[e.code]; if (!hit) return false;
    res.status(hit[0]).json({ ok: false, code: e.code, error: hit[1] }); return true;
  };
  const pdfOnce = async (res, brief, opts, extra) => {
    let out;
    try { out = await PDFS.serve(brief, opts); await sendPdf(res, out, PDFS.filenameOf(brief, opts.kind), extra && extra(out)); }
    catch (e) {
      if (e && e.code === 'ENOENT' && out) { out = await PDFS.serve(brief, opts); return sendPdf(res, out, PDFS.filenameOf(brief, opts.kind), extra && extra(out)); }
      throw e;
    }
  };
  app.get('/r/:ref/preview.pdf', ah(async (req, res) => {
    const ref = String(req.params.ref || '');
    const brief = REF_RE.test(ref) ? await getByRefAsync(ref) : null;
    if (!brief || brief.kind !== 'dossier' || !brief.dossier) return res.status(404).json({ ok: false, error: 'That report was not found.' });
    ACCOUNTS.touch(req, ref);
    try { await pdfOnce(res, brief, { kind: 'preview', ctx: pdfCtx(ref), held: REVIEW.isHeld(brief) }); }
    catch (e) { if (!pdfProblem(res, e)) throw e; }
  }));
  /* Check a copy of a report: the stamp printed in the full PDF is a short fingerprint of the report's content. Anyone holding the
     document (a lawyer, a bank) can open its address and see whether it matches the report on file. It answers match or no match and
     shows nothing else from the report, so it needs no sign-in. Held reports are not checked. */
  const verifyLimiter = rateLimit({ windowMs: 3600e3, max: 60, message: 'Too many checks from this connection. Please try again later.' });
  app.get('/r/:ref/verify/:code', verifyLimiter, ah(async (req, res) => {
    const ref = String(req.params.ref || ''), code = String(req.params.code || '').toLowerCase();
    const send = (status, result, title, text) => res.status(status).set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Verify-Result': result, 'Content-Type': 'text/html; charset=utf-8' })
      .send(pageHead('Check a report copy') + `<h1 style="margin-top:2rem">${escHtml(title)}</h1><p>${escHtml(text)}</p><p class="small">Reference ${escHtml(REF_RE.test(ref) ? ref : '(not valid)')}. Research, not advice.</p></main></body></html>`);
    if (!REF_RE.test(ref) || !DOSSIER.FINGERPRINT_RE.test(code)) return send(400, 'invalid', 'That address is not valid', 'Open the check address exactly as it is printed in the report, under "This copy\'s stamp".');
    const brief = await getByRefAsync(ref);
    if (!brief || brief.kind !== 'dossier' || !brief.dossier) return send(404, 'unknown', 'No report on file with that reference', 'We hold no report under this reference, so this copy cannot be checked.');
    if (REVIEW.isHeld(brief)) return send(423, 'held', 'This report is being checked', 'A person is checking this report before it can be released. Try again later.');
    const want = Buffer.from(DOSSIER.fingerprint(brief.dossier)), got = Buffer.from(code);
    const match = want.length === got.length && require('crypto').timingSafeEqual(want, got);
    return match
      ? send(200, 'match', 'This copy matches the report on file', `The fingerprint is the same as the report we hold, researched to ${brief.dossier.asOf || 'the date shown in the report'}. Its content has not been changed. A match is not an endorsement.`)
      : send(200, 'mismatch', 'This copy does not match the report on file', 'Either the document was edited, or the report has been corrected or updated since this copy was made. Ask the person who gave it to you for the current version.');
  }));

  app.get('/r/:ref/pdf', ACCOUNTS.guard, ah(async (req, res) => {
    const ref = String(req.params.ref || ''); const t = String((req.query && req.query.t) || '');
    if (!REF_RE.test(ref)) return res.status(403).json({ ok: false, error: 'This link has expired or is not valid.' });
    if (!(await fullAccess(req, ref, t))) {
      if (t) return res.status(403).json({ ok: false, error: 'This link has expired or is not valid.' });
      return res.status(403).json({ ok: false, code: 'payment_required', error: 'Unlock the full report to download this PDF. The free preview PDF is available.', previewPdf: `/r/${ref}/preview.pdf` });
    }
    const brief = await getByRefAsync(ref); if (!brief || !brief.dossier) return res.status(404).json({ ok: false, error: 'No report yet.' });
    try { await pdfOnce(res, brief, { kind: 'full', held: REVIEW.isHeld(brief) }, out => (out.stored ? {} : { 'X-Report-Phase': String(brief.dossier.phase || 'working') })); }
    catch (e) { if (!pdfProblem(res, e)) throw e; }
  }));
};
