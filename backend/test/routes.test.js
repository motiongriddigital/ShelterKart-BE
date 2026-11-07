'use strict';
// The route table is the contract of the folder layout: splitting server.js into modules must not drop, add or reorder a route that matters.
// Compares what the server registers now with the snapshots in test/fixtures (regenerate with tools/dump_routes.js when a route is added on purpose).
const { execFileSync } = require('child_process'), path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..', '..');
let failures = 0;
const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });

const dump = mode => JSON.parse(execFileSync(process.execPath, ['-r', path.join(ROOT, 'backend/test/harness/stub-loader.js'), path.join(ROOT, 'tools/dump_routes.js'), mode], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: '' } }));
const keyOf = r => r.method + ' ' + r.path + ' #' + r.handlers;
const patterns = r => String(r.path).split(',');
const sample = p => p.replace(/:[A-Za-z]+/g, 'x').replace(/\*/g, 'x');
const toRe = p => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z]+/g, '[^/]+').replace(/\*/g, '.*') + '/?$');
function hits(a, b) {                       // can a request reach both layers a and b
  const ma = a.method === 'use' || a.method === 'all' ? null : a.method, mb = b.method === 'use' || b.method === 'all' ? null : b.method;
  if (ma && mb && ma !== mb) return false;
  const at = layer => p => layer.method === 'use' ? (p === '*' ? () => true : s => s === p || s.startsWith(p + '/')) : (p === '*' ? () => true : s => toRe(p).test(s));
  for (const pa of patterns(a)) for (const pb of patterns(b)) if (at(a)(pa)(sample(pb)) || at(b)(pb)(sample(pa))) return true;
  return false;
}
for (const mode of ['bare', 'accounts']) {
  const before = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `routes.${mode}.json`), 'utf8')), after = dump(mode);
  const count = list => list.reduce((m, r) => m.set(keyOf(r), (m.get(keyOf(r)) || 0) + 1), new Map());
  const cb = count(before), ca = count(after);
  const lost = [...cb.keys()].filter(k => (ca.get(k) || 0) < cb.get(k)), added = [...ca.keys()].filter(k => (cb.get(k) || 0) < ca.get(k));
  ok(`[${mode}] every route is still registered with the same number of handlers (${before.length})`, !lost.length && !added.length);
  if (lost.length) console.log('       lost: ' + lost.join(' | '));
  if (added.length) console.log('       added: ' + added.join(' | '));
  const posAfter = new Map(); after.forEach((r, i) => { const k = keyOf(r); (posAfter.get(k) || posAfter.set(k, []).get(k)).push(i); });
  const used = new Map(); const idx = before.map(r => { const k = keyOf(r), n = used.get(k) || 0; used.set(k, n + 1); return (posAfter.get(k) || [])[n]; });
  const flipped = [];
  for (let i = 0; i < before.length; i++) for (let j = i + 1; j < before.length; j++) {
    if (idx[i] === undefined || idx[j] === undefined || idx[i] < idx[j]) continue;
    if (hits(before[i], before[j])) flipped.push(keyOf(before[i]) + '  BEFORE  ' + keyOf(before[j]));
  }
  ok(`[${mode}] routes that can match the same request keep their order`, !flipped.length);
  flipped.slice(0, 10).forEach(f => console.log('       flipped: ' + f));
}
