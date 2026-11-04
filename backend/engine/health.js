'use strict';
/**
 * ShelterKart — source health.
 *
 * Tamil Nadu's regulator stopped allowing automated access to its
 * registered-projects page. Nobody was told; it was found by accident
 * while researching something else. Registers change their rules and their
 * response shapes without notice, and a connector that quietly stops
 * working is worse than one that says so: buyers get "no match" and
 * conclude the developer has no record.
 *
 * Once a day this module runs one *canary* per market: a lookup of a
 * well-known company through the very connector production uses. It
 * checks two different things:
 *
 *   1. Does the connector still work? It must find the canary company.
 *      Because the connector's own parser does the reading, a changed
 *      response shape shows up here as "no match", not just a dead host.
 *   2. Is it still allowed? Every URL the connector actually requested is
 *      checked against that host's robots.txt. The URLs come from the
 *      request itself, not a hand-kept list, so they cannot drift.
 *
 * A market whose register is confirmed down is switched to research-only
 * until it recovers, and the operator is told. The engine then says so in
 * the report instead of quietly reporting "no match".
 */

const AGENT = 'ShelterKart';

/* ------------------------------------------------------------------ */
/* robots.txt, per RFC 9309                                            */
/* ------------------------------------------------------------------ */

/** @returns {Array<{agents:string[], rules:Array<{allow:boolean, pattern:string}>}>} */
function parseRobots(text) {
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const field = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === 'allow' || field === 'disallow') {
      lastWasAgent = false;
      if (!cur) continue;                         // a rule before any user-agent line applies to nobody
      cur.rules.push({ allow: field === 'allow', pattern: value });
    } else {
      lastWasAgent = false;                       // sitemap, crawl-delay etc. do not affect access
    }
  }
  return groups;
}

/** Does a robots pattern match this path? '*' matches any run, a trailing '$' anchors the end. */
function patternMatches(pattern, path) {
  if (pattern === '') return false;               // an empty Disallow allows everything
  let anchored = false, pat = pattern;
  if (pat.endsWith('$')) { anchored = true; pat = pat.slice(0, -1); }
  const re = '^' + pat.split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : '');
  return new RegExp(re).test(path);
}

/**
 * Is `path` (with its query string) allowed for `agent`?
 * The group naming our agent most specifically wins; without one, `*`.
 * Within a group the longest matching pattern wins, and Allow beats
 * Disallow when they are equally long.
 */
function robotsAllows(text, path, agent = AGENT) {
  const groups = parseRobots(text);
  const token = agent.toLowerCase();
  // How specifically a group addresses us: the length of the user-agent
  // value that names us ('*' counts as 0, no match as -1). A version
  // suffix such as "shelterkart/1.0" is ignored.
  const specificity = g => {
    let best = -1;
    for (const raw of g.agents) {
      const a = raw.split('/')[0].trim();
      if (a === '*') best = Math.max(best, 0);
      else if (a === token) best = Math.max(best, a.length);
    }
    return best;
  };
  const top = Math.max(-1, ...groups.map(specificity));
  if (top < 0) return true;                                        // no group addresses us at all
  // Every group at the winning specificity applies together (a robots file
  // may repeat the same user-agent in several blocks).
  const rules = groups.filter(g => specificity(g) === top).flatMap(g => g.rules);
  let verdict = null, verdictLen = -1;
  for (const r of rules) {
    if (!patternMatches(r.pattern, path)) continue;
    const len = r.pattern.length;                                  // longest pattern wins; Allow wins a tie
    if (len > verdictLen || (len === verdictLen && r.allow)) { verdict = r.allow; verdictLen = len; }
  }
  return verdict === null ? true : verdict;
}

/**
 * Fetch and apply a host's robots.txt.
 * RFC 9309: a 4xx means there is no robots file, so everything is allowed;
 * a 5xx or a network failure means the answer is unknown -- reported as
 * 'unreachable', never guessed either way.
 * @returns {Promise<{status:'allowed'|'blocked'|'unreachable', detail:string}>}
 */
