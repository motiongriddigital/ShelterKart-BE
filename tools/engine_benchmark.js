#!/usr/bin/env node
'use strict';
/**
 * The quality gate for AI engines, the same test for every vendor. No engine serves buyers until it passes here.
 *
 *   node tools/engine_benchmark.js --engine all                 research: every engine that has a key and can search
 *   node tools/engine_benchmark.js --engine gemini              one engine
 *   node tools/engine_benchmark.js --engine all --role translate --lang hi     translation fact-check pass rate
 *
 * It runs the five real sample reports and judges each engine on facts that are true whoever wrote the report, never
 * on resemblance to the stored samples (one engine wrote those): the official registration number, the developer's
 * legal entity, an official source, and how many claims grounding had to remove for citing a page the search never
 * returned. Translation is judged on how often the code's fact check forces a fallback to English.
 * It measures cost per call from the catalogue's prices for the model actually used, and writes every result to
 * tools/benchmarks/results.json, which the router reads: engines that fail are excluded, and among those that pass the
 * cheapest serves first.
 *
 * Thresholds are starting values, set before any live run; tune them after the first round, in the open.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), B = p => require(path.join(ROOT, 'backend', p));
const SAMPLES = ['hubtown', 'in', 'uk', 'sg', 'ae'];
const DEFAULTS = { maxRemovedShare: 0.30, maxTranslationFallbackShare: 0.15 };

const loadSample = id => JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'samples', id + '.json'), 'utf8'));
function scoreOf(brief) { try { const s = B('engine/score').computeScore(brief); return s && s.value != null ? s.value : null; } catch { return null; } }
function officialCount(brief) { const { isOfficial } = B('engine/grounding'); return (brief.pages || []).filter(p => p && p.url && isOfficial(p.url)).length; }

const GENERIC = new Set(['limited', 'private', 'group', 'properties', 'property', 'developers', 'developer', 'builder', 'builders', 'realty', 'holdings', 'company', 'estates', 'homes']);
const idKey = x => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/**
 * Pure and vendor-neutral: judge a candidate report on facts that are true whoever wrote it, never on how closely it
 * resembles the stored sample (which one engine wrote). Pass/fail rests on:
 *   - the official registration number, where the sample's official record has one,
 *   - the developer's legal entity (its distinctive name),
 *   - at least one official source, where one exists,
 *   - how many claims grounding had to remove because they cited a page the search never returned.
 * Findings kept are reported for reading, not used to pass or fail.
 */
function compare(base, cand, t = DEFAULTS) {
  const kept = (cand.findings || []).length, removed = Number(cand.removed) || 0;
  const removedShare = kept + removed ? removed / (kept + removed) : 0;
  const ids = (base.project && base.project.ids || []).map(idKey).filter(Boolean);
  const candIds = new Set((cand.project && cand.project.ids || []).map(idKey));
  const idFound = ids.length ? ids.some(x => candIds.has(x)) : null;
  const devTokens = String(base.project && base.project.developer || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !GENERIC.has(w));
  const candDev = String(cand.project && cand.project.developer || '').toLowerCase();
  const developerFound = devTokens.length ? devTokens.some(w => candDev.includes(w)) : null;
  const ob = officialCount(base), oc = officialCount(cand);
  const sb = scoreOf(base), sc = scoreOf(cand);
  const fails = [];
  if (removedShare > t.maxRemovedShare) fails.push(`grounding removed ${(removedShare * 100).toFixed(0)}% of claims (limit ${t.maxRemovedShare * 100}%)`);
  if (idFound === false) fails.push('did not find the official registration number ' + base.project.ids.join(' or '));
  if (developerFound === false) fails.push('did not identify the developer ' + base.project.developer);
  if (ob > 0 && oc === 0) fails.push('found no official source');
  return { kept, removed, removedShare: Math.round(removedShare * 1000) / 1000, idFound, developerFound, official: { sample: ob, candidate: oc },
    qualityIndex: kept + 2 * oc, info: { findingsInSample: (base.findings || []).length, score: { sample: sb, candidate: sc } },
    searches: cand.searches || 0, pages: (cand.pages || []).length, pass: fails.length === 0, fails };
}

const RESULTS = path.join(ROOT, 'tools', 'benchmarks', 'results.json');
/** Record a result where the router reads it: results[agent][engine]. */
function recordResults(role, engine, entry, file = RESULTS) {
  let all = {}; try { all = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  all.results = all.results || {}; all.results[role] = all.results[role] || {};
  all.results[role][engine] = entry; all.updatedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(all, null, 1) + '\n');
}
const avgCost = (usage, role) => { const b = usage && usage.byRole && usage.byRole[role]; return b && b.costedCalls ? Math.round(b.costUsd / b.costedCalls * 10000) / 10000 : null; };

