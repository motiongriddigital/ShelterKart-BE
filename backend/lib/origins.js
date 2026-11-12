'use strict';
const trim = v => String(v || '').replace(/\/+$/, '');
const originOf = v => { try { const u = new URL(String(v)); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch { return ''; } };
const configured = env => String(env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);

/** The origins a browser may call the API from: ALLOWED_ORIGINS plus the API's own origin (API_PUBLIC_URL), so the pages the API serves itself never need it listed by hand. */
function allowedOrigins(env = process.env) {
  const out = configured(env), own = originOf(env.API_PUBLIC_URL);
  if (own && !out.includes(own)) out.push(own);
  return out;
}

/* The website's address does three jobs. Each has its own setting and falls back to PUBLIC_BASE_URL (or SITE_URL), so one address still works when the website and the API share a host. */
const siteBase = (env = process.env) => trim(env.PUBLIC_BASE_URL || env.SITE_URL);
const linkBase = (env = process.env) => trim(env.REPORT_LINK_BASE) || siteBase(env);
const returnBase = (env = process.env) => trim(env.PAYMENT_RETURN_BASE) || siteBase(env);

/** Mistakes in the origin settings that fail silently otherwise (a trailing slash or a path never matches the browser's Origin header). */
function originProblems(env = process.env) {
  const out = [], production = env.NODE_ENV === 'production';
  for (const o of configured(env)) {
    if (o === '*') { out.push('ALLOWED_ORIGINS contains "*": list the exact website origins instead.'); continue; }
    const norm = originOf(o);
    if (!norm) out.push(`ALLOWED_ORIGINS entry "${o}" is not an origin (it needs http:// or https:// and a host).`);
    else if (norm !== o) out.push(`ALLOWED_ORIGINS entry "${o}" is not an exact origin: write "${norm}" (no path, no trailing slash), or the browser's Origin header will never match it.`);
    else if (production && o.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) out.push(`ALLOWED_ORIGINS entry "${o}" is not https.`);
  }
  for (const k of ['API_PUBLIC_URL', 'PUBLIC_BASE_URL', 'SITE_URL', 'REPORT_LINK_BASE', 'PAYMENT_RETURN_BASE']) {
    const v = String(env[k] || '').trim();
    if (v && !originOf(v)) out.push(`${k} "${v}" is not a web address (it needs http:// or https:// and a host).`);
    else if (v && production && v.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(v)) out.push(`${k} is not https.`);
  }
  return out;
}

module.exports = { allowedOrigins, configured, originOf, siteBase, linkBase, returnBase, originProblems };
