'use strict';
/**
 * ShelterKart — access to paid briefs.
 *
 * Signed tokens, not cookies. The old entitlement path read a signed
 * session cookie that nothing ever set and no installed library could
 * read, so even a paying buyer could never have been granted access.
 * This layer is self-contained:
 *
 *   ref     'SK-' + a hash of the project's canonical key. Every spelling
 *           of the same project shares one ref, so a buyer pays once.
 *   token   payload.signature, HMAC-SHA256 with ACCESS_TOKEN_SECRET,
 *           tied to one ref, with an expiry. Verified timing-safely.
 *   preview built from an ALLOW-list. Paid content is never sent to an
 *           unpaid browser in any form -- not blurred, not truncated,
 *           not present. A field added to the brief later is withheld
 *           by default, which is the safe direction to fail.
 */
const crypto = require('crypto');

const b64u = buf => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function briefRef(canonicalKey) {
  return 'SK-' + crypto.createHash('sha256').update(String(canonicalKey)).digest('hex').slice(0, 12).toUpperCase();
}
const REF_RE = /^SK-[0-9A-F]{12}$/;

/** `pid` is the purchase the access was bought with. A token that carries it can be revoked by refunding that purchase (the server checks the
 *  purchase when the token is used); a token without it cannot, and the server no longer honours one (engine's tokenGrants). */
function issueToken(ref, secret, ttlDays = 30, now = Date.now(), pid = null) {
  if (!secret || !REF_RE.test(ref)) throw new Error('cannot issue token');
  const payload = b64u(JSON.stringify({ ref, exp: now + ttlDays * 86400000, ...(pid ? { pid: String(pid) } : {}) }));
  const sig = b64u(crypto.createHmac('sha256', secret).update(payload).digest());
  return payload + '.' + sig;
}

/** The token's body when it is genuine for this report and not expired, else null. */
function tokenInfo(token, ref, secret, now = Date.now()) {
  if (!token || !secret || !REF_RE.test(ref)) return null;
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  let given;
  try { given = fromB64u(sig); } catch { return null; }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let body;
  try { body = JSON.parse(fromB64u(payload).toString('utf8')); } catch { return null; }
  return body && body.ref === ref && Number.isFinite(body.exp) && body.exp > now ? body : null;
}
function verifyToken(token, ref, secret, now = Date.now()) { return Boolean(tokenInfo(token, ref, secret, now)); }

/** The paywall exists only when a purchase can actually complete.
 *  Locking content nobody can buy is a dead end, which the product's
 *  own rule forbids -- so with payments off, every brief is complete. */
function paywallActive(env) {
  // Prices come from the price book through pricing/quote.js.
  return env.PAYMENTS_ENABLED === 'true' && Boolean(env.ACCESS_TOKEN_SECRET)
    && Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);   // no way to pay means no lock
}

const PREVIEW = { findings: 3, questions: 2 };

/** Allow-list projection. Free: enough to see the brief is real and
 *  worth having. Withheld: the sources behind most claims, what each
 *  disagreement actually says, the reading, most questions, the pages. */
function previewOf(b) {
  const out = {
    version: b.version, ref: b.ref, query: b.query, location: b.location, market: b.market,
    marketLabel: b.marketLabel, depth: b.depth, marketNote: b.marketNote, checkedAt: b.checkedAt,
    project: b.project, registry: b.registry, counts: b.counts, matchedAs: b.matchedAs,
    notes: b.notes, pipeline_status: b.pipeline_status,
    // The protections themselves are paid content; the preview says only how many, and for where.
    protectionsCount: b.protections ? b.protections.items.length : 0, protectionsLabel: b.protections ? b.protections.label : '',
    responsible: b.responsible, disclaimer: b.disclaimer, removed: b.removed, searches: b.searches,
    credits: b.credits || [],             // register credits are attribution, never paid content
    findings: (b.findings || []).slice(0, PREVIEW.findings),
    conflicts: (b.conflicts || []).map(c => ({ topic: c.topic, versions: [] })),
    gaps: b.gaps,
    reading: [],
    questions: (b.questions || []).slice(0, PREVIEW.questions),
    pages: [],
    locked: true,
    lockedCounts: {
      findings: Math.max(0, (b.findings || []).length - PREVIEW.findings),
      conflicts: (b.conflicts || []).length,
      reading: (b.reading || []).length,
      questions: Math.max(0, (b.questions || []).length - PREVIEW.questions),
      pages: (b.pages || []).length
    }
  };
  return out;
}

module.exports = { briefRef, issueToken, verifyToken, tokenInfo, paywallActive, previewOf, REF_RE, PREVIEW };
