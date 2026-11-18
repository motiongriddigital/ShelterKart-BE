'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const MANAGED_HOST = /(^|\.)supabase\.(co|com)$/i;
const OFF = new Set(['off', 'disable', 'false', '0', 'no']);
const REQUIRE = new Set(['require', 'on', 'true', '1', 'yes']);
const VERIFY = new Set(['verify', 'verify-ca', 'verify-full']);

const parse = url => { try { return new URL(url); } catch (e) { return null; } };
const intOf = (v, d, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min ? Math.min(max, Math.floor(n)) : d; };

function sslMode(env = process.env, url = env.DATABASE_URL) {
  const set = String(env.DATABASE_SSL || '').trim().toLowerCase();
  if (OFF.has(set)) return 'off';
  if (VERIFY.has(set)) return 'verify';
  if (REQUIRE.has(set)) return 'require';
  const u = parse(url);
  if (!u) return 'off';
  const q = String(u.searchParams.get('sslmode') || '').toLowerCase();
  if (q === 'disable') return 'off';
  if (q === 'verify-full' || q === 'verify-ca') return 'verify';
  if (q === 'require') return 'require';
  return MANAGED_HOST.test(u.hostname) ? 'require' : 'off';
}

function stripSsl(url) {
  const u = parse(url);
  if (!u) return url;
  for (const k of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) u.searchParams.delete(k);
  return u.toString();
}

function caText(env = process.env) {
  const raw = String(env.DATABASE_SSL_CA || '').trim();
  if (!raw) return null;
  if (raw.includes('-----BEGIN')) return raw.replace(/\\n/g, '\n');
  try { return fs.readFileSync(raw, 'utf8'); } catch (e) { return null; }
}

function caPath(env = process.env) {
  const raw = String(env.DATABASE_SSL_CA || '').trim();
  if (!raw) return null;
  if (!raw.includes('-----BEGIN')) return fs.existsSync(raw) ? raw : null;
  const file = path.join(os.tmpdir(), 'shelterkart-db-ca-' + process.pid + '.pem');
  fs.writeFileSync(file, raw.replace(/\\n/g, '\n'), { mode: 0o600 });
  return file;
}

function connectionOptions(env = process.env, url = env.DATABASE_URL) {
  const mode = sslMode(env, url);
  const o = { connectionString: stripSsl(url), keepAlive: true, connectionTimeoutMillis: intOf(env.DATABASE_CONNECT_TIMEOUT_MS, 10000, 1000, 120000) };
  if (mode === 'require') o.ssl = { rejectUnauthorized: false };
  if (mode === 'verify') { o.ssl = { rejectUnauthorized: true }; const ca = caText(env); if (ca) o.ssl.ca = ca; }
  const st = intOf(env.DATABASE_STATEMENT_TIMEOUT_MS, 0, 0, 600000);
  if (st) o.statement_timeout = st;
  return o;
}

function poolOptions(env = process.env) {
  return { ...connectionOptions(env, env.DATABASE_URL), max: intOf(env.DATABASE_POOL_MAX, 10, 1, 100), idleTimeoutMillis: intOf(env.DATABASE_IDLE_TIMEOUT_MS, 10000, 1000, 600000) };
}

function directUrl(env = process.env) { return env.DATABASE_DIRECT_URL || env.DATABASE_URL; }

function directOptions(env = process.env) { return connectionOptions(env, directUrl(env)); }

function kindOf(url) {
  const u = parse(url);
  if (!u) return 'unknown';
  if (u.port === '6543') return 'transaction-pooler';
  if (/pooler\.supabase\.com$/i.test(u.hostname)) return 'session-pooler';
  return 'direct';
}

module.exports = { sslMode, stripSsl, caText, caPath, connectionOptions, poolOptions, directOptions, directUrl, kindOf, MANAGED_HOST };
