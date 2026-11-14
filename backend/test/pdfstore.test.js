'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPdfStore, createMemoryPdfStore, defaultDir } = require('../engine/pdfStore');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const REF = 'SK-0123456789AB', REF2 = 'SK-BA9876543210', K1 = 'a'.repeat(16), K2 = 'b'.repeat(16);
const pdf = s => Buffer.from('%PDF-1.4 ' + s);

(async () => {
  for (const [label, make] of [
    ['directory store', () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skpdf-')); const clock = { t: Date.now() }; return { store: createPdfStore({ dir, now: () => clock.t }), dir, clock }; }],
    ['memory store', () => { const clock = { t: Date.now() }; return { store: createMemoryPdfStore({ now: () => clock.t }), dir: null, clock }; }],
  ]) {
    console.log(label);
    await t('a stored file is read back with its key, size and time', () => {
      const { store } = make(); assert.strictEqual(store.get(REF, 'preview'), null);
      const put = store.put(REF, 'preview', K1, pdf('one')); const got = store.get(REF, 'preview');
      assert.strictEqual(got.key, K1); assert.strictEqual(got.bytes, pdf('one').length); assert(got.madeAt > 0); assert.strictEqual(put.key, K1);
    });
    await t('the two kinds are kept apart, and a new key replaces the old file of that kind only', () => {
      const { store, dir } = make();
      store.put(REF, 'preview', K1, pdf('p1')); store.put(REF, 'full', K1, pdf('f1')); store.put(REF, 'preview', K2, pdf('p2'));
      assert.strictEqual(store.get(REF, 'preview').key, K2); assert.strictEqual(store.get(REF, 'full').key, K1);
      assert.strictEqual(store.list().length, 2);
      if (dir) assert.deepStrictEqual(fs.readdirSync(path.join(dir, REF)).sort(), [`full-${K1}.pdf`, `preview-${K2}.pdf`]);
    });
    await t('remove takes one kind or every file of a report, and leaves other reports alone', () => {
      const { store } = make();
      store.put(REF, 'preview', K1, pdf('a')); store.put(REF, 'full', K1, pdf('b')); store.put(REF2, 'full', K1, pdf('c'));
      assert.strictEqual(store.remove(REF, 'preview'), 1); assert.strictEqual(store.get(REF, 'preview'), null); assert(store.get(REF, 'full'));
      assert.strictEqual(store.remove(REF), 1); assert.strictEqual(store.get(REF, 'full'), null); assert(store.get(REF2, 'full'));
      assert.strictEqual(store.remove(REF), 0);
    });
    await t('a bad reference, kind or key is refused before any path is built', () => {
      const { store, dir } = make();
      for (const ref of ['../etc', 'SK-123', 'sk-0123456789ab', REF + '/..', '', null, undefined, 'SK-0123456789AB\u0000']) {
        assert.strictEqual(store.get(ref, 'full'), null); assert.strictEqual(store.remove(ref), 0);
        assert.throws(() => store.put(ref, 'full', K1, pdf('x')));
      }
      assert.throws(() => store.put(REF, '../full', K1, pdf('x'))); assert.throws(() => store.put(REF, 'full', '../../x', pdf('x')));
      assert.throws(() => store.put(REF, 'full', K1, Buffer.alloc(0))); assert.throws(() => store.put(REF, 'full', K1, 'not a buffer'));
      assert.strictEqual(store.get(REF, 'secret'), null);
      if (dir) assert.deepStrictEqual(fs.readdirSync(dir), []);
    });
    await t('prune removes old previews and files of reports that are gone, and keeps current ones', () => {
      const { store, clock } = make();
      store.put(REF, 'preview', K1, pdf('old')); store.put(REF, 'full', K1, pdf('full')); store.put(REF2, 'full', K1, pdf('orphan'));
      const day = 86400000;
      assert.strictEqual(store.prune({ previewMs: 7 * day, keep: () => true, at: clock.t + 3 * day }), 0);
      assert.strictEqual(store.prune({ previewMs: 7 * day, keep: ref => ref === REF, at: clock.t + 3 * day }), 1);
      assert(store.get(REF, 'preview') && store.get(REF, 'full')); assert.strictEqual(store.get(REF2, 'full'), null);
      assert.strictEqual(store.prune({ previewMs: 7 * day, keep: () => true, at: clock.t + 8 * day }), 1);
      assert.strictEqual(store.get(REF, 'preview'), null); assert(store.get(REF, 'full'));
    });
    await t('a failing keep() never deletes anything', () => {
      const { store, clock } = make(); store.put(REF, 'full', K1, pdf('x'));
      assert.strictEqual(store.prune({ keep: () => { throw new Error('db down'); }, at: clock.t }), 0); assert(store.get(REF, 'full'));
    });
    await t('stats count files and bytes per kind', () => {
      const { store } = make(); store.put(REF, 'preview', K1, pdf('12345')); store.put(REF, 'full', K1, pdf('1234567890'));
      const s = store.stats(); assert.strictEqual(s.files, 2); assert.strictEqual(s.byKind.preview.files, 1); assert.strictEqual(s.byKind.full.bytes, pdf('1234567890').length);
    });
  }

  console.log('the directory store on disk');
  await t('a write is atomic: no temporary file is left, and the file is private', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skpdf-')); const store = createPdfStore({ dir });
    store.put(REF, 'full', K1, pdf('x'));
    assert(fs.readdirSync(path.join(dir, REF)).every(n => !n.endsWith('.tmp')));
    assert.strictEqual(fs.statSync(path.join(dir, REF, `full-${K1}.pdf`)).mode & 0o077, 0);
    assert.strictEqual(fs.statSync(path.join(dir, REF)).mode & 0o077, 0);
  });
  await t('files that do not belong (other names, other directories) are ignored by list, prune and stats', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skpdf-')); const store = createPdfStore({ dir });
    fs.mkdirSync(path.join(dir, 'not-a-ref')); fs.writeFileSync(path.join(dir, 'not-a-ref', 'preview-' + K1 + '.pdf'), 'x');
    fs.mkdirSync(path.join(dir, REF)); fs.writeFileSync(path.join(dir, REF, 'notes.txt'), 'x');
    assert.deepStrictEqual(store.list(), []); assert.strictEqual(store.prune({ keep: () => false }), 0);
    assert(fs.existsSync(path.join(dir, 'not-a-ref', 'preview-' + K1 + '.pdf')) && fs.existsSync(path.join(dir, REF, 'notes.txt')));
  });
  await t('the default directory follows PDF_DIR, then LIVE_JOBS_DIR, then the temporary directory', () => {
    assert.strictEqual(defaultDir({ PDF_DIR: '/a/b' }), '/a/b');
    assert.strictEqual(defaultDir({ LIVE_JOBS_DIR: '/jobs' }), path.join('/jobs', 'pdfs'));
    assert.strictEqual(defaultDir({}), path.join(os.tmpdir(), 'shelterkart-pdfs'));
  });
  await t('a store without a directory is refused', () => { assert.throws(() => createPdfStore({})); });

  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
