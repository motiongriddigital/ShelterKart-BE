'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const REF_RE = /^SK-[A-F0-9]{12}$/;
const KINDS = ['preview', 'full'];
const KEY_RE = /^[a-f0-9]{16}$/;
const FILE_RE = /^(preview|full)-([a-f0-9]{16})\.pdf$/;

const badRef = ref => !REF_RE.test(String(ref));
const badKind = kind => !KINDS.includes(kind);

function createPdfStore({ dir, now = () => Date.now() } = {}) {
  if (!dir) throw new Error('a PDF store needs a directory');
  const root = path.resolve(dir);
  const refDir = ref => path.join(root, ref);
  const ensureDir = d => fs.mkdirSync(d, { recursive: true, mode: 0o700 });

  function filesOf(ref) {
    let names = [];
    try { names = fs.readdirSync(refDir(ref)); } catch { return []; }
    const out = [];
    for (const name of names) {
      const m = FILE_RE.exec(name);
      if (!m) continue;
      const file = path.join(refDir(ref), name);
      let st; try { st = fs.statSync(file); } catch { continue; }
      out.push({ ref, kind: m[1], key: m[2], path: file, bytes: st.size, madeAt: st.mtimeMs });
    }
    return out;
  }

  return {
    get(ref, kind) {
      if (badRef(ref) || badKind(kind)) return null;
      return filesOf(ref).filter(f => f.kind === kind).sort((a, b) => b.madeAt - a.madeAt)[0] || null;
    },
    put(ref, kind, key, buffer) {
      if (badRef(ref) || badKind(kind) || !KEY_RE.test(String(key))) throw new Error('invalid PDF store address');
      if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('nothing to store');
      const d = refDir(ref); ensureDir(d);
      const final = path.join(d, `${kind}-${key}.pdf`), tmp = path.join(d, `.${kind}-${key}.${process.pid}.${Date.now()}.tmp`);
      fs.writeFileSync(tmp, buffer, { mode: 0o600 });
      fs.renameSync(tmp, final);
      for (const f of filesOf(ref)) if (f.kind === kind && f.path !== final) { try { fs.unlinkSync(f.path); } catch { /* gone */ } }
      const st = fs.statSync(final);
      return { ref, kind, key, path: final, bytes: st.size, madeAt: st.mtimeMs };
    },
    remove(ref, kind) {
      if (badRef(ref) || (kind !== undefined && badKind(kind))) return 0;
      let n = 0;
      for (const f of filesOf(ref)) if (!kind || f.kind === kind) { try { fs.unlinkSync(f.path); n++; } catch { /* gone */ } }
      try { fs.rmdirSync(refDir(ref)); } catch { /* not empty or gone */ }
      return n;
    },
    list() {
      let refs = [];
      try { refs = fs.readdirSync(root).filter(r => REF_RE.test(r)); } catch { return []; }
      return refs.flatMap(ref => filesOf(ref));
    },
    prune({ previewMs = 7 * 86400000, keep = () => true, at = now() } = {}) {
      let n = 0;
      for (const f of this.list()) {
        const stale = f.kind === 'preview' && at - f.madeAt > previewMs;
        let kept = true; try { kept = Boolean(keep(f.ref)); } catch { kept = true; }
        if (stale || !kept) { try { fs.unlinkSync(f.path); n++; } catch { /* gone */ } }
      }
      let refs = []; try { refs = fs.readdirSync(root).filter(r => REF_RE.test(r)); } catch { return n; }
      for (const r of refs) { try { fs.rmdirSync(refDir(r)); } catch { /* not empty */ } }
      return n;
    },
    stats() {
      const out = { files: 0, bytes: 0, byKind: { preview: { files: 0, bytes: 0 }, full: { files: 0, bytes: 0 } } };
      for (const f of this.list()) { out.files++; out.bytes += f.bytes; out.byKind[f.kind].files++; out.byKind[f.kind].bytes += f.bytes; }
      return out;
    },
    dir: root,
  };
}

function createMemoryPdfStore({ now = () => Date.now() } = {}) {
  const files = new Map();
  const id = (ref, kind) => `${ref}:${kind}`;
  return {
    get(ref, kind) {
      if (badRef(ref) || badKind(kind)) return null;
      const f = files.get(id(ref, kind));
      return f ? { ref, kind, key: f.key, path: null, bytes: f.buffer.length, madeAt: f.madeAt, buffer: f.buffer } : null;
    },
    put(ref, kind, key, buffer) {
      if (badRef(ref) || badKind(kind) || !KEY_RE.test(String(key))) throw new Error('invalid PDF store address');
      if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('nothing to store');
      const f = { key, buffer, madeAt: now() };
      files.set(id(ref, kind), f);
      return { ref, kind, key, path: null, bytes: buffer.length, madeAt: f.madeAt, buffer };
    },
    remove(ref, kind) {
      if (badRef(ref) || (kind !== undefined && badKind(kind))) return 0;
      let n = 0;
      for (const k of KINDS) if ((!kind || kind === k) && files.delete(id(ref, k))) n++;
      return n;
    },
    list() { return [...files.entries()].map(([k, f]) => { const [ref, kind] = k.split(':'); return { ref, kind, key: f.key, path: null, bytes: f.buffer.length, madeAt: f.madeAt }; }); },
    prune({ previewMs = 7 * 86400000, keep = () => true, at = now() } = {}) {
      let n = 0;
      for (const f of this.list()) {
        const stale = f.kind === 'preview' && at - f.madeAt > previewMs;
        let kept = true; try { kept = Boolean(keep(f.ref)); } catch { kept = true; }
        if (stale || !kept) { files.delete(id(f.ref, f.kind)); n++; }
      }
      return n;
    },
    stats() {
      const out = { files: 0, bytes: 0, byKind: { preview: { files: 0, bytes: 0 }, full: { files: 0, bytes: 0 } } };
      for (const f of this.list()) { out.files++; out.bytes += f.bytes; out.byKind[f.kind].files++; out.byKind[f.kind].bytes += f.bytes; }
      return out;
    },
    dir: null,
  };
}

const defaultDir = (env = process.env) => env.PDF_DIR || (env.LIVE_JOBS_DIR ? path.join(env.LIVE_JOBS_DIR, 'pdfs') : path.join(os.tmpdir(), 'shelterkart-pdfs'));

module.exports = { createPdfStore, createMemoryPdfStore, defaultDir, REF_RE, KINDS };
