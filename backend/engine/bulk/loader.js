'use strict';
/**
 * The bulk register loader: one open-data file per country, downloaded politely and loaded into bulk_register_entities.
 *
 * - One request when nothing changed (If-None-Match gets a 304). A dropped connection resumes with a Range request, checked
 *   against the file's ETag, instead of starting again: the Latvian file is 129 MB and its server closes long downloads.
 * - Nothing existing is touched until the whole file has arrived, byte for byte, and its header has the columns we expect.
 *   A short, changed-layout or suspiciously small file fails and leaves yesterday's rows in place.
 * - Rows the new file no longer has are removed only after a good load.
 * A country is described by a spec: { country, url, hosts, columns, minRows, rowOf(record) }.
 */
const { CsvStream } = require('./csv');

const BATCH = 2000;
const MAX_ATTEMPTS = 6;
const STALE_RUNNING_MS = 3 * 3600 * 1000;
let running = false;

class LoadError extends Error { constructor(kind, message) { super(message); this.kind = kind; } }

async function upsert(pool, country, rows, startedAt) {
  if (!rows.length) return;
  const col = k => rows.map(r => r[k]);
  await pool.query(
    `INSERT INTO bulk_register_entities (country, reg_id, name, name_key, legal_form, registered, terminated, address, loaded_at)
     SELECT $1, u.reg_id, u.name, u.name_key, u.legal_form, u.registered, u.terminated, u.address, $2
       FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::date[], $8::date[], $9::text[])
         AS u(reg_id, name, name_key, legal_form, registered, terminated, address)
     ON CONFLICT (country, reg_id) DO UPDATE SET name = EXCLUDED.name, name_key = EXCLUDED.name_key, legal_form = EXCLUDED.legal_form,
       registered = EXCLUDED.registered, terminated = EXCLUDED.terminated, address = EXCLUDED.address, loaded_at = EXCLUDED.loaded_at`,
    [country, startedAt, col('reg_id'), col('name'), col('name_key'), col('legal_form'), col('registered'), col('terminated'), col('address')]);
}

