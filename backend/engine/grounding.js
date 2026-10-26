'use strict';
/**
 * ShelterKart — grounding and marking.
 *
 * Every finding in every report passes through here. The rules are
 * enforced in code, never taken on a model's word:
 *   - a claim survives only if its cited page actually came back from
 *     a search or a registry call (the grounding gate)
 *   - "Confirmed at source" is decided by the source's domain, not by
 *     anything the model says about it
 *   - agreement is counted by independent SITES, not pages, so one
 *     site cannot corroborate itself
 *   - a website named after the project is treated as an agent's
 *     marketing site, never as the developer's own statement
 */

// The retrieval layer's own defence, wired in rather than left unused.
// It scans the PAGE TEXT a claim is built on for injection patterns --
// "ignore previous instructions", a false system-voice, a direct
// instruction to assign a rating -- and downgrades the mark rather than
// trusting the model's word that the page was safe.
const { scanForInjection } = require('../connectors/untrusted');

function norm(u) {
  try {
    const x = new URL(String(u).trim());
    const host = x.hostname.toLowerCase().replace(/^www\./, '');
    return host + x.pathname.replace(/\/+$/, '') + x.search;
  } catch { return null; }
}

function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

const SECOND_LEVEL = new Set([
  'co.uk','org.uk','gov.uk','ac.uk','com.au','gov.au','net.au','co.in','gov.in','nic.in','net.in','org.in',
  'com.sg','gov.sg','co.nz','govt.nz','gov.ae','co.ae','com.hk','gov.hk','gouv.fr','co.jp','go.jp','co.kr',
  'go.kr','gc.ca','com.my','gov.my','gov.tw','com.tw','gov.pl','com.pl','gov.ie'
]);

function siteOf(u) {
  const p = hostOf(u).split('.');
  if (p.length >= 3 && SECOND_LEVEL.has(p.slice(-2).join('.'))) return p.slice(-3).join('.');
  return p.slice(-2).join('.');
}

// The official and social tiers are read from data/source-tiers.json (reviewed like any method change).
const TIERS = require('path').join(__dirname, '..', 'data', 'source-tiers.json');
const TIER_RULES = JSON.parse(require('fs').readFileSync(TIERS, 'utf8'));
const OFFICIAL_SUFFIX = new RegExp(TIER_RULES.official.suffixPattern);
// Stock-exchange disclosure hosts count as official for the same reason
// NSE and BSE always have: a listed company's filings there are statutory
// disclosures. Treating India's exchanges as official but not Singapore's,
// Dubai's, London's or Australia's was an inconsistency -- a listed
// developer's own SGX filing was being marked no stronger than a listing
// site. Only the exchanges' own disclosure hosts are listed, not general
// market-data sites that republish them.
const OFFICIAL_HOSTS = TIER_RULES.official.hosts;

function isOfficial(u) {
  const h = hostOf(u);
  if (!h) return false;
  return OFFICIAL_SUFFIX.test(h) || OFFICIAL_HOSTS.some(o => h === o || h.endsWith('.' + o));
}

/** Tokens from the searched name, long enough to be distinctive. */
function nameTokens(q) {
  return String(q || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/).filter(t => t.length >= 5);
}

/** A domain built from the project's own name ("hubtown-celeste.in") is
 *  almost always an agent's microsite. In the Celeste test, two such
 *  sites disclosed in their own small print that they were run by
 *  estate agents. */
function isProjectNamedSite(u, query, developer) {
  if (isOfficial(u)) return false;
  const h = hostOf(u).replace(/[^a-z0-9]/g, '');
  const devToks = new Set(nameTokens(developer));
  // The project's own words -- "celeste" in "Hubtown Celeste" -- not the
  // developer's. The first version flagged hubtown.co.in, the developer's
  // real site, because "hubtown" appears in the project name too.
  const projToks = nameTokens(query).filter(t => !devToks.has(t));
  if (devToks.size) return projToks.some(t => h.includes(t));
  // Developer unknown: require at least two of the project's words.
  return projToks.filter(t => h.includes(t)).length >= 2;
}

/**
 * The grounding gate.
 * @param out        parsed model output: {project, sources[], findings[], conflicts[], gaps[]}
 * @param retrieved  Map(normalisedUrl -> {url, title}) of pages that ACTUALLY came back
 * @param query      the buyer's search, used for the microsite rule
 */
