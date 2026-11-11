'use strict';
/**
 * ShelterKart -- the AI engine layer. Vendor-neutral by design.
 *
 * Four agents use an AI model: research (three parallel passes with web search), the adviser, the document check, and
 * translation with its meaning check (roles: research, adviser, documents, translate, verify). Five engines can serve
 * them: Anthropic (Claude), OpenAI (ChatGPT models), Google (Gemini), xAI (Grok) and DeepSeek. NO engine is preferred
 * by name. For each agent the router takes the engines that are:
 *   - set up (an API key; the model is the setting, the per-agent setting, or the catalogue's default),
 *   - able to do the job (DeepSeek cannot search; Grok and OpenAI read images but not PDFs),
 *   - allowed by the company (AI_ENGINES / AI_ENGINES_<AGENT>, optional allow-lists),
 *   - approved for personal data when the job involves it (the document check: AI_PERSONAL_DATA_ENGINES, empty = none),
 *   - right for the stage: the preview sweep may be limited to AI_PREVIEW_ENGINES; every other stage may be limited to
 *     AI_PAID_ENGINES, and never uses an engine named in AI_FREE_ENGINES (a free-tier key, which may train on what it reads),
 *   - and, once quality-gate results exist for that agent, passed it (tools/engine_benchmark.js),
 * and ranks them by expected cost per call: measured on this server (after 5 calls), else from the quality gate, else
 * from catalogue prices. The cheapest goes first; the others are the fail-over order. AI_ROUTING=order uses the
 * allow-list's own order instead.
 *
 * What no engine may do is unchanged: claims are kept only if they cite a page the
 * engine's search returned, and translations keep every number, date, ID and URL or fall back to English.
 */
const fs = require('fs'), path = require('path');
const ADAPTERS = { anthropic: require('./anthropic'), openai: require('./openai'), gemini: require('./gemini'), xai: require('./xai'), deepseek: require('./deepseek') };
const meter = require('./meter'), CAT = require('./catalog');
const ROLES = ['research', 'adviser', 'documents', 'translate', 'verify'];
const OP = { research: 'search', adviser: 'complete', documents: 'read', translate: 'complete', verify: 'complete' };
const PERSONAL = new Set(['documents']);                 // agents that may carry a buyer's personal data
const list = s => [...new Set(String(s || '').split(',').map(x => x.trim().toLowerCase()).filter(x => ADAPTERS[x]))];

function modelFor(role, id, env) {
  const ID = id.toUpperCase(), R = String(role || '').toUpperCase();
  return (R && env[`${ID}_MODEL_${R}`]) || (id === 'anthropic' && (role === 'translate' || role === 'verify') && env.TRANSLATE_MODEL) || env[`${ID}_MODEL`] || CAT.engine(id).defaultModel;
}
let bcache = { file: '', mtime: 0, data: null };
function benchmarks(env) {
  const file = env.AI_BENCHMARK_FILE || path.join(__dirname, '..', '..', 'tools', 'benchmarks', 'results.json');
  try { const m = fs.statSync(file).mtimeMs; if (bcache.file !== file || bcache.mtime !== m) bcache = { file, mtime: m, data: JSON.parse(fs.readFileSync(file, 'utf8')) }; return bcache.data; }
  catch { return null; }
}
function estimate(role, id, model, env, bench) {
  const m = meter.measured(id, role);
  if (m != null) return { usd: m, basis: 'measured on this server' };
  const b = bench && bench.results && bench.results[role] && bench.results[role][id];
  if (b && b.costPerCallUsd != null && b.model === model) return { usd: b.costPerCallUsd, basis: 'quality gate' };
  const d = (CAT.catalog().roleDefaults || {})[role] || {};
  const c = CAT.costOf(id, model, { input: d.in, output: d.out }, d.searches || 0);
  return c == null ? { usd: null, basis: 'price unknown' } : { usd: c, basis: 'catalogue prices' };
}

/** Who may serve this agent, in what order, and why each other engine is excluded. */
function plan(role, env = process.env, op = OP[role], opts = { mediaType: 'image/png' }) {
  const allow = list(env['AI_ENGINES_' + String(role).toUpperCase()] || env.AI_ENGINES);
  const ids = allow.length ? allow : Object.keys(ADAPTERS);
  const bench = benchmarks(env), results = bench && bench.results && bench.results[role];
  const gated = Boolean(results && Object.keys(results).length) && env.AI_REQUIRE_BENCHMARK !== 'false';
  const personalOk = list(env.AI_PERSONAL_DATA_ENGINES);
  const preview = Boolean(opts && opts.stage === 'sweep');
  const freeKey = list(env.AI_FREE_ENGINES), previewOnly = list(env.AI_PREVIEW_ENGINES), paidOnly = list(env.AI_PAID_ENGINES);
  const candidates = [], excluded = [];
  for (const id of ids) {
    const a = ADAPTERS[id], model = modelFor(role, id, env);
    if (!a.configured(env)) { excluded.push({ engine: id, reason: 'not set up (no API key)' }); continue; }
    if (!a.supports(op, opts)) { excluded.push({ engine: id, reason: op === 'search' ? 'cannot search the web' : op === 'read' ? 'cannot read this file type' : 'cannot do this job' }); continue; }
    if (PERSONAL.has(role) && !personalOk.includes(id)) { excluded.push({ engine: id, reason: 'not approved for personal data' }); continue; }
    if (preview && previewOnly.length && !previewOnly.includes(id)) { excluded.push({ engine: id, reason: 'not on the preview list (AI_PREVIEW_ENGINES)' }); continue; }
    if (!preview && freeKey.includes(id)) { excluded.push({ engine: id, reason: 'runs on a free-tier key: preview only (AI_FREE_ENGINES)' }); continue; }
    if (!preview && paidOnly.length && !paidOnly.includes(id)) { excluded.push({ engine: id, reason: 'not on the paid list (AI_PAID_ENGINES)' }); continue; }
    if (gated) {
      const r = results[id];
      if (!r) { excluded.push({ engine: id, reason: 'not yet through the quality gate' }); continue; }
      if (!r.pass) { excluded.push({ engine: id, reason: 'failed the quality gate' }); continue; }
    }
    const est = estimate(role, id, model, env, bench);
    candidates.push({ engine: id, model, estUsd: est.usd, basis: est.basis, quality: results && results[id] ? results[id].qualityIndex || 0 : 0 });
  }
  if (!(env.AI_ROUTING === 'order' && allow.length))
    candidates.sort((x, y) => (x.estUsd == null) - (y.estUsd == null) || (x.estUsd || 0) - (y.estUsd || 0) || y.quality - x.quality || (x.engine < y.engine ? -1 : 1));
  return { role, op, gated, routing: env.AI_ROUTING === 'order' && allow.length ? 'order' : 'cost', candidates, excluded };
}
const available = (role, env = process.env, op = OP[role], opts = { mediaType: 'image/png' }) => plan(role, env, op, opts).candidates.length > 0;
const order = (role, env = process.env) => plan(role, env).candidates.map(c => c.engine);

