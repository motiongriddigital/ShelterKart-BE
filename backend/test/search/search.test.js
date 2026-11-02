'use strict';
/** The search: reading a query, hints, the project index, and the messy-query set with its measured rates (never confidently wrong). */
const assert = require('assert');
const N = require('../../search/normalize'), H = require('../../search/hints'), { ProjectIndex, idsIn } = require('../../search');
const F = require('./fixtures'), G = require('./golden');
let passed = 0, failed = 0; const t = (n, f) => { try { f(); passed++; console.log('  ok   ' + n); } catch (e) { failed++; console.log('  FAIL ' + n + '\n       ' + String(e && e.message).split('\n')[0]); } };
const ix = () => new ProjectIndex().load(F);

console.log('reading a query');
t('Hindi and Arabic script become Latin letters, and English property words written in Hindi come back as English', () => {
  assert.strictEqual(N.tokens('वसंत हाइट्स').join(' '), 'vasant heights'); assert.strictEqual(N.tokens('स्काईलाइन टॉवर्स').join(' '), 'skyline towers');
  assert.strictEqual(N.tokens('مارينا').join(' '), 'maryna'); assert.strictEqual(N.translit('Plain text'), 'Plain text');
});
t('number words and phase numerals become digits; abbreviations expand', () => {
  assert.strictEqual(N.tokens('Phase II').join(' '), 'phase 2'); assert.strictEqual(N.tokens('tower two').join(' '), 'tower 2'); assert.strictEqual(N.tokens('Ph. 3 Twr B').join(' '), 'phase 3 tower b');
});
t('spellings that sound alike match; short words need their vowels; numbers must be exact', () => {
  for (const [a, b] of [['shreeji', 'shriji'], ['realty', 'reality'], ['vasant', 'wasant'], ['heights', 'hieghts'], ['worli', 'warli']]) assert(N.sim(a, b) >= 0.78, a + '/' + b);
  for (const [a, b] of [['park', 'perk'], ['park', 'pork'], ['2', '3'], ['lake', 'like']]) assert.strictEqual(N.sim(a, b), 0, a + '/' + b);
  assert(N.sim('crest', 'kryst', { skeleton: true }) >= 0.78 && N.sim('crest', 'kryst') === 0, 'consonant skeletons only for Arabic-script queries');
});
t('hints are lifted out and the name words are left; a hint never stands in for a name', () => {
  const r = H.hints('2bhk sea view flat in worli by vasant possession 2027 under 3 crore');
  assert.deepStrictEqual(r.hints.config, ['2bhk']); assert.strictEqual(r.hints.year, 2027); assert.deepStrictEqual(r.hints.features, ['sea_view']); assert.strictEqual(r.hints.price.inr, 3e7);
  assert.deepStrictEqual(r.name, ['worli', 'vasant']); assert.strictEqual(H.hints('Lodha Park').any, false);
});
t('registration numbers are found however they are written', () => { assert.deepStrictEqual(idsIn('rera no p-519-000-678-90'), ['P51900067890']); assert.deepStrictEqual(idsIn('call 98200'), []); });

