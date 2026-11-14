'use strict';
const assert = require('assert');
const { renderPreviewPdf, renderDossier } = require('../engine/dossierHtml');
const { createPdfDocs, freeView, filenameOf } = require('../engine/pdfDocs');
const { createMemoryPdfStore } = require('../engine/pdfStore');
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

(async () => {
  console.log('the file names');
  await t('a file is named for the developer (the paid one), a date and a short code, so two reports never look alike; the free one says preview', () => {
    const full = { ref: REF, dossier: dossier({ project: { name: 'Marigold Heights', developer: 'Hubtown Limited', ids: [] } }) };
    assert.strictEqual(filenameOf(full, 'full'), 'Hubtown-Limited_2026-11-14_012345.pdf');
    assert.strictEqual(filenameOf(full, 'preview'), 'Marigold-Heights_preview_2026-11-14_012345.pdf');
    assert.strictEqual(filenameOf({ ref: REF, project: { name: 'Marigold Heights', developer: 'Hubtown Limited' }, dossier: dossier() }, 'full'), 'Hubtown-Limited_2026-11-14_012345.pdf');
    const other = { ref: 'SK-ABCDEF012345', dossier: full.dossier };
    assert.notStrictEqual(filenameOf(full, 'full'), filenameOf(other, 'full'));
  });
  await t('the free file never carries a name the free view does not show: the developer appears only in the paid file name', () => {
    const b = { ref: REF, dossier: dossier({ project: { name: 'Marigold Heights', developer: 'SENTINEL_DEVELOPER', ids: [] } }) };
    assert(!filenameOf(b, 'preview').includes('SENTINEL')); assert(filenameOf(b, 'full').startsWith('SENTINEL-DEVELOPER_'));
  });
  await t('a name is made safe and short: no path or header characters, at most 40 characters of name, a fallback when there is nothing', () => {
    const wild = { ref: REF, dossier: dossier({ query: 'x', project: { name: 'n', developer: '../../etc/passwd "; \r\nX: y ' + 'A'.repeat(200), ids: [] } }) };
    const n = filenameOf(wild, 'full'); assert(/^[A-Za-z0-9._-]+\.pdf$/.test(n), n); assert(n.length < 80, n); assert(!n.includes('..'));
    assert(/^Report_/.test(filenameOf({ ref: REF, dossier: { asOf: '2026-11-14' } }, 'full')));
    assert.strictEqual(filenameOf({ dossier: {} }, 'full'), 'Report.pdf');
  });

  console.log('the free preview PDF page');
  const price = { display: 'GBP 36', line: 'Set by the property value.' };
  const html = renderPreviewPdf(dossier(), { price, link: 'https://shelterkart.example/r/' + REF });
  await t('it carries the project, the counts, the promise-versus-record cards, exactly three questions in full, the price and the unlock link', () => {
    assert(/Marigold Heights/.test(html) && /P52100099999/.test(html) && /14 November 2026/.test(html));
    assert(/We found 11 things from 7 sources and 2 places where sources disagree/.test(html));
    assert(/Where the marketing and the record part ways/.test(html) && /Filed with the regulator: 30 June 2027/.test(html));
    assert.strictEqual((html.match(/class="q" id="Q\d+"/g) || []).length, 3);
    assert(/GBP 36/.test(html) && /https:\/\/shelterkart\.example\/r\/SK-0123456789AB/.test(html) && /Free preview/.test(html));
    assert(/2 more questions are in the full report/.test(html) && /1 for the sales team|1 for your own lawyer/.test(html));
  });
  await t('nothing from the paid report appears in it, whatever the dossier holds', () => {
    for (const s of PAID) assert(!html.includes(s), 'paid text leaked: ' + s);
    assert(!/Where sources disagree|What we found|Every question, by stage|Your question tracker|What the facts add up to|The numbers, checked/.test(html));
  });
  await t('the full report, from the same dossier, does hold that text (the sentinels are real)', () => {
    const full = renderDossier(dossier());
    for (const s of ['SENTINEL_QUESTION_FOUR', 'SENTINEL_FINDING', 'SENTINEL_INFERENCE', 'sentinel-source.example']) assert(full.includes(s), 'missing from the full report: ' + s);
  });
  await t('it never reads the paid fields: a dossier without them prints the same page', () => {
    const bare = dossier({ sections: undefined, sources: undefined, inferences: undefined, conflicts: undefined, checks: undefined, unreachable: undefined, glance: undefined });
    assert.strictEqual(renderPreviewPdf(bare, { price, link: 'https://shelterkart.example/r/' + REF }), html);
  });
  await t('hostile text is escaped', () => {
    const evil = dossier({ project: { name: '<script>alert(1)</script>', ids: ['"><img src=x onerror=alert(1)>'] }, location: '</style><b>x</b>',
      questions: [q(1, { question: '<img src=x onerror=alert(2)>' }), q(2), q(3)], promises: [{ label: '<i>l</i>', promise: '<script>p</script>', record: '"r"' }] });
    const out = renderPreviewPdf(evil, { price: { display: '<b>1</b>', line: '<u>x</u>' }, link: 'javascript:alert(1)"<' });
    assert(!/<script>alert|<img src=x|<b>x<\/b>|<i>l<\/i>|<b>1<\/b>|<u>x<\/u>/.test(out));
    assert(!/href="javascript:/.test(out));
  });
  await t('a thin dossier still prints: no cards, no questions, no price, no link', () => {
    const out = renderPreviewPdf(dossier({ promises: [], questions: [], counts: {} }), {});
    assert(/Marigold Heights/.test(out) && /Unlock the full report/.test(out) && !/Three questions to start with/.test(out) && !/more questions are in the full report/.test(out));
    assert(/\/r\/SK-0123456789AB/.test(out));
  });
  await t('three or fewer questions: no lock box about more questions', () => {
    const out = renderPreviewPdf(dossier({ questions: [q(1), q(2)] }), {});
    assert.strictEqual((out.match(/class="q" id="Q\d+"/g) || []).length, 2); assert(!/more questions are in the full report/.test(out));
  });

  console.log('the service: making, keeping and serving');
  function rig(over = {}) {
    const calls = [], state = { waiting: 0, available: true, fail: false, delay: 0 };
    const printer = {
      available: () => state.available,
      queueState: () => ({ active: 0, waiting: state.waiting, limit: 2 }),
      renderPdf: async (html, { footer } = {}) => { calls.push({ html, footer }); if (state.delay) await new Promise(r => setTimeout(r, state.delay)); if (state.fail) throw new Error('chromium died'); return Buffer.from('%PDF-1.4 ' + calls.length + ' ' + html.length); },
    };
    const store = over.store || createMemoryPdfStore();
    const docs = createPdfDocs({ pdf: printer, store, env: over.env || {}, log: { warn: () => {} } });
    const brief = (extra = {}, dossierOver = {}) => ({ ref: REF, kind: 'dossier', project: { name: 'Marigold Heights' }, dossier: dossier(dossierOver), ...extra });
    return { calls, state, store, docs, brief };
  }
  const CTX = { price: { display: 'GBP 36', line: 'x' }, link: 'https://shelterkart.example/r/' + REF };

  await t('the key follows the content: a changed question, price or link changes it; the paid report changes only the full key', () => {
    const { docs } = rig();
    const a = dossier(), k = (kind, d, ctx = CTX) => docs.keyOf(kind, d, ctx);
    assert.strictEqual(k('preview', a), k('preview', dossier()));
    assert.notStrictEqual(k('preview', a), k('preview', dossier({ questions: [q(1, { question: 'changed?' }), q(2), q(3)] })));
    assert.notStrictEqual(k('preview', a), k('preview', a, { ...CTX, price: { display: 'GBP 40', line: 'x' } }));
    assert.notStrictEqual(k('preview', a), k('preview', a, { ...CTX, link: 'https://other.example/r/' + REF }));
    const paidChange = dossier({ sections: [{ title: 'Other', facts: [] }], sources: [], inferences: [], phase: 'complete' });
    assert.strictEqual(k('preview', a), k('preview', paidChange));
    assert.notStrictEqual(k('full', a), k('full', paidChange));
    assert.notStrictEqual(k('full', a), k('preview', a));
    assert(/^[a-f0-9]{16}$/.test(k('full', a)));
    assert.strictEqual(k('full', a), k('full', a, {})); assert.strictEqual(k('full', a), k('full', a, { link: 'https://elsewhere.example/r/' + REF }));
  });
  await t('the free view is a whitelist: nothing else of the dossier goes into the preview page or its key', () => {
    const d = dossier({ secretField: 'SENTINEL_EXTRA', entities: [{ name: 'SENTINEL_ENTITY' }] });
    const v = freeView(d);
    assert.deepStrictEqual(Object.keys(v).sort(), ['asOf', 'counts', 'location', 'market', 'project', 'promises', 'query', 'questions', 'ref']);
    assert.deepStrictEqual(Object.keys(v.project).sort(), ['ids', 'name']);
    assert.strictEqual(v.questions.length, 5); assert(v.questions[0].why && v.questions[2].good); assert.deepStrictEqual(Object.keys(v.questions[3]).sort(), ['id', 'to', 'when']);
    assert(!JSON.stringify(v).includes('SENTINEL_'.concat('FINDING')) && !JSON.stringify(v).includes('SENTINEL_EXTRA') && !JSON.stringify(v).includes('SENTINEL_QUESTION_FOUR'));
  });
  await t('a preview is printed once and then served from storage', async () => {
    const { docs, calls, brief } = rig();
    const first = await docs.serve(brief(), { kind: 'preview', ctx: CTX }), second = await docs.serve(brief(), { kind: 'preview', ctx: CTX });
    assert.strictEqual(calls.length, 1); assert.strictEqual(first.from, 'print'); assert.strictEqual(second.from, 'store'); assert(first.stored && second.stored);
    assert(/^ShelterKart free preview: Marigold Heights\. SK-0123456789AB\./.test(calls[0].footer));
    assert(!calls[0].html.includes('SENTINEL_FINDING'));
  });
  await t('ten requests at once cause one print', async () => {
    const { docs, calls, state, brief } = rig(); state.delay = 20;
    const rs = await Promise.all(Array.from({ length: 10 }, () => docs.serve(brief(), { kind: 'preview', ctx: CTX })));
    assert.strictEqual(calls.length, 1); assert(rs.every(r => r.key === rs[0].key));
  });
  await t('a changed report is printed again and the old file is replaced', async () => {
    const { docs, calls, store, brief } = rig();
    await docs.serve(brief(), { kind: 'preview', ctx: CTX });
    const r = await docs.serve(brief({}, { questions: [q(1, { question: 'a new first question?' }), q(2), q(3)] }), { kind: 'preview', ctx: CTX });
    assert.strictEqual(calls.length, 2); assert.strictEqual(store.list().length, 1); assert.strictEqual(store.get(REF, 'preview').key, r.key);
  });
  await t('the full PDF is stored only once the report is complete; before that it prints on demand every time', async () => {
    const { docs, calls, store, brief } = rig();
    const a = await docs.serve(brief({}, { phase: 'completing' }), { kind: 'full' }), b = await docs.serve(brief({}, { phase: 'completing' }), { kind: 'full' });
    assert.strictEqual(calls.length, 2); assert(!a.stored && !b.stored); assert.strictEqual(store.get(REF, 'full'), null);
    assert(/^ShelterKart report: Marigold Heights/.test(calls[0].footer));
    const c = await docs.serve(brief({}, { phase: 'complete' }), { kind: 'full' }), d2 = await docs.serve(brief({}, { phase: 'complete' }), { kind: 'full' });
    assert.strictEqual(calls.length, 3); assert(c.stored && d2.from === 'store'); assert(store.get(REF, 'full'));
    assert(calls[2].html.includes('SENTINEL_FINDING'));
  });
  await t('ensure in the background makes the PDF, never throws, and yields when the printer has a queue', async () => {
    const { docs, calls, state, store, brief } = rig();
    state.waiting = 1; assert.strictEqual(await docs.ensure(brief(), { kind: 'preview', ctx: CTX, background: true }), null); assert.strictEqual(calls.length, 0); assert.strictEqual(docs.stats().skippedBusy, 1);
    state.waiting = 0; const made = await docs.ensure(brief(), { kind: 'preview', ctx: CTX, background: true }); assert(made && made.stored); assert(store.get(REF, 'preview'));
    state.fail = true; const failed = await docs.ensure(brief({ ref: 'SK-AAAAAAAAAAAA' }), { kind: 'preview', ctx: CTX, background: true }); assert.strictEqual(failed, null); assert.strictEqual(docs.stats().failed, 1);
  });
  await t('ensure makes a full PDF only for a complete report', async () => {
    const { docs, calls, brief } = rig();
    assert.strictEqual(await docs.ensure(brief({}, { phase: 'completing' }), { kind: 'full' }), null); assert.strictEqual(calls.length, 0);
    assert(await docs.ensure(brief({}, { phase: 'complete' }), { kind: 'full' })); assert.strictEqual(calls.length, 1);
  });
  await t('PDF_AUTO=off stops the background making and leaves on-demand serving alone', async () => {
    const { docs, calls, brief } = rig({ env: { PDF_AUTO: 'off' } });
    assert.strictEqual(await docs.ensure(brief(), { kind: 'preview', ctx: CTX, background: true }), null); assert.strictEqual(calls.length, 0);
    assert.strictEqual(await docs.ensure(brief({}, { phase: 'complete' }), { kind: 'full' }), null); assert.strictEqual(calls.length, 0);
    assert((await docs.serve(brief(), { kind: 'preview', ctx: CTX })).bytes > 0); assert.strictEqual(calls.length, 1); assert.strictEqual(docs.stats().auto, false);
  });
  await t('describe says what a visitor can have, and never prints', async () => {
    const { docs, calls, state, brief } = rig();
    assert.deepStrictEqual(docs.describe(brief({ dossier: null }), { kind: 'preview', ctx: CTX }), { kind: 'preview', ready: false, reason: 'pending' });
    assert.strictEqual(docs.describe(brief(), { kind: 'preview', ctx: CTX, held: true }).reason, 'held');
    const nm = docs.describe(brief(), { kind: 'preview', ctx: CTX }); assert.strictEqual(nm.reason, 'not_made'); assert.strictEqual(nm.url, '/r/SK-0123456789AB/preview.pdf'); assert.strictEqual(nm.filename, 'Marigold-Heights_preview_2026-11-14_012345.pdf');
    assert.strictEqual(docs.describe(brief({}, { phase: 'completing' }), { kind: 'full' }).reason, 'completing');
    assert.strictEqual(calls.length, 0);
    await docs.serve(brief(), { kind: 'preview', ctx: CTX });
    const ready = docs.describe(brief(), { kind: 'preview', ctx: CTX }); assert(ready.ready && ready.bytes > 0 && /^\d{4}-\d\d-\d\dT/.test(ready.generatedAt) && !ready.reason);
    assert.strictEqual(docs.describe(brief({}, { questions: [q(1, { question: 'edited?' }), q(2), q(3)] }), { kind: 'preview', ctx: CTX }).reason, 'not_made');
    assert.strictEqual(docs.describe(brief({}, { phase: 'complete' }), { kind: 'full' }).url, '/r/SK-0123456789AB/pdf');
    state.available = false; assert.strictEqual(docs.describe(brief(), { kind: 'preview', ctx: CTX }).reason, 'unavailable');
  });
  await t('serve refuses with a code a route can answer: pending, held, unavailable', async () => {
    const { docs, state, brief } = rig(); const code = async (b, o) => { try { await docs.serve(b, o); return 'served'; } catch (e) { return e.code; } };
    assert.strictEqual(await code(brief({ dossier: null }), { kind: 'preview' }), 'pdf_pending');
    assert.strictEqual(await code(brief(), { kind: 'preview', held: true }), 'pdf_held');
    state.available = false; assert.strictEqual(await code(brief(), { kind: 'preview' }), 'pdf_unavailable');
  });
  await t('a print that fails is an error for serve, is counted, and is retried next time', async () => {
    const { docs, state, brief } = rig(); state.fail = true;
    await assert.rejects(() => docs.serve(brief(), { kind: 'preview', ctx: CTX }), /chromium died/); assert.strictEqual(docs.stats().failed, 1);
    state.fail = false; assert((await docs.serve(brief(), { kind: 'preview', ctx: CTX })).bytes > 0);
  });
  await t('a store that cannot be written still serves the PDF, unstored', async () => {
    const bad = createMemoryPdfStore(); bad.put = () => { throw new Error('read-only file system'); };
    const { docs, brief } = rig({ store: bad }); const r = await docs.serve(brief(), { kind: 'preview', ctx: CTX });
    assert(r.bytes > 0 && !r.stored && r.buffer);
  });
  await t('dropRef and prune remove what belongs to a report that is gone', async () => {
    const { docs, store, brief } = rig();
    await docs.serve(brief(), { kind: 'preview', ctx: CTX }); await docs.serve(brief({}, { phase: 'complete' }), { kind: 'full' }); await docs.serve(brief({ ref: 'SK-BBBBBBBBBBBB' }), { kind: 'preview', ctx: CTX });
    assert.strictEqual(store.list().length, 3);
    assert.strictEqual(docs.prune({ keep: ref => ref === REF }), 1); assert.strictEqual(store.list().length, 2);
    assert.strictEqual(docs.dropRef(REF), 2); assert.strictEqual(store.list().length, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
