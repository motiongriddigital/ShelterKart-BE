'use strict';
/** The engine catalogue (backend/data/ai-engines.json): default models, prices, data notes. Read fresh when the file changes. */
const fs = require('fs'), path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'ai-engines.json');
let cache = null, mtime = 0, override = null;
function catalog() {
  if (override) return override;
  try { const m = fs.statSync(FILE).mtimeMs; if (!cache || m !== mtime) { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); mtime = m; } } catch { cache = cache || { engines: {}, roleDefaults: {} }; }
  return cache;
}
const engine = id => catalog().engines[id] || {};
/** USD for one call, or null when a needed price is unknown. */
function costOf(id, model, usage = {}, searches = 0) {
  const e = engine(id), p = (e.models || {})[model];
  if (!p) return null;
  if (searches > 0 && e.searchPer1kUsd == null) return null;
  return (usage.input || 0) / 1e6 * p.in + (usage.output || 0) / 1e6 * p.out + searches / 1000 * (e.searchPer1kUsd || 0);
}
module.exports = { catalog, engine, costOf, _setForTest: c => { override = c; } };
