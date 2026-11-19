'use strict';
const assert = require('assert');
const D = require('../engine/dossier');
const { renderDossier, renderPreviewPdf } = require('../engine/dossierHtml');
const { freeView } = require('../engine/pdfDocs');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const REF = 'SK-0123456789AB';
const q = (n, extra = {}) => ({ id: 'Q' + n, question: `Question number ${n} about the record?`, why: `Why ${n} matters`, to: 'sales team', when: 'before booking', good: `Good document ${n}`, notAccepted: `Not ${n}`, ...extra });
function dossier(over = {}) {
  return {
    ref: REF, query: 'Marigold Heights', location: 'Wakad, Pune', market: 'India', asOf: '2026-11-14', phase: 'complete',
    project: { name: 'Marigold Heights', ids: ['P52100099999'] },
    counts: { facts: 11, sources: 7, conflicts: 0, inferences: 0, questions: 6, confirmed: 4, reported: 2, single: 3, developer: 2 },
    promises: [], glance: [], inferences: [], conflicts: [], unreachable: [], checks: { gaps: [], prices: [] },
    questions: [q(1), q(2, { to: 'legal team', when: 'before signing' }), q(3), q(4, { to: 'accounts team', when: 'before each payment' }), q(5, { to: 'your own lawyer' })],
    sections: [{ title: 'Section', facts: [{ id: 'F1', claim: 'A finding', status: 'verified', sources: [{ url: 'https://example.org/a', status: 'verified' }] }] }],
    sources: [{ url: 'https://example.org/a', title: 'A source', status: 'verified' }],
    notice: 'Research, not advice.',
    ...over,
  };
}
const section = (html, id) => { const i = html.indexOf(`id="sec-${id}"`); if (i < 0) return ''; const rest = html.slice(i + 10), m = rest.search(/<h2 id="sec-/); return m < 0 ? rest : rest.slice(0, m); };
const text = html => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ');

(async () => {
  console.log('the first steps');
  await t('the record page ends with three steps and the three questions to send first, named by team', () => {
    const html = renderDossier(dossier()), ledger = section(html, 'ledger');
    assert(/Before you pay: three steps/.test(ledger)); assert(/Send the questions/.test(ledger) && /Give your own lawyer/.test(ledger));
    assert(/The three to send first/.test(ledger) && ledger.includes('Q1') && ledger.includes('Q2') && ledger.includes('Q3') && !ledger.includes('Q4'));
    assert(/3 questions are marked &quot;before booking&quot;|3 questions are marked "before booking"/.test(ledger));
  });
  await t('a report with no questions has no steps block', () => { assert(!/Before you pay: three steps/.test(renderDossier(dossier({ questions: [] })))); });

  console.log('the letters');
  await t('one letter per developer team, none for the buyer\'s own lawyer', () => {
    const html = renderDossier(dossier()); const all = html.slice(html.indexOf('id="sec-letters"'), html.indexOf('id="sec-sources"'));
    assert.strictEqual((all.match(/<p class="l-tag">/g) || []).length, 3);
    assert(/Letter 1 of 3, to the sales team/.test(all) && /Letter 2 of 3, to the legal team/.test(all) && /Letter 3 of 3, to the accounts team/.test(all));
    assert(!/Letter \d of \d, to your own lawyer/.test(all));
  });
  await t('a letter holds only its team\'s questions, with the document that closes each, and no commentary', () => {
    const html = renderDossier(dossier()), all = html.slice(html.indexOf('id="sec-letters"'), html.indexOf('id="sec-sources"'));
    const first = all.slice(0, all.indexOf('Letter 2 of 3'));
    assert(first.includes('Question number 1 about the record?') && first.includes('Question number 3 about the record?'));
    assert(!first.includes('Question number 2') && !first.includes('Question number 5'));
    assert(first.includes('A document that answers it: Good document 1'));
    assert(!/Why 1 matters|Not 1/.test(all));
    assert(/Dear Sales team,/.test(first) && /within 15 days/.test(first) && /Subject:<\/b> Questions before I go further with Marigold Heights \(registration P52100099999\)/.test(first));
  });
  await t('a long list is cut at 12 and says how many more are in the full list', () => {
    const many = Array.from({ length: 15 }, (_, i) => q(i + 1, { to: 'legal team' }));
    const html = renderDossier(dossier({ questions: many })), all = html.slice(html.indexOf('id="sec-letters"'), html.indexOf('id="sec-sources"'));
    assert.strictEqual((all.match(/<li><p>Question number/g) || []).length, 12); assert(/3 more questions for this team are in/.test(all));
  });
  await t('what a buyer or an AI put in a question cannot become markup in a letter', () => {
    const html = renderDossier(dossier({ questions: [q(1, { question: '<img src=x onerror=alert(1)> & "quoted"', good: '<script>x()</script>' })], project: { name: '<b>Name</b>', ids: [] } }));
    const all = html.slice(html.indexOf('id="sec-letters"'), html.indexOf('id="sec-sources"'));
    assert(!/<img src=x|<script>x\(\)|<b>Name<\/b>/.test(all)); assert(/&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;quoted&quot;/.test(all));
  });
  await t('the contents lists the letters, and a report with only the buyer\'s own questions has none', () => {
    assert(/href="#sec-letters"/.test(renderDossier(dossier())));
    const none = renderDossier(dossier({ questions: [q(1, { to: 'your own lawyer' })] }));
    assert(!/href="#sec-letters"/.test(none) && !none.includes('id="sec-letters"'));
  });

  console.log('the stamp');
  await t('the about page carries the reference, the date, the fingerprint in groups and the check address', () => {
    const d = dossier(), fp = D.fingerprint(d), html = renderDossier(d), about = html.slice(html.indexOf('id="sec-about"'));
    assert(/^[0-9a-f]{16}$/.test(fp)); assert(about.includes(fp.replace(/(.{4})(?=.)/g, '$1 '))); assert(about.includes(`/r/${REF}/verify/${fp}`));
    assert(/This copy&#39;s stamp|This copy's stamp/.test(about) && about.includes(REF));
  });
  await t('with a site address the check address is a link; without one it is the path', () => {
    const before = process.env.PUBLIC_BASE_URL; process.env.PUBLIC_BASE_URL = 'https://shelterkart.test/';
    try { assert(renderDossier(dossier()).includes(`<a href="https://shelterkart.test/r/${REF}/verify/`)); } finally { if (before === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = before; }
    delete process.env.SITE_URL; const prev = process.env.PUBLIC_BASE_URL; delete process.env.PUBLIC_BASE_URL;
    try { assert(!/<a href="[^"]*\/verify\//.test(renderDossier(dossier()))); } finally { if (prev !== undefined) process.env.PUBLIC_BASE_URL = prev; }
  });
  await t('the fingerprint is stable for the same content whatever the key order, and changes with any change', () => {
    const d = dossier(), same = JSON.parse(JSON.stringify(d)), reordered = Object.fromEntries(Object.entries(d).reverse());
    assert.strictEqual(D.fingerprint(d), D.fingerprint(same)); assert.strictEqual(D.fingerprint(d), D.fingerprint(reordered));
    const c = JSON.parse(JSON.stringify(d)); c.sections[0].facts[0].claim = 'A finding.'; assert.notStrictEqual(D.fingerprint(d), D.fingerprint(c));
    const e = JSON.parse(JSON.stringify(d)); e.asOf = '2026-11-15'; assert.notStrictEqual(D.fingerprint(d), D.fingerprint(e));
  });

  console.log('the free PDF stays free');
  await t('the free preview PDF has no steps block, no letters and no stamp', () => {
    const d = dossier({ phase: 'preview' }), html = renderPreviewPdf(freeView(d), { price: null, link: '' }), fp = D.fingerprint(d);
    for (const bad of ['Before you pay: three steps', 'Send this to the developer', "This copy's stamp", 'Fingerprint', '/verify/', fp, 'Dear Sales team', 'A document that answers it']) assert(!html.includes(bad), 'leaked: ' + bad);
  });
  await t('the free view does not carry the stamp or the letters either', () => {
    const v = JSON.stringify(freeView(dossier())); assert(!/fingerprint|verify|Dear /i.test(v));
  });

  console.log('the wording');
  await t('nothing added tells the buyer whether to buy', () => {
    const html = renderDossier(dossier()), added = [section(html, 'ledger'), html.slice(html.indexOf('id="sec-letters"'), html.indexOf('id="sec-sources"')), html.slice(html.indexOf('id="sec-about"'))].join(' ');
    assert(!D.hasVerdict(text(added)), 'a verdict phrase was found');
  });

  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
