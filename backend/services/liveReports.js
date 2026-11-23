'use strict';
const { issueToken } = require('../engine/access');
const { cites } = require('../engine/briefPages');
const PRICING = require('../pricing');
const INVESTIGATOR = require('../engine/investigator');
const DOSSIER_BRIEF = require('../engine/dossierBrief');
const { alertOperator, pdfAttachment } = require('../engine/delivery');
const { reportLink } = require('../engine/delivery');
const { registerBrief, getByRef } = require('../engine/research');
const { createPdfDocs } = require('../engine/pdfDocs');
const PREVIEW_STATES = require('../engine/previewStates');
const REVIEW = require('../engine/review');
const { costedEngines, addStageCost } = require('../engine/jobCosts');
const ROOT = require('path').resolve(__dirname, '..');

module.exports = function setup(c) {
  const { ACCOUNTS, RESPONSES, pool, pricingData, tokenGrants } = c;
  const FP = PREVIEW_STATES.createDayCounters();
  const PDFS = c.PDFS || createPdfDocs({ pdf: require('../engine/pdf'), env: process.env });
  const pdfCtx = ref => ({ link: reportLink(process.env, ref, '').replace(/\?t=$/, '') });

  /* ------------------------------------------------------------------
   * The investigator for buyers. /start names a property; /r/:ref shows the free preview (the panel's first sweep) with
   * the unlock form; payment goes through the SAME quote, checkout, Razorpay verification and webhook as every report,
   * because each investigation is stored under a normal report ref. When a purchase is marked paid, the investigation
   * continues (lead-following, the reviewer, the question writer) and the buyer is sent the link and the PDF.
   * Live progress streams as Server-Sent Events; the public stream never carries paid content.
   * Settings: INVESTIGATE_DAILY_CAP (100; 0 pauses), INVESTIGATE_MARKET_DAILY_CAP (40% of the daily cap, at least 5),
   * INVESTIGATE_PREVIEW_PANEL (1 engine for the free sweep), PREVIEW_SEARCHES (6) and PREVIEW_FETCHES (2) for its depth,
   * AI_CAP_SHARE (0.30: a report's AI spend stops at that share of its net price), AI_DAILY_ALERT_USD (warn) and
   * AI_DAILY_MAX_USD (new free previews pause for the day), LIVE_JOBS_DIR (saved investigations), INVESTIGATE_CONCURRENCY,
   * PUBLIC_BASE_URL (links in messages), and the delivery providers (engine/delivery.js).
   * ------------------------------------------------------------------ */
  const notifyOps = (subject, text) => { alertOperator(process.env, subject, text).catch(() => {}); };
  const DELIVERY = require('../engine/delivery').createDelivery({ env: process.env,
    onGiveUp: x => notifyOps('a report could not be delivered', `Report ${x.ref} (${x.channel}) failed after every retry, so the buyer has not received it by ${x.channel}. Their report link still works. Last error: ${x.error}`) });
  const liveJobs = new Map();       // ref -> the running or finished investigation behind a buyer's report
  const liveIndex = new Map();      // project key -> { ref, at }: the same project is not investigated twice in 30 days
  const investigateDaily = { day: '', count: 0, byMarket: {} };
  /* The same project under a different name: once a report is complete, its registration numbers point to it for 30 days.
     A later buyer of the same registered project gets that report, and its research is not paid for again. */
  const regIndex = new Map();       // registration number -> { ref, at }
  const previewIndex = new Map();   // registration number -> { ref, at }: a first look already made for that registered project (the preview is reusable too)
  /* A registration number that can identify a project: at least 8 characters with a digit. A short id from a model's output (a year, a plot number) would hand a buyer another project's report. */
  const regIdsOf = d => ((d && d.project && d.project.ids) || []).map(x => String(x).toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(x => x.length >= 8 && /\d/.test(x));
  const COMPANY_NOISE = new Set(['private', 'limited', 'pvt', 'ltd', 'llp', 'llc', 'plc', 'inc', 'corporation', 'corp', 'company', 'co', 'the']);
  const companyKey = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(w => w && !COMPANY_NOISE.has(w)).join(' ');
  /* The same registered project means the same developer: the registered company when both reports name one, else the brand. A report that names neither is never a twin. */
  function sameDeveloper(a, b) {
    const pa = a && a.project || {}, pb = b && b.project || {}, la = companyKey(pa.promoter_legal_name), lb = companyKey(pb.promoter_legal_name);
    if (la && lb) return la === lb;
    const ba = companyKey(pa.brand), bb = companyKey(pb.brand);
    return Boolean(ba && bb && ba === bb);
  }
  function indexFinished(job, d) { for (const id of regIdsOf(d)) regIndex.set(id, { ref: job.ref, at: Date.now() }); }
  function indexPreview(job, d, at = Date.now()) { for (const id of regIdsOf(d)) previewIndex.set(id, { ref: job.ref, at }); }
  /* A buyer who types a registration number that a first look already holds (and the project's name differently) gets that report instead of a second sweep.
     The number must be at least 8 characters with a digit, so a short word or year in a name never matches. Failed and interrupted jobs are never reused. */
  function previewTwin(query, location) {
    const typed = String(query || '').toUpperCase().replace(/[^A-Z0-9]/g, '') + String(location || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    for (const idx of [previewIndex, regIndex]) for (const [id, hit] of idx) {
      if (id.length < 8 || !/\d/.test(id) || !typed.includes(id) || Date.now() - hit.at > 30 * 24 * 3600 * 1000) continue;
      const j = liveJobs.get(hit.ref); if (j && !['failed', 'interrupted'].includes(j.status)) return hit.ref;
    }
    return null;
  }
  function finishedTwin(job) {
    const d = (job.inv && job.inv.dossier) || (job.saved && job.saved.dossier);
    for (const id of regIdsOf(d)) {
      const hit = regIndex.get(id); if (!hit || hit.ref === job.ref || Date.now() - hit.at > 30 * 24 * 3600 * 1000) continue;
      const twin = liveJobs.get(hit.ref);
      const done = twin && twin.status === 'done' && ((twin.inv && twin.inv.dossier) || (twin.saved && twin.saved.dossier));
      if (done && done.phase === 'complete' && String((twin.input || {}).country || '').toUpperCase() === String((job.input || {}).country || '').toUpperCase() && sameDeveloper(d, done)) return { ref: hit.ref, dossier: done };
    }
    return null;
  }
  const JOBS = require('../engine/jobStore').createJobStore({ dir: process.env.LIVE_JOBS_DIR || require('path').join(ROOT, 'data', 'live-jobs') });
  const dayOf = () => new Date().toISOString().slice(0, 10);
  const num = (k, d) => { const v = process.env[k]; return v === undefined || v === '' ? d : Number(v); };
  const previewBudget = () => ({ searches: num('PREVIEW_SEARCHES', 6), fetches: num('PREVIEW_FETCHES', 2) });
  const previewPanel = () => num('INVESTIGATE_PREVIEW_PANEL', 1) || 1;
  const marketCap = () => num('INVESTIGATE_MARKET_DAILY_CAP', Math.max(5, Math.ceil(investigateCap() * 0.4)));

  /* What the AI is costing: today's total and by market, and each report's own total (from engine/jobCosts.js). */
  const spend = { day: '', usd: 0, byMarket: {}, alerted: false };
  function addSpend(job, usd, info) {
    if (!(usd > 0)) return;
    addStageCost(job.stageCosts || (job.stageCosts = {}), usd, info);
    const d = dayOf(); if (spend.day !== d) Object.assign(spend, { day: d, usd: 0, byMarket: {}, alerted: false });
    const m = String(job.input.country || '').toUpperCase() || '??';
    spend.usd += usd; spend.byMarket[m] = (spend.byMarket[m] || 0) + usd; job.costUsd = (job.costUsd || 0) + usd;
    const alert = num('AI_DAILY_ALERT_USD', 0);
    if (alert > 0 && !spend.alerted && spend.usd >= alert) { spend.alerted = true; console.warn(`[costs] AI spend today has passed $${alert}: $${spend.usd.toFixed(2)}`); }
  }
  const overDailyMax = () => { const m = num('AI_DAILY_MAX_USD', 0); return m > 0 && spend.day === dayOf() && spend.usd >= m; };
  /** The most a paid report may spend on AI: AI_CAP_SHARE (30%) of its net price in the project's own country. */
  function aiCapFor(brief) {
    const share = num('AI_CAP_SHARE', 0.30);
    try {
      const f = PRICING.previewFee(pricingData, brief, PRICING.resolveBuyer(pricingData, { selected: String(brief.market || 'in').toUpperCase() }));
      const usd = (f.net != null ? f.net : f.price) / pricingData.book.fx.perUsd[f.currency];
      if (Number.isFinite(usd) && usd > 0) return usd * share;
    } catch { /* fall back */ }
    return num('AI_CAP_FALLBACK_USD', 6);
  }
  /* A legal takedown also clears the saved investigations that cite the page: their files would otherwise bring a withdrawn page back after a
     restart. A job still working is left alone (its work is not stopped halfway) and counted, so the operator can repeat the call. */
  function purgeLiveJobs({ url, host }) {
    let removed = 0, running = 0;
    for (const [ref, job] of liveJobs) {
      const d = (job.inv && job.inv.dossier) || (job.saved && job.saved.dossier);
      if (!d || !cites({ dossier: d }, { url, host })) continue;
      if (job.status === 'sweeping' || job.status === 'completing') { running++; continue; }
      dropLiveJob(ref);
      removed++;
    }
    return { removed, running };
  }
  /* A saved investigation is kept as long as the report it belongs to (30 days, the published schedule), then deleted, file and memory together.
     A paid report that has neither finished nor failed is never deleted: it is still owed to the buyer. */
  const jobTtlMs = () => num('JOB_RETENTION_DAYS', 30) * 24 * 3600 * 1000;
  const jobIsStale = (rec, now = Date.now()) => {
    if (rec.status === 'sweeping' || rec.status === 'completing' || rec.completing) return false;
    if (rec.paid && rec.status !== 'done' && rec.status !== 'failed') return false;
    return now - (rec.updatedAt || rec.createdAt || 0) > jobTtlMs();
  };
  function dropLiveJob(ref) {
    liveJobs.delete(ref); JOBS.remove(ref);
    try { PDFS.dropRef(ref); } catch (e) { console.error('[pdf] could not remove the files of ' + ref + ':', e && e.message); }
    for (const [k, v] of liveIndex) if (v.ref === ref) liveIndex.delete(k);
    for (const [k, v] of regIndex) if (v.ref === ref) regIndex.delete(k);
    for (const [k, v] of previewIndex) if (v.ref === ref) previewIndex.delete(k);
  }
  function pruneLiveJobs(now = Date.now()) {
    let removed = 0;
    for (const [ref, job] of liveJobs) if (jobIsStale(job, now)) { dropLiveJob(ref); removed++; }
    return removed;
  }
  function persistJob(job) {
    job.updatedAt = Date.now();
    const saved = job.inv ? job.inv.exportState() : (job.saved || null);
    JOBS.save({ ref: job.ref, input: job.input, key: job.key || null, status: job.status, paid: Boolean(job.paid), purchaseId: job.purchaseId || null, contact: job.contact || null,
      costUsd: job.costUsd || 0, stageCosts: job.stageCosts || null, capUsd: job.capUsd == null ? null : job.capUsd, delivered: Boolean(job.delivered), createdAt: job.createdAt || Date.now(),
      failedAt: job.failedAt || null, failError: job.failError || null, failReason: job.failReason || null, previewFailedAt: job.previewFailedAt || null, updatedAt: job.updatedAt, saved });
    /* A job that is not working keeps only its saved state, not the whole running investigation, for as long as it is kept (30 days): an unpaid first look, a finished
       report, a failed one. A paid completion that needs it again rebuilds it from that state, exactly as after a restart. */
    if (job.inv && (job.status === 'done' || job.status === 'failed' || (job.status === 'preview' && !job.paid))) { job.saved = saved; job.inv = null; }
  }
  const fullAccess = (req, ref, token) => (ACCOUNTS.enabled ? ACCOUNTS.entitled(req, ref) : tokenGrants(token ? String(token) : '', ref));
  const ownsPurchase = async (req, purchaseId) => { const u = await ACCOUNTS.user(req); return Boolean(u) && (await pool.query(`SELECT 1 FROM report_purchases WHERE id=$1 AND user_id=$2`, [purchaseId, u.id])).rows.length > 0; };
  const grantOf = (ref, purchaseId) => (ACCOUNTS.enabled ? { ok: true, entitled: true } : { ok: true, token: issueToken(ref, process.env.ACCESS_TOKEN_SECRET, 30, Date.now(), purchaseId) });
  const investigateCap = () => { const v = process.env.INVESTIGATE_DAILY_CAP; return v === undefined || v === '' ? 100 : Number(v); };
  const publicEvent = e => ({ type: e.type, stage: e.stage, phase: e.phase, counts: e.counts, ...(e.stage === 'sweep' || e.type === 'error' ? { message: e.message } : {}), ...(e.type === 'error' && e.reason ? { reason: e.reason, ...(e.retryAt ? { retryAt: e.retryAt } : {}) } : {}) });
  function saveLiveDossier(job, d) {
    d.ref = job.ref;
    const prev = getByRef(job.ref) || {};
    registerBrief(DOSSIER_BRIEF.briefOf({ ref: job.ref, query: job.input.query, location: job.input.location, country: job.input.country, marketLabel: job.input.market,
      dossier: d, phase: d.phase, contact: job.contact || prev.contact, review: prev.review }));
  }
  function makePreviewPdf(ref) {
    const brief = getByRef(ref);
    if (!brief || !brief.dossier) return Promise.resolve(null);
    return PDFS.ensure(brief, { kind: 'preview', ctx: pdfCtx(ref), held: REVIEW.isHeld(brief), background: true }).catch(() => null);
  }
  function liveEmit(job, ev) {
    const slim = { type: ev.type, stage: ev.stage, round: ev.round, message: ev.message, phase: ev.dossier && ev.dossier.phase, counts: ev.dossier && ev.dossier.counts, ...(ev.reason ? { reason: ev.reason } : {}), ...(ev.retryAt ? { retryAt: ev.retryAt } : {}) };
    job.events.push({ at: Date.now(), ...slim }); if (job.events.length > 200) job.events.shift();
    if (ev.dossier) saveLiveDossier(job, ev.dossier);
    if (ev.dossier || ev.type === 'done' || ev.type === 'error') persistJob(job);
    for (const l of job.listeners) { try { l.res.write(`event: ${ev.type}\ndata: ${JSON.stringify(l.full ? slim : publicEvent(slim))}\n\n`); } catch { /* gone */ } }
  }
  /** The investigation behind a job: priced per call, stopped at its cap, and resumed from saved state when there is one. */
  function makeInv(job, resume) {
    job.inv = INVESTIGATOR.createInvestigation({ query: job.input.query, location: job.input.location, market: job.input.market || job.input.country, country: job.input.country, budget: { ...INVESTIGATOR.budgetFromEnv(process.env), ...previewBudget() } },
      { onEvent: ev => liveEmit(job, ev), engines: costedEngines(require('../engines'), (usd, info) => addSpend(job, usd, info)),
        shouldStop: () => job.capUsd != null && (job.costUsd || 0) >= job.capUsd, resume });
    return job.inv;
  }
  function newLiveJob(ref, input) {
    const job = { ref, input, status: 'sweeping', listeners: new Set(), events: [], contact: null, paid: false, costUsd: 0, capUsd: null, createdAt: Date.now() };
    makeInv(job, null);
    liveJobs.set(ref, job); persistJob(job);
    return job;
  }
  function deliverReport(job) {
    const brief = getByRef(job.ref); const contact = (brief && brief.contact) || job.contact;
    if (!contact || job.delivered || !process.env.ACCESS_TOKEN_SECRET) return null;
    job.delivered = true;
    const token = issueToken(job.ref, process.env.ACCESS_TOKEN_SECRET, 30, Date.now(), job.purchaseId), link = ACCOUNTS.enabled ? reportLink(process.env, job.ref, '').replace(/\?t=$/, '') : reportLink(process.env, job.ref, token);
    if (contact.email) RESPONSES.watch(job.ref, contact.email).catch(() => {});   // told if a finding in this report is corrected: that one purpose only
    const message = { ref: job.ref, project: (brief && brief.project && brief.project.name) || job.input.query, email: contact.email, phone: contact.phone, link, pdfLink: ACCOUNTS.enabled ? link + '/pdf' : link.replace(/\?t=/, '/pdf?t=') };
    const fresh = getByRef(job.ref);
    const prepared = fresh && fresh.dossier && fresh.dossier.phase === 'complete'
      ? Promise.race([PDFS.ensure(fresh, { kind: 'full', held: REVIEW.isHeld(fresh) }), new Promise(r => setTimeout(r, Number(process.env.PDF_BEFORE_DELIVERY_MS) || 60000).unref())]).catch(() => null)
      : Promise.resolve(null);
    const sent = prepared.then(async out => DELIVERY.send({ ...message, attachment: await pdfAttachment(out, { env: process.env, filename: PDFS.filenameOf(fresh, 'full') }) }));
    // The delivery layer now holds the address for its own retries. A finished report has no further use for it, so the saved file stops carrying it;
    // a report that stopped early keeps it, because the operator's retry sends the complete report to the same buyer.
    if (job.status === 'done') { job.contact = null; persistJob(job); }
    return sent;
  }
  /** Run the paid part. Never twice. After a restart it resumes from the saved state, so the research is not paid for again. */
  function completeLive(job) {
    if (job.completing) return;
    if (!job.inv) { makeInv(job, job.saved && job.saved.state ? job.saved : null); job.swept = Boolean(job.saved && job.saved.swept); }
    if (job.paid && job.capUsd == null) job.capUsd = aiCapFor(getByRef(job.ref) || {});
    const twin = finishedTwin(job);
    if (twin) {
      // Already investigated in full under another name: give this buyer that report, at no new AI cost.
      const d = JSON.parse(JSON.stringify(twin.dossier)); d.ref = job.ref; d.reusedFrom = twin.ref;
      job.reusedFrom = twin.ref; job.status = 'done'; job.inv = null;   // the unused investigation is dropped, so what is saved is this report
      job.saved = { state: null, dossier: d, swept: true };
      liveEmit(job, { type: 'done', dossier: d }); persistJob(job);
      try { const p = deliverReport(job); if (p && typeof p.catch === 'function') p.catch(e => console.error('[investigate] delivery failed for ' + job.ref + ':', e && e.message)); } catch (e) { console.error('[investigate] delivery failed for ' + job.ref + ':', e && e.message); }
      for (const l of job.listeners) { try { l.res.end(); } catch { /* gone */ } } job.listeners.clear();
      return;
    }
    job.completing = true; job.status = 'completing'; persistJob(job);
    const run = job.swept === false && job.inv.previewMode !== 'lean' ? job.inv.sweep({ panel: previewPanel() }).then(() => job.inv.complete()) : job.inv.complete();
    // The research is done, so the report is done: a delivery problem is logged and retried by the delivery layer,
    // and never turns a finished, paid report into a failed one.
    run.then(() => {
      job.status = 'done'; indexFinished(job, job.inv.dossier); persistJob(job);
      try { const p = deliverReport(job); if (p && typeof p.catch === 'function') p.catch(e => console.error('[investigate] delivery failed for ' + job.ref + ':', e && e.message)); }
      catch (e) { console.error('[investigate] delivery failed for ' + job.ref + ':', e && e.message); }
    })
      .catch(e => { notifyOps('a paid report failed', `Report ${job.ref} could not be completed after payment. Error: ${String((e && e.message) || e).slice(0, 160)}`); job.status = 'failed'; job.failedAt = Date.now(); job.failError = String((e && e.message) || e).slice(0, 300); persistJob(job); console.error('[investigate] completion failed for ' + job.ref + ':', e && e.message); liveEmit(job, { type: 'error', message: 'The investigation stopped early. What was found is in your report.' }); if (!job.retried) deliverReport(job); })
      .finally(() => { for (const l of job.listeners) { try { l.res.end(); } catch { /* gone */ } } job.listeners.clear(); });
  }
  /** An operator's retry of a paid report that stopped early. Only a failed one runs, once; a retry that fails again does not e-mail the partial report a second time, and one that works delivers the complete report; the research resumes from its saved state, so nothing is paid for twice and the buyer is not charged again. */
  function retryFailedReport(ref) {
    const job = liveJobs.get(ref);
    if (!job) return { ok: false, code: 'not_found' };
    if (!job.paid || job.status !== 'failed') return { ok: false, code: 'not_failed' };
    if (job.inv) { job.saved = job.inv.exportState(); job.inv = null; }   // start from the saved state, exactly as after a restart
    job.completing = false; job.delivered = false; job.retried = true; job.failedAt = null; job.failError = null; job.status = 'preview';
    persistJob(job);
    try { completeLive(job); } catch (e) { console.error('[jobs] retry could not start for ' + ref + ':', e && e.message); }
    return { ok: true };
  }
  /** Called whenever a purchase is settled (the browser's verification or Razorpay's webhook). A no-op for other reports. */
  function onReportPaid(ref, payerEmail, purchaseId) {
    const brief = getByRef(ref);
    if (!brief || brief.kind !== 'dossier') return;
    let job = liveJobs.get(ref);
    if (!job) { job = newLiveJob(ref, { query: brief.project.name, location: brief.location, country: brief.market.toUpperCase(), market: brief.marketLabel }); job.swept = false; job.status = 'preview'; }
    if (ACCOUNTS.enabled && payerEmail) { job.contact = { email: payerEmail }; if (job.status === 'done') job.delivered = false; }
    job.paid = true; job.capUsd = aiCapFor(brief); if (purchaseId && !job.purchaseId) job.purchaseId = purchaseId; persistJob(job);
    if (job.status === 'done' && ACCOUNTS.enabled && payerEmail) { try { const p = deliverReport(job); if (p && typeof p.catch === 'function') p.catch(e => console.error('[investigate] delivery failed for ' + job.ref + ':', e && e.message)); } catch (e) { console.error('[investigate] delivery failed for ' + job.ref + ':', e && e.message); } }
    if (job.status === 'preview' || job.status === 'interrupted') completeLive(job);   // a sweep still running continues into completion when it ends
  }

  /* At start: reload saved investigations. Finished previews stay reusable for 30 days; a paid report that was still
     running resumes on its own from its saved state. */
  let settled = 0;
  for (const rec of JOBS.all()) {
    if (jobIsStale(rec)) { JOBS.remove(rec.ref); continue; }
    const job = { ...rec, listeners: new Set(), events: [], inv: null, completing: false };
    if (rec.status === 'sweeping' && !(rec.saved && rec.saved.swept)) job.status = 'interrupted';
    if (rec.status === 'completing') job.status = 'preview';
    liveJobs.set(rec.ref, job);
    if (job.status === 'interrupted' && !job.paid) { job.status = 'failed'; job.failReason = 'restarted'; job.previewFailedAt = Date.now(); settled++; try { FP.failed(); } catch { /* counters are optional */ } persistJob(job); }
    if (rec.key && rec.saved && rec.saved.swept && Date.now() - (rec.createdAt || 0) < 30 * 24 * 3600 * 1000) liveIndex.set(rec.key, { ref: rec.ref, at: rec.createdAt });
    if (rec.status === 'done' && rec.saved && rec.saved.dossier && Date.now() - (rec.updatedAt || 0) < 30 * 24 * 3600 * 1000) for (const id of regIdsOf(rec.saved.dossier)) regIndex.set(id, { ref: rec.ref, at: rec.updatedAt });
    if (rec.status !== 'failed' && rec.saved && rec.saved.swept && rec.saved.dossier && Date.now() - (rec.updatedAt || 0) < 30 * 24 * 3600 * 1000) indexPreview(rec, rec.saved.dossier, rec.updatedAt);
    // Without a database the report store is in memory: put each saved report back, so buyers' links work after a restart.
    if (!process.env.DATABASE_URL && rec.saved && rec.saved.dossier) { try { saveLiveDossier(job, JSON.parse(JSON.stringify(rec.saved.dossier))); } catch (e) { console.error('[investigate] could not restore report ' + rec.ref + ':', e && e.message); } }
  }
  if (settled) console.log('[jobs] ' + settled + ' free search' + (settled === 1 ? '' : 'es') + ' running when the server stopped ' + (settled === 1 ? 'was' : 'were') + ' marked failed (reason restarted), so the buyer sees it and can search again');
  setInterval(() => { try { const n = pruneLiveJobs(); if (n) console.log('[jobs] removed ' + n + ' saved investigation' + (n === 1 ? '' : 's') + ' past retention'); } catch (e) { console.error('[jobs] retention sweep failed:', e && e.message); } }, 6 * 3600 * 1000).unref();
  const pdfCleanup = () => { try { const n = PDFS.prune({ previewMs: num('PDF_PREVIEW_DAYS', 7) * 24 * 3600 * 1000, keep: ref => liveJobs.has(ref) }); if (n) console.log('[pdf] removed ' + n + ' stored PDF' + (n === 1 ? '' : 's') + ' past retention'); } catch (e) { console.error('[pdf] clean-up failed:', e && e.message); } };
  setInterval(pdfCleanup, 24 * 3600 * 1000).unref();
  setImmediate(pdfCleanup);
  setImmediate(() => { for (const job of liveJobs.values()) if (job.paid && job.status !== 'done' && job.status !== 'failed' && !job.completing) { try { completeLive(job); } catch (e) { console.error('[investigate] could not resume ' + job.ref + ':', e && e.message); } } });
  Object.assign(c, { DELIVERY, FP, PDFS, makePreviewPdf, pdfCtx, indexPreview, previewTwin, purgeLiveJobs, pruneLiveJobs, addSpend, completeLive, dayOf, fullAccess, grantOf, investigateCap, investigateDaily, liveEmit, liveIndex, liveJobs, marketCap, newLiveJob, notifyOps, num, onReportPaid, overDailyMax, ownsPurchase, persistJob, previewBudget, previewPanel, publicEvent, retryFailedReport, spend });
};
