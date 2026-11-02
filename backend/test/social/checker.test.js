'use strict';
/** The constitution checker: the good set passes, the whole red-team set is stopped, every rule has a case, and the judge fails safe. */
const assert = require('assert');
const C = require('../../social/checker'), S = require('../../social/schedule'), M = require('../../social/marketer'), K = require('../../social/kb');
const { makeAudit } = require('../../social/audit'), { fingerprintOf } = require('../../social/fingerprint');
const F = require('./fixtures'), R = require('./redteam'), LEX = require('../../social/lexicons');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
const kb = F.buildKb(), plan = S.weekPlan(F.MONDAY), slot = (m, p) => plan.find(s => s.market === m && s.platform === p);
const goodJudge = async () => ({ pass: true, issues: [] });

(async () => {
  console.log('the good set');
  await t('every drafted post of three whole weeks (756 posts, 36 markets, every platform, nine languages) passes the mechanical rules', () => {
    let n = 0; const bad = [];
    for (const [w, monday] of ['2026-10-26', '2026-11-02', '2026-11-09'].entries()) for (const s of S.weekPlan(monday)) { n++; const spec = F.goodPost(kb, s, { topic: 't0' + (w + 1) }); const r = C.evaluate(spec, F.ctx(kb)); if (r.length) bad.push(s.id + ' ' + r.map(x => x.rule + ':' + x.detail).join('|')); }
    assert.strictEqual(n, 756); assert.deepStrictEqual(bad.slice(0, 3), []);
  });
  await t('a good post passes the full check, with the judge, and leaves a pass in the audit log with its fingerprint and the rules version', async () => {
    const audit = makeAudit(), ck = C.makeChecker({ kb, audit, judge: goodJudge }), spec = F.goodPost(kb, slot('GB', 'IG'));
    const r = await ck.check(spec, F.ctx(kb, { judge: undefined })); assert.strictEqual(r.verdict, 'pass'); assert.deepStrictEqual(r.findings, []);
    const e = audit.tail(1)[0]; assert.strictEqual(e.kind, 'check'); assert.strictEqual(e.data.verdict, 'pass'); assert.strictEqual(e.data.fingerprint, fingerprintOf(spec)); assert.strictEqual(e.data.rulesVersion, C.RULES_VERSION); assert(audit.verify().ok);
  });

  console.log('the red-team set');
  const set = R.build();
  await t(`at least 200 deliberately bad posts exist, and every one is stopped with the expected verdict and rule (${set.length} posts)`, () => {
    assert(set.length >= 200, 'only ' + set.length); const miss = [];
    for (const r of set) { const f = C.evaluate(r.spec, { ...F.ctx(r.kb), ...r.ctx }), v = C.verdictOf(f); if (v !== r.verdict || !f.some(x => x.rule === r.rule)) miss.push(`${r.name}: wanted ${r.verdict} ${r.rule}, got ${v} ${[...new Set(f.map(x => x.rule))].join(',')}`); }
    assert.deepStrictEqual(miss, []);
  });
  await t('nothing in the red-team set can pass: a post that must be stopped is never a pass, under any rule', () => { for (const r of set) assert.notStrictEqual(C.verdictOf(C.evaluate(r.spec, { ...F.ctx(r.kb), ...r.ctx })), 'pass', r.name); });
  await t('every rule has at least one red-team case, except the judge (tested below)', () => {
    const covered = new Set(set.map(r => r.rule)); const missing = C.RULES.filter(r => r !== 'C19.judge' && !covered.has(r)); assert.deepStrictEqual(missing, []);
  });
  await t('the accusation test is exercised in all 21 languages and the advice test in 12', () => {
    const langs = cat => new Set(set.filter(r => r.name.startsWith('A ' + cat + '/')).map(r => r.name.split('/')[1].split(':')[0]));
    assert.strictEqual(langs('accusation').size, 21); assert(langs('advice').size >= 12);
  });
  await t('severity is right: a broken constitution rule is a BLOCK, a fixable format problem is a HOLD', () => {
    const v = n => set.find(r => r.name.includes(n)); assert.strictEqual(v('names a party').verdict, 'block'); assert.strictEqual(v('too many hashtags').verdict, 'hold'); assert.strictEqual(v('an invented percentage').verdict, 'block'); assert.strictEqual(v('all capitals').verdict, 'hold');
  });
  await t('a post that fails several rules reports every one of them, not only the first', () => {
    const s = F.goodPost(kb, slot('GB', 'IG')); s.sponsored = true; s.body += '\n\nA fraud. Buy now. Prices rose 12%.'; const f = C.evaluate(s, F.ctx(kb)), rules = new Set(f.map(x => x.rule));
    for (const r of ['C1.sponsored', 'C5.accusation', 'C9.advice', 'C3.numbers']) assert(rules.has(r), r);
  });

  console.log('the judge');
  const spec = () => F.goodPost(kb, slot('GB', 'IG'));
  const run = async (judge, ctx = {}) => C.makeChecker({ kb, audit: makeAudit(), judge }).check(spec(), F.ctx(kb, { judge: undefined, ...ctx }));
  await t('with no judge available the post is HELD, never passed: when in doubt, hold', async () => { const r = await C.makeChecker({ kb }).check(spec(), F.ctx(kb, { judge: undefined })); assert.strictEqual(r.verdict, 'hold'); assert(r.findings.some(f => f.rule === 'C19.judge')); });
  await t('a judge that throws, or returns nothing readable, also gives a HOLD', async () => {
    for (const j of [async () => { throw new Error('down'); }, async () => null, async () => undefined]) { const r = await run(j); assert.strictEqual(r.verdict, 'hold'); assert(r.findings.some(f => f.rule === 'C19.judge')); }
  });
  await t('a judge that passes the post lets it through; one that flags an unnamed accusation or advice makes it a BLOCK; a tone problem a HOLD', async () => {
    assert.strictEqual((await run(goodJudge)).verdict, 'pass');
    assert.strictEqual((await run(async () => ({ pass: false, issues: [{ rule: 'C5.accusation', quote: 'x', why: 'implies a developer cheats' }] }))).verdict, 'block');
    assert.strictEqual((await run(async () => ({ pass: false, issues: [{ rule: 'C9.advice', quote: 'x', why: 'tells the reader to buy' }] }))).verdict, 'block');
    assert.strictEqual((await run(async () => ({ pass: false, issues: [{ rule: 'C17.tone', quote: 'x', why: 'fear' }] }))).verdict, 'hold');
  });
  await t('a judge that says "not pass" with no reason still holds the post', async () => { assert.strictEqual((await run(async () => ({ pass: false, issues: [] }))).verdict, 'hold'); });
  await t('the judge is only consulted when the mechanical tests did not already block, so a blocked post costs no model call', async () => {
    let calls = 0; const s = spec(); s.sponsored = true; const r = await C.makeChecker({ kb, judge: async () => { calls++; return { pass: true, issues: [] }; } }).check(s, F.ctx(kb, { judge: undefined })); assert.strictEqual(r.verdict, 'block'); assert.strictEqual(calls, 0);
  });
  await t('the judge answer is parsed strictly: JSON inside text is found, unknown rules are dropped, a missing "pass" is unreadable', () => {
    const p = C.parseJudge('Sure. {"pass": false, "issues": [{"rule": "C5.accusation", "quote": "q", "why": "w"}, {"rule": "Z9.made_up", "quote": "", "why": ""}]} thanks');
    assert.strictEqual(p.pass, false); assert.strictEqual(p.issues.length, 1); assert.strictEqual(C.parseJudge('{"issues": []}'), null); assert.strictEqual(C.parseJudge('no json here'), null); assert.strictEqual(C.parseJudge('{bad json}'), null);
  });
  await t('the judge prompt lists the claims, carries the post and asks for JSON only, and contains no secrets', () => {
    const s = spec(), p = C.buildJudgePrompt(s); assert(p.includes(s.claims[0].text)); assert(p.includes('JSON only')); assert(/NEW-BUILD/.test(p)); assert(!/api[_-]?key|password|secret/i.test(p));
  });
  await t('the model judge runs on the verify role, so it can sit on a different provider from the marketer', async () => {
    const seen = []; const engines = { run: async (role, op, args) => { seen.push([role, op]); return { text: '{"pass": true, "issues": []}' }; } };
    const j = C.makeLlmJudge({ engines }); const r = await j(spec()); assert.deepStrictEqual(seen, [['verify', 'complete']]); assert.strictEqual(r.pass, true);
  });

  console.log('the marketer\u2019s deterministic floor');
  await t('a draft restates the knowledge item word for word, with its source, check date, question and the disclaimer, in the post\u2019s own language', () => {
    for (const [m, p, l] of [['IN', 'IG', 'hi'], ['JP', 'X', 'ja'], ['SA', 'LI', 'ar'], ['DE', 'FB', 'de'], ['GB', 'LI', 'en']]) {
      const s = F.goodPost(kb, slot(m, p) || plan.find(x => x.market === m), { lang: l }), it = kb.get(`test.${m}.t01`), want = l === 'en' ? it.statement : it.translations[l].text;
      assert(s.body.includes(want)); assert(s.body.includes(C.DISCLAIMERS[l])); assert(s.body.includes('2026-10-20')); assert.strictEqual(s.lang, l);
    }
  });
  await t('hashtags respect each platform\u2019s limit: X 2, Threads 1, LINE 0, Instagram 5 at most', () => {
    for (const s of plan) { const spec = F.goodPost(kb, s); assert(spec.hashtags.length <= S.PLATFORMS[s.platform].maxHashtags, s.id); }
    assert.strictEqual(F.goodPost(kb, plan.find(x => x.platform === 'LN')).hashtags.length, 0);
  });
  await t('a claim too long for the platform is refused with a reason, not squeezed in', () => {
    const k2 = F.buildKb(), it = k2.get('test.GB.t01'); it.statement = 'TEST ONLY (United Kingdom): ' + 'a very long statement about the register '.repeat(9);
    const r = M.draft({ slot: slot('GB', 'X'), item: it, lang: 'en', topic: 't01' }); assert.deepStrictEqual([r.ok, r.reason], [false, 'claim_too_long_for_platform']);
  });
  await t('a draft is refused, never guessed, for an unapproved translation, a language the marketer has no words for, or a missing item', () => {
    const k2 = F.buildKb(); k2.get('test.IN.t01').translations.hi.approvedBy = null;
    assert.strictEqual(M.draft({ slot: slot('IN', 'IG'), item: k2.get('test.IN.t01'), lang: 'hi', topic: 't01' }).reason, 'translation_not_approved');
    assert.strictEqual(M.draft({ slot: slot('TH', 'X') || plan.find(x => x.market === 'TH'), item: kb.get('test.TH.t01'), lang: 'th', topic: 't01' }).reason, 'language_needs_localiser');
    assert.strictEqual(M.draft({ slot: slot('GB', 'IG'), item: null, lang: 'en', topic: 't01' }).reason, 'no_usable_knowledge');
    assert.strictEqual(M.draft({ slot: slot('GB', 'IG'), item: kb.get('test.GB.t01'), lang: 'en', topic: 't99' }).reason, 'unknown_topic');
  });
  await t('the 12 topics rotate week by week, then repeat at the next depth', () => {
    assert.deepStrictEqual(M.topicForWeek(0), { topic: 't01', chapter: 1, depth: 1 }); assert.strictEqual(M.topicForWeek(11).topic, 't12'); assert.deepStrictEqual(M.topicForWeek(12), { topic: 't01', chapter: 1, depth: 2 }); assert.strictEqual(M.topicForWeek(36).depth, 1);
  });
  await t('the curriculum stops at registration and upkeep: no topic covers resale, in line with constitution rule 7', () => {
    for (const x of M.CURRICULUM.topics) assert.deepStrictEqual(LEX.scan(x.title, ['out_of_scope']), [], x.title); assert(/registration and upkeep/.test(M.CURRICULUM.topics[11].title));
  });

  console.log('fingerprint and rules version');
  await t('the fingerprint is stable, and changes when one comma, one hashtag, one image or the time changes', () => {
    const s = spec(), f0 = fingerprintOf(s); assert.strictEqual(fingerprintOf(JSON.parse(JSON.stringify(s))), f0);
    const mut = fn => { const c = JSON.parse(JSON.stringify(s)); fn(c); return fingerprintOf(c); };
    for (const fn of [c => { c.body += ','; }, c => { c.hashtags = c.hashtags.slice(1); }, c => { c.media[0].sha256 = 'x'; }, c => { c.slot.scheduledUtc = '2026-10-30T19:31:00.000Z'; }, c => { c.links = [{ url: 'https://shelterkart.com/' }]; }, c => { c.media[0].alt += '.'; }]) assert.notStrictEqual(mut(fn), f0);
  });
  await t('the fingerprint ignores what is not published: the id, the check result and bookkeeping fields', () => {
    const s = spec(), f0 = fingerprintOf(s), c = JSON.parse(JSON.stringify(s)); c.id = 'other'; c.source = 'polished'; c.langName = 'x'; c.listCount = null; assert.strictEqual(fingerprintOf(c), f0);
  });
  await t('the rules version is 12 hex characters, stable within a run, and is part of every verdict', async () => {
    assert(/^[0-9a-f]{12}$/.test(C.RULES_VERSION)); const r = await C.makeChecker({ kb, judge: goodJudge }).check(spec(), F.ctx(kb, { judge: undefined })); assert.strictEqual(r.rulesVersion, C.RULES_VERSION);
  });
  await t('checking is fast enough to run on every post: a whole week of 252 posts, drafting included, in under five seconds (the engine needs 36 a day)', () => { const posts = S.weekPlan('2026-11-02').map(s => F.goodPost(kb, s, { topic: 't02' })), t0 = Date.now(); for (const s of posts) C.evaluate(s, F.ctx(kb)); const ms = Date.now() - t0; assert(ms < 5000, ms + ' ms for the checks alone'); });

  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
