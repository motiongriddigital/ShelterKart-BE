'use strict';
/**
 * Every web page a report cites. A search-lane report lists them in `pages`; an investigator report (kind "dossier") has no `pages` and
 * keeps its sources inside the dossier, in sections, facts, questions and checks. A legal takedown must reach both, so the pages of a
 * report are read from `pages` AND from every `url` anywhere inside its dossier.
 */
const hostOf = u => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };

function collect(node, into, depth) {
  if (!node || typeof node !== 'object' || depth > 12) return;
  if (Array.isArray(node)) { for (const x of node) collect(x, into, depth + 1); return; }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'url' && typeof v === 'string' && /^https?:\/\//i.test(v)) into.add(v);
    else if (v && typeof v === 'object') collect(v, into, depth + 1);
  }
}

/** The distinct URLs a report cites, as [{ url }]. Never throws on an odd shape. */
function pagesOf(brief) {
  const urls = new Set();
  if (brief && Array.isArray(brief.pages)) for (const p of brief.pages) if (p && typeof p.url === 'string' && p.url) urls.add(p.url);
  if (brief && brief.dossier) collect(brief.dossier, urls, 0);
  return [...urls].map(url => ({ url }));
}

/** Does the report cite this exact URL, or any page on this host? */
function cites(brief, { url, host } = {}) {
  const h = host ? String(host).toLowerCase().replace(/^www\./, '') : null;
  return pagesOf(brief).some(p => (url ? p.url === url : false) || (h ? hostOf(p.url) === h : false));
}

module.exports = { pagesOf, cites, hostOf };
