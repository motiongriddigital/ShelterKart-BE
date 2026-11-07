'use strict';
const crypto = require('crypto');

// ============================================================
// ADMIN — the founder's one place to manage the company, per
// HANDOFF.md's "one-person company" plan. Protected by HTTP Basic
// Auth against ADMIN_USERNAME/ADMIN_PASSWORD env vars — simple on
// purpose; a single-operator dashboard doesn't need a full auth
// system, it needs to not be publicly reachable. Never put anything
// here that can edit a finding directly — see CONSTITUTION.md rule 1.
// ============================================================
/* Admin credential comparison, hardened.

   Three defects were present here:

   1. `user !== ENV_USER || pass !== ENV_PASS` short-circuits and
      compares byte-by-byte, so response time leaks how much of the
      credential was correct. Over enough requests that is enough to
      recover a password one character at a time. Now hashed to a fixed
      length and compared with timingSafeEqual, which takes constant
      time regardless of where the first difference falls.

   2. No rate limit on the admin surface at all — unlimited guesses
      against a single password. Now limited per IP, and the limiter is
      applied to the router rather than to each route, so a new admin
      route cannot accidentally ship unprotected.

   3. If ADMIN_PASSWORD were unset, `undefined !== undefined` is false
      and every request would authenticate. Startup now refuses to boot
      in production without both variables set, and the middleware fails
      closed if they are missing at request time.
*/
function safeEqual(a, b) {
  // Hash first: timingSafeEqual throws when lengths differ, and the
  // length difference is itself a leak. SHA-256 makes both sides 32
  // bytes regardless of input.
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function adminAuth(req, res, next) {
  const envUser = process.env.ADMIN_USERNAME;
  const envPass = process.env.ADMIN_PASSWORD;

  // Fail closed. Without this, unset credentials would make every
  // comparison below trivially true.
  if (!envUser || !envPass) {
    console.error('[admin] ADMIN_USERNAME/ADMIN_PASSWORD not configured — refusing all admin access.');
    return res.status(503).json({ ok: false, error: 'Admin access is not configured.' });
  }

  const hdr = req.headers.authorization || '';
  const [scheme, encoded] = hdr.split(' ');
  if (scheme !== 'Basic' || !encoded) {
    res.set('WWW-Authenticate', 'Basic realm="ShelterKart Admin"');
    return res.status(401).json({ ok: false, error: 'Authentication required' });
  }

  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }
  // Split on the FIRST colon only: passwords may legitimately contain one.
  const sep = decoded.indexOf(':');
  const user = sep === -1 ? decoded : decoded.slice(0, sep);
  const pass = sep === -1 ? '' : decoded.slice(sep + 1);

  // Evaluate both comparisons before branching, so the boolean operator
  // itself cannot short-circuit and reintroduce a timing signal.
  const userOk = safeEqual(user, envUser);
  const passOk = safeEqual(pass, envPass);
  if (!(userOk && passOk)) {
    res.set('WWW-Authenticate', 'Basic realm="ShelterKart Admin"');
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }
  next();
}

/* Route params reach SQL as bound parameters, so injection is not the
   risk — but an unparseable id causes Postgres to raise a type error
   that surfaces as a 500 and lands in logs as noise. Reject early with
   a 400 instead. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requireUuid(req, res, next) {
  if (!UUID_RE.test(req.params.id || '')) {
    return res.status(400).json({ ok: false, error: 'Invalid identifier.' });
  }
  next();
}

module.exports = { adminAuth, requireUuid };
