'use strict';
/**
 * What each AI engine did since the server started: calls, failures, fail-overs it rescued, tokens, searches, time and
 * cost (from the catalogue's price for the model actually used). Per agent too, so the router can use measured costs.
 * Never stores prompts or answers.
 */
const state = new Map();
let sink = null;   // told about every call as it happens (the daily history); a sink that throws never reaches the engine call
const told = ev => { if (sink) { try { sink(ev); } catch { /* history must never break an engine call */ } } };
const blank = () => ({ calls: 0, ok: 0, failed: 0, rescued: 0, tokensIn: 0, tokensOut: 0, searches: 0, ms: 0, costUsd: 0, costedCalls: 0, uncostedCalls: 0, byRole: {}, lastError: '', lastErrorAt: '' });
const row = id => { if (!state.has(id)) state.set(id, blank()); return state.get(id); };
function ok(id, role, r, ms, rescued, cost) {
  const c = row(id); c.calls++; c.ok++; c.ms += ms; if (rescued) c.rescued++;
  c.tokensIn += (r.usage && r.usage.input) || 0; c.tokensOut += (r.usage && r.usage.output) || 0; c.searches += r.searches || 0;
  const b = c.byRole[role] || (c.byRole[role] = { calls: 0, costUsd: 0, costedCalls: 0 }); b.calls++;
  told({ engine: id, role, ok: true, rescued: Boolean(rescued), tokensIn: (r.usage && r.usage.input) || 0, tokensOut: (r.usage && r.usage.output) || 0, searches: r.searches || 0, ms, costUsd: cost == null ? null : cost });
  if (cost == null) c.uncostedCalls++; else { c.costUsd += cost; c.costedCalls++; b.costUsd += cost; b.costedCalls++; }
}
/** A failed call can still have been billed (a lead that finished two rounds and then failed): `err.usage`, `err.searches` and `cost` carry that spend. */
function fail(id, role, err, ms, cost) {
  const c = row(id); c.calls++; c.failed++; c.ms += ms; c.lastError = String((err && err.message) || err).slice(0, 160); c.lastErrorAt = new Date().toISOString();
  const u = (err && err.usage) || null, tin = (u && u.input) || 0, tout = (u && u.output) || 0, se = (err && err.searches) || 0;
  c.tokensIn += tin; c.tokensOut += tout; c.searches += se;
  if (cost != null && cost > 0) { c.costUsd += cost; c.wastedUsd = (c.wastedUsd || 0) + cost; }
  told({ engine: id, role, ok: false, ms, ...(tin || tout || se ? { tokensIn: tin, tokensOut: tout, searches: se, costUsd: cost == null ? null : cost } : {}) });
}
/** Average measured cost of a successful call for this engine and agent, once there are at least `min` costed calls. */
function measured(id, role, min = 5) { const b = state.has(id) && state.get(id).byRole[role]; return b && b.costedCalls >= min ? b.costUsd / b.costedCalls : null; }
function snapshot() {
  const out = {};
  for (const [id, c] of state) out[id] = { ...c, byRole: JSON.parse(JSON.stringify(c.byRole)), avgMs: c.calls ? Math.round(c.ms / c.calls) : 0,
    estimatedCostUsd: c.costedCalls ? Math.round(c.costUsd * 10000) / 10000 : null, costComplete: c.uncostedCalls === 0 };
  return out;
}
const reset = () => state.clear();
const setSink = fn => { sink = typeof fn === 'function' ? fn : null; };
module.exports = { ok, fail, measured, snapshot, reset, setSink };
