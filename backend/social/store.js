'use strict';
/**
 * The desk's durable store: a few collections of documents (posts, packs, pauses, incidents, gaps, knowledge items, settings).
 * Three backends behind one interface: memory (tests, the demo), files (one JSON file per collection, written atomically), and
 * Postgres (one table, social_docs, one row per document). Writes are coalesced and flushed a moment later; flush() waits for them,
 * and a restart loads everything back, so an approved post waiting in the buffer is never lost.
 */
const fs = require('fs'), path = require('path');
const KINDS = ['posts', 'packs', 'pauses', 'incidents', 'gaps', 'kb', 'meta'];
const clone = o => JSON.parse(JSON.stringify(o));

function memoryPersist() { return { async load() { return {}; }, async write() {} }; }
function filePersist(dir) {
  fs.mkdirSync(dir, { recursive: true }); const file = k => path.join(dir, k + '.json');
  return {
    async load() { const out = {}; for (const k of KINDS) { try { out[k] = JSON.parse(fs.readFileSync(file(k), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw Object.assign(new Error(`The ${k} file is unreadable: ${e.message}`), { code: 'store_unreadable' }); } } return out; },
    async write(dirty, all) { for (const k of Object.keys(dirty)) { const tmp = file(k) + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(all[k])); fs.renameSync(tmp, file(k)); } },
  };
}
/** Postgres: social_docs(kind text, id text, data jsonb, updated_at timestamptz, primary key (kind, id)). `query` is pool.query. */
function pgPersist(query) {
  return {
    async load() { const r = await query('SELECT kind, id, data FROM social_docs'); const out = {}; for (const row of r.rows) (out[row.kind] = out[row.kind] || {})[row.id] = row.data; return out; },
    async write(dirty, all) { for (const [k, ids] of Object.entries(dirty)) for (const id of ids) { if (all[k][id] === undefined) await query('DELETE FROM social_docs WHERE kind=$1 AND id=$2', [k, id]); else await query('INSERT INTO social_docs (kind, id, data, updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (kind, id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()', [k, id, JSON.stringify(all[k][id])]); } },
  };
}

function makeStore({ persist = memoryPersist(), delayMs = 20, onError = () => {} } = {}) {
  const all = Object.fromEntries(KINDS.map(k => [k, {}])), dirty = {}; let timer = null, inflight = Promise.resolve();
  const mark = (k, id) => { (dirty[k] = dirty[k] || new Set()).add(id); if (!timer) { timer = setTimeout(() => { timer = null; flushNow(); }, delayMs); if (timer.unref) timer.unref(); } };
  const flushNow = () => {
    const batch = {}; for (const [k, set] of Object.entries(dirty)) { batch[k] = [...set]; delete dirty[k]; }
    if (!Object.keys(batch).length) return inflight;
    inflight = inflight.then(() => persist.write(batch, all)).catch(e => { onError(e); });
    return inflight;
  };
  const col = kind => ({
    get: id => all[kind][id] || null, put(id, doc) { all[kind][id] = doc; mark(kind, id); return doc; }, delete(id) { delete all[kind][id]; mark(kind, id); },
    update(id, fn) { const d = all[kind][id]; if (!d) return null; fn(d); mark(kind, id); return d; }, all: () => Object.values(all[kind]), find: pred => Object.values(all[kind]).filter(pred), size: () => Object.keys(all[kind]).length,
  });
  return {
    async load() { const data = await persist.load(); for (const k of KINDS) if (data[k]) all[k] = data[k]; return this; },
    async flush() { if (timer) { clearTimeout(timer); timer = null; } flushNow(); await inflight; },
    posts: col('posts'), packs: col('packs'), pauses: col('pauses'), incidents: col('incidents'), gaps: col('gaps'), kb: col('kb'), meta: col('meta'),
    snapshot: () => clone(all),
  };
}
module.exports = { makeStore, memoryPersist, filePersist, pgPersist, KINDS };
