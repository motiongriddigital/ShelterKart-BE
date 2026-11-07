'use strict';
const { isAnswerable } = require('../engine/research');
const BOT = require('../engine/botguard');             // proof-of-work before NEW research (BOT_GUARD)         // licence credits for the official registers a report used          // adverse findings held for a person (ADVERSE_HOLD_MARKETS)
const { rateLimit } = require('./rateLimit');
const { stripPII } = require('../lib/pii');

module.exports = function setup(c) {
  const disputeLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: { ok: false, error: 'Too many submissions. Please try again later.' } });

  /* Many Indian mobile networks put large numbers of users behind one
     shared IP address, so a tight per-IP limit would lock out a crowd of
     real people at once during a spike. The limit is looser, and searches
     that can be answered from memory are exempt -- they cost nothing. The
     real cost ceiling is RESEARCH_DAILY_CAP, enforced in the engine. */
  const researchLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: Number(process.env.RESEARCH_HOURLY_PER_IP) || 10,
    standardHeaders: true, legacyHeaders: false,
    skip: req => { try { const b = req.body || {};
      if (BOT.enabled(process.env) && req.path === '/api/research' && !(b.pow && b.pow.token)) return true;   // refused before any cost; counting it would charge twice
      return isAnswerable({ query: stripPII(b.query), location: stripPII(b.location), market: b.market }); } catch { return false; } },
    message: { ok: false, error: 'Too many new searches from this connection. Please try again in an hour.' } });

  /* Every /api/admin route sits behind this limiter, registered BEFORE any of
     them: Express applies middleware in registration order, and this used
     to be declared near the end of the file, so the purge route -- and the
     source-health routes -- were outside it. Admin password guessing on
     them was never rate-limited. */
  const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    skipSuccessfulRequests: true,   // only refused requests count: guessing the password is capped, while a signed-in console (3 calls per screen) is not locked out
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'Too many attempts. Try again later.' },
  });
  const checkoutResearchLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
  const documentLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
    message: { ok: false, error: 'Too many document checks from this address. Please try again in an hour.' } });

  /* The browser's own events: page views, unlock clicks, PDF saves and
     WhatsApp shares. Only these four names are accepted, and only these
     fields: nothing a script sends here can move searches, purchases or
     revenue, which are recorded by the server itself. */
  const trackLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

  /* ---- Respond or correct. The RIGHT OF REPLY (the developer or anyone named in a report) and the RIGHT OF CORRECTION (anyone).
     Free. No account. The sender confirms by e-mail, a screen checks the message, a clean reply is published beside its finding at once,
     and a correction changes a finding only with evidence, publicly and dated. Nothing here can be bought, and nothing here changes a
     finding by itself. The older /api/dispute and /api/developer-response routes below still work for existing clients. ---- */
  const respondLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 8, message: { ok: false, error: 'Too many submissions. Please try again later.' } });
  const respondReadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 240, message: { ok: false, error: 'Too many requests. Please try again later.' } });

  // ============================================================
  // (The older reply route, kept for existing clients. New submissions use /api/responses, above: one panel, e-mail confirmation, screening.)
  // DEVELOPER RIGHT OF REPLY — Constitution rule 5. Free, unconditional,
  // admin-reviewed before publication (never auto-published — that's
  // what keeps this from becoming a channel for pressure or spam),
  // and always displayed alongside the original finding, never in
  // place of it. A developer cannot use this to alter a finding.
  // ============================================================
  const replyLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 3, message: { ok:false, error:'Too many submissions. Please try again later.' } });
  Object.assign(c, { adminLimiter, checkoutResearchLimiter, disputeLimiter, documentLimiter, replyLimiter, researchLimiter, respondLimiter, respondReadLimiter, trackLimiter });
};
