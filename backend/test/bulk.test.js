'use strict';
/**
 * The bulk registers: the streaming CSV reader, Latvia's row rules, the loader's safety (resume, unchanged, short, changed layout,
 * shrunk, no resume support, database failure) and the Latvian connector. No network and no database: both are faked.
 */
const assert = require('assert');
const { CsvStream } = require('../engine/bulk/csv');
const { loadBulk } = require('../engine/bulk/loader');
const LV = require('../engine/bulk/latvia');
const { CONNECTORS } = require('../engine/registry');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const HEADER = 'regcode;sepa;name;name_before_quotes;name_in_quotes;name_after_quotes;without_quotes;regtype;regtype_text;type;type_text;registered;terminated;closed;address;index;addressid;region;city;atvk;reregistration_term';
const line = (code, name, inq, type, typeText, reg, term, addr) => `${code};LV00ZZZ${code};${/[;"]/.test(name) ? '"' + name.replace(/"/g, '""') + '"' : name};;${inq};;0;K;Komercreģistrs;${type};${typeText};${reg};${term};L;${/[;"]/.test(addr) ? '"' + addr.replace(/"/g, '""') + '"' : addr};1011;1;1;0;0;`;
const ROWS = [
  line('40003304295', 'Sabiedrība ar ierobežotu atbildību "MERKS"', 'MERKS', 'SIA', 'Sabiedrība ar ierobežotu atbildību', '1996-08-05', '', 'Rīga, Marijas iela 2A; 3. stāvs'),
  line('40203036587', 'Pilnsabiedrība "Merks-Ostas celtnieks"', 'Merks-Ostas celtnieks', 'PS', 'Pilnsabiedrība', '2012-01-02', '', 'Rīga, Mūkusalas iela 41'),
  line('40103554468', 'Pillar, SIA', 'Pillar', 'SIA', 'Sabiedrība ar ierobežotu atbildību', '2012-03-04', '2020-06-30', 'Rīga, Elizabetes iela 2'),
  line('41202013815', 'IK "KRASTNIEKI A I"', 'KRASTNIEKI A I', 'IK', 'Individuālais komersants', '1998-02-26', '2014-04-10', 'Kolka'),
  line('40008234596', '"House of Glory"', 'House of Glory', 'BDR', 'Biedrība', '2015-03-02', '', 'Rīga'),
  line('4000000000', 'Bad code SIA', 'Bad code', 'SIA', 'x', '2015-03-02', '', 'Rīga'),
];
const FILE = [HEADER, ...ROWS].join('\n') + '\n';

function fakePool(prev = null) {
  const q = { all: [], upserts: [], deletes: [], saved: [] };
  return Object.assign(q, { async query(sql, p) {
    q.all.push(sql);
    if (/^SELECT \* FROM bulk_register_loads/.test(sql)) return { rows: prev ? [prev] : [] };
    if (/^INSERT INTO bulk_register_entities/.test(sql)) { if (q.failUpsert) throw new Error('disk full'); q.upserts.push(p[2]); return { rows: [] }; }
    if (/^DELETE FROM bulk_register_entities/.test(sql)) { q.deletes.push(p); return { rowCount: 7 }; }
    if (/^INSERT INTO bulk_register_loads/.test(sql)) { q.saved.push({ status: p[6], detail: p[7], rows: p[5] }); return { rows: [] }; }
    return { rows: [] };
  } });
}
const enc = new TextEncoder();
// A fake server for one file: honours Range and If-None-Match; `dropAt` cuts the first response short.
function fakeFetch(text, { etag = '"e1"', dropAt = null, noRange = false, dropAlways = false, lastModified = 'Fri, 06 Nov 2026 21:25:11 GMT' } = {}) {
  const bytes = enc.encode(text), calls = [];
  const fn = async (url, { headers = {} }) => {
    calls.push(headers);
    const h = k => ({ etag, 'content-length': String(bytes.length), 'last-modified': lastModified }[k]);
    if (headers['if-none-match'] === etag) return { status: 304, headers: { get: () => null }, body: [] };
    const start = headers.range ? Number(/bytes=(\d+)-/.exec(headers.range)[1]) : 0;
    if (headers.range && noRange) return { status: 200, headers: { get: h }, body: [bytes] };
    const cut = (dropAt != null && (calls.length === 1 || dropAlways)) ? Math.min(bytes.length, start + dropAt) : bytes.length;
    const body = { async *[Symbol.asyncIterator]() {
      for (let i = start; i < cut; i += 7) yield bytes.slice(i, Math.min(i + 7, cut));            // 7-byte pieces: splits multi-byte letters
      if (cut < bytes.length) throw new TypeError('terminated');
    } };
    return { status: headers.range ? 206 : 200, headers: { get: h }, body };
  };
  fn.calls = calls; return fn;
}
const spec = { ...LV.spec, minRows: 2 };

