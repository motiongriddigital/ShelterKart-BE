'use strict';
/**
 * ShelterKart — what one investigation costs. Wraps the engine layer for a single job so every result it gets back is
 * priced from the catalogue (tokens and searches) and added to that job's own total. The global meter still sees
 * everything; this adds the per-report view the margin gate and the spending cap need.
 */
const CAT = require('../engines/catalog');

function costedEngines(engines, onCost) {
  const price = r => { try { const c = CAT.costOf(r.engine, r.model, r.usage, r.searches || 0); return Number.isFinite(c) ? c : 0; } catch { return 0; } };
  const wrapped = Object.create(engines);
  if (typeof engines.runEach === 'function') wrapped.runEach = async (...a) => {
    const res = await engines.runEach(...a);
    for (const r of (res && res.results) || []) onCost(price(r));
    return res;
  };
  if (typeof engines.run === 'function') wrapped.run = async (...a) => {
    const r = await engines.run(...a);
    if (r) onCost(price(r));
    return r;
  };
  return wrapped;
}

module.exports = { costedEngines };
