'use strict';
/**
 * Premium search: the policy. policy.choose(context) -> action, called at two decisions of every search:
 *
 *   step 'plan'    before any search: how deep to go, how many engines (and which), how many waves of names, how many searches
 *   step 'review'  after the waves: whether to run a second pass on weak or conflicting findings, on how many, with which engines
 *
 * context: plain numbers and short tokens (see featuresOf): the market, the budget and what is left, the engines that can serve it with
 * their estimated cost per call, how sure the index is about the project, and, at 'review', what the waves found and spent.
 * action: { depth, engines: [ids], waves, variantsPerWave, searches, fetches, verifyTargets, verifyEngines: [ids], minNewPerWave, minNewPerUsd }.
 *
 * The baseline is deterministic and follows the cost model (engines/costmodel.js): the deepest depth whose modelled cost fits in
 * the budget. A learned policy plugs in with guard(): it returns an action, guard() checks it against the rules below (engines that exist,
 * numbers in range, a plan that fits the budget) and falls back to the baseline when it throws, is slow or returns something unusable.
 * Where it goes: a contextual bandit first (arms = the DEPTHS, context = featuresOf), logged propensities allow off-policy evaluation
 * (premium-search-design.md); a full policy over each wave later. Nothing here learns.
 */
const CM = require('../../engines/costmodel');

const VERSION = 1;
const DEPTHS = {
  light: { engines: 2, waves: 1, variantsPerWave: 3, searches: 6, fetches: 2, verifyTargets: 0, verifyEngines: 0, minNewPerWave: 1, minNewPerUsd: 0 },
  standard: { engines: 3, waves: 2, variantsPerWave: 3, searches: 8, fetches: 3, verifyTargets: 3, verifyEngines: 2, minNewPerWave: 1, minNewPerUsd: 2 },
  deep: { engines: 4, waves: 3, variantsPerWave: 3, searches: 8, fetches: 4, verifyTargets: 6, verifyEngines: 3, minNewPerWave: 1, minNewPerUsd: 2 },
};
const ORDER = ['light', 'standard', 'deep'];
const LIMITS = { engines: [1, 5], waves: [1, 4], variantsPerWave: [1, 6], searches: [1, 12], fetches: [0, 6], verifyTargets: [0, 10], verifyEngines: [0, 4], minNewPerWave: [0, 10], minNewPerUsd: [0, 50] };
const HEADROOM = 1.25;

const bandOf = c => (c === 'sure' ? 3 : c === 'likely' ? 2 : c === 'possible' ? 1 : 0);
/** The features a learned policy sees: numbers and short tokens only. */
function featuresOf(c) {
  return { step: c.step, market: c.market || 'xx', queryTokens: c.queryTokens || 0, hasRegId: c.hasRegId ? 1 : 0, indexBand: bandOf(c.indexConfidence), knownNames: c.knownNames || 0,
    budgetUsd: c.budgetUsd, budgetLeftUsd: c.budgetLeftUsd, enginesAvailable: (c.engines || []).length, cheapestEstUsd: (c.engines || []).length ? Math.min(...c.engines.map(e => e.estUsd == null ? 1 : e.estUsd)) : null,
    spentUsd: c.spentUsd || 0, wavesRun: c.wavesRun || 0, accepted: c.accepted || 0, weak: c.weak || 0, conflicting: c.conflicting || 0, lastNewAccepted: c.lastNewAccepted == null ? null : c.lastNewAccepted };
}

/** Modelled USD of a call of a step on an engine: the cost model's figure, else the engine's own estimate, else a flat guess. */
function callUsd(stepId, engine, A) {
  const m = CM.modelledCall(stepId, 'typical', engine.engine, A);
  return m != null ? m : engine.estUsd != null ? engine.estUsd : 0.25;
}
/** Modelled cost of a plan and of a second pass: what the baseline compares with the budget. */
function planUsd(p, engines, A) {
  const panel = engines.slice(0, p.engines), wave = panel.reduce((s, e) => s + callUsd('premium_wave', e, A), 0);
  const verify = engines.slice(0, p.verifyEngines).reduce((s, e) => s + callUsd('premium_verify', e, A), 0) * p.verifyTargets;
  return { wavesUsd: wave * p.waves, verifyUsd: verify, totalUsd: wave * p.waves + verify };
}

