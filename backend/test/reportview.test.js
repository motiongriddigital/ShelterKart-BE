'use strict';
const assert = require('assert');
const { reportView, GROUPS } = require('../engine/reportView');
const SAMPLE = require('../../tools/samples/dossier-celeste.json');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } }

const FRONTEND_KEYS = ['slug', 'ref', 'researchedTo', 'registration', 'name', 'address', 'headline', 'summary', 'ledger', 'stats', 'discrepancies', 'questions', 'numbers', 'checklist', 'sources'];
const TONES = ['green', 'blue', 'amber', 'violet', 'slate', 'red'];
const REF = 'SK-ABCDEF123456';
const full = () => reportView(SAMPLE, { locked: false, ref: REF });
const free = () => reportView(SAMPLE, { locked: true, ref: REF });
const clone = o => JSON.parse(JSON.stringify(o));

(async () => {
  console.log('the shape the front end draws');
  await t('every field of the front end\'s PropertyReport is present, in both views', () => {
    for (const v of [full(), free()]) for (const k of FRONTEND_KEYS) assert.ok(k in v, 'missing ' + k);
  });
  await t('the title block comes from the dossier', () => {
    const v = full();
    assert.strictEqual(v.slug, 'hubtown-celeste'); assert.strictEqual(v.ref, REF); assert.strictEqual(v.name, 'Hubtown Celeste');
    assert.strictEqual(v.researchedTo, '13 October 2026'); assert.strictEqual(v.registration.id, 'P51900008925'); assert.strictEqual(v.registration.registeredOn, '19 Aug 2017');
    assert.match(v.headline, /30 questions/); assert.match(v.summary, /^43 findings from 28 sources\. 2 disagreements between sources and 8 conclusions/);
  });
  await t('six number tiles with the dossier\'s counts and a valid tone each', () => {
    const v = full();
    assert.deepStrictEqual(v.stats.map(s => s.value), [43, 6, 37, 2, 8, 30]);
    assert.ok(v.stats.every(s => TONES.includes(s.tone) && s.label && s.hint));
  });
  await t('the key facts are five, the promoter and the brand first, and a disagreement is highlighted', () => {
    const v = full();
    assert.strictEqual(v.ledger.length, 5); assert.deepStrictEqual(v.ledger.slice(0, 2).map(r => r.label), ['Registered promoter', 'Sold as']);
    assert.ok(v.ledger.some(r => r.label === 'Marketed possession' && r.highlight === true));
    assert.ok(v.ledger.every(r => typeof r.highlight === 'boolean'));
  });
  await t('the promise-versus-record pairs become the difference cards, at most three', () => {
    const v = full();
    assert.strictEqual(v.discrepancies.length, 3);
    const d = v.discrepancies[0];
    assert.deepStrictEqual([d.tag, d.claimed.title, d.official.title], ['Who sells it', 'Sold as Hubtown', 'Registered to Nayan Real Estate Private Limited']);
    assert.ok(v.discrepancies.every(x => x.code && x.title && x.footer.text));
  });
  await t('the first eight questions carry why, a good answer and what does not close it', () => {
    const v = full();
    assert.strictEqual(v.questions.length, 8);
    assert.deepStrictEqual(v.questions[0].notClose, SAMPLE.questions[0].notAccepted);
    assert.ok(v.questions.every(q => GROUPS.includes(q.category) && q.question && q.id));
  });
  await t('the checklist carries questions 9 to 18, a count per team over all 30, and how many are left', () => {
    const v = full();
    assert.deepStrictEqual(v.checklist.items.map(i => i.no), [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
    assert.strictEqual(Object.values(v.checklist.groupCounts).reduce((a, b) => a + b, 0), 30);
    assert.deepStrictEqual(Object.keys(v.checklist.groupCounts), GROUPS);
    assert.strictEqual(v.checklist.more, 12);
    assert.ok(v.checklist.items.every(i => GROUPS.includes(i.group) && i.status === 'Pending Response' && /^Ask (the|your)/.test(i.direction)));
  });
  await t('the numbers: listed prices per square foot, the checks, and the delay cost; no benchmark is invented', () => {
    const n = full().numbers;
    assert.strictEqual(n.rows.length, 4); assert.strictEqual(n.rows[0].effective, '₹60,303 / sq ft');
    assert.ok(n.rows.every(r => r.benchmark === '' && r.variance === ''));
    assert.ok(n.checks.some(c => c.label === 'Area' && /2\.47/.test(c.text)) && n.checks.some(c => c.label === 'Dates'));
    assert.strictEqual(n.statutory.rows[1].value, '₹92,500'); assert.match(n.statutory.intro, /11\.1%/);
  });
  await t('sources: official first, at most eight, each with a safe link and a valid tone', () => {
    const s = full().sources;
    assert.strictEqual(s.length, 8); assert.strictEqual(s[0].status.tone, 'green');
    assert.ok(s.every(x => /^https?:\/\//.test(x.url) && TONES.includes(x.status.tone)));
  });
  await t('the counts and the phase ride along', () => { assert.strictEqual(full().counts.questions, 30); assert.strictEqual(full().locked, false); });

  console.log('the free view shows what the preview page shows, and nothing else');
  await t('it says it is locked and counts what is withheld', () => {
    const v = free();
    assert.strictEqual(v.locked, true); assert.deepStrictEqual(v.lockedCounts, { questions: 27, facts: 43, sources: 28, conflicts: 2, inferences: 8 });
  });
  await t('three questions in full, the rest only as a count per team', () => {
    const v = free();
    assert.strictEqual(v.questions.length, 3); assert.deepStrictEqual(v.checklist.items, []);
    assert.strictEqual(v.checklist.more, 27); assert.strictEqual(Object.values(v.checklist.groupCounts).reduce((a, b) => a + b, 0), 27);
  });
  await t('the difference cards and the tiles are shown, as on the preview page', () => { assert.strictEqual(free().discrepancies.length, 3); assert.strictEqual(free().stats.length, 6); });
  await t('no ledger, no numbers, no sources, no registration date', () => {
    const v = free();
    assert.deepStrictEqual([v.ledger, v.numbers.rows, v.numbers.checks, v.sources], [[], [], [], []]);
    assert.strictEqual(v.numbers.statutory, null); assert.strictEqual(v.registration.registeredOn, '');
  });
  await t('nothing from a locked question, a source or a finding is anywhere in the text', () => {
    const text = JSON.stringify(free());
    for (const q of SAMPLE.questions.slice(3)) assert.ok(!text.includes(q.question.slice(0, 60)), 'question ' + q.id);
    for (const s of SAMPLE.sources) assert.ok(!text.includes(s.url), 'source ' + s.url);
    for (const f of SAMPLE.sections.flatMap(x => x.facts)) assert.ok(!text.includes(f.claim.slice(0, 60)), 'finding ' + f.id);
    assert.ok(!text.includes('19 Aug 2017') && !text.includes('92,500'));
  });
  await t('the free view is a copy: the stored dossier is not changed', () => {
    const d = clone(SAMPLE); const before = JSON.stringify(d); reportView(d, { locked: true }); reportView(d, { locked: false });
    assert.strictEqual(JSON.stringify(d), before);
  });

  console.log('odd input');
  await t('an empty or early dossier does not throw and still has every field', () => {
    for (const d of [{}, { questions: [], counts: {} }, { project: { name: 'X' }, questions: [{ id: 'Q1', question: 'Q?', to: 'nobody', when: 'before booking' }] }]) for (const locked of [true, false]) {
      const v = reportView(d, { locked, ref: REF }); for (const k of FRONTEND_KEYS) assert.ok(k in v, 'missing ' + k);
    }
  });
  await t('a question for an unknown team falls into Legal', () => {
    const v = reportView({ questions: [{ id: 'Q1', question: 'Q?', to: 'the moon', when: 'before booking' }] }, { locked: false });
    assert.strictEqual(v.questions[0].category, 'Legal');
  });
  await t('a source that is not a web address gets no link', () => {
    const d = clone(SAMPLE); d.sources = [{ url: 'javascript:alert(1)', title: 'x', host: '', status: 'reported', seen: true }];
    assert.strictEqual(reportView(d, { locked: false }).sources[0].url, '');
  });
  await t('a cited link the search did not return is flagged', () => {
    const d = clone(SAMPLE); d.sources = [{ url: 'https://a.example/x', title: '', host: 'a.example', status: 'reported', seen: false }];
    assert.match(reportView(d, { locked: false }).sources[0].note, /did not return/);
  });
  await t('a market with no delay rule gives no statutory block, and an amount in another currency is not shown as rupees', () => {
    const d = clone(SAMPLE); delete d.checks.delay; d.checks.prices = [{ label: 'Flat', price: 1200000, area: 800, perSqft: 1500, currency: 'GBP' }];
    const n = reportView(d, { locked: false }).numbers;
    assert.strictEqual(n.statutory, null); assert.strictEqual(n.rows[0].quoted, 'GBP 1,200,000');
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