async function checkRobots(http, host, pathWithQuery) {
  let res;
  try { res = await http(`https://${host}/robots.txt`, {}); }
  catch (e) { return { status: 'unreachable', detail: `robots.txt for ${host} could not be fetched (${e && e.message})` }; }
  if (res.status >= 500) return { status: 'unreachable', detail: `robots.txt for ${host} returned HTTP ${res.status}` };
  if (res.status >= 400) return { status: 'allowed', detail: `${host} has no robots.txt` };
  let text;
  try { text = await res.text(); } catch { return { status: 'unreachable', detail: `robots.txt for ${host} was unreadable` }; }
  return robotsAllows(text, pathWithQuery)
    ? { status: 'allowed', detail: `${host} robots.txt allows ${pathWithQuery}` }
    : { status: 'blocked', detail: `${host} robots.txt now disallows ${pathWithQuery}` };
}

/* ------------------------------------------------------------------ */
/* canaries                                                            */
/* ------------------------------------------------------------------ */

/**
 * One well-known company per register. `expectId` is asserted ONLY where
 * it was read from the official source; the rest need only to be found,
 * which still proves the connector, its parser and the endpoint work.
 * A canary that has never passed puts the market in 'unconfirmed', not
 * 'down' -- so a wrong guess here can never switch off a working register.
 * India has none: IBBI needs a CIN known to have a claims page, and one
 * has not been verified. Add one here when it has.
 */
// Keyed by MARKET code (uk), not connector name (gb). A mismatch here once
// left the UK register unchecked and unreported; a test now requires every
// market with a register to have a canary or be listed in NO_CANARY.
const NO_CANARY = new Set(['in']);
const CANARIES = {
  uk: { name: 'The Berkeley Group Holdings PLC', expectId: '05172586', needs: ['COMPANIES_HOUSE_API_KEY'] },   // verified live on Companies House
  sg: { name: 'GuocoLand Limited', expectId: '197600660W' },                                                   // UEN stated in its own SGX annual reports
  fr: { name: 'Nexity' },
  no: { name: 'Equinor ASA' },
  fi: { name: 'Kesko Oyj' },
  cz: { name: 'Skanska a.s.' },
  ie: { name: 'Glenveagh Homes Limited' },
  au: { name: 'BHP Group Limited', needs: ['ABR_GUID'] },
  tw: { name: 'TSMC', localName: '\u53f0\u7063\u7a4d\u9ad4\u96fb\u8def\u88fd\u9020', needs: ['GCIS_NOTIFIED'] },
};

/** Run one market's canary. Never throws. */
async function runCanary(market, connector, { http, env, canary = CANARIES[market], robotsOverride = new Set() }) {
  if (!canary) return { kind: 'skipped', detail: 'no canary defined for this market' };
  const missing = (canary.needs || []).filter(k => !env[k]);
  if (missing.length) return { kind: 'skipped', detail: `not configured on this server (${missing.join(', ')})` };

  const requested = [];                                           // every URL the connector really asked for
  const recording = async (url, opts) => {
    const res = await http(url, opts);
    requested.push({ url, status: res && res.status });
    return res;
  };

  let r;
  try {
    r = await connector.lookup(canary.name, { http: recording, env, ids: canary.ids || [], localName: canary.localName });
  } catch (e) {
    return { kind: 'fail', detail: `the lookup threw: ${e && e.message}`, requested };
  }
  if (r && r.skipped) return { kind: 'skipped', detail: r.skipped };

  const bad = requested.find(x => x.status && x.status >= 400);
  if (!r || !r.match) {
    return { kind: 'fail', requested,
      detail: bad ? `HTTP ${bad.status} from ${new URL(bad.url).host}${new URL(bad.url).pathname}` : 'the canary company was not found, or the response no longer has the expected shape' };
  }
  if (canary.expectId && String(r.match.id) !== String(canary.expectId)) {
    return { kind: 'fail', requested, detail: `found ${r.match.id}, expected ${canary.expectId} for the canary company` };
  }
  if (!Array.isArray(r.findings) || r.findings.length === 0) {
    return { kind: 'fail', requested, detail: 'matched, but produced no findings' };
  }

  // robots.txt, for the paths the connector really used
  const seen = new Set();
  for (const { url } of requested) {
    let u; try { u = new URL(url); } catch { continue; }
    if (u.pathname === '/robots.txt') continue;
    const key = u.host + u.pathname + u.search;
    if (seen.has(key)) continue; seen.add(key);
    if (robotsOverride.has(market)) continue;
    const rb = await checkRobots(http, u.host, u.pathname + u.search);
    if (rb.status === 'blocked') return { kind: 'blocked', detail: rb.detail, requested };
    if (rb.status === 'unreachable') return { kind: 'fail', detail: rb.detail, requested };
  }
  return { kind: 'ok', detail: `found ${r.match.id} through ${new Set(requested.map(x => new URL(x.url).host)).size} host(s)`, requested };
}

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