async function loadBulk({ spec, pool, fetchFile, now = () => new Date(), log = () => {}, force = false }) {
  const { country } = spec;
  if (running) return { status: 'busy', detail: 'a load is already running in this process' };
  const prev = ((await pool.query(`SELECT * FROM bulk_register_loads WHERE country = $1`, [country])).rows || [])[0] || null;
  if (prev && prev.status === 'running' && now() - new Date(prev.started_at) < STALE_RUNNING_MS) return { status: 'busy', detail: 'another instance started a load recently' };
  running = true;
  const startedAt = now().toISOString();
  const save = (status, extra = {}) => pool.query(
    `INSERT INTO bulk_register_loads (country, source_url, etag, last_modified, bytes, row_count, status, detail, started_at, finished_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (country) DO UPDATE SET source_url = EXCLUDED.source_url, etag = EXCLUDED.etag, last_modified = EXCLUDED.last_modified, bytes = EXCLUDED.bytes,
       row_count = EXCLUDED.row_count, status = EXCLUDED.status, detail = EXCLUDED.detail, started_at = EXCLUDED.started_at, finished_at = EXCLUDED.finished_at`,
    [country, spec.url, extra.etag ?? (prev && prev.etag) ?? null, extra.lastModified ?? (prev && prev.last_modified) ?? null, extra.bytes ?? (prev && prev.bytes) ?? null,
     extra.rows ?? (prev && prev.row_count) ?? null, status, extra.detail || null, startedAt, status === 'running' ? null : now().toISOString()]);
  try {
    await save('running', { detail: 'started' });
    const csv = new CsvStream({ delimiter: spec.delimiter || ';' });
    const dec = new TextDecoder('utf-8');
    let header = null, index = null, batch = new Map(), kept = 0, seen = 0;
    const flush = async () => { await upsert(pool, country, [...batch.values()], startedAt); kept += batch.size; batch = new Map(); };
    const takeRows = async rows => {
      for (const r of rows) {
        if (!header) {
          header = r.map(x => x.replace(/^﻿/, '').trim());
          const missing = spec.columns.filter(c => !header.includes(c));
          if (missing.length) throw new LoadError('layout_changed', `the file no longer has the columns ${missing.join(', ')}`);
          index = Object.fromEntries(header.map((h, i) => [h, i]));
          continue;
        }
        seen++;
        const rec = Object.fromEntries(spec.columns.map(c => [c, r[index[c]] === undefined ? '' : r[index[c]]]));
        const e = spec.rowOf(rec);
        if (e) { batch.set(e.reg_id, e); if (batch.size >= BATCH) await flush(); }
      }
    };

    let received = 0, total = null, etag = null, lastModified = null, unchanged = false;
    for (let attempt = 1; ; attempt++) {
      const headers = received ? { range: `bytes=${received}-`, ...(etag ? { 'if-range': etag } : {}) }
        : (!force && prev && prev.status === 'ok' && prev.etag ? { 'if-none-match': prev.etag } : {});
      let res;
      try { res = await fetchFile(spec.url, { headers }); }
      catch (e) { if (attempt >= MAX_ATTEMPTS) throw new LoadError('network', `could not reach the source: ${e.message}`); continue; }
      if (res.status === 304 && !received) { unchanged = true; break; }
      if (!received && res.status !== 200) throw new LoadError('http', `the source answered ${res.status}`);
      if (received && res.status !== 206) throw new LoadError('resume', `the source did not resume the download (${res.status}); starting again tomorrow`);
      if (!received) { total = Number(res.headers.get('content-length')) || null; etag = res.headers.get('etag'); lastModified = res.headers.get('last-modified'); }
      // Only a failure to READ the body is a dropped connection that can be resumed; a failure while storing rows is not.
      const it = res.body[Symbol.asyncIterator]();
      let dropped = null;
      for (;;) {
        let step;
        try { step = await it.next(); } catch (e) { dropped = e; break; }
        if (step.done) break;
        received += step.value.length;
        await takeRows(csv.feed(dec.decode(step.value, { stream: true })));
      }
      if (dropped) {
        if (attempt >= MAX_ATTEMPTS) throw new LoadError('network', `the download kept breaking after ${received} bytes: ${dropped.message}`);
        log(`[bulk ${country}] connection dropped at ${received} bytes, resuming`);
        continue;
      }
      if (total == null || received >= total) break;
      if (attempt >= MAX_ATTEMPTS) throw new LoadError('short', `the download stopped at ${received} of ${total} bytes`);
    }
    if (unchanged) { await save('ok', { detail: 'unchanged since the last load' }); return { status: 'unchanged' }; }
    if (total != null && received !== total) throw new LoadError('short', `received ${received} of ${total} bytes`);
    await takeRows(csv.feed(dec.decode()).concat(csv.end()));
    await flush();
    if (kept < (spec.minRows || 1)) throw new LoadError('too_small', `only ${kept} usable rows (expected at least ${spec.minRows})`);
    if (prev && prev.status === 'ok' && prev.row_count && kept < prev.row_count * 0.5) throw new LoadError('shrunk', `${kept} rows against ${prev.row_count} last time: not replacing the old data`);
    const del = await pool.query(`DELETE FROM bulk_register_entities WHERE country = $1 AND loaded_at < $2`, [country, startedAt]);
    await save('ok', { etag, lastModified, bytes: received, rows: kept, detail: `${kept} rows, ${del.rowCount || 0} removed` });
    return { status: 'ok', rows: kept, seen, removed: del.rowCount || 0, bytes: received };
  } catch (e) {
    const kind = e instanceof LoadError ? e.kind : 'error';
    try { await save('failed', { detail: `${kind}: ${e.message}`.slice(0, 300) }); } catch { /* nothing more to do */ }
    return { status: 'failed', kind, detail: e.message };
  } finally { running = false; }
}

module.exports = { loadBulk, LoadError };