function baseline({ A = CM.load(), share = 0.85 } = {}) {
  return {
    id: 'baseline', version: VERSION,
    choose(c) {
      const engines = c.engines || [];
      if (c.step === 'review') {
        const want = Math.min(c.weak + c.conflicting, c.plan ? c.plan.verifyTargets : 0), ids = (c.plan ? c.plan.verifyEngines : []).length ? c.plan.verifyEngines : [];
        const per = ids.reduce((s, id) => s + callUsd('premium_verify', engines.find(e => e.engine === id) || { engine: id }, A), 0) * HEADROOM;
        const afford = per > 0 ? Math.floor(Math.max(0, c.budgetLeftUsd) / per) : 0, n = Math.max(0, Math.min(want, afford));
        return { secondPass: n > 0, verifyTargets: n, verifyEngines: n > 0 ? ids : [] };
      }
      let pick = 'light';
      for (const d of ORDER) { const p = adapt(DEPTHS[d], c, engines); if (planUsd(p, engines, A).totalUsd * HEADROOM <= c.budgetUsd * share) pick = d; }
      const p = adapt(DEPTHS[pick], c, engines);
      return { depth: pick, ...p, engines: engines.slice(0, p.engines).map(e => e.engine), verifyEngines: engines.slice(0, p.verifyEngines).map(e => e.engine) };
    },
  };
}
/** A depth made to fit what is known: no more engines than exist, and a project the index is sure about needs one wave of names. */
function adapt(d, c, engines) {
  const n = Math.max(1, Math.min(d.engines, engines.length)), sure = bandOf(c.indexConfidence) >= 3 || c.hasRegId;
  return { ...d, engines: n, verifyEngines: Math.min(d.verifyEngines, n), waves: sure ? 1 : d.waves, verifyTargets: d.verifyTargets };
}

const within = (v, [lo, hi]) => Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi;
/** The rules every action must meet, whoever chose it. Returns the problems found (empty means usable). */
function problems(step, a, c) {
  const p = [], ids = new Set((c.engines || []).map(e => e.engine));
  if (!a || typeof a !== 'object') return ['no action'];
  if (step === 'review') {
    if (typeof a.secondPass !== 'boolean') p.push('secondPass');
    if (!within(a.verifyTargets, LIMITS.verifyTargets)) p.push('verifyTargets');
    if (!Array.isArray(a.verifyEngines) || a.verifyEngines.some(x => !ids.has(x))) p.push('verifyEngines');
    if (a.secondPass && (!(a.verifyTargets > 0) || !a.verifyEngines.length)) p.push('secondPass without targets or engines');
    return p;
  }
  if (!ORDER.includes(a.depth)) p.push('depth');
  for (const k of ['waves', 'variantsPerWave', 'searches', 'fetches', 'verifyTargets', 'verifyEngines', 'minNewPerWave', 'minNewPerUsd']) if (k !== 'verifyEngines' && !within(a[k], LIMITS[k])) p.push(k);
  if (!Array.isArray(a.engines) || !a.engines.length || a.engines.length > LIMITS.engines[1] || a.engines.some(x => !ids.has(x)) || new Set(a.engines).size !== a.engines.length) p.push('engines');
  if (!Array.isArray(a.verifyEngines) || a.verifyEngines.some(x => !ids.has(x))) p.push('verifyEngines');
  return p;
}

/**
 * Wrap a policy so its actions are checked. A throw, a timeout, an invalid action or a plan whose modelled cost is over the whole budget
 * gives the baseline's action instead, marked fallback. Returns { action, policy: {id, version, fallback, problems}, propensity }.
 */
function guard(policy, fallback = baseline(), { timeoutMs = 2000, A = CM.load() } = {}) {
  return async function choose(c) {
    let a = null, bad = [], timer = null;
    try {
      a = await Promise.race([Promise.resolve(policy.choose(c)), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('policy too slow')), timeoutMs); })]);
      bad = problems(c.step, a, c);
      if (!bad.length && c.step === 'plan' && planUsd({ ...a, engines: a.engines.length, verifyEngines: a.verifyEngines.length }, c.engines.filter(e => a.engines.includes(e.engine)), A).wavesUsd > c.budgetUsd) bad.push('over budget');
    } catch (e) { bad = [String((e && e.message) || e).slice(0, 40)]; } finally { clearTimeout(timer); }
    if (bad.length) return { action: fallback.choose(c), policy: { id: fallback.id, version: fallback.version, fallback: true, problems: bad.length }, propensity: 1 };
    const prop = Number(a.propensity);
    const { propensity, ...action } = a;
    return { action, policy: { id: policy.id || 'custom', version: policy.version || 0, fallback: false, problems: 0 }, propensity: prop > 0 && prop <= 1 ? prop : 1 };
  };
}

module.exports = { baseline, guard, problems, featuresOf, planUsd, callUsd, DEPTHS, ORDER, LIMITS, HEADROOM, VERSION };
