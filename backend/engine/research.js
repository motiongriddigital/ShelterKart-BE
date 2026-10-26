'use strict';
/**
 * ShelterKart — the research engine.
 *
 * One call in, one brief out:
 *   1. search lane    -- everything findable, via a search provider
 *   2. grounding gate -- claims citing pages that never came back are removed
 *   3. registry lane  -- where an official API connector exists, the
 *                        developer is checked at source
 *   4. adviser        -- reading between the lines, and the questions
 *   5. brief          -- assembled, counted, cached
 *
 * No overall number is produced. Each finding is judged on its own sources; a finding needs primary evidence across its
 * components; producing one from search results would break the rule
 * that only confirmed facts move a number.
 */

const { ground, markFinding, siteOf, hostOf, norm } = require('./grounding');
const { CONNECTORS } = require('./registry');
const { research: searchLane } = require('./searchLane');
const { advise } = require('./adviser');
const { MARKETS, depthOf } = require('./markets');
const { briefRef } = require('./access');
const { EntityIndex } = require('./entities');
const HEALTH = require('./health');
const { protectionsFor } = require('./protections');
const { researchLanguages } = require('./languages');
const entities = new EntityIndex();

/* ---------- durability ----------
   The maps below are the fast layer. When a store is attached (Postgres
   in production), every change is mirrored to it in the background, and
   hydrate() reloads it on startup. A storage failure is logged and never
   breaks a request: the buyer still gets their report, and the next
   write tries again. */
let store = null;
function bg(label, fn) {
  if (!store) return;
  Promise.resolve().then(fn).catch(e => console.error('[persistence]', label, 'failed:', e && e.message));
}
function attachStore(s) {
  store = s;
  entities.onChange = s ? (alias, value) => bg('saveAlias', () => store.saveAlias(alias, value)) : null;
  entities.onForget = s ? key => bg('forgetKey', () => store.forgetKey(key)) : null;
}

/* The time budget, actually enforced. The previous round added a
   timeLeft() helper that nothing called, so the 55-second limit it
   described was never applied. Each stage now races its own share. */
class Timeout extends Error {}
function withDeadline(promise, ms) {
  if (ms <= 0) return Promise.reject(new Timeout());
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Timeout()), ms); })])
    .finally(() => clearTimeout(t));
}

/* ---------- cache: the thousandth buyer gets an instant answer ---------- */
const TTL_MS = 24 * 3600 * 1000, MAX = 500;
const cache = new Map();
// NFKD + stripping combining marks means "Sao Paulo" and "S\u00e3o Paulo"
// -- or "Lodha Park" typed with an accidental accent -- share one
// cache entry instead of silently duplicating the same research.
const foldDiacritics = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
const keyOf = (q, loc, mkt) => [mkt, q, loc].map(s => foldDiacritics(s).toLowerCase().trim().replace(/\s+/g, ' ')).join('|');
function cacheGet(k) {
  const e = cache.get(k);
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) { cache.delete(k); return null; }
  return e.brief;
}
function cacheSet(k, brief) {
  if (cache.size >= MAX) cache.delete(cache.keys().next().value);
  cache.set(k, { at: Date.now(), brief });
  if (brief && brief.ref) {
    if (refStore.size >= REF_MAX && !refStore.has(brief.ref)) refStore.delete(refStore.keys().next().value);
    refStore.set(brief.ref, { at: Date.now(), brief });
    bg('saveBrief', () => store.saveBrief(k, brief));
  }
}

/* A shared link used to encode the search text, not the report itself
   -- opening it re-ran the whole pipeline, and "Sky Villas" months
   later could resolve to a different project, or simply return
   different findings, than what was actually shared. Wrong for a
   product whose entire premise is that a specific claim traces to a
   specific source: what someone forwards on WhatsApp should be the
   report they actually saw, not a live re-query that happens to share
   its name. This store is keyed by the report's own stable ref, kept
   independently of the regular query cache and for longer -- 30 days,
   matching the access token's own lifetime, since a shared link and a
   purchased report should outlive a browsing session by roughly the
   same amount. Past that, the honest answer is "no longer available",
   not a silent, possibly-different re-run. */
