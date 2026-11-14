'use strict';
const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.PDF_CONCURRENCY = '1';
const PDF = require('../engine/pdf');
const { createPdfDocs } = require('../engine/pdfDocs');
const { createPdfStore } = require('../engine/pdfStore');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const REF = 'SK-0123456789AB';
const q = (n, extra = {}) => ({ id: 'Q' + n, question: `Question number ${n} about the record?`, why: `Why ${n} matters`, to: 'sales team', when: 'before booking', good: `Good ${n}`, notAccepted: `Not ${n}`, sources: [{ url: 'https://maharera.example.gov.in/p/' + n, status: 'verified' }], ...extra });

function dossier(over = {}) {
  return {
    ref: REF, query: 'Marigold Heights', location: 'Wakad, Pune', market: 'India', asOf: '2026-11-14', phase: 'preview',
    project: { name: 'Marigold Heights', ids: ['P52100099999'] },
    counts: { facts: 11, sources: 7, conflicts: 2, inferences: 3, questions: 5, confirmed: 4, reported: 2, single: 3, developer: 2 },
    promises: [{ label: 'When you get it', promise: 'Marketed: December 2026', record: 'Filed with the regulator: 30 June 2027', note: '6 months later than the marketed date.' }],
    questions: [q(1), q(2), q(3), q(4, { question: 'SENTINEL_QUESTION_FOUR?', why: 'SENTINEL_WHY_FOUR', good: 'SENTINEL_GOOD_FOUR', sources: [{ url: 'https://sentinel-q4.example/x', status: 'reported' }] }),
      q(5, { question: 'SENTINEL_QUESTION_FIVE?', to: 'your own lawyer' })],
    sections: [{ title: 'SENTINEL_SECTION', facts: [{ id: 'F1', claim: 'SENTINEL_FINDING', status: 'verified', sources: [{ url: 'https://sentinel-finding.example/f', status: 'verified' }] }] }],
    sources: [{ url: 'https://sentinel-source.example/s', title: 'SENTINEL_SOURCE_TITLE', status: 'reported' }],
    inferences: [{ id: 'I1', kind: 'inference', text: 'SENTINEL_INFERENCE', steps: [{ text: 'SENTINEL_STEP', sources: [] }], sources: [] }],
    conflicts: [{ field: 'SENTINEL_CONFLICT', label: 'SENTINEL_CONFLICT', versions: [{ value: 'SENTINEL_V1', sources: [] }] }],
    checks: { area: { text: 'SENTINEL_AREA' }, gaps: [], prices: [] },
    unreachable: [{ what: 'SENTINEL_UNREACHED', why: 'x', how_to_get_it: 'y' }],
    glance: [{ label: 'SENTINEL_GLANCE', values: ['SENTINEL_GLANCE_VALUE'] }],
    notice: 'Research, not advice.',
    ...over,
  };
}
const PAID = ['SENTINEL_QUESTION_FOUR', 'SENTINEL_QUESTION_FIVE', 'SENTINEL_WHY_FOUR', 'SENTINEL_GOOD_FOUR', 'sentinel-q4.example', 'SENTINEL_SECTION', 'SENTINEL_FINDING', 'sentinel-finding.example',
  'sentinel-source.example', 'SENTINEL_SOURCE_TITLE', 'SENTINEL_INFERENCE', 'SENTINEL_STEP', 'SENTINEL_CONFLICT', 'SENTINEL_V1', 'SENTINEL_AREA', 'SENTINEL_UNREACHED', 'SENTINEL_GLANCE', 'SENTINEL_GLANCE_VALUE'];


const pagesOf = buf => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
const hasPdftotext = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const textOf = buf => { const f = path.join(os.tmpdir(), 'skpdf-real-' + process.pid + '.pdf'); fs.writeFileSync(f, buf); try { return execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }); } finally { fs.unlinkSync(f); } };

(async () => {
  if (!PDF.available()) { console.log('  skip PDF printing is not installed here'); console.log('\n0 passed, 0 failed'); process.exit(0); }
  try { await PDF.renderPdf('<p>probe</p>'); } catch (e) {
    if (e.code === 'pdf_unavailable') { console.log('  skip the package is installed but its browser is not (' + e.message + ')'); console.log('\n0 passed, 0 failed'); process.exit(0); }
    throw e;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skpdf-real-'));
  const docs = createPdfDocs({ pdf: PDF, store: createPdfStore({ dir }), env: {}, log: { warn: () => {} } });
  const brief = (over = {}) => ({ ref: REF, kind: 'dossier', project: { name: 'Marigold Heights' }, dossier: dossier({ phase: 'complete', ...over }) });
  const ctx = { link: 'https://shelterkart.example/r/' + REF };

  console.log('real printing');
  let preview, full;
  await t('the free preview prints as a real PDF of at most three pages and is stored on disk', async () => {
    preview = await docs.serve(brief(), { kind: 'preview', ctx });
    const buf = fs.readFileSync(preview.path);
    assert.strictEqual(buf.slice(0, 5).toString(), '%PDF-'); assert(buf.length > 4000 && buf.length < 600000, 'size ' + buf.length);
    assert(pagesOf(buf) >= 1 && pagesOf(buf) <= 3, 'pages ' + pagesOf(buf));
    assert(/\.pdf$/.test(preview.path) && preview.path.startsWith(dir));
  });
  await t('the full report prints as a real PDF of more pages than the preview', async () => {
    full = await docs.serve(brief(), { kind: 'full' });
    const buf = fs.readFileSync(full.path);
    assert.strictEqual(buf.slice(0, 5).toString(), '%PDF-'); assert(pagesOf(buf) > pagesOf(fs.readFileSync(preview.path)), 'full ' + pagesOf(buf) + ' preview ' + pagesOf(fs.readFileSync(preview.path)));
  });
  await t('the second request for each is the stored file, not a new print', async () => {
    const a = await docs.serve(brief(), { kind: 'preview', ctx }), b = await docs.serve(brief(), { kind: 'full' });
    assert.strictEqual(a.from, 'store'); assert.strictEqual(b.from, 'store');
  });
  if (hasPdftotext) {
    await t('the text of the free PDF holds the free content and none of the paid content; the full PDF holds the paid content', () => {
      const free = textOf(fs.readFileSync(preview.path)), paid = textOf(fs.readFileSync(full.path));
      assert(/Marigold Heights/.test(free) && /Free preview/.test(free) && /Question number 1/.test(free));
      for (const s of PAID) assert(!free.includes(s), 'paid text in the free PDF: ' + s);
      assert(/SENTINEL_FINDING/.test(paid) && /SENTINEL_QUESTION_FOUR/.test(paid));
    });
  } else console.log('  skip no pdftotext here: the text of the printed PDF is not read back (the page HTML is checked in pdfdocs.test.js)');
  await t('a hostile title or finding does not run anything in the printer and the PDF still prints', async () => {
    const http = require('http'); const hits = []; const srv = http.createServer((req, res) => { hits.push(req.url); res.end('x'); });
    await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
    const evil = brief({ project: { name: `<img src="${base}/leak"><script>fetch("${base}/leak2")</script>`, ids: [] }, ref: 'SK-ABCDEF012345' });
    const out = await docs.serve(evil, { kind: 'preview', ctx }); const out2 = await docs.serve(evil, { kind: 'full' });
    await new Promise(r => setTimeout(r, 200)); srv.close();
    assert(out.bytes > 1000 && out2.bytes > 1000); assert.deepStrictEqual(hits, []);
  });
  await PDF.closeBrowser();
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