/**
 * healthy      the canary passes
 * degraded     failed once after having passed -- could be a blip; still used
 * down         failed on two consecutive runs after having passed, or robots.txt
 *              now forbids the path -- switched to research-only
 * unconfirmed  has never passed -- still used, but the operator is asked to
 *              check the canary and the connector
 * skipped      not configured on this server
 */
function nextState(prev, result) {
  const p = prev || { state: 'unconfirmed', consecutiveFailures: 0, everHealthy: false };
  if (result.kind === 'skipped') return { ...p, state: 'skipped', detail: result.detail };
  if (result.kind === 'ok') return { state: 'healthy', consecutiveFailures: 0, everHealthy: true, detail: result.detail };
  if (result.kind === 'blocked')
    // compliance beats availability: no waiting for a second failure
    return { state: 'down', consecutiveFailures: (p.consecutiveFailures || 0) + 1, everHealthy: p.everHealthy, detail: result.detail, reason: 'blocked' };
  const failures = (p.consecutiveFailures || 0) + 1;
  if (!p.everHealthy) return { state: 'unconfirmed', consecutiveFailures: failures, everHealthy: false, detail: result.detail };
  return { state: failures >= 2 ? 'down' : 'degraded', consecutiveFailures: failures, everHealthy: true, detail: result.detail, reason: 'failing' };
}

const health = new Map();                                          // market -> record, the fast layer the engine reads

const getHealth = market => health.get(market) || null;
/** The only state that switches a register off. Everything else keeps using it. */
const isRegistryUsable = market => { const h = health.get(market); return !(h && h.state === 'down'); };
const setHealth = (market, rec) => { health.set(market, rec); };
const loadHealth = (market, rec) => { health.set(market, rec); };

/* ------------------------------------------------------------------ */
/* alerts                                                              */
/* ------------------------------------------------------------------ */

async function sendAlert(text, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  console.error('[source-health]', text);
  if (!env.ALERT_WEBHOOK_URL || typeof fetchImpl !== 'function') return false;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      // `text` for Slack-style hooks, `content` for Discord-style ones
      const res = await fetchImpl(env.ALERT_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, content: text }), signal: ctrl.signal });
      return Boolean(res && res.ok);
    } finally { clearTimeout(t); }
  } catch (e) { console.error('[source-health] alert delivery failed:', e && e.message); return false; }
}

/** What, if anything, is worth telling a human about this transition. */
function describeTransition(market, label, prevState, rec) {
  if (rec.state === prevState) return null;
  if (rec.state === 'down') return `ShelterKart: the official register for ${label} (${market}) is now switched to research-only. ${rec.detail}. ${rec.reason === 'blocked'
    ? 'Its robots.txt forbids automated access to the path used. If you have confirmed its terms permit this API use, set HEALTH_ROBOTS_OVERRIDE=' + market + '.'
    : 'It failed two checks in a row and will be retried tonight.'}`;
  if (rec.state === 'healthy' && prevState === 'down') return `ShelterKart: the official register for ${label} (${market}) has recovered and is back in use.`;
  return null;                                                    // 'unconfirmed' is reported as one digest per run, see runHealthChecks
}