const REF_TTL_MS = 30 * 24 * 3600 * 1000, REF_MAX = 2000;
const refStore = new Map();
function getByRef(ref) {
  const e = refStore.get(ref);
  if (!e) return null;
  if (Date.now() - e.at > REF_TTL_MS) { refStore.delete(ref); return null; }
  return e.brief;
}
// Two people searching the same property in the same moment -- a
// news mention, a shared link -- would otherwise both pay for and
// wait through a full pipeline. The second one now joins the first.
const inFlight = new Map();
/** When a source withdraws a record for legal reasons (Norway's "410
 *  Gone" is the model case), every cached brief built on it must go too. */
function purgeByUrl(url) {
  let n = 0;
  for (const [k, e] of cache) {
    if (e.brief.pages.some(p => p.url === url)) { cache.delete(k); entities.forgetKey(k); n++; }
  }
  // A withdrawn record must not still be reachable through a shared
  // link just because that store has a longer memory than the cache.
  for (const [ref, e] of refStore) if (e.brief.pages.some(p => p.url === url)) refStore.delete(ref);
  bg('deleteCiting', () => store.deleteCiting({ url }));
  return n;
}
/** A takedown is usually a whole source withdrawing a record, not one
 *  exact querystring. Matches by host so a live legal notice actually
 *  clears everything it should. */
function purgeByHost(host) {
  let n = 0;
  const h = String(host).toLowerCase().replace(/^www\./, '');   // same normalisation as storage
  const fromHost = p => { try { return new URL(p.url).hostname.toLowerCase().replace(/^www\./, '') === h; } catch { return false; } };
  for (const [k, e] of cache) {
    if (e.brief.pages.some(fromHost)) { cache.delete(k); entities.forgetKey(k); n++; }
  }
  for (const [ref, e] of refStore) if (e.brief.pages.some(fromHost)) refStore.delete(ref);
  bg('deleteCiting', () => store.deleteCiting({ host: h }));
  return n;
}

/** A legal withdrawal, confirmed end to end: memory AND storage. The admin
 *  route awaits this, so "purged" is only reported once storage agrees. */
async function purgeDurably({ url, host }) {
  const prev = store; store = null;                  // run the in-memory purge without a duplicate background delete
  let memory;
  try { memory = url ? purgeByUrl(url) : purgeByHost(host); } finally { store = prev; }
  const stored = store ? await store.deleteCiting(url ? { url } : { host: String(host).toLowerCase() }) : 0;
  return { memory, stored };
}

/** Reload recent reports, aliases and today's count from storage. Called
 *  once at startup, before the server accepts traffic. Reports past the
 *  retention window are deleted from storage first, not just skipped. */
async function hydrate() {
  if (!store) return { reports: 0, aliases: 0 };
  const now = Date.now();
  await store.pruneOlderThan(new Date(now - REF_TTL_MS));
  const rows = await store.loadRecent(new Date(now - REF_TTL_MS), REF_MAX);
  for (const r of rows) {
    const at = r.createdAt.getTime();
    if (!r.brief || !r.brief.ref) continue;
    refStore.set(r.brief.ref, { at, brief: r.brief });
    if (now - at <= TTL_MS) {
      if (cache.size >= MAX) cache.delete(cache.keys().next().value);
      cache.set(r.cacheKey, { at, brief: r.brief });
    }
  }
  const aliases = await store.loadAliases();
  for (const a of aliases) entities.load(a.alias, a.value);
  const today = new Date().toISOString().slice(0, 10);
  daily.day = today; daily.count = await store.loadDaily(today);
  // A register switched off yesterday must still be off after a restart.
  let healthRecords = 0;
  if (store.loadHealth) for (const h of await store.loadHealth()) { HEALTH.loadHealth(h.market, h); healthRecords++; }
  return { reports: rows.length, aliases: aliases.length, dailyCount: daily.count, healthRecords };
}

/** A shared or purchased report, even if this server instance never saw
 *  it or has since evicted it: memory first, then storage. */
/** Newest reports first, for the admin Reports panel. */
function listRecentReports(limit = 100) {
  return [...refStore.values()].sort((a, b) => b.at - a.at).slice(0, limit).map(({ brief: x }) => ({
    ref: x.ref, title: x.project && x.project.name, place: x.project && x.project.location, market: x.marketLabel,
    developer: x.project && x.project.developer, checkedAt: x.checkedAt,
    findings: (x.findings || []).length, disputes: (x.conflicts || []).length }));
}

