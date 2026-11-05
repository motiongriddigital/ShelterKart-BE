'use strict';
/**
 * The cost model: what each pipeline step and each report costs, per engine, from the catalogue's prices (engines/catalog.js)
 * and the assumptions in data/cost-model.json (token counts, searches, call counts: all estimates a reader can change).
 * Pure: no network, no keys. The premium search uses it to choose a depth and to show modelled beside measured cost.
 */
const fs = require('fs'), path = require('path');
const CAT = require('./catalog');
const FILE = path.join(__dirname, '..', 'data', 'cost-model.json');
const LEVELS = ['low', 'typical', 'high'];
const r6 = v => (v == null ? null : Math.round(v * 1e6) / 1e6);
const clone = o => JSON.parse(JSON.stringify(o));

function load(file = FILE) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
/** A copy of the assumptions with `patch` merged in (objects merge, everything else replaces): for what-if runs. */
function withOverrides(A, patch) {
  const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v; return a; };
  return merge(clone(A), patch);
}

/** Engines that can serve an operation, whatever is configured: from each adapter's own supports(). */
function eligible(op, opts = { mediaType: 'image/png' }) {
  const { ADAPTERS } = require('./index');
  return Object.keys(ADAPTERS).filter(id => ADAPTERS[id].supports(op, opts));
}
const defaultModel = id => CAT.engine(id).defaultModel;

const pick = (v, level) => (v && typeof v === 'object' ? v[level] : v);
/** The tokens and searches of one call at a level: input is the prompt plus what each search and each full page read adds. */
function usageOf(call, level, A) {
  const T = A.tokens, searches = pick(call.searches, level) || 0, fetches = pick(call.fetches, level) || 0;
  const input = Math.round((pick(call.prompt, level) + searches * T.perSearchIn + fetches * T.perFetchIn) * (searches || fetches ? T.resendFactor : 1));
  return { input, output: pick(call.out, level), searches, fetches };
}
/** USD for one call on one engine and model (the catalogue's own costOf), with the token and search parts apart. */
function callCost(engineId, call, level, A, model = defaultModel(engineId)) {
  const u = usageOf(call, level, A), e = CAT.engine(engineId), total = CAT.costOf(engineId, model, { input: u.input, output: u.output }, u.searches);
  if (total == null) return { engine: engineId, model, usd: null, ...u };
  const search = u.searches / 1000 * (e.searchPer1kUsd || 0);
  return { engine: engineId, model, usd: r6(total), tokensUsd: r6(total - search), searchUsd: r6(search), ...u };
}

/** Engines for a role and operation, cheapest first, the way the router ranks them with no benchmark and no measured data. */
function rank(role, op, A) {
  const d = (CAT.catalog().roleDefaults || {})[role] || {};
  return eligible(op).map(id => ({ id, usd: CAT.costOf(id, defaultModel(id), { input: d.in, output: d.out }, d.searches || 0) }))
    .sort((a, b) => (a.usd == null) - (b.usd == null) || (a.usd || 0) - (b.usd || 0) || (a.id < b.id ? -1 : 1)).map(x => x.id);
}

/** How many model calls a step makes at a level, and how many engines share each unit of work (the panel). */
function callsOf(stepId, level, A) {
  const S = A.scenario, v = k => S[k][level];
  switch (stepId) {
    case 'sweep_preview': return { calls: v('previewPanel'), panel: v('previewPanel'), note: 'one engine, the cheapest' };
    case 'sweep_full': return { calls: v('fullSweepPanel'), panel: v('fullSweepPanel'), note: 'every search-capable engine' };
    case 'lead_following': { const leads = v('leadRounds') * v('leadsPerRound') + v('reviewerLeads'); return { calls: leads * v('leadPanel'), panel: v('leadPanel'), units: leads, note: `${leads} leads, each on ${v('leadPanel')} engines` }; }
    case 'reviewer': return { calls: v('reviewerPanel'), panel: v('reviewerPanel'), note: 'the two cheapest engines' };
    case 'question_writer': return { calls: v('questionPanel'), panel: v('questionPanel'), note: 'the two cheapest engines' };
    case 'legacy_pass': return { calls: 3, panel: 1, note: 'record, track and voice, each on the cheapest engine' };
    case 'legacy_adviser': return { calls: 1, panel: 1, note: 'one engine' };
    case 'translate_batch': { const n = Math.ceil(v('translateStrings') / 30); return { calls: Math.round(n * (1 + v('translateRetryShare')) * 100) / 100, panel: 1, note: `${v('translateStrings')} strings in batches of 30, retry share ${v('translateRetryShare')}` }; }
    case 'translate_check': return { calls: 1, panel: 1, note: 'one engine' };
    case 'document_check': return { calls: 1, panel: 1, note: 'one engine approved for personal data' };
    case 'premium_wave': return { calls: v('premiumWaves') * v('premiumEngines'), panel: v('premiumEngines'), units: v('premiumWaves'), note: `${v('premiumWaves')} waves on ${v('premiumEngines')} engines` };
    case 'premium_verify': return { calls: v('premiumVerifyTargets') * v('premiumVerifyEngines'), panel: v('premiumVerifyEngines'), units: v('premiumVerifyTargets'), note: `${v('premiumVerifyTargets')} findings on ${v('premiumVerifyEngines')} engines` };
    default: return { calls: 0, panel: 0, note: 'no model call' };
  }
}