/** What a failed call cost anyway (rounds that finished before the failure), priced from the catalogue; null when nothing was billed. */
function spentOn(c, e) {
  if (!e || !e.usage || !((e.usage.input || 0) + (e.usage.output || 0) + (e.searches || 0))) return null;
  try { const v = CAT.costOf(c.engine, e.model || c.model, e.usage, e.searches || 0); return Number.isFinite(v) ? v : null; } catch { return null; }
}
const spendOf = (c, e) => (spentOn(c, e) == null ? {} : { usage: e.usage, searches: e.searches || 0, model: e.model || c.model });

/** Run one operation for one agent: the cheapest qualified engine first, the next on failure. */
async function run(role, op, args, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const p = plan(role, env, op, args); const tried = [...p.excluded.map(x => ({ engine: x.engine, skipped: x.reason }))]; let last = null;
  for (const c of p.candidates) {
    const t0 = Date.now();
    try {
      const r = await ADAPTERS[c.engine][op]({ ...args, model: c.model }, { env, fetchImpl });
      meter.ok(c.engine, role, r, Date.now() - t0, tried.some(t => t.error), CAT.costOf(c.engine, r.model || c.model, r.usage, r.searches || 0));
      return { ...r, engine: c.engine, model: r.model || c.model, tried };
    } catch (e) {
      meter.fail(c.engine, role, e, Date.now() - t0, spentOn(c, e));
      tried.push({ engine: c.engine, error: String((e && e.message) || e).slice(0, 160), ...spendOf(c, e) }); last = e;
    }
  }
  const err = last || Object.assign(new Error(`no AI engine is set up and allowed for ${role}`), { code: 'no_engine' });
  err.tried = tried; throw err;
}

/** The dashboard view: the plan per agent, each engine's catalogue facts, usage. Never shows a key. */
function status(env = process.env) {
  const cat = CAT.catalog(), bench = benchmarks(env);
  const engines = Object.fromEntries(Object.values(ADAPTERS).map(a => { const e = CAT.engine(a.id); return [a.id, { label: a.label, configured: a.configured(env), jurisdiction: e.jurisdiction || '', data: e.data || '', priceVerified: Boolean(e.priceVerified) }]; }));
  return { roles: Object.fromEntries(ROLES.map(r => [r, plan(r, env)])), engines, usage: meter.snapshot(), pricesChecked: cat.checked || '', benchmarkAt: bench && bench.updatedAt || null };
}

/**
 * The panel: the same job on EVERY allowed engine at once (up to `max`), not only the first that works.
 * Different engines find different pages, so the investigator merges what they all found.
 * One engine failing never sinks the others; only when every engine fails does this throw.
 */
async function runEach(role, op, args, { env = process.env, fetchImpl = globalThis.fetch, max } = {}) {
  const p = plan(role, env, op, args);
  const size = Number(max || env.INVESTIGATE_PANEL_SIZE) || p.candidates.length;
  const cands = p.candidates.slice(0, size);
  if (!cands.length) { const err = Object.assign(new Error(`no AI engine is set up and allowed for ${role}`), { code: 'no_engine' }); err.tried = p.excluded; throw err; }
  const settled = await Promise.all(cands.map(async c => {
    const t0 = Date.now();
    try {
      const r = await ADAPTERS[c.engine][op]({ ...args, model: c.model }, { env, fetchImpl });
      meter.ok(c.engine, role, r, Date.now() - t0, false, CAT.costOf(c.engine, r.model || c.model, r.usage, r.searches || 0));
      return { ok: true, ...r, engine: c.engine, model: r.model || c.model };
    } catch (e) {
      meter.fail(c.engine, role, e, Date.now() - t0, spentOn(c, e));
      return { ok: false, engine: c.engine, error: String((e && e.message) || e).slice(0, 160), ...spendOf(c, e) };
    }
  }));
  const results = settled.filter(r => r.ok), failed = settled.filter(r => !r.ok);
  if (!results.length) { const err = Object.assign(new Error('every engine on the panel failed'), { code: 'panel_failed' }); err.tried = failed; throw err; }
  return { results, failed, excluded: p.excluded };
}

module.exports = { run, runEach, plan, order, available, status, modelFor, ADAPTERS, ROLES, OP, meter };