async function benchmarkResearch({ engine, env = process.env, fetchImpl = globalThis.fetch, samples = SAMPLES, thresholds = DEFAULTS, log = () => {}, record = false }) {
  const { runResearch } = B('engine/research'), ENG = B('engines');
  const runEnv = { ...env, AI_ENGINES_RESEARCH: engine, AI_REQUIRE_BENCHMARK: 'false', AI_ROUTING: 'order', RESEARCH_DAILY_CAP: '1000' };
  if (!ENG.available('research', runEnv)) throw new Error(`engine "${engine}" is not configured for research (check its API key and model settings)`);
  ENG.meter.reset();
  const rows = [];
  for (const id of samples) {
    const base = loadSample(id), t0 = Date.now();
    try {
      const cand = await runResearch({ query: base.query, location: base.location, market: base.market }, { env: runEnv, fetchImpl });
      const r = { sample: id, ok: true, ms: Date.now() - t0, ...compare(base, cand, thresholds) };
      rows.push(r); log(`${r.pass ? 'pass' : 'FAIL'} ${id.padEnd(8)} kept ${r.kept}, removed ${r.removed}, registration ${r.idFound == null ? 'n/a' : r.idFound ? 'found' : 'MISSING'}, developer ${r.developerFound ? 'found' : 'MISSING'}, official ${r.official.candidate}${r.fails.length ? '  [' + r.fails.join('; ') + ']' : ''}`);
    } catch (e) { rows.push({ sample: id, ok: false, pass: false, ms: Date.now() - t0, fails: ['research failed: ' + String(e && e.message).slice(0, 160)] }); log(`FAIL ${id.padEnd(8)} research failed: ${e && e.message}`); }
  }
  const usage = ENG.meter.snapshot()[engine] || null, pass = rows.every(r => r.pass);
  const quality = rows.filter(r => r.ok).reduce((a, r) => a + r.qualityIndex, 0) / Math.max(1, rows.filter(r => r.ok).length);
  const out = { engine, model: ENG.modelFor('research', engine, runEnv), role: 'research', at: new Date().toISOString(), thresholds, rows, usage, costPerCallUsd: avgCost(usage, 'research'), qualityIndex: Math.round(quality * 10) / 10, pass };
  if (record) recordResults('research', engine, { pass, model: out.model, costPerCallUsd: out.costPerCallUsd, qualityIndex: out.qualityIndex, at: out.at });
  return out;
}

async function benchmarkTranslation({ engine, lang = 'hi', env = process.env, fetchImpl = globalThis.fetch, samples = SAMPLES, thresholds = DEFAULTS, log = () => {}, record = false }) {
  const T = B('engine/translate'), ENG = B('engines');
  const runEnv = { ...env, AI_ENGINES_TRANSLATE: engine, AI_ENGINES_VERIFY: engine, AI_REQUIRE_BENCHMARK: 'false', AI_ROUTING: 'order', TRANSLATE_ENABLED: 'true' };
  if (!ENG.available('translate', runEnv)) throw new Error(`engine "${engine}" is not configured for translation`);
  ENG.meter.reset();
  const items = samples.flatMap(id => (loadSample(id).findings || []).map((f, i) => ({ id: `${id}-${i}`, text: f.claim, sensitive: /court|insolven|fraud|default|penalt|complaint|stalled|delay/i.test(f.claim) })));
  const out = await T.translateTexts(items, lang, { env: runEnv, fetchImpl });
  const fell = Object.values(out).filter(r => !r.translated), share = items.length ? fell.length / items.length : 0;
  const reasons = fell.reduce((m, r) => ((m[r.why || 'unknown'] = (m[r.why || 'unknown'] || 0) + 1), m), {});
  const pass = share <= thresholds.maxTranslationFallbackShare;
  log(`${pass ? 'pass' : 'FAIL'} ${items.length} sentences into ${lang}: ${fell.length} fell back to English (${(share * 100).toFixed(0)}%) ${JSON.stringify(reasons)}`);
  const usage = ENG.meter.snapshot()[engine] || null, at = new Date().toISOString(), quality = Math.round((1 - share) * 1000) / 10;
  if (record) for (const role of ['translate', 'verify']) recordResults(role, engine, { pass, model: ENG.modelFor(role, engine, runEnv), costPerCallUsd: avgCost(usage, role), qualityIndex: quality, at });
  return { engine, role: 'translate', lang, at, thresholds, sentences: items.length, fellBack: fell.length, fallbackShare: Math.round(share * 1000) / 1000, reasons, usage, pass };
}

module.exports = { compare, recordResults, benchmarkResearch, benchmarkTranslation, DEFAULTS, SAMPLES };

if (require.main === module) {
  require(path.join(ROOT, 'backend', 'node_modules', 'dotenv')).config({ path: path.join(ROOT, 'backend', '.env') });
  const arg = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
  const which = arg('--engine'); if (!which) { console.error('usage: node tools/engine_benchmark.js --engine <anthropic|openai|gemini|xai|deepseek|all> [--role research|translate] [--lang hi]'); process.exit(2); }
  const ENG = B('engines'), role = arg('--role') || 'research', op = role === 'translate' ? 'complete' : 'search';
  const engines = which === 'all' ? Object.keys(ENG.ADAPTERS).filter(id => ENG.ADAPTERS[id].configured(process.env) && ENG.ADAPTERS[id].supports(op)) : [which];
  (async () => {
    let failed = 0;
    for (const engine of engines) {
      console.log(`\n== ${engine} (${role}) ==`);
      try {
        const r = role === 'translate' ? await benchmarkTranslation({ engine, lang: arg('--lang') || 'hi', log: console.log, record: true }) : await benchmarkResearch({ engine, log: console.log, record: true });
        const file = path.join(ROOT, 'tools', 'benchmarks', `${engine}-${role}-${r.at.slice(0, 10)}.json`);
        fs.writeFileSync(file, JSON.stringify(r, null, 1) + '\n');
        console.log(`${r.pass ? 'PASSED' : 'FAILED'}: ${engine} for ${role}${r.costPerCallUsd != null ? `, about $${r.costPerCallUsd} a call` : ''}. Written: ${path.relative(ROOT, file)}`);
        if (!r.pass) failed++;
      } catch (e) { console.error(`${engine}: ${e.message}`); failed++; }
    }
    console.log(`\nResults for the router: ${path.relative(ROOT, RESULTS)}`);
    process.exit(failed ? 1 : 0);
  })();
}