console.log('the project index');
t('a project needs an id, a two-letter market and a name; bad ones are refused with the reason', () => {
  const x = new ProjectIndex(); assert.throws(() => x.add({ id: 'a', market: 'india', name: 'X' }), /market/); assert.throws(() => x.add({ market: 'in', name: 'X' }), /id/); assert.throws(() => x.add({ id: 'a', market: 'in', name: 'X', phases: 'no' }), /phases/);
});
t('replacing a project drops its old registration numbers', () => {
  const x = new ProjectIndex(); x.add({ id: 'a', market: 'in', name: 'Alpha', regIds: ['P11111111111'] }); x.add({ id: 'a', market: 'in', name: 'Alpha', regIds: ['P22222222222'] });
  assert.strictEqual(x.match({ query: 'P11111111111', market: 'in' }).confidence, 'none'); assert.strictEqual(x.match({ query: 'P22222222222', market: 'in' }).confidence, 'sure');
});
t('a project ShelterKart has researched becomes searchable by name and registration number', () => {
  const x = new ProjectIndex(); x.addBrief({ ref: 'SK-AB12', project: { name: 'Coral Bay Residences', location: 'Bandra West', developer: 'Coral Homes', ids: ['P51800099999'] } }, 'in');
  assert.strictEqual(x.match({ query: 'coral bay residences', market: 'in' }).candidates[0].id, 'r:SK-AB12'); assert.strictEqual(x.match({ query: 'P51800099999', market: 'in' }).confidence, 'sure');
  assert.strictEqual(x.addBrief({ ref: 'X', project: {} }, 'in'), null);
});
t('a developer-only search lists that developer\u2019s projects, without claiming certainty', () => {
  const r = ix().match({ query: 'shreeji realty', market: 'in' }); assert.deepStrictEqual(r.candidates.map(c => c.id).sort(), ['t-shreeji-greens-mum', 't-shreeji-greens-pune']); assert.notStrictEqual(r.confidence, 'sure');
});
t('every candidate carries what tells projects apart: developer, area, city, registration number, phases, and why it matched', () => {
  const c = ix().match({ query: 'P51900067890', market: 'in' }).candidates[0];
  assert.deepStrictEqual([c.developer, c.locality, c.city, c.registration, c.phase, c.why.code], ['Vasant Builders', 'Worli', 'Mumbai', 'P51900067890', 'Phase 2', 'registration']); assert.strictEqual(c.phases.length, 2);
});
t('nothing found is not a dead end: it says so, offers the closest, asks what the buyer remembers, and allows research anyway', () => {
  const r = ix().match({ query: 'Godrej Platinum Vikhroli', market: 'in' }); assert.strictEqual(r.confidence, 'none'); assert.strictEqual(r.candidates.length, 0);
  assert(Array.isArray(r.notFound.closest)); assert.deepStrictEqual(r.notFound.ask, ['developer', 'locality', 'year']); assert.strictEqual(r.notFound.researchAnyway, true);
});
t('"tell us what you remember" finds the project from the developer, the area and the year', () => {
  const r = ix().remember({ market: 'in', developer: 'Vasant Builders', locality: 'Worli', year: 2027 }); assert.strictEqual(r.candidates[0].id, 't-vasant-heights');
});
t('hostile or odd input never breaks it: very long, symbols, markup, emoji, no market', () => {
  const x = ix(); for (const q of ['x'.repeat(5000), '<script>alert(1)</script>', "'; DROP TABLE projects; --", '🏠🏠🏠', '']) { const r = x.match({ query: q, market: 'in' }); assert(r.ok && r.confidence !== 'sure'); }
  assert.strictEqual(x.match({ query: 'Vasant Heights' }).ok, false);
});

console.log('the messy-query set');
const x = ix(); let top1 = 0, top5 = 0, found = 0, wrongSure = 0; const fails = [];
for (const g of G) {
  const r = x.match({ query: g.q, location: g.loc || '', market: g.m }), ids = r.candidates.map(c => c.id), top = r.candidates[0], errs = [];
  if (g.expect) { found++; if (ids[0] === g.expect) top1++; if (ids.includes(g.expect)) top5++; if (!(g.inTop ? ids.includes(g.expect) : ids[0] === g.expect)) errs.push('expected ' + g.expect + ', got ' + (ids.join(',') || 'nothing')); }
  if (g.also && !ids.includes(g.also)) errs.push('missing ' + g.also);
  if (g.sure && r.confidence !== 'sure') errs.push('should be sure, was ' + r.confidence);
  if (g.phase && (!top || top.phase !== g.phase)) errs.push('phase ' + g.phase);
  if (g.notSure && r.confidence === 'sure') errs.push('must not be sure');
  if (g.atMost === 'possible' && ['sure', 'likely'].includes(r.confidence)) errs.push('at most possible, was ' + r.confidence);
  if (g.none && (r.confidence === 'sure' || (top && top.score >= 0.7))) errs.push('should find nothing confident');
  if (r.confidence === 'sure' && (g.none || (g.expect && ids[0] !== g.expect))) { wrongSure++; errs.push('CONFIDENTLY WRONG'); }
  if (errs.length) fails.push(`${g.q} (${g.why}): ${errs.join('; ')}`);
}
t(`all ${G.length} messy searches behave as specified`, () => assert.deepStrictEqual(fails, []));
t(`never confidently wrong: ${wrongSure} of ${G.length}`, () => assert.strictEqual(wrongSure, 0));
t(`the right project is first in ${top1} of ${found} searches that have one, and in the top five in ${top5}`, () => { assert(top1 / found >= 0.9); assert.strictEqual(top5, found); });

console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