function ground(out, retrieved, query) {
  const developer = out && out.project && typeof out.project.developer === 'string' ? out.project.developer : '';
  const srcList = Array.isArray(out.sources) ? out.sources : [];
  const resolve = i => {
    const k = norm(srcList[i]);
    return k && retrieved.has(k) ? retrieved.get(k).url : null;
  };

  let removed = 0;
  const findings = [];
  for (const f of (Array.isArray(out.findings) ? out.findings : [])) {
    if (!f || typeof f.claim !== 'string' || !f.claim.trim()) { removed++; continue; }
    const urls = [...new Set((Array.isArray(f.src) ? f.src : []).map(resolve).filter(Boolean))];
    if (!urls.length) { removed++; continue; }
    // Scan the retrieved page text itself -- title plus snippet -- for
    // injection patterns, not the model's paraphrase of it. A page
    // that tries to instruct the model can never earn "confirmed" on
    // the strength of that instruction working.
    const suspicious = urls.some(u => { const p = retrieved.get(norm(u));
      return p && scanForInjection((p.title || '') + ' ' + (p.snippet || '')).suspicious; });
    const marked = markFinding({
      id: String(f.id || ''), topic: String(f.topic || 'other'),
      stance: ['positive', 'negative', 'neutral'].includes(f.stance) ? f.stance : 'neutral',
      claim: f.claim.trim().slice(0, 300), kind: f.kind, urls, lane: 'search'
    }, query, developer);
    if (suspicious && marked.mark === 'confirmed') { marked.mark = 'single'; marked.note = 'One of the pages behind this claim contains text resembling an instruction to an AI system. Downgraded pending review.'; }
    findings.push(marked);
  }

  const conflicts = [];
  for (const c of (Array.isArray(out.conflicts) ? out.conflicts : [])) {
    const versions = (Array.isArray(c && c.versions) ? c.versions : [])
      .map(v => ({ value: String((v && v.value) || '').slice(0, 160), url: resolve(v && v.src) }))
      .filter(v => v.value && v.url);
    if (versions.length >= 2 && new Set(versions.map(v => siteOf(v.url))).size >= 2) {
      conflicts.push({ topic: String(c.topic || 'Detail').slice(0, 80), versions });
    } else if (c && Array.isArray(c.versions) && c.versions.length) removed++;
  }

  const gaps = (Array.isArray(out.gaps) ? out.gaps : [])
    .filter(g => g && g.topic).slice(0, 6)
    .map(g => ({ topic: String(g.topic).slice(0, 80), why: String(g.why || '').slice(0, 160) }));

  const project = sanitizeProject(out.project);
  if (!findings.some(f => f.topic === 'price')) { delete project.price_from; delete project.price_to; delete project.price_currency; }
  project.developer_site = verifiedDeveloperSite(out.project && out.project.developer_site, project.developer, retrieved);
  return { project, findings, conflicts, gaps, removed };
}

/** Decide a finding's mark from its sources -- the only place marks are set. */
const SOCIAL = new RegExp(TIER_RULES.social.pattern);

function markFinding(f, query, developer) {
  const sites = new Set(f.urls.map(siteOf));
  let mark, note = '';
  if (f.urls.some(isOfficial)) mark = 'confirmed';
  else if (f.kind === 'developer_claim') {
    if (f.urls.every(u => isProjectNamedSite(u, query, developer))) {
      mark = 'single';
      note = 'This site is named after the project. Sites like this are usually run by estate agents, not the developer.';
    } else mark = 'developer';
  }
  else if (sites.size >= 2) mark = 'reported';
  else mark = 'single';
  // After the chain, never inside it: an if placed between "else if" and
  // "else" once captured the else and downgraded every finding to single.
  if (!note && f.urls.length && f.urls.every(u => SOCIAL.test(hostOf(u))))
    note = 'From social media or a forum: individual views, not verified facts.';
  return { ...f, sites: sites.size, mark, note };
}

/* The developer's own website decides which statements count as the
   developer's disclosures, and which date conflicts involve the developer
   itself. So the model's claim is checked in code: the domain must be one
   the search actually retrieved, must not be official or social, and must
   carry a word of the developer's name ("berkeleygroup.co.uk" for Berkeley)
   -- which keeps an agent's project-named microsite from passing as the
   developer's own site. */
function verifiedDeveloperSite(raw, developer, retrieved) {
  let h = String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return '';
  const hosts = [...retrieved.values()].map(p => hostOf(p.url));
  if (!hosts.some(x => x === h || x.endsWith('.' + h))) return '';
  if (isOfficial('https://' + h + '/') || SOCIAL.test(h)) return '';
  const toks = nameTokens(developer).filter(t => t.length >= 4);
  if (!toks.some(t => h.replace(/[^a-z0-9]/g, '').includes(t))) return '';
  return h;
}

function sanitizeProject(p) {
  const s = v => (typeof v === 'string' ? v.trim().slice(0, 140) : '');
  p = p && typeof p === 'object' ? p : {};
  const list = (v, n) => (Array.isArray(v) ? v : []).map(s).filter(Boolean).slice(0, n);
  return {
    name: s(p.name), location: s(p.location), developer: s(p.developer),
    developer_local: s(p.developer_local),
    ids: list(p.ids, 4),
    company_ids: list(p.company_ids, 4),
    // The listed unit-price range, which sets the report's price (pricing/quote.js).
    ...priceRange(p)
  };
}

/* Listed unit prices as plain numbers in one currency code. Anything malformed
   is dropped, and pricing then treats the project as an average home. */
function priceRange(p) {
  const n = v => (typeof v === 'number' ? v : Number(String(v || '').replace(/[,\s]/g, '')));
  const from = n(p.price_from), to = n(p.price_to) || n(p.price_from), cur = String(p.price_currency || '').trim().toUpperCase();
  if (!(from > 0) || !(to >= from) || to > from * 20 || !/^[A-Z]{3}$/.test(cur)) return {};
  return { price_from: Math.round(from), price_to: Math.round(to), price_currency: cur };
}

module.exports = { norm, hostOf, siteOf, isOfficial, isProjectNamedSite, nameTokens, ground, markFinding, verifiedDeveloperSite };
