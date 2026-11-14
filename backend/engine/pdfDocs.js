'use strict';
const crypto = require('crypto');
const H = require('./dossierHtml');
const { createPdfStore, defaultDir } = require('./pdfStore');

const TEMPLATE_VERSION = 'pdf-1';
const clean = s => String(s == null ? '' : s).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '');
const subjectOf = (brief, kind) => {
  const d = (brief && brief.dossier) || {}, bp = (brief && brief.project) || {}, dp = d.project || {};
  const dev = bp.developer || dp.developer || dp.promoter_legal_name || dp.brand;
  return clean((kind === 'full' && dev) || d.query || bp.name) || 'Report';
};
const stampOf = brief => {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(String((brief && brief.dossier && brief.dossier.asOf) || '')), code = String((brief && brief.ref) || '').replace(/^SK-/, '').slice(0, 6);
  return [day ? day[0] : null, code || null].filter(Boolean).join('_');
};
const filenameOf = (brief, kind) => [subjectOf(brief, kind), kind === 'preview' ? 'preview' : null, stampOf(brief)].filter(Boolean).join('_') + '.pdf';

function freeView(d) {
  const qs = d.questions || [], p = d.project || {};
  return { ref: d.ref, query: d.query, location: d.location, market: d.market, asOf: d.asOf, project: { name: p.name, ids: p.ids }, counts: d.counts, promises: d.promises,
    questions: qs.slice(0, 3).concat(qs.slice(3).map(q => ({ id: q.id, to: q.to, when: q.when }))) };
}

function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

function createPdfDocs({ pdf, store, env = process.env, log = console, now = () => Date.now() } = {}) {
  if (!pdf) throw new Error('a printer is needed');
  const files = store || createPdfStore({ dir: defaultDir(env) });
  const flights = new Map();
  const counters = { made: { preview: 0, full: 0 }, failed: 0, fromStore: 0, onDemand: 0, skippedBusy: 0, lastWarnAt: 0 };
  const auto = () => String(env.PDF_AUTO || 'on').toLowerCase() !== 'off';

  const dossierOf = brief => (brief && brief.dossier) || null;

  function keyOf(kind, dossier, ctx = {}) {
    const body = kind === 'full' ? dossier : freeView(dossier);
    return crypto.createHash('sha256').update(TEMPLATE_VERSION + '|' + kind + '|' + stable(body) + '|' + stable(kind === 'full' ? {} : ctx)).digest('hex').slice(0, 16);
  }

  function htmlFor(kind, brief, ctx = {}) {
    const d = dossierOf(brief);
    if (kind === 'full') return H.renderDossier(d);
    return H.renderPreviewPdf(freeView(d), { price: ctx.price || null, link: ctx.link || '' });
  }
  const footerFor = (kind, brief) => (kind === 'full'
    ? `ShelterKart report: ${brief.project.name}. ${brief.ref || ''}. Research, not advice.`
    : `ShelterKart free preview: ${brief.project.name}. ${brief.ref || ''}. Research, not advice.`);

  function reasonNow(brief, kind, held) {
    if (!dossierOf(brief)) return 'pending';
    if (held) return 'held';
    if (!pdf.available()) return 'unavailable';
    if (kind === 'full' && brief.dossier.phase !== 'complete') return 'completing';
    return null;
  }

  function describe(brief, { kind, ctx = {}, held = false } = {}) {
    const ref = brief && brief.ref;
    const base = { kind, ready: false };
    const reason = reasonNow(brief, kind, held);
    if (reason && !(reason === 'completing')) return { ...base, reason };
    const hit = files.get(ref, kind);
    const url = kind === 'full' ? `/r/${ref}/pdf` : `/r/${ref}/preview.pdf`;
    const filename = filenameOf(brief, kind);
    if (reason === 'completing') return { ...base, reason, url, filename };
    if (hit && hit.key === keyOf(kind, brief.dossier, ctx)) return { kind, ready: true, url, filename, bytes: hit.bytes, generatedAt: new Date(hit.madeAt).toISOString() };
    return { ...base, reason: 'not_made', url, filename };
  }

  async function print(kind, brief, ctx) {
    const bytes = await pdf.renderPdf(htmlFor(kind, brief, ctx), { footer: footerFor(kind, brief) });
    return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  }

  function warnStore(e) {
    if (now() - counters.lastWarnAt < 3600e3) return;
    counters.lastWarnAt = now();
    log.warn && log.warn('[pdf] the PDF directory could not be written: ' + String(e && e.message).split('\n')[0]);
  }

  function run(kind, brief, ctx, { onDemand }) {
    const ref = brief.ref, id = ref + ':' + kind;
    if (flights.has(id)) return flights.get(id);
    const key = keyOf(kind, brief.dossier, ctx), storable = kind === 'preview' || brief.dossier.phase === 'complete';
    const p = (async () => {
      const hit = files.get(ref, kind);
      if (hit && hit.key === key) { counters.fromStore++; return { path: hit.path, buffer: hit.buffer || null, bytes: hit.bytes, madeAt: hit.madeAt, key, from: 'store', stored: true }; }
      let buffer;
      try { buffer = await print(kind, brief, ctx); } catch (e) { counters.failed++; throw e; }
      counters.made[kind]++; if (onDemand) counters.onDemand++;
      if (!storable) return { path: null, buffer, bytes: buffer.length, madeAt: now(), key, from: 'print', stored: false };
      try { const put = files.put(ref, kind, key, buffer); return { path: put.path, buffer, bytes: put.bytes, madeAt: put.madeAt, key, from: 'print', stored: true }; }
      catch (e) { warnStore(e); return { path: null, buffer, bytes: buffer.length, madeAt: now(), key, from: 'print', stored: false }; }
    })().finally(() => { flights.delete(id); });
    flights.set(id, p);
    return p;
  }

  async function serve(brief, { kind, ctx = {}, held = false } = {}) {
    const reason = reasonNow(brief, kind, held);
    if (reason === 'pending') throw Object.assign(new Error('no report yet'), { code: 'pdf_pending' });
    if (reason === 'held') throw Object.assign(new Error('the report is held'), { code: 'pdf_held' });
    if (reason === 'unavailable') throw Object.assign(new Error('PDF printing is not available on this server'), { code: 'pdf_unavailable' });
    return run(kind, brief, ctx, { onDemand: true });
  }

  async function ensure(brief, { kind, ctx = {}, held = false, background = false } = {}) {
    if (!auto()) return null;
    const reason = reasonNow(brief, kind, held);
    if (reason && reason !== 'completing') return null;
    if (kind === 'full' && reason === 'completing') return null;
    if (background) {
      const q = pdf.queueState ? pdf.queueState() : { waiting: 0 };
      if (q.waiting > 0) { counters.skippedBusy++; return null; }
    }
    try { return await run(kind, brief, ctx, { onDemand: false }); } catch (e) { return null; }
  }

  return {
    keyOf, describe, ensure, serve, TEMPLATE_VERSION, filenameOf,
    dropRef: ref => files.remove(ref),
    prune: opts => files.prune(opts),
    stats: () => ({ ...files.stats(), made: { ...counters.made }, failed: counters.failed, fromStore: counters.fromStore, onDemand: counters.onDemand, skippedBusy: counters.skippedBusy, auto: auto(), available: pdf.available() }),
    store: files,
  };
}

module.exports = { createPdfDocs, TEMPLATE_VERSION, filenameOf, freeView };
