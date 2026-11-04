'use strict';
/**
 * Accounts: the small pure pieces. Codes, session tokens, their hashes, cookies and the safe return address.
 * Nothing here touches a database, a clock or the network.
 */
const crypto = require('crypto');

const b64u = buf => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const hmac = (key, text) => crypto.createHmac('sha256', key).update(text).digest('hex');

/** The address as stored for comparison: trimmed, lower case, one @, a dot in the domain, at most 254 characters. Null if unusable. */
function normEmail(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!s || s.length > 254 || /[\s\u0000-\u001f]/.test(s)) return null;
  const parts = s.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1] || parts[0].length > 64) return null;
  if (!/^[^.][^@]*\.[^.@]+$/.test(parts[1]) || parts[1].includes('..') || parts[1].startsWith('-')) return null;
  return s;
}

const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const hashCode = (pepper, emailLower, code) => hmac(pepper, emailLower + ':' + String(code));
const hashIp = (pepper, ip) => hmac(pepper, 'ip:' + String(ip || '')).slice(0, 32);

function sameHash(a, b) {
  const x = Buffer.from(String(a), 'utf8'), y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const newToken = () => b64u(crypto.randomBytes(32));
const hashToken = token => crypto.createHash('sha256').update(String(token)).digest('hex');
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    if (!(k in out)) { try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); } }
  }
  return out;
}

const cookieName = secure => (secure ? '__Host-sk_session' : 'sk_session');

function sessionCookie(token, { secure, maxAgeSeconds }) {
  return `${cookieName(secure)}=${token}; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
const clearedCookie = secure => `${cookieName(secure)}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

/** A return address that stays on this site: one leading slash, no scheme, no backslash, no control characters. */
function safeNext(raw, fallback = '/') {
  const s = String(raw == null ? '' : raw);
  if (!s || s.length > 512 || s[0] !== '/' || s[1] === '/' || s[1] === '\\' || /[\\\u0000-\u001f\u007f]/.test(s)) return fallback;
  return s;
}


const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const ipToInt = ip => { const m = IPV4.exec(ip); if (!m) return null; const p = m.slice(1).map(Number); return p.some(n => n > 255) ? null : ((p[0] * 16777216) + (p[1] * 65536) + (p[2] * 256) + p[3]); };

/** Does this client address fall under a ban target? A target is an IPv4 address, an IPv4 range such as 185.220.101.0/24, or "hash:<peppered hash>". */
function ipMatches(target, ip, ipHash) {
  const t = String(target || '');
  if (t.startsWith('hash:')) return Boolean(ipHash) && t.slice(5) === ipHash;
  const [base, bits] = t.split('/'), a = ipToInt(ip), b = ipToInt(base);
  if (a === null || b === null) return false;
  if (bits === undefined) return a === b;
  const n = Number(bits);
  if (!Number.isInteger(n) || n < 8 || n > 32) return false;
  const size = 2 ** (32 - n);
  return Math.floor(a / size) === Math.floor(b / size);
}

/** A ban target that is acceptable for its kind, or '' if not. Ranges wider than /8 are refused so one slip cannot block the world. */
function cleanBanTarget(kind, raw) {
  const t = String(raw == null ? '' : raw).trim().toLowerCase();
  if (kind === 'account') return normEmail(t) || '';
  if (kind !== 'ip') return '';
  if (/^hash:[0-9a-f]{16,128}$/.test(t)) return t;
  const [base, bits] = t.split('/');
  if (ipToInt(base) === null) return '';
  if (bits === undefined) return base;
  const n = Number(bits);
  return Number.isInteger(n) && n >= 8 && n <= 32 ? t : '';
}

module.exports = { ipMatches, cleanBanTarget, normEmail, newCode, hashCode, hashIp, sameHash, newToken, hashToken, TOKEN_RE, parseCookies, cookieName, sessionCookie, clearedCookie, safeNext, b64u };
