'use strict';
const express = require('express');
const { runResearch, isAnswerable, getByRefAsync, capOf, _daily: researchDaily } = require('../engine/research');
const REVIEW = require('../engine/review');
const CREDITS = require('../engine/credits');
const BOT = require('../engine/botguard');             // proof-of-work before NEW research (BOT_GUARD)         // licence credits for the official registers a report used          // adverse findings held for a person (ADVERSE_HOLD_MARKETS)
const ANALYTICS = require('../engine/analytics');
const { pickLanguage, publicList: languageList, languagesForMarket } = require('../engine/languages');
const { paywallActive, issueToken, REF_RE } = require('../engine/access');
const { extractFields, crossCheck } = require('../engine/documents');
const { MARKETS, depthOf } = require('../engine/markets');
const HEALTH = require('../engine/health');
const { ah } = require('../middleware/asyncHandler');
const { stripPII } = require('../lib/pii');

module.exports = function register(app, c) {
  const { ACCOUNTS, SEARCH, checkoutResearchLimiter, documentLimiter, gateBrief, localize, pool, registryHttp, researchLimiter, track, trackLimiter } = c;

  /* The buyer's own document, checked against the research. Never stored,
     never logged, never cached: it exists only for this request. */
  /* New research costs money; a report already researched does not. Only the first needs the browser's proof of work. Every route that can start
     new research asks here (the document check once did not, and could use up the day's allowance with no check at all: SHEL-39). */
  const challengeFor = body => {
    const { query, location, market } = body || {};
    if (!BOT.enabled(process.env) || isAnswerable({ query: stripPII(query), location: stripPII(location), market })) return null;
    const v = BOT.verify(body && body.pow, process.env);
    return v.ok ? null : { status: 428, body: { ok: false, code: 'challenge', reason: v.reason, error: 'This search needs a short automatic check from your browser. Please try again.' } };
  };
  app.post('/api/research/document-check', ACCOUNTS.guard, documentLimiter, express.json({ limit: '12mb' }), ah(async (req, res) => {
    const { query, location, market, file, mediaType } = req.body || {};
    const challenge = challengeFor(req.body);
    if (challenge) return res.status(challenge.status).json(challenge.body);
    try {
      const brief = await runResearch({ query: stripPII(query), location: stripPII(location), market }, { env: process.env, http: registryHttp });
      const gated = await gateBrief(brief, req);
      if (gated.brief.locked) return res.status(402).json({ ok: false, error: 'Checking your documents is part of the full report.' });
      const fields = await extractFields({ data: file, mediaType }, { env: process.env });
      track('document_check', req, { ref: brief.ref, market });
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, result: crossCheck(fields, brief) });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.status ? e.message : 'The document check could not be completed.' });
    }
  }));

  /* A shared link opens the EXACT report that was shared -- not a fresh
     search that happens to share its name. Same paywall logic as every
     other route: a locked report shared before payment still shows only
     the preview here too, decided server-side, not by what the link
     claims. */
  /* Languages a reader can choose, and each market's languages (the first is the one its buyers most often prefer). */
  app.get('/api/languages', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ ok: true, languages: languageList(), markets: Object.fromEntries(Object.keys(MARKETS).map(m => [m, languagesForMarket(m)])) });
  });
  app.get('/api/research/by-ref/:ref', ACCOUNTS.guard, researchLimiter, ah(async (req, res) => {
    const ref = req.params.ref;
    if (!REF_RE.test(String(ref || ''))) return res.status(400).json({ ok: false, error: 'Not a valid report reference.' });
    const brief = await getByRefAsync(ref);   // memory first, then storage
    if (!brief) return res.status(404).json({ ok: false, error: 'This report is no longer available. Search again for the latest information.' });
    ACCOUNTS.touch(req, ref);
    track('report_open', req, { ref, market: brief.market, lang: pickLanguage(req.query && req.query.lang) });
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, ...(await localize(await gateBrief(CREDITS.attach(REVIEW.forBuyer(brief)), req), req)) });
  }));
  app.post('/api/track', trackLimiter, (req, res) => {
    const b = req.body || {};
    if (!ANALYTICS.CLIENT_EVENTS.has(b.event)) return res.status(400).json({ ok: false });
    track(b.event, req, { path: b.path, referrer: b.referrer, utm: b.utm, market: b.market, ref: b.ref });
    res.status(204).end();
  });

  /* A buyer who paid on another device, or whose browser was cleared, gets
     their access back with the payment ID from Razorpay's receipt email.
     Payment IDs are long and random, and this route is rate-limited. */
  app.post('/api/research/recover', checkoutResearchLimiter, ah(async (req, res) => {
    if (ACCOUNTS.enabled) return res.status(410).json({ ok: false, code: 'use_account', error: 'Sign in with the e-mail you bought with. Your reports are under My reports.' });
    if (!paywallActive(process.env)) return res.status(503).json({ ok: false, error: 'Payments are not enabled yet.' });
    const paymentId = String((req.body || {}).paymentId || '').trim();
    if (!/^pay_[A-Za-z0-9]{8,30}$/.test(paymentId))
      return res.status(400).json({ ok: false, error: 'Enter the payment ID from your Razorpay receipt. It starts with pay_.' });
    const q = await pool.query(`SELECT report_ref, id FROM report_purchases WHERE provider_payment_id=$1 AND status='paid'`, [paymentId]);
    if (!q.rows.length) return res.status(404).json({ ok: false, error: 'No paid ShelterKart report matches that payment ID. If you were charged, write to us with your receipt.' });
    const ref = q.rows[0].report_ref;
    track('access_recovered', req, { ref });
    res.json({ ok: true, ref, token: issueToken(ref, process.env.ACCESS_TOKEN_SECRET, 30, Date.now(), q.rows[0].id) });
  }));

  // Does this visitor have to agree before the page keeps the visit's source (the campaign link or website that brought them) in the
  // browser? Decided from the visitor's country; varies by visitor, so it is never cached. See SK_SOURCE_CONSENT in .env.example.
  app.get('/api/source-consent', (req, res) => {
    res.set('Cache-Control', 'private, no-store'); res.json({ mode: ANALYTICS.sourceConsentMode(req.headers, process.env) });
  });
  app.get('/api/markets', (req, res) => {
    res.json(Object.entries(MARKETS).map(([code, m]) => {
      const off = Boolean(m.registry) && !HEALTH.isRegistryUsable(code);
      return { code, label: m.label, status: m.status,
        depth: off ? 'Research' : depthOf(code),
        note: off ? 'The official register is temporarily switched off, so briefs here rest on web research only.' : m.note };
    }));
  });

  /* A proof-of-work challenge for the browser to solve before a NEW research. Light limiter: fetching one never costs a search. */
  app.get('/api/research/challenge', trackLimiter, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const cap = capOf(process.env), usage = cap > 0 && researchDaily.day === new Date().toISOString().slice(0, 10) ? researchDaily.count / cap : 0;
    res.json({ ok: true, ...BOT.issue(process.env, { usage }) });
  });
  app.post('/api/research', ACCOUNTS.guard, researchLimiter, ah(async (req, res) => {
    const { query, location, market } = req.body || {};
    const challenge = challengeFor(req.body);
    if (challenge) return res.status(challenge.status).json(challenge.body);
    try {
      const brief = await runResearch({ query: stripPII(query), location: stripPII(location), market }, { env: process.env, http: registryHttp });
      try { SEARCH.afterResearch({ query: stripPII(query), location: stripPII(location), market, brief }); } catch {}   // shadow comparison; the project becomes findable
      res.set('X-Robots-Tag', 'noindex, nofollow'); // some sources forbid search-engine indexing of reused data
      res.set('Cache-Control', 'no-store');         // a paid brief must never sit in a shared cache
      ACCOUNTS.touch(req, brief.ref);
      track('search', req, { market, query: stripPII(query), ref: brief.ref, lang: pickLanguage(req.body && req.body.lang), detail: brief.matchedAs ? 'matched' : brief.cached ? 'cached' : 'fresh' });
      res.json({ ok: true, ...(await localize(await gateBrief(CREDITS.attach(REVIEW.forBuyer(brief)), req), req)) });
    } catch (e) {
      track('search', req, { market, query: stripPII(query), detail: e.status === 400 ? 'invalid' : e.status === 503 ? 'unavailable' : 'error' });
      res.status(e.status || 500).json({ ok: false, error: e.status ? e.message : 'Research failed. Please try again.' });
    }
  }));

  // ============================================================
  // ============================================================
  // TIER-1 STRUCTURED FETCH (stub) — the one piece that genuinely
  // requires real, country-specific source connectors (MahaRERA,
  // Dubai Pulse, Companies House, etc. — see Developer Brief §7)
  // plus OCR for scanned filings. Kept as a single, clearly marked
  // integration point rather than scattered TODOs.
  // ============================================================
  async function fetchStructuredLegal(country, city, entityId) {
    // TODO: real registry connector per country/tier. Returning null
    // signals "could not verify" — callers must treat that as
    // "assume changed, regenerate" rather than silently trusting stale data.
    return null;
  }

  // ============================================================
  // CACHE-FIRST REPORT RETRIEVAL — with smart change-detection
  // ============================================================
  // On a cache hit older than RECHECK_DAYS, run ONLY the free Level 0
  // structured fetch (no LLM) and compare key fields against the cached
  // version. If nothing material changed, just refresh the cache
  // timestamp — zero AI cost. Only run the full pipeline (which may
  // reach Level 1/2 AI) if something real changed.
  const RECHECK_DAYS = 7;
  function hasSourceChanged(cachedFacts, freshFacts) {
    if (!cachedFacts || !freshFacts) return true; // can't compare → be safe, regenerate
    return cachedFacts.registrationStatus !== freshFacts.registrationStatus
      || (cachedFacts.litigation?.length || 0) !== (freshFacts.litigation?.length || 0);
  }

  /* ============================================================
     REPORT ENTITLEMENT — server-side gating

     The demo frontend ships every paid finding in the client bundle and
     decides what to show from a localStorage boolean. Both bypasses are
     two lines in devtools:

       localStorage.setItem('sk_unlocked_reports', ...)   // flip the flag
       console.log(PROJECTS['lodha-park'])                // skip the UI

     No amount of frontend work fixes this. A gate the client evaluates
     is not a gate. The server must be the authority, and paid fields
     must never leave it unless the caller is entitled.

     The revenue loss is the obvious half. The half that matters more:
     the Constitution treats a report as a traceable artifact tied to an
     identified buyer. Anonymous extraction destroys the audit trail —
     there is no record of who holds which version of which finding, so
     a later correction cannot be delivered to the people who relied on
     the superseded one.
     ============================================================ */

  // OTP codes are hashed before storage (scrypt + random salt per code,
  // Node's built-in crypto — no new dependency). A compromised database
  // should never yield directly-usable codes, even briefly within their
  // 5-minute validity window.

  /* Retired: the old OTP / lead-capture / client-priced checkout system.
     Nothing calls these any more, and they let an anonymous caller create
     pending purchases and buyer_leads rows (with phone_verified hardcoded
     true) and, for /api/checkout, name their own price -- which would also
     have polluted any count of leads or purchases. 410 Gone, not 404, so a
     stale cached copy of the site gets an explicit answer. */
  app.all(['/api/resolve', '/api/report/:type/:id', '/api/send-otp', '/api/verify-otp', '/api/checkout', '/api/report-checkout'],
    (req, res) => res.status(410).json({ ok: false, error: 'This endpoint has been retired.' }));
};