/** Store a report that runResearch did not produce (the investigator's dossier) under its own ref, so the same quote,
 *  checkout, access, review and retention routes serve it. Its query is prefixed so it never answers a normal search. */
function registerBrief(brief) {
  if (!brief || !brief.ref) return null;
  refStore.set(brief.ref, { at: Date.now(), brief });
  while (refStore.size > REF_MAX) refStore.delete(refStore.keys().next().value);
  if (store) bg('saveBrief', () => store.saveBrief(keyOf(brief.query, brief.location, brief.market), brief));
  return brief;
}

/** Record a person's review decision on a report, in memory and in storage, inside the report itself. */
async function setReview(ref, review) {
  const brief = await getByRefAsync(ref);
  if (!brief) return null;
  brief.review = { ...review, at: new Date().toISOString() };
  const k = keyOf(brief.query, brief.location, brief.market);
  if (cache.has(k)) cache.get(k).brief = brief;
  if (store) bg('saveBrief', () => store.saveBrief(k, brief));
  return brief;
}
async function getByRefAsync(ref) {
  const hit = getByRef(ref);
  if (hit || !store) return hit;
  let row;
  try { row = await store.getBrief(ref); } catch (e) { console.error('[persistence] getBrief failed:', e && e.message); return null; }
  if (!row || Date.now() - row.createdAt.getTime() > REF_TTL_MS) return null;
  refStore.set(ref, { at: row.createdAt.getTime(), brief: row.brief });
  return row.brief;
}

function validateInput({ query, location, market }) {
  const q = String(query || '').trim();
  if (q.length < 2 || q.length > 120) return 'Enter a property or developer name between 2 and 120 characters.';
  if (location && String(location).length > 80) return 'Location is too long.';
  if (!MARKETS[market]) return 'Unknown market.';
  return null;
}

const GENERIC = new Set(['park','tower','residency','residences','villa','villas','heights','green','city',
  'garden','gardens','square','plaza','court','manor','estate','homes','apartments','the','of','by']);
// A single generic word ("Park") is too thin to search on and matches
// thousands of unrelated projects. The rule this session has held to
// is "every search gets an answer" -- so this degrades the search
// rather than rejecting it: the brief still runs, with an upfront note
// telling the buyer their result may be unreliable and why.
function isTooGeneric(query) {
  const tokens = String(query).toLowerCase().split(/\s+/).filter(t => t.length > 1 && !GENERIC.has(t));
  return tokens.length === 0;
}

const RESPONSIBLE = env => ({
  name: env.RESPONSIBLE_NAME || 'Preeyancc',
  title: env.RESPONSIBLE_TITLE || 'Founder, ShelterKart',
  contact: env.CORRECTIONS_EMAIL || 'corrections@shelterkart.com'
});

const BUDGET_MS = 55000; // a user who has waited a minute has usually already left

/* A ceiling on NEW research per day. A viral post can otherwise turn
   into an unbounded bill overnight. Reports already researched are
   never affected: they cost nothing to serve. */