/* ------------------------------------------------------------------ */
/* the run                                                             */
/* ------------------------------------------------------------------ */

const withTimeout = (p, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('check timed out')), ms);
  p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
});

/**
 * Check every market that has a live register, one at a time (a nightly
 * job has no reason to hit fifteen hosts at once), save the result, and
 * alert on changes only.
 */
/** The checks of this run of the server, for when there is no database (the database keeps the long history). */
const historyMem = [];
function remember(market, rec) { historyMem.push({ market, state: rec.state, reason: rec.reason || null, at: rec.checkedAt }); if (historyMem.length > 3000) historyMem.splice(0, historyMem.length - 3000); }
function memoryHistory(days) { const since = Date.now() - days * 24 * 3600 * 1000; return historyMem.filter(h => Date.parse(h.at) >= since); }

async function runHealthChecks({ connectors, markets, http, env = process.env, store = null, alert = sendAlert, now = () => new Date() }) {
  const robotsOverride = new Set(String(env.HEALTH_ROBOTS_OVERRIDE || '').split(',').map(s => s.trim()).filter(Boolean));
  const results = [], newlyUnconfirmed = [];
  for (const [market, m] of Object.entries(markets)) {
    if (!m.registry) continue;
    const connector = connectors[m.registry];
    if (!connector) continue;
    let result;
    try { result = await withTimeout(runCanary(market, connector, { http, env, robotsOverride }), 30000); }
    catch (e) { result = { kind: 'fail', detail: e && e.message }; }

    const prev = health.get(market) || null;
    const rec = { ...nextState(prev, result), market, checkedAt: now().toISOString(),
                  lastOkAt: result.kind === 'ok' ? now().toISOString() : (prev && prev.lastOkAt) || null };
    setHealth(market, rec);
    remember(market, rec);
    if (store) { try { await store.saveHealth(market, rec); } catch (e) { console.error('[source-health] could not save:', e && e.message); } }

    const msg = describeTransition(market, m.label, prev ? prev.state : null, rec);
    if (msg) { rec.alerted = await alert(msg, { env }); }
    if (rec.state === 'unconfirmed' && (!prev || prev.state !== 'unconfirmed')) newlyUnconfirmed.push(`${m.label} (${market}): ${rec.detail}`);
    results.push({ market, label: m.label, ...rec });
  }
  if (newlyUnconfirmed.length) {
    // One message, however many: on a first deploy every register is new.
    await alert(`ShelterKart: the register check has never passed for ${newlyUnconfirmed.length} market(s). They are still in use, but the canary company or the connector needs a look:\n- ${newlyUnconfirmed.join('\n- ')}`, { env });
  }
  return results;
}

/** Run once shortly after start-up and then every `hours`. Enabled on ONE instance. */
function startSchedule(run, { hours = 24, firstDelayMs = 60000 } = {}) {
  let timer = null;
  const tick = async () => { try { await run(); } catch (e) { console.error('[source-health] run failed:', e && e.message); } };
  const first = setTimeout(() => { tick(); timer = setInterval(tick, hours * 3600 * 1000); if (timer.unref) timer.unref(); }, firstDelayMs);
  if (first.unref) first.unref();
  return () => { clearTimeout(first); if (timer) clearInterval(timer); };
}

module.exports = {
  parseRobots, robotsAllows, patternMatches, checkRobots,
  CANARIES, NO_CANARY, runCanary, nextState, describeTransition, runHealthChecks, sendAlert, startSchedule,
  getHealth, isRegistryUsable, setHealth, loadHealth, memoryHistory, _health: health,
};