/** One step at one level: calls, the cost of a call on every engine that can serve it, the cost on each engine alone, and as routed (cheapest first). */
function stepModel(stepId, level, A) {
  const def = A.steps[stepId], n = callsOf(stepId, level, A);
  if (!def.call) return { step: stepId, label: def.label, level, calls: 0, searchCapable: false, engines: [], perCall: {}, onEachEngine: {}, routedUsd: 0, routedEngines: [], note: n.note };
  const opts = def.op === 'read' ? { mediaType: 'image/png' } : undefined;
  const ids = eligible(def.op, opts), perCall = {};
  for (const id of ids) perCall[id] = callCost(id, def.call, level, A);
  const onEach = Object.fromEntries(ids.map(id => [id, perCall[id].usd == null ? null : r6(perCall[id].usd * n.calls)]));
  const order = rank(def.role, def.op, A).filter(id => perCall[id] && perCall[id].usd != null);
  const units = n.units != null ? n.units : n.calls / (n.panel || 1);
  const size = Math.max(1, n.panel), routed = order.slice(0, Math.ceil(size));
  const perUnit = routed.reduce((s, id, i) => s + perCall[id].usd * Math.min(1, size - i), 0);
  const usage = def.call ? usageOf(def.call, level, A) : null;
  return { step: stepId, label: def.label, level, role: def.role, op: def.op, searchCapable: def.op === 'search', calls: n.calls, note: n.note, usage,
    engines: ids, perCall, onEachEngine: onEach, routedEngines: routed, routedUsd: r6(perUnit * units) };
}

/** A whole report at a level: its steps, the total as routed, and the total if one engine did everything it can (null where it cannot). */
function reportModel(kind, level, A) {
  const steps = A.reports[kind].map(s => stepModel(s, level, A));
  const routedUsd = r6(steps.reduce((s, x) => s + x.routedUsd, 0));
  const single = {};
  for (const id of Object.keys(require('./index').ADAPTERS)) {
    let tot = 0, ok = true;
    for (const x of steps) { if (!x.calls) continue; if (x.onEachEngine[id] == null) { ok = false; break; } tot += x.onEachEngine[id]; }
    single[id] = ok ? r6(tot) : null;
  }
  return { report: kind, level, steps: steps.map(x => ({ step: x.step, usd: x.routedUsd, calls: x.calls })), routedUsd, singleEngineUsd: single };
}

/** What the buyer's price leaves after tax, in dollars, from the price book (the same functions the quote uses). */
function netPrices(A, pricing = require('../pricing')) {
  const data = pricing.load(Object.assign({}, process.env, { TAX_GATE: 'off' }));
  const out = [];
  for (const r of A.netPrice.rungs) {
    const country = A.netPrice.country[r.currency], profile = country ? pricing.taxProfileFor(data, country) : null;
    const t = pricing.splitTax(data, r.gross, r.currency, profile), net = pricing.toMajor(data, t.netMinor, r.currency), fx = data.book.fx.perUsd[r.currency];
    out.push({ currency: r.currency, gross: r.gross, net: Math.round(net * 100) / 100, netUsd: r6(net / fx), grossUsd: r6(r.gross / fx), taxIncluded: t.taxMinor > 0, fxPerUsd: fx, fxAsOf: data.book.fx.asOf });
  }
  return { book: data.book.version, capShare: 0.3, rungs: out.map(x => ({ ...x, aiCapUsd: r6(x.netUsd * 0.3) })) };
}

/** The whole model as data: every step at every level, every report, the net prices and the cost shares. */
function model(A = load()) {
  const steps = {}, reports = {}, models = {};
  for (const s of Object.keys(A.steps)) steps[s] = Object.fromEntries(LEVELS.map(l => [l, stepModel(s, l, A)]));
  for (const k of Object.keys(A.reports)) reports[k] = Object.fromEntries(LEVELS.map(l => [l, reportModel(k, l, A)]));
  for (const [id, e] of Object.entries(CAT.catalog().engines)) models[id] = Object.fromEntries(Object.keys(e.models || {}).map(m => [m, e.models[m]]));
  const net = netPrices(A), shares = {};
  for (const k of ['preview', 'paid_report', 'premium_search', 'legacy_brief']) shares[k] = Object.fromEntries(LEVELS.map(l => [l, net.rungs.map(r => ({ currency: r.currency, gross: r.gross, share: r6(reports[k][l].routedUsd / r.netUsd) }))]));
  return { assumptionsAsOf: A.asOf, catalogueChecked: CAT.catalog().checked, steps, reports, net, shares, models };
}

/** Modelled cost of one call of a step at a level on an engine, or null: what the premium search shows beside the measured cost. */
function modelledCall(stepId, level, engineId, A = load()) {
  const def = A.steps[stepId]; if (!def || !def.call) return null;
  return callCost(engineId, def.call, level, A).usd;
}

module.exports = { load, withOverrides, eligible, usageOf, callCost, rank, callsOf, stepModel, reportModel, netPrices, model, modelledCall, LEVELS };
