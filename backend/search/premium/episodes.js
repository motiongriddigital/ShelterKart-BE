'use strict';
/**
 * Premium search: the episode log, the data a learned policy will be trained on later. One JSON line per decision, appended to a
 * sink (a JSONL file, or memory; any object with append(lines) and read() fits, so a table can replace the file).
 *
 * Line kinds (FORMAT_VERSION 1):
 *   decision  episode, step, name, at, policy {name, version, fallback}, propensity, context {features}, action, cost {measuredUsd,
 *             modelledUsd, byEngine, calls, searches, tokensIn, tokensOut}, latencyMs, findings {accepted, newAccepted, weak,
 *             conflicting, developerClaims, unsupported}, waves [...], stop, outcome {the episode's final numbers, the same on every line of it}
 *   label     episode or project key, at, corrected, disputed, source: what happened to the findings afterwards (a correction or a dispute), joined by episode id or project key
 *
 * No personal data and no raw text: only numbers, booleans and short tokens survive scrub(), and the keys that could hold a query,
 * a prompt, an answer or a person are dropped by name. The log holds no user id and no query; a project key is a one-way hash.
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const FORMAT_VERSION = 1;
const DROP = new Set(['query', 'location', 'prompt', 'answer', 'text', 'claim', 'claims', 'email', 'phone', 'user', 'userId', 'name', 'url', 'urls', 'response']);
const TOKEN = /^[A-Za-z0-9_.:+-]{1,48}$/;

/** Keep numbers, booleans, short plain tokens and objects and arrays of those; drop everything else, and any key that may hold text. */
function scrub(v, depth = 0) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return TOKEN.test(v) ? v : undefined;
  if (depth > 4) return undefined;
  if (Array.isArray(v)) return v.slice(0, 24).map(x => scrub(x, depth + 1)).filter(x => x !== undefined);
  if (typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) { if (DROP.has(k)) continue; const s = scrub(x, depth + 1); if (s !== undefined) o[k] = s; }
    return o;
  }
  return undefined;
}

const memorySink = (max = 2000) => { const rows = []; return { append(lines) { rows.push(...lines); if (rows.length > max) rows.splice(0, rows.length - max); }, read() { return rows.slice(); }, kind: 'memory' }; };
function fileSink(file, log = console) {
  return {
    kind: 'file', file,
    append(lines) { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n'); } catch (e) { log.error('[premium-search] could not write the episode log: ' + e.message); } },
    read(limit = 5000) { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } },
  };
}

const newId = () => 'ep_' + crypto.randomBytes(8).toString('hex');
const projectKey = (text, market) => crypto.createHash('sha256').update(String(market || '') + '|' + String(text || '')).digest('hex').slice(0, 12);

/** Reward components computed from a finished episode, so any reward can be recomputed offline from the log: see docs in premium-search-design.md. */
function rewardOf(o) {
  const spent = Math.max(0.01, o.spentUsd || 0), accepted = o.accepted || 0;
  return { acceptedPerUsd: Math.round(accepted / spent * 1e4) / 1e4, netOfDisputes: Math.round((accepted - 2 * (o.conflicting || 0)) / spent * 1e4) / 1e4 };
}

function createEpisodes({ sink = memorySink(), now = () => Date.now(), log = console } = {}) {
  const iso = () => new Date(now()).toISOString();
  /** Write the decisions of one episode. Each carries the episode's outcome. Never throws. */
  function writeEpisode(id, decisions, outcome) {
    try {
      const o = { ...outcome, reward: rewardOf(outcome) };
      sink.append(decisions.map((d, i) => scrub({ v: FORMAT_VERSION, kind: 'decision', episode: id, step: i + 1, at: iso(), ...d, outcome: o })));
    } catch (e) { log.error('[premium-search] episode not logged: ' + e.message); }
  }
  /** What happened to the findings later (a correction through the right of reply, a dispute): one line, joined by episode id. */
  function label(id, { project = null, corrected = 0, disputed = 0, source = 'manual' } = {}) {
    try { sink.append([scrub({ v: FORMAT_VERSION, kind: 'label', episode: id || null, project, at: iso(), corrected: Number(corrected) || 0, disputed: Number(disputed) || 0, source })]); return true; } catch (e) { log.error('[premium-search] label not logged: ' + e.message); return false; }
  }
  /** Aggregates for the admin: counts, average cost and findings per episode, by depth. */
  function summary(limit = 5000) {
    const rows = (sink.read ? sink.read(limit) : []).filter(r => r.kind === 'decision'), byEp = new Map();
    for (const r of rows) byEp.set(r.episode, r.outcome || {});
    const eps = [...byEp.values()], n = eps.length, sum = k => eps.reduce((s, e) => s + (Number(e[k]) || 0), 0);
    const byDepth = {};
    for (const r of rows) if (r.step === 1 && r.action) { const d = r.action.depth || 'unknown'; const b = byDepth[d] || (byDepth[d] = { episodes: 0, spentUsd: 0, accepted: 0 }); b.episodes++; b.spentUsd += (r.outcome || {}).spentUsd || 0; b.accepted += (r.outcome || {}).accepted || 0; }
    for (const b of Object.values(byDepth)) { b.spentUsd = Math.round(b.spentUsd * 1e4) / 1e4; }
    const labels = (sink.read ? sink.read(limit) : []).filter(r => r.kind === 'label');
    return { episodes: n, avgSpentUsd: n ? Math.round(sum('spentUsd') / n * 1e4) / 1e4 : 0, avgModelledUsd: n ? Math.round(sum('modelledUsd') / n * 1e4) / 1e4 : 0, avgAccepted: n ? Math.round(sum('accepted') / n * 100) / 100 : 0,
      labelled: new Set(labels.filter(l => l.episode).map(l => l.episode)).size, corrected: labels.reduce((s, l) => s + (l.corrected || 0), 0), disputed: labels.reduce((s, l) => s + (l.disputed || 0), 0), byDepth };
  }
  return { newId, writeEpisode, label, summary, read: limit => (sink.read ? sink.read(limit) : []), sink };
}

module.exports = { createEpisodes, memorySink, fileSink, scrub, rewardOf, projectKey, newId, FORMAT_VERSION };
