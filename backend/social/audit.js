'use strict';
/**
 * The audit log: every verdict, approval, veto, pause and publication, chained by hash so that no entry can be changed or removed
 * without the chain failing. Memory by default; a file (one JSON line per entry) when `file` is given, and the chain is verified
 * when the file is opened. The Postgres store keeps the same entries in an insert-only table.
 */
const fs = require('fs'), crypto = require('crypto');
const sortKeys = v => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;
const canonical = o => JSON.stringify(sortKeys(o));
const hashOf = (prev, body) => crypto.createHash('sha256').update(prev + '|' + canonical(body)).digest('hex');
const GENESIS = '0'.repeat(64);

function makeAudit({ file = null, now = () => Date.now(), preload = null, sink = null } = {}) {
  let entries = [];
  const verify = list => { let prev = GENESIS; for (let i = 0; i < list.length; i++) { const { hash, ...body } = list[i]; if (body.prev !== prev || body.seq !== i + 1 || hashOf(prev, body) !== hash) return { ok: false, brokenAt: i + 1 }; prev = hash; } return { ok: true, length: list.length }; };
  if (preload) { entries = preload.slice(); const v = verify(entries); if (!v.ok) throw Object.assign(new Error('The audit log chain is broken at entry ' + v.brokenAt), { code: 'audit_broken' }); }
  else if (file && fs.existsSync(file)) { entries = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); const v = verify(entries); if (!v.ok) throw Object.assign(new Error('The audit log chain is broken at entry ' + v.brokenAt), { code: 'audit_broken' }); }
  return {
    append(kind, data = {}) {
      const prev = entries.length ? entries[entries.length - 1].hash : GENESIS, body = { seq: entries.length + 1, at: new Date(now()).toISOString(), kind, data, prev };
      const entry = { ...body, hash: hashOf(prev, body) }; entries.push(entry);
      if (file) fs.appendFileSync(file, JSON.stringify(entry) + '\n');
      if (sink) Promise.resolve().then(() => sink(entry)).catch(() => {});
      return entry;
    },
    verify: () => verify(entries), tail: (n = 50) => entries.slice(-n), all: () => entries.slice(), size: () => entries.length,
    filter: pred => entries.filter(pred),
  };
}
module.exports = { makeAudit, canonical, GENESIS };
