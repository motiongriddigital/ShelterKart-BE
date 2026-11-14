'use strict';
const { Pool } = require('pg');
const { createErrorLog } = require('../engine/errorlog');
const { getByRefAsync, attachStore } = require('../engine/research');
const BOT = require('../engine/botguard');             // proof-of-work before NEW research (BOT_GUARD)         // licence credits for the official registers a report used          // adverse findings held for a person (ADVERSE_HOLD_MARKETS)
const { makeReviewStore } = require('../engine/reviews');
const { makeResponses, makeResponseStore } = require('../engine/responses');
const { createAccounts } = require('../accounts');
const { makeAccountStore } = require('../accounts/store');
const { makePgStore } = require('../engine/persistence');
const ANALYTICS = require('../engine/analytics');
const TRANSLATE = require('../engine/translate');
const { REF_RE } = require('../engine/access');
const { rateLimit } = require('../middleware/rateLimit');

module.exports = function setup(c) {
  const TIMING = require('../engine/timing').createTiming();
  const CONTRACT = require('../engine/contract').createContract();
  const pool = require('../engine/poolGuard').guardPool(new Pool({ connectionString: process.env.DATABASE_URL }));
  const ERRORLOG = createErrorLog({ pool: process.env.DATABASE_URL ? pool : null, enabled: String(process.env.ERROR_LOG || 'on').toLowerCase() !== 'off' });
  const ADMIN_AUDIT = require('../engine/adminAudit').createAdminAudit({ pool: process.env.DATABASE_URL ? pool : null });
  const auditAdmin = async (req, entry) => {
    try { await ADMIN_AUDIT.record({ actor: require('../engine/adminAudit').actorOf(req), ...entry }); return true; }
    catch (e) { console.error('[audit] could not record ' + entry.action + ':', e && e.message); return false; }
  };
  ERRORLOG.hookConsole(console);
  const SITE_BASE = () => String(process.env.PUBLIC_BASE_URL || process.env.SITE_URL || '').replace(/\/+$/, '');

  /* ============================================================
     RESEARCH ENGINE -- the product's core loop.
     Search lane (everything findable) + registry lane (official APIs
     where a connector exists) -> grounding gate -> marks -> questions.
     Needs no database. Registry calls go through the SSRF guard, with
     the permitted hosts taken from the connectors themselves.
     ============================================================ */
  // Disputes and developer replies: Postgres when configured, memory otherwise, so the right of reply works in every mode.
  const REVIEWS = makeReviewStore(process.env.DATABASE_URL ? pool : null);
  // Respond or correct: the right of reply and the right of correction (engine/responses.js). Every outside thing is passed in.
  const RESPONSES = makeResponses({
    store: makeResponseStore(process.env.DATABASE_URL ? pool : null),
    getBrief: ref => getByRefAsync(ref).catch(() => null),
    sendMail: m => require('../engine/delivery').sendEmail(process.env, m),
    alert: (subject, text) => require('../engine/delivery').alertOperator(process.env, subject, text),
    siteBase: () => SITE_BASE(), refOk: ref => REF_RE.test(ref),
  });
  const ACCOUNTS = createAccounts({
    env: process.env, store: makeAccountStore(process.env.DATABASE_URL ? pool : null), bot: BOT, rateLimit, track: (event, req, body) => track(event, req, body),
    mail: m => require('../engine/delivery').sendEmail(process.env, m),
    mailConfigured: Boolean(require('../engine/delivery').emailProvider(process.env)),
    alert: (subject, text) => require('../engine/delivery').alertOperator(process.env, subject, text),
    entitled: async (userId, ref) => (await pool.query(`SELECT 1 FROM report_purchases WHERE user_id=$1 AND report_ref=$2 AND status='paid' LIMIT 1`, [userId, ref])).rows.length > 0,
    purchasesOf: async userId => (await pool.query(`SELECT report_ref, amount, currency, status, created_at FROM report_purchases WHERE user_id=$1 ORDER BY created_at DESC LIMIT 500`, [userId]))
      .rows.map(r => ({ ref: r.report_ref, amount: r.amount, currency: r.currency, status: r.status, createdAt: r.created_at })),
    briefInfo: async ref => { const b = await getByRefAsync(ref); if (!b) return null; const { filenameOf } = require('../engine/pdfDocs'); return { projectName: b.project && b.project.name, market: b.market, pdfFilename: b.dossier ? filenameOf(b, 'full') : null, previewPdfFilename: b.dossier ? filenameOf(b, 'preview') : null }; },
  });
  // With a database configured, reports, aliases and the daily ceiling are
  // durable: a deploy or crash no longer erases what buyers paid for.
  const pgStore = process.env.DATABASE_URL ? makePgStore(pool) : null;
  if (pgStore) attachStore(pgStore);
  if (pgStore) ANALYTICS.attachStore(pgStore);
  if (pgStore) TRANSLATE.attachStore(pgStore);   // translated sentences are kept, so each is translated once
  /* Record an analytics event without ever slowing or failing the request.
     `serverSide` marks events with no buyer behind them (payment webhooks). */
  function track(event, req, body = {}, { serverSide = false } = {}) {
    try {
      let ownHost = '';
      try { const o = req && req.get && req.get('origin'); if (o) ownHost = new URL(o).hostname.replace(/^www\./, ''); } catch {}
      ANALYTICS.record(ANALYTICS.makeEvent(event, { ip: req && req.ip, ua: serverSide ? 'server' : (req && req.get && req.get('user-agent')),
        headers: (req && req.headers) || {}, body, ownHost }));
    } catch (e) { console.error('[analytics]', e && e.message); }
  }
  const BACKUPS = require('../engine/backups').createBackups({ pool: process.env.DATABASE_URL ? pool : null });
  Object.assign(c, { ACCOUNTS, ADMIN_AUDIT, BACKUPS, CONTRACT, ERRORLOG, RESPONSES, REVIEWS, SITE_BASE, TIMING, auditAdmin, pgStore, pool, track });
};
