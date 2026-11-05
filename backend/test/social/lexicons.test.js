'use strict';
/** The lexicon matcher, the audit chain and the knowledge base: the foundations the checker stands on. */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const L = require('../../social/lexicons'), { makeAudit } = require('../../social/audit'), K = require('../../social/kb');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
const cats = text => [...new Set(L.scan(text).map(x => x.category))];

(async () => {
  console.log('the matcher');
  await t('it finds an accusation in every script the lexicon covers, written plainly', () => {
    for (const [lang, s] of Object.entries({ en: 'He is a fraud', fr: 'C\u2019est une arnaque', es: 'Es una estafa', de: 'Das ist Betrug', pl: 'To oszustwo', hi: '\u092F\u0939 \u0927\u094B\u0916\u093E\u0927\u0921\u093C\u0940 \u0939\u0948', ar: '\u0647\u0630\u0627 \u0627\u062D\u062A\u064A\u0627\u0644', ja: '\u3053\u308C\u306F\u8A50\u6B3A\u3067\u3059', zh: '\u9019\u662F\u8A50\u9A19', pt: '\u00C9 um golpe', it: '\u00C8 una truffa', nl: 'Dat is oplichting', th: '\u0E19\u0E35\u0E48\u0E04\u0E37\u0E2D\u0E01\u0E32\u0E23\u0E2B\u0E25\u0E2D\u0E01\u0E25\u0E27\u0E07', sv: 'Det \u00E4r bedr\u00E4geri', cs: 'To je podvod', fi: 'Se on huijaus' })) assert(cats(s).includes('accusation'), lang + ': ' + s);
  });
  await t('it is not fooled by spacing, dots, look-alike letters, accents, zero-width characters, full-width letters or leetspeak', () => {
    for (const s of ['s c a m', 's.c.a.m', 'f-r-a-u-d', 'fr4ud', 'sc@m', 'fr\u0430ud', 'fr\u00E0ud', 'fra\u200Bud', 'ＦＲＡＵＤ', 'FrAuD', 'cr00k', 'br1b3ry']) assert(cats(s).includes('accusation'), s);
  });
  await t('it does not flag innocent words that merely contain a term', () => {
    for (const s of ['a scampi dinner', 'the scale of the plan', 'Check the register before you pay', 'stealth mode is a software term? no', 'The booking amount is stated on the receipt']) assert(!cats(s).includes('accusation'), s);
  });
  await t('curly and plain apostrophes are the same, so "don\u2019t buy" and "don\'t buy" are both advice', () => { assert(cats('Don\u2019t buy this flat').includes('advice')); assert(cats('don\'t buy this flat').includes('advice')); });
  await t('each category is found: advice, scores and rankings, out-of-scope, fair housing, safety claims, sponsored, sensitive, clickbait, scope watch', () => {
    const want = { advice: 'You should buy now', score_ranking: 'The top 10 developers', out_of_scope: 'A resale bargain for a tenant', fair_housing: 'Vegetarians only society', safety_claim: 'An earthquake-proof tower', sponsored: 'Paid partnership with the builder', sensitive: 'After the election the market', clickbait: 'You won\'t believe this', scope_watch: 'A vacant land parcel' };
    for (const [c, s] of Object.entries(want)) assert(cats(s).includes(c), c + ': ' + s);
  });
  await t('ordinary education text passes the lexicon: dates, numbers and normal real-estate terms', () => {
    for (const s of ['Checked on 2026-10-20: ask for the registered project number.', 'Carpet area is the usable floor inside the walls.', 'Five questions to ask the sales office about the possession date.']) assert.deepStrictEqual(L.scan(s, ['accusation', 'advice', 'score_ranking', 'out_of_scope', 'fair_housing', 'safety_claim', 'sponsored']), [], s);
  });
  await t('the lexicon has a version that changes with its contents, and lists in many languages', () => { assert(/^[0-9a-f]{12}$/.test(L.VERSION)); assert(L.TERMS.accusation > 200 && L.TERMS.advice > 60); });

  console.log('the audit log');
  await t('entries are chained, and the chain verifies', () => {
    const a = makeAudit({ now: () => 1700000000000 }); a.append('check', { post: 'p1', verdict: 'pass' }); a.append('approval', { pack: 'k1' }); a.append('publish', { post: 'p1' });
    assert.deepStrictEqual(a.verify(), { ok: true, length: 3 }); assert.strictEqual(a.tail(1)[0].seq, 3);
  });
  await t('any change, removal or reordering breaks the chain', () => {
    const a = makeAudit(); for (let i = 0; i < 5; i++) a.append('check', { i });
    const copy = () => a.all().map(e => JSON.parse(JSON.stringify(e)));
    const changed = copy(); changed[2].data.i = 99; const removed = copy(); removed.splice(1, 1); const swapped = copy(); [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
    const verify = list => { const f = path.join(os.tmpdir(), 'audit-' + Math.random().toString(36).slice(2) + '.jsonl'); fs.writeFileSync(f, list.map(e => JSON.stringify(e)).join('\n') + '\n'); try { makeAudit({ file: f }); return 'accepted'; } catch (e) { return e.code; } finally { fs.unlinkSync(f); } };
    assert.strictEqual(verify(copy()), 'accepted'); assert.strictEqual(verify(changed), 'audit_broken'); assert.strictEqual(verify(removed), 'audit_broken'); assert.strictEqual(verify(swapped), 'audit_broken');
  });
  await t('a file-backed log survives a restart with its chain intact and keeps appending', () => {
    const f = path.join(os.tmpdir(), 'audit-keep-' + process.pid + '.jsonl'); try { fs.unlinkSync(f); } catch {}
    const a = makeAudit({ file: f }); a.append('check', { n: 1 }); a.append('check', { n: 2 });
    const b = makeAudit({ file: f }); assert.strictEqual(b.size(), 2); b.append('check', { n: 3 }); assert.deepStrictEqual(makeAudit({ file: f }).verify(), { ok: true, length: 3 }); fs.unlinkSync(f);
  });

  console.log('the knowledge base');
  const good = { id: 'test.in.t02.a', market: 'IN', topic: 't02', statement: 'TEST ONLY: a registered project shows its registration number on the regulator\u2019s page.', type: 'fact', source: { name: 'Test regulator', url: 'https://example.org/register' }, checkedOn: '2026-10-20', expiresOn: '2027-01-20', scope: 'new_build_primary', status: 'verified', verification: { by: 'agent', at: '2026-10-21' } };
  const kb = K.makeKb({ markets: ['IN', 'GB'], topics: ['t01', 't02'], today: () => '2026-10-25' });
  await t('a complete, verified item is stored and usable; a draft is stored but not usable', () => {
    kb.put(good); assert.strictEqual(kb.usable('test.in.t02.a').ok, true); kb.put({ ...good, id: 'test.in.t02.b', status: 'draft' }); assert.strictEqual(kb.usable('test.in.t02.b').reason, 'not_verified');
    assert.deepStrictEqual(kb.forPost('IN', 't02').map(i => i.id), ['test.in.t02.a']);
  });
  await t('an item with a missing source, a future check date, a long recheck gap, a wrong scope or an unknown market is refused with every reason', () => {
    const bad = (o, re) => { try { kb.put({ ...good, id: 'x.' + Math.random().toString(36).slice(2, 8), ...o }); assert.fail('stored: ' + JSON.stringify(o)); } catch (e) { assert.strictEqual(e.code, 'kb_invalid', e.message); assert(re.test(e.message), e.message); } };
    bad({ source: { name: '', url: 'http://insecure.test' } }, /source/); bad({ checkedOn: '2026-12-01' }, /checkedOn/); bad({ expiresOn: '2027-12-01' }, /expiresOn/); bad({ scope: 'resale' }, /scope/); bad({ market: 'ZZ' }, /market/);
    bad({ topic: 't99' }, /topic/); bad({ type: 'prediction' }, /hedged/); bad({ type: 'opinion' }, /informational opinion/); bad({ statement: 'short' }, /statement/); bad({ verification: null }, /verification/);
  });
  await t('a statement with an accusation, advice, a ranking, resale or a safety claim is refused at the door', () => {
    for (const s of ['TEST ONLY: this developer is a fraud and everyone knows it.', 'TEST ONLY: you should buy now before the price changes.', 'TEST ONLY: the top 10 developers in the city this year.', 'TEST ONLY: a resale flat is a better bargain here.', 'TEST ONLY: the tower is earthquake-proof and completely safe.']) assert.throws(() => kb.put({ ...good, id: 'y.' + Math.random().toString(36).slice(2, 8), statement: s }), /refused/, s);
  });
  await t('an item expires on its date: it stops being usable, and the sweep reports the gap', () => {
    const k2 = K.makeKb({ today: () => '2026-10-25' }); k2.put({ ...good, id: 'e.1', expiresOn: '2026-10-30' }); assert(k2.usable('e.1').ok);
    const later = K.usable(k2.get('e.1'), '2026-10-31'); assert.deepStrictEqual(later, { ok: false, reason: 'expired' });
    const k3 = K.makeKb({ today: () => '2026-10-31' }); k3.put({ ...good, id: 'e.2', checkedOn: '2026-10-24', expiresOn: '2026-10-31' }); assert.deepStrictEqual(k3.sweep(), ['e.2']); assert.strictEqual(k3.get('e.2').status, 'expired');
  });
  await t('coverage shows which market and topic pairs have no usable item, so a gap is reported, never papered over', () => {
    const rows = kb.coverage(['IN', 'GB'], ['t01', 't02']); assert.deepStrictEqual(rows.filter(r => r.usable).map(r => r.market + r.topic), ['INt02']); assert.strictEqual(rows.length, 4);
  });

  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
