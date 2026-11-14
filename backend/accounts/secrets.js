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

const PASSWORD_MIN = 12, PASSWORD_MAX = 128;
const SCRYPT_DEFAULT = { N: 32768, r: 8, p: 3 };
const SCRYPT_CEILING = { N: 131072, r: 16, p: 8 };
const COMMON_PASSWORDS = new Set(['password', 'password1', 'password12', 'password123', 'password1234', '1234567890', '12345678910', 'qwertyuiop', 'qwerty12345', 'iloveyou123', 'letmein1234', 'welcome1234', 'admin12345', 'abcdefghij', '0123456789', 'shelterkart', 'shelterkart1', 'shelterkart123']);

/** Why a password is not acceptable, or null if it is. Length is counted in characters; the rest stops the obvious. */
function passwordProblem(raw, email) {
  if (typeof raw !== 'string') return 'Enter a password.';
  const chars = [...raw].length;
  if (chars < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (chars > PASSWORD_MAX || Buffer.byteLength(raw, 'utf8') > PASSWORD_MAX * 4) return `Use at most ${PASSWORD_MAX} characters.`;
  const low = raw.toLowerCase(), mail = String(email || '').toLowerCase();
  if (/^(.)\1+$/u.test(raw)) return 'Choose a password that is not one repeated character.';
  if (COMMON_PASSWORDS.has(low)) return 'That password is too common. Choose another.';
  if (mail && (low === mail || low === mail.split('@')[0])) return 'The password cannot be your e-mail address.';
  return null;
}

const scryptAsync = (secret, salt, { N, r, p }) => new Promise((resolve, reject) => crypto.scrypt(secret, salt, 64, { N, r, p, maxmem: 160 * N * r }, (e, key) => (e ? reject(e) : resolve(key))));
const prehash = (pepper, password) => crypto.createHmac('sha256', pepper).update(String(password)).digest();

/** A stored form of the password: scrypt$N$r$p$salt$hash. The pepper is mixed in first, so a copy of the database alone cannot be attacked offline. */
async function hashPassword(pepper, password, params = SCRYPT_DEFAULT) {
  const salt = crypto.randomBytes(16), key = await scryptAsync(prehash(pepper, password), salt, params);
  return ['scrypt', params.N, params.r, params.p, b64u(salt), b64u(key)].join('$');
}

function parseStored(stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isInteger) || N < 2 || (N & (N - 1)) !== 0 || N > SCRYPT_CEILING.N || r < 1 || r > SCRYPT_CEILING.r || p < 1 || p > SCRYPT_CEILING.p) return null;
  const pad = x => Buffer.from(x.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return { N, r, p, salt: pad(parts[4]), key: pad(parts[5]) };
}

let dummyStored = null;
/** True only for the right password. With no stored form it still does the same work, so a missing account takes as long as a wrong password. */
async function verifyPassword(pepper, password, stored) {
  let parsed = parseStored(stored);
  if (!parsed) { dummyStored = dummyStored || hashPassword('dummy-pepper', 'dummy-password'); parsed = parseStored(await dummyStored); await scryptAsync(prehash(pepper, password), parsed.salt, parsed); return false; }
  const key = await scryptAsync(prehash(pepper, password), parsed.salt, parsed);
  return key.length === parsed.key.length && crypto.timingSafeEqual(key, parsed.key);
}

module.exports = { passwordProblem, hashPassword, verifyPassword, PASSWORD_MIN, PASSWORD_MAX, ipMatches, cleanBanTarget, normEmail, newCode, hashCode, hashIp, sameHash, newToken, hashToken, TOKEN_RE, parseCookies, cookieName, sessionCookie, clearedCookie, safeNext, b64u };