(async () => {
  console.log('\nCSV reader');
  await t('quotes, doubled quotes, the delimiter and line breaks inside quotes, CRLF, pieces of any size', () => {
    const text = 'a;b;c\r\n1;"x;""y""";"multi\nline"\r\n2;;3';
    for (const step of [1, 2, 3, 5, 100]) {
      const s = new CsvStream(); const rows = [];
      for (let i = 0; i < text.length; i += step) rows.push(...s.feed(text.slice(i, i + step)));
      rows.push(...s.end());
      assert.deepStrictEqual(rows, [['a', 'b', 'c'], ['1', 'x;"y"', 'multi\nline'], ['2', '', '3']], 'step ' + step);
    }
  });

  console.log('\nLatvia: which rows are kept');
  await t('companies and organisations are kept; sole traders, individual enterprises and farms are not (they carry a person\'s name)', () => {
    const mk = type => ({ regcode: '40003304295', name: 'X "Y"', name_in_quotes: 'Y', type, type_text: 'T', registered: '2000-01-01', terminated: '', address: 'Rīga' });
    for (const k of ['SIA', 'AS', 'PS', 'KS', 'KB', 'VU', 'PSV', 'FIL', 'AKF']) assert(LV.spec.rowOf(mk(k)), k);
    for (const k of ['IK', 'IND', 'ZEM', 'BDR', '']) assert.strictEqual(LV.spec.rowOf(mk(k)), null, k);
    assert.strictEqual(LV.spec.rowOf({ ...mk('SIA'), regcode: '4000' }), null);
  });
  await t('name keys: accents, punctuation and Latvian legal forms drop out, so "Pillar, SIA", "PILLAR" and "Pillar SIA" meet', () => {
    assert.strictEqual(LV.keyOf('Pillar, SIA'), 'pillar'); assert.strictEqual(LV.keyOf('PILLAR'), 'pillar'); assert.strictEqual(LV.keyOf('Rīgas nami'), 'rigas nami');
    assert.strictEqual(LV.keyOf('Ķekavas Ģimenes SIA'), 'kekavas gimenes');
  });

  console.log('\nLoader');
  await t('a good file: right rows stored, stale rows removed after, status ok, header and quotes handled across 7-byte pieces', async () => {
    const pool = fakePool(), net = fakeFetch(FILE);
    const r = await loadBulk({ spec, pool, fetchFile: net });
    assert.strictEqual(r.status, 'ok'); assert.strictEqual(r.rows, 3);
    assert.deepStrictEqual(pool.upserts.flat().sort(), ['40003304295', '40103554468', '40203036587']);
    assert.strictEqual(pool.deletes.length, 1); assert.strictEqual(pool.saved.at(-1).status, 'ok');
    assert(pool.all.findIndex(s => /^DELETE/.test(s)) > pool.all.findLastIndex(s => /^INSERT INTO bulk_register_entities/.test(s)), 'old rows are removed only after the new ones are in');
  });
  await t('the stored fields are right: key, form, dates, address with its own semicolon', async () => {
    const seen = []; const pool = fakePool(); const q = pool.query.bind(pool);
    pool.query = async (sql, p) => { if (/^INSERT INTO bulk_register_entities/.test(sql)) seen.push(p); return q(sql, p); };
    await loadBulk({ spec, pool, fetchFile: fakeFetch(FILE) });
    const p = seen[0], i = p[2].indexOf('40003304295');
    assert.strictEqual(p[3][i], 'Sabiedrība ar ierobežotu atbildību "MERKS"'); assert.strictEqual(p[4][i], 'merks');
    assert.strictEqual(p[5][i], 'Sabiedrība ar ierobežotu atbildību'); assert.strictEqual(p[6][i], '1996-08-05'); assert.strictEqual(p[7][i], null);
    assert.strictEqual(p[8][i], 'Rīga, Marijas iela 2A; 3. stāvs');
    assert.strictEqual(p[7][p[2].indexOf('40103554468')], '2020-06-30');
  });
  await t('a dropped connection resumes with a Range request guarded by the ETag, and nothing is lost or doubled', async () => {
    const pool = fakePool(), net = fakeFetch(FILE, { dropAt: 300 });
    const r = await loadBulk({ spec, pool, fetchFile: net });
    assert.strictEqual(r.status, 'ok'); assert.strictEqual(r.rows, 3);
    assert.strictEqual(net.calls.length, 2); assert.strictEqual(net.calls[1].range, 'bytes=300-'); assert.strictEqual(net.calls[1]['if-range'], '"e1"');
    assert.deepStrictEqual(pool.upserts.flat().sort(), ['40003304295', '40103554468', '40203036587']);
  });
  await t('nothing changed (304): one request, nothing stored, nothing removed', async () => {
    const pool = fakePool({ status: 'ok', etag: '"e1"', row_count: 3, started_at: '2026-11-06T00:00:00Z' }), net = fakeFetch(FILE);
    const r = await loadBulk({ spec, pool, fetchFile: net });
    assert.strictEqual(r.status, 'unchanged'); assert.strictEqual(net.calls.length, 1); assert.strictEqual(pool.upserts.length, 0); assert.strictEqual(pool.deletes.length, 0);
  });
  await t('--force ignores the ETag', async () => {
    const pool = fakePool({ status: 'ok', etag: '"e1"', row_count: 3, started_at: '2026-11-06T00:00:00Z' });
    assert.strictEqual((await loadBulk({ spec, pool, fetchFile: fakeFetch(FILE), force: true })).status, 'ok');
  });
  await t('a download that keeps breaking fails and removes nothing', async () => {
    const pool = fakePool({ status: 'ok', etag: '"old"', row_count: 3, started_at: '2026-11-06T00:00:00Z' });
    const r = await loadBulk({ spec, pool, fetchFile: fakeFetch(FILE, { dropAt: 100, dropAlways: true }) });
    assert.strictEqual(r.status, 'failed'); assert.strictEqual(pool.deletes.length, 0); assert.strictEqual(pool.saved.at(-1).status, 'failed');
  });
  await t('a server that ignores Range fails cleanly instead of storing a doubled start', async () => {
    const pool = fakePool(), r = await loadBulk({ spec, pool, fetchFile: fakeFetch(FILE, { dropAt: 200, noRange: true }) });
    assert.strictEqual(r.status, 'failed'); assert.strictEqual(r.kind, 'resume'); assert.strictEqual(pool.deletes.length, 0);
  });
  await t('a changed layout (a column gone) fails before storing anything', async () => {
    const pool = fakePool(), r = await loadBulk({ spec, pool, fetchFile: fakeFetch(FILE.replace('regcode;', 'code;')) });
    assert.strictEqual(r.kind, 'layout_changed'); assert.strictEqual(pool.upserts.length, 0); assert.strictEqual(pool.deletes.length, 0);
  });
  await t('a file far smaller than the last one is refused and the old rows stay', async () => {
    const pool = fakePool({ status: 'ok', etag: '"old"', row_count: 100, started_at: '2026-11-06T00:00:00Z' });
    const r = await loadBulk({ spec, pool, fetchFile: fakeFetch(FILE) });
    assert.strictEqual(r.kind, 'shrunk'); assert.strictEqual(pool.deletes.length, 0);
  });
  await t('too few usable rows (an empty or wrong file) is refused', async () => {
    const pool = fakePool(), r = await loadBulk({ spec: { ...spec, minRows: 50000 }, pool, fetchFile: fakeFetch(FILE) });
    assert.strictEqual(r.kind, 'too_small'); assert.strictEqual(pool.deletes.length, 0);
  });
  await t('a database failure while storing is a failure, not a dropped connection: no resume, no silent loss', async () => {
    const pool = fakePool(); pool.failUpsert = true; const net = fakeFetch(FILE);
    const r = await loadBulk({ spec, pool, fetchFile: net });
    assert.strictEqual(r.status, 'failed'); assert.strictEqual(net.calls.length, 1); assert.strictEqual(pool.deletes.length, 0);
  });
  await t('a load already running elsewhere is respected', async () => {
    const pool = fakePool({ status: 'running', started_at: new Date().toISOString(), row_count: 3 }), net = fakeFetch(FILE);
    assert.strictEqual((await loadBulk({ spec, pool, fetchFile: net })).status, 'busy'); assert.strictEqual(net.calls.length, 0);
  });

  console.log('\nLatvian connector');
  const lv = CONNECTORS.lv;
  const TABLE = [
    { reg_id: '40003304295', name: 'Sabiedrība ar ierobežotu atbildību "MERKS"', name_key: 'merks', legal_form: 'Sabiedrība ar ierobežotu atbildību', registered: '1996-08-05', terminated: null, address: 'Rīga, Marijas iela 2A' },
    { reg_id: '40203036587', name: 'Pilnsabiedrība "Merks-Ostas celtnieks"', name_key: 'merks ostas celtnieks', legal_form: 'Pilnsabiedrība', registered: '2012-01-02', terminated: null, address: 'Rīga' },
    { reg_id: '40103554468', name: 'Pillar, SIA', name_key: 'pillar', legal_form: 'Sabiedrība ar ierobežotu atbildību', registered: '2012-03-04', terminated: '2020-06-30', address: 'Rīga' },
  ];
  const bulk = (loaded = true) => ({
    bulkStatus: async () => loaded ? { status: 'ok', row_count: 3, finished_at: '2026-11-07T03:00:00Z', last_modified: 'Fri, 06 Nov 2026 21:25:11 GMT' } : null,
    bulkFind: async (c, prefix) => TABLE.filter(r => r.name_key.startsWith(prefix)),
    bulkGet: async (c, id) => TABLE.find(r => r.reg_id === id) || null,
  });
  await t('without a store, or before the first load, the check is "not configured", never "no match"', async () => {
    assert(/not available/.test((await lv.lookup('Merks', { env: {} })).skipped));
    assert(/not been loaded/.test((await lv.lookup('Merks', { env: {}, bulk: bulk(false) })).skipped));
  });
  await t('found by name: the right company, with its facts and a dated statement', async () => {
    const r = await lv.lookup('Merks SIA', { env: {}, bulk: bulk() });
    assert.strictEqual(r.match.id, '40003304295');
    assert(/registration number 40003304295/.test(r.findings[0].claim) && /limited liability company \(SIA\), registered 5 August 1996/.test(r.findings[0].claim) && /Marijas iela 2A/.test(r.findings[0].claim), r.findings[0].claim);
    assert(/of 6 November 2026 records no termination date/.test(r.findings[1].claim), r.findings[1].claim);
    assert(r.findings.every(f => f.urls[0] === 'https://data.gov.lv/dati/dataset/uz' && f.lane === 'registry'));
  });
  await t('THE NAME-ALIKE TRAP: "Merks" is the SIA, not "Merks-Ostas celtnieks"; "Merks Ostas" is the partnership', async () => {
    assert.strictEqual((await lv.lookup('Merks', { env: {}, bulk: bulk() })).match.id, '40003304295');
    assert.strictEqual((await lv.lookup('Merks Ostas celtnieks', { env: {}, bulk: bulk() })).match.id, '40203036587');
  });
  await t('a terminated company is reported as terminated, with the date', async () => {
    const r = await lv.lookup('Pillar', { env: {}, bulk: bulk() });
    assert(/terminated on 30 June 2020/.test(r.findings[1].claim), r.findings[1].claim);
  });
  await t('found by registration number alone, even with a different name; an unknown company is simply no match', async () => {
    assert.strictEqual((await lv.lookup('', { env: {}, bulk: bulk(), ids: ['LV 40003304295'] })).match.id, '40003304295');
    const none = await lv.lookup('Nonexistent Builders', { env: {}, bulk: bulk() });
    assert.strictEqual(none.match, null); assert.deepStrictEqual(none.findings, []);
    assert.strictEqual((await lv.lookup('X', { env: {}, bulk: bulk() })).match, null);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
