'use strict';
/**
 * Premium search: when is a finding accepted. Decided in code from the sources, never on a model's word, with the codebase's own
 * rules: a source the search never returned does not count (the grounding gate), agreement is counted by independent SITES and
 * not pages, an official source (regulator, registry, court, exchange) is enough by itself, and the developer's own word is a
 * claim, never accepted as fact. A finding on a disputed field is not accepted unless an official source settles it.
 */
const D = require('../../engine/dossier');
const { siteOf } = require('../../engine/grounding');

const WEIGHT = { identity: 3, record: 3, money: 3, legal: 3, complaints: 3, timeline: 2, units: 2, construction: 2, track_record: 2 };
const keyOf = f => (f.field ? f.field + '|' + D.norm(f.value || f.claim) : D.norm(f.claim)).slice(0, 100);

/** One merged fact (engine/dossier.js mergeFacts) with its evidence counted: pages the search returned, independent sites, official. */
function evidenceOf(f, { developerSite = '' } = {}) {
  const seen = (f.sources || []).filter(s => s.seen), sites = new Set(seen.map(s => siteOf(s.url)).filter(Boolean));
  const own = developerSite ? [...sites].filter(s => D.host('https://' + s).endsWith(String(developerSite).toLowerCase().replace(/^www\./, ''))).length : 0;
  return { sources: (f.sources || []).length, seen: seen.length, sites: sites.size, independentSites: sites.size - own, official: seen.some(s => D.isOfficial(s.url)), engines: (f.foundBy || []).length };
}

/**
 * @returns { accepted, weak, conflicting, claims, unsupported } arrays of { key, id, area, field, claim, value, evidence, reason }
 * minSites: independent sites that corroborate a finding with no official source (default 2).
 */
function assess(facts, { developerSite = '', minSites = 2 } = {}) {
  const out = { accepted: [], weak: [], conflicting: [], claims: [], unsupported: [] };
  for (const f of facts) {
    const ev = evidenceOf(f, { developerSite }), row = { key: keyOf(f), id: f.id, area: f.area, field: f.field || '', value: f.value || '', claim: f.claim, status: f.status, kind: f.kind, evidence: ev, sources: (f.sources || []).map(s => s.url) };
    if (!ev.seen) out.unsupported.push({ ...row, reason: 'cites no page the search returned' });
    else if (f.kind === 'developer_claim' || f.status === 'claim') out.claims.push({ ...row, reason: 'the developer\'s own word' });
    else if (ev.official) out.accepted.push({ ...row, reason: 'official source' });
    else if (f.inConflict) out.conflicting.push({ ...row, reason: 'sources disagree and no official source settles it' });
    else if (ev.independentSites >= minSites) out.accepted.push({ ...row, reason: ev.independentSites + ' independent sites' });
    else out.weak.push({ ...row, reason: ev.independentSites + ' independent site, not enough' });
  }
  return out;
}

/** The findings worth a second look, most valuable first: disputed ones, then weak ones in the areas a buyer cares about most. */
function targets(assessed, max) {
  const score = (r, bonus) => bonus + (WEIGHT[r.area] || 1) + (r.evidence.seen ? 0.5 : 0);
  return [...assessed.conflicting.map(r => ({ ...r, why: 'conflict', score: score(r, 5) })), ...assessed.weak.map(r => ({ ...r, why: 'weak', score: score(r, 0) }))]
    .sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1)).slice(0, Math.max(0, max));
}

module.exports = { assess, targets, evidenceOf, keyOf, WEIGHT };