const daily = { day: '', count: 0, alerted: new Set() };
/** The daily ceiling. Unset or blank = 1,500. 0 = paused (it used to fall back to 1,500). Garbage = 1,500, logged. */
function capOf(env) {
  const raw = env.RESEARCH_DAILY_CAP;
  if (raw === undefined || String(raw).trim() === '') return 1500;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) { console.error('[research] RESEARCH_DAILY_CAP is not a number; using 1500'); return 1500; }
  return Math.floor(n);
}
/** Warn when the day's allowance is half used, mostly used, and used up -- the signs of a busy day or a cost attack. */
const BUDGET_STEPS = [0.5, 0.8, 1];
function budgetAlerts(cap, env) {
  for (const step of BUDGET_STEPS) {
    if (cap > 0 && daily.count >= Math.ceil(cap * step) && !daily.alerted.has(step)) {
      daily.alerted.add(step);
      const text = step === 1 ? `ShelterKart: the daily limit of ${cap} new researches is used up. New searches are refused until tomorrow (UTC); already-researched reports still open.`
        : `ShelterKart: ${Math.round(step * 100)}% of today's ${cap} new researches used (${daily.count}). If this is unexpected, check for automated searching.`;
      try { const { sendAlert } = require('./health'); Promise.resolve(sendAlert(text, { env })).catch(() => {}); } catch {}
    }
  }
}
function underDailyCap(env) {
  const today = new Date().toISOString().slice(0, 10);
  if (daily.day !== today) { daily.day = today; daily.count = 0; daily.alerted = new Set(); }
  const cap = capOf(env);
  if (daily.count >= cap) return false;
  daily.count++;
  bg('incrementDaily', () => store.incrementDaily(today));
  budgetAlerts(cap, env);
  return true;
}
/** Emergency switches: RESEARCH_PAUSED=true stops all new research; RESEARCH_MARKETS_OFF=tw,cz stops it in those markets. */
function pausedReason(env, market) {
  if (env.RESEARCH_PAUSED === 'true' || capOf(env) === 0) return 'New research is paused for a short while. Projects already researched are still available \u2014 please try again later.';
  const off = String(env.RESEARCH_MARKETS_OFF || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  if (off.includes(String(market || '').toLowerCase())) return 'New research in this market is paused for now. Projects already researched here are still available.';
  return null;
}

/** True when this search can be answered from memory -- the exact search,
 *  another spelling, or the registration number of a project already
 *  researched. Used to exempt free-to-serve searches from rate limits. */
function isAnswerable({ query, location, market }) {
  if (!query || !MARKETS[market]) return false;
  if (cacheGet(keyOf(query, location, market))) return true;
  const known = entities.resolve({ market, query: String(query), location: location || '' });
  return Boolean(known && cacheGet(known.key));
}

async function runResearch(input, opts = {}) {
  const key0 = keyOf(input.query, input.location, input.market);
  const already = inFlight.get(key0);
  if (already) return already;
  const p = _runResearch(input, opts).finally(() => inFlight.delete(key0));
  inFlight.set(key0, p);
  return p;
}

async function _runResearch(input, { env = process.env, fetchImpl = globalThis.fetch, http } = {}) {
  const started = Date.now();
  const timeLeft = () => BUDGET_MS - (Date.now() - started);
  const bad = validateInput(input);
  if (bad) { const e = new Error(bad); e.status = 400; throw e; }
  const query = input.query.trim(), location = (input.location || '').trim(), market = input.market;
  const k = keyOf(query, location, market);
  const hit = cacheGet(k);
  if (hit) return { ...hit, cached: true };
  // A different spelling, or the registration number, of a project
  // already researched: serve that brief, and say so.
  const known = entities.resolve({ market, query, location });
  if (known) {
    const b = cacheGet(known.key);
    if (b) return { ...b, cached: true, matchedAs: { via: known.via, searched: query } };
  }

  const pause = pausedReason(env, market);
  if (pause) { const e = new Error(pause); e.status = 503; e.code = 'paused'; throw e; }
  if (!underDailyCap(env)) {
    const e = new Error('ShelterKart has reached its limit for new research today. Projects already researched are still available \u2014 please try this one again tomorrow.');
    e.status = 503; throw e;
  }

  const mkt = MARKETS[market];
  const notes = [];
  if (isTooGeneric(query)) notes.push('This name is very generic and may match projects it is not related to. Search by the full project name, or add the developer\u2019s name, for a reliable result.');

  // 1-2. Search lane + grounding gate.
  let g = { project: { name: query, location, developer: '', ids: [] }, findings: [], conflicts: [], gaps: [], removed: 0 };
  let retrieved = new Map(), searches = 0, searchOk = false;
  try {
    const r = await withDeadline(searchLane(query, { location, marketLabel: mkt.label, languages: researchLanguages(market), env, fetchImpl }), timeLeft() - 12000);
    retrieved = r.retrieved; searches = r.searches;
    g = ground(r.out, retrieved, query);
    if (!g.project.name) g.project.name = query;
    searchOk = true;
    // A pass that did not finish must never read as "nothing was found".
    const PASS = { record: 'the official record and the developer\u2019s own website', track: 'the developer\u2019s track record and this project\u2019s timeline', voice: 'what buyers and the public say' };
    if (r.facets && r.facets.failed.length)
      notes.push('Part of the research did not complete this time (' + r.facets.failed.map(f => PASS[f] || f).join('; ') + '), so this brief may be missing findings about it. Those parts are marked "not assessed" in the score, never counted against the developer.');
  } catch (e) {
    notes.push(e instanceof Timeout
      ? 'The web search took too long this time, so this brief rests on official registers only.'
      : 'The web search could not complete this time, so this brief rests on official registers only.');
  }

  // 3. Registry lane -- check the developer at source, by the developer's
  //    name rather than the project's, so a project name can't match an
  //    unrelated company (the "Hubtown Solaris" trap).
  let registry = null;
  const connector = mkt.registry && CONNECTORS[mkt.registry];
  // The developer's name only -- never the project's. Falling back to
  // `query` here was the exact Hubtown Solaris trap this file's own
  // comment warns against: a project name can match an unrelated
  // company in the register. No match is a better outcome than a
  // wrong one, so an unknown developer name skips the lookup entirely.
  const allIds = [...(g.project.ids || []), ...(g.project.company_ids || [])];
  // A connector keyed by company number (India's IBBI) can run without a
  // name, as long as a number was found. Every other connector still
  // needs the developer's name -- never the project's.
  const idUsable = connector && connector.byIdOnly && allIds.length > 0;
  // A register the nightly health check has confirmed down (or whose
  // robots.txt now forbids the path) is not queried at all. Asking it
  // anyway would come back "no match", which a buyer reads as "this
  // developer has no record" -- the wrong conclusion. Say what happened.
  const registryOff = Boolean(connector) && !HEALTH.isRegistryUsable(market);
  if (registryOff) {
    const h = HEALTH.getHealth(market);
    notes.push(`The official register for ${mkt.label} is temporarily switched off${h && h.reason === 'blocked' ? ' because it has changed its access rules' : ' because it is not responding as expected'}, so this brief rests on web research only. It is checked again regularly.`);
  } else if (connector && http && !g.project.developer && !idUsable) {
    notes.push(connector && connector.byIdOnly
      ? 'No company registration number was found for the developer, so the official insolvency register could not be checked. Ask the developer for the seller\u2019s registration number.'
      : 'The developer could not be identified from the search results, so the official register check was skipped rather than guessed. Ask the developer for the seller\u2019s exact legal name and registration number.');
  } else if (connector && http) {
    const devName = g.project.developer;
    try {
      const r = await withDeadline(connector.lookup(devName, { http, env, ids: allIds, localName: g.project.developer_local }),
                                   Math.min(15000, timeLeft() - 6000));
      if (r.skipped) notes.push('The official register check is not configured on this server.');
      else if (r.gone) notes.push('The official register has withdrawn this record.');
      else if (r.match) {
        registry = r.match;
        r.findings.forEach(f => g.findings.push(markFinding({ ...f, id: 'reg-' + f.id }, query)));
        r.pages.forEach(p => { const n = norm(p.url); if (n) retrieved.set(n, p); });
      } else if (r.note === 'no-cin') {
        notes.push('No company registration number (CIN) was found for the developer, so IBBI\u2019s insolvency records could not be checked. Ask the developer for the seller\u2019s CIN.');
      } else if (r.note === 'no-local-name') {
        notes.push('The developer\u2019s registered Chinese name was not found, so Taiwan\u2019s company register could not be searched. Ask the developer for the seller\u2019s exact registered name and Unified Business Number.');
      } else {
        notes.push(`No confident match for \u201c${devName || 'the developer'}\u201d in the official register. Ask the developer for the seller\u2019s exact legal name and number.`);
      }
    } catch {
      notes.push('The official register did not respond this time.');
    }
  }

  if (!searchOk && !registry) {
    const e = new Error('Research could not be completed right now. Please try again shortly.'); e.status = 503; throw e;
  }

  // 4. Adviser. advise() already guards its own model call internally
  // and falls back to the fixed question library on failure. This
  // outer guard is defense in depth against a failure OUTSIDE that
  // inner try -- a malformed g.project, for instance -- so a bug in
  // the advisory layer can never take down a request that already has
  // real, grounded findings.
  let adv;
  try {
    adv = await withDeadline(advise(g, { env, fetchImpl }), timeLeft() - 1000);
  } catch {
    adv = { reading: [], questions: [] };
    notes.push('The adviser could not run this time; findings and registers are unaffected.');
  }
  if (registry) {
    adv.questions.unshift({
      who: 'Legal team', when: 'Before booking', source: 'registry',
      question: /^CIN /.test(registry.name) ? `Is the company with CIN ${registry.id} the seller named on my agreement?` : `Is ${registry.name} (${registry.id}) the company named as seller on my agreement?`,
      good: 'Yes, and the agreement shows the same name and number.',
      red_flag: 'A different company, or no registration number on the agreement.'
    });
  }

  // 5. Brief.
  const used = new Set();
  g.findings.forEach(f => f.urls.forEach(u => used.add(norm(u))));
  g.conflicts.forEach(c => c.versions.forEach(v => used.add(norm(v.url))));
  const counts = { confirmed: 0, reported: 0, single: 0, developer: 0, disputed: g.conflicts.length };
  g.findings.forEach(f => { counts[f.mark] = (counts[f.mark] || 0) + 1; });

  const brief = {
    version: 1,
    ref: briefRef(k),
    query, location, market, marketLabel: mkt.label,
    depth: registry ? depthOf(market) : 'Research',
    marketNote: mkt.note,
    checkedAt: new Date().toISOString(),
    project: { ...g.project, ids: normalizeIds(g.project.ids) },
    registry,
    counts,
    findings: g.findings.map(f => ({ id: f.id, topic: f.topic, stance: f.stance || 'neutral', claim: f.claim, mark: f.mark, sites: f.sites, note: f.note || '', lane: f.lane || 'search',
                                     sources: f.urls.map(u => ({ url: u, site: siteOf(u), host: hostOf(u) })) })),
    conflicts: g.conflicts.map(c => ({ topic: c.topic, versions: c.versions.map(v => ({ value: v.value, url: v.url, site: siteOf(v.url), host: hostOf(v.url) })) })),
    gaps: g.gaps,
    reading: adv.reading,
    questions: adv.questions,
    removed: g.removed,
    searches,
    pages: [...retrieved.entries()].map(([n, p]) => ({ url: p.url, title: p.title || siteOf(p.url), site: siteOf(p.url), cited: used.has(n) })),
    notes: capNotes(notes),
    pipeline_status: {
      search: searchOk ? 'ok' : 'failed',
      registry: registry ? 'matched' : (registryOff ? 'switched_off' : (connector ? (g.project.developer ? 'no_match' : 'skipped_no_developer') : 'unavailable')),
      adviser: adv.reading.length || adv.questions.some(q => q.source === 'adviser') ? 'ok' : 'library_only',
      degraded: !searchOk || !registry && Boolean(connector)
    },
    responsible: RESPONSIBLE(env),
    disclaimer: 'Research, not advice. ShelterKart never tells you to buy or not buy, and no developer can pay to change what it shows.'
  };
  // The buyer's statutory rights and costs for this market (and Indian state): plain, cited data.
  brief.protections = protectionsFor(market, [brief.project && brief.project.location, location].filter(Boolean).join(' '));
  cacheSet(k, brief);
  entities.register({ key: k, market, query, location, project: brief.project });
  return brief;
}

function normalizeIds(ids) {
  const clean = id => String(id).replace(/[^\w-]/g, '').toUpperCase();
  return [...new Set((ids || []).map(clean).filter(Boolean))];
}

// Failure notes (search down, register down) matter more to a reader
// deciding how much to trust the brief than a routine "developer not
// identified" note. A bad hour with five failure paths firing at once
// should not bury the one the user most needs to see.
const NOTE_PRIORITY = [/web search/i, /register did not respond/i, /register check is not configured/i, /adviser could not run/i];
function capNotes(notes) {
  if (notes.length <= 4) return notes;
  const rank = n => { const i = NOTE_PRIORITY.findIndex(re => re.test(n)); return i === -1 ? NOTE_PRIORITY.length : i; };
  const sorted = [...notes].sort((a, b) => rank(a) - rank(b));
  return [...sorted.slice(0, 4), `And ${notes.length - 4} more note(s) omitted for length.`];
}

module.exports = { runResearch, validateInput, purgeByUrl, purgeByHost, purgeDurably, isAnswerable, getByRef, getByRefAsync, listRecentReports, setReview, capOf, pausedReason, registerBrief,
  attachStore, hydrate,
  _daily: daily, _underDailyCap: underDailyCap, _cache: cache, _refStore: refStore, _entities: entities, _withDeadline: withDeadline, Timeout };
