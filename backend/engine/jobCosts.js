'use strict';
/**
 * ShelterKart — what one investigation costs. Wraps the engine layer for a single job so every result it gets back is
 * priced from the catalogue (tokens and searches) and added to that job's own total. The global meter still sees
 * everything; this adds the per-report view the margin gate and the spending cap need.
 */
const CAT = require('../engines/catalog');

function costedEngines(engines, onCost) {
  const info = (r, args) => ({ stage: (args && args.stage) || 'other', engine: r.engine, input: Number(r.usage && r.usage.input) || 0, output: Number(r.usage && r.usage.output) || 0, searches: Number(r.searches) || 0 });
  const price = r => { try { const c = CAT.costOf(r.engine, r.model, r.usage, r.searches || 0); return Number.isFinite(c) ? c : 0; } catch { return 0; } };
  const wrapped = Object.create(engines);
  if (typeof engines.runEach === 'function') wrapped.runEach = async (...a) => {
    const res = await engines.runEach(...a);
    for (const r of (res && res.results) || []) onCost(price(r), info(r, a[2]));
    return res;
  };
  if (typeof engines.run === 'function') wrapped.run = async (...a) => {
    const r = await engines.run(...a);
    if (r) onCost(price(r), info(r, a[2]));
    return r;
  };
  return wrapped;
}

/** Adds one priced call to a job's per-stage totals (sweep, leads, reviewer, reviewer-leads, questions, other). */
function addStageCost(stages, usd, info = {}) {
  if (!(usd > 0)) return;
  const k = String(info.stage || 'other');
  const s = stages[k] || (stages[k] = { usd: 0, calls: 0, input: 0, output: 0, searches: 0 });
  s.usd += usd; s.calls += 1; s.input += Number(info.input) || 0; s.output += Number(info.output) || 0; s.searches += Number(info.searches) || 0;
}
/** The per-stage totals as a list, dearest first, dollars rounded to four places. */
function stageTotals(stages) {
  return Object.entries(stages || {}).filter(([, s]) => s && typeof s === 'object')
    .map(([stage, s]) => ({ stage, usd: Math.round((Number(s.usd) || 0) * 1e4) / 1e4, calls: s.calls | 0, input: s.input | 0, output: s.output | 0, searches: s.searches | 0 }))
    .sort((a, b) => b.usd - a.usd || a.stage.localeCompare(b.stage));
}

module.exports = { costedEngines, addStageCost, stageTotals };
