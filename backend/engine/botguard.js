'use strict';
/**
 * Bot protection for the one expensive thing a visitor can trigger: NEW research (blind-spot review #5).
 *
 * Proof of work, built in, no third party: before a new research, the browser finds a number that makes
 * SHA-256(token + ":" + number) start with a set count of zero bits. About a second on a phone, invisible to a
 * person; but a script that wants thousands of new researches must pay that cost thousands of times. Nothing is
 * stored about the visitor: no cookie, no IP address. Reports already researched never need it.
 *
 * The token is signed by the server (HMAC), expires in 5 minutes, and is accepted once. Difficulty rises as the day's
 * research allowance is used: +1 bit at 50%, +2 at 80%, so an attack gets slower exactly when it matters.
 * It slows bulk abuse; it does not stop a determined attacker with real computing power. A third-party challenge can be
 * added behind the same check later.
 *
 * BOT_GUARD=on|off (default: on in production), BOT_POW_BITS (default 16), BOT_SECRET (else QUOTE_SECRET or ACCESS_TOKEN_SECRET).
 */
const crypto = require('crypto');
const TTL_MS = 5 * 60 * 1000;
const PROCESS_SECRET = crypto.randomBytes(32).toString('hex');   // only if no secret is configured (development)
const used = new Map();                                          // accepted tokens until they expire (one server; Redis later)

const secretOf = env => env.BOT_SECRET || env.QUOTE_SECRET || env.ACCESS_TOKEN_SECRET || PROCESS_SECRET;
const hmac = (secret, s) => crypto.createHmac('sha256', secret).update(s).digest('base64url');
function enabled(env = process.env) {
  const v = String(env.BOT_GUARD || '').toLowerCase();
  if (v === 'on' || v === 'true') return true;
  if (v === 'off' || v === 'false') return false;
  return env.NODE_ENV === 'production';
}
function bitsFor(env = process.env, usage = 0) {
  const n = Number(env.BOT_POW_BITS), base = Number.isFinite(n) ? Math.max(8, Math.min(24, Math.floor(n))) : 16;
  return Math.min(26, base + (usage >= 0.8 ? 2 : usage >= 0.5 ? 1 : 0));
}
function leadingZeroBits(buf) {
  let n = 0;
  for (const byte of buf) { if (byte === 0) { n += 8; continue; } n += Math.clz32(byte) - 24; break; }
  return n;
}

/** A new challenge. `usage` is the share of today's research allowance already used (0 to 1). */
function issue(env = process.env, { usage = 0, now = Date.now() } = {}) {
  const bits = bitsFor(env, usage);
  const payload = Buffer.from(JSON.stringify({ n: crypto.randomBytes(12).toString('hex'), b: bits, e: now + TTL_MS })).toString('base64url');
  return { token: payload + '.' + hmac(secretOf(env), payload), bits, expiresAt: new Date(now + TTL_MS).toISOString() };
}

/** Check a solved challenge. Returns { ok } or { ok: false, reason }. A good one is accepted once only. */
function verify(pow, env = process.env, { now = Date.now() } = {}) {
  const token = pow && String(pow.token || ''), solution = pow && String(pow.solution == null ? '' : pow.solution);
  if (!token || !solution) return { ok: false, reason: 'missing' };
  if (token.length > 400 || !/^[0-9a-z]{1,16}$/.test(solution)) return { ok: false, reason: 'malformed' };
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return { ok: false, reason: 'malformed' };
  const want = Buffer.from(hmac(secretOf(env), payload)), got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return { ok: false, reason: 'tampered' };
  let body; try { body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
  if (!(body && Number.isFinite(body.e) && Number.isFinite(body.b))) return { ok: false, reason: 'malformed' };
  if (now > body.e) return { ok: false, reason: 'expired' };
  for (const [k, exp] of used) if (exp < now) used.delete(k);
  if (used.has(token)) return { ok: false, reason: 'used' };
  if (leadingZeroBits(crypto.createHash('sha256').update(token + ':' + solution).digest()) < body.b) return { ok: false, reason: 'not_solved' };
  used.set(token, body.e);
  return { ok: true };
}

module.exports = { enabled, issue, verify, bitsFor, leadingZeroBits, TTL_MS, _used: used };
