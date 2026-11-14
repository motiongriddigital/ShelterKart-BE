'use strict';
const assert = require('assert'), os = require('os'), path = require('path'), crypto = require('crypto');
const INV = require('../engine/investigator');
const ENG = require('../engines');
let passed = 0, failed = 0;
async function t(name, fn) { ENG.meter.reset(); try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } }

const REG = 'https://maharera.maharashtra.gov.in/project/P52100099001', SITE = 'https://sunrise-sandbox.example/marigold';
const LEAN = { project: { name: 'Marigold Heights', location: 'Wakad, Pune', country: 'India', brand: 'Marigold Heights by Sunrise', promoter_legal_name: 'Marigold Realty Ventures Private Limited', registration_ids: ['P52100099001'] },
  facts: [{ area: 'record', field: 'filed completion date', value: '31 Dec 2026', claim: 'The filed completion date is 31 December 2026.', sources: [REG] }, { area: 'timeline', claim: 'The brochure promises possession by March 2026.', kind: 'developer_claim', sources: [SITE] }],
  marketed_dates: [{ value: 'March 2026', source: SITE }], filed_completion: { value: '31 Dec 2026', source: REG },
  questions: [{ question: 'Which date will my agreement carry?', why: 'Only the registered date gives a remedy.', to: 'legal team', when: 'before signing', good: 'The registered date.', not_accepted: 'A brochure date.' }] };
const DEEP = { facts: [{ area: 'money', claim: 'A charge of 85 crore rupees is registered against the promoter.', sources: ['https://charges-sandbox.example/c1'] }, { area: 'complaints', claim: 'Four complaints are listed against the project.', sources: [REG] }],
  questions: [{ question: 'Has the lender consented to the sale of flats?', to: 'legal team', when: 'before booking' }] };

function makeEngines({ failDeep = false } = {}) {
  const calls = [];
  return { calls, async runEach(role, op, args, opts) {
    calls.push({ role, op, args, opts });
    if (role === 'research') {
      if (args.stage === 'deep' && failDeep) throw Object.assign(new Error('the engines are down'), { code: 'no_engine' });
      const text = args.stage === 'sweep' ? JSON.stringify(LEAN) : args.stage === 'deep' ? JSON.stringify(DEEP) : '{}';
      return { results: [{ engine: 'claude', text, retrieved: [REG, SITE, 'https://charges-sandbox.example/c1'].map(url => ({ url })) }], failed: [] };
    }
    return { results: [{ engine: 'claude', text: JSON.stringify({ questions: [{ question: 'Who signs my agreement?', to: 'legal team', when: 'before booking' }], leads: [], challenges: [] }) }], failed: [] };
  } };
}
const stages = e => e.calls.map(c => c.args.stage);
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

(async () => {
  console.log('the switch and its settings');
  await t('nothing changes until it is set: no setting, no change; today\'s keys keep their values', () => {
    assert.deepStrictEqual(INV.budgetFromEnv({}), {});
    const d = INV.DEFAULT_BUDGET;
    assert.deepStrictEqual([d.searches, d.fetches, d.maxTokens, d.rounds, d.leadPanel, d.previewMode], [25, 12, 16000, 4, 2, 'full']);
  });
  await t('INVESTIGATE_PREVIEW_MODE accepts lean or full in any case, and ignores anything else', () => {
    assert.strictEqual(INV.budgetFromEnv({ INVESTIGATE_PREVIEW_MODE: 'LEAN' }).previewMode, 'lean');
    assert.strictEqual(INV.budgetFromEnv({ INVESTIGATE_PREVIEW_MODE: ' full ' }).previewMode, undefined);
    assert.strictEqual(INV.budgetFromEnv({ INVESTIGATE_PREVIEW_MODE: 'full' }).previewMode, 'full');
    for (const v of ['', 'on', 'cheap', '1']) assert.strictEqual(INV.budgetFromEnv({ INVESTIGATE_PREVIEW_MODE: v }).previewMode, undefined, v);
  });
  await t('the lean and deep settings map to budget keys and are clamped', () => {
    assert.deepStrictEqual(INV.budgetFromEnv({ INVESTIGATE_LEAN_MAX_TOKENS: '2500', INVESTIGATE_DEEP_SEARCHES: '9', INVESTIGATE_DEEP_FETCHES: '4', INVESTIGATE_DEEP_PANEL: '2' }), { leanMaxTokens: 2500, deepSearches: 9, deepFetches: 4, deepPanel: 2 });
    assert.deepStrictEqual(INV.budgetFromEnv({ INVESTIGATE_LEAN_MAX_TOKENS: '999999', INVESTIGATE_DEEP_SEARCHES: '999', INVESTIGATE_DEEP_FETCHES: '99', INVESTIGATE_DEEP_PANEL: '9' }), { leanMaxTokens: 16000, deepSearches: 25, deepFetches: 12, deepPanel: 3 });
    assert.deepStrictEqual(INV.budgetFromEnv({ INVESTIGATE_LEAN_MAX_TOKENS: '10', INVESTIGATE_DEEP_SEARCHES: 'x', INVESTIGATE_DEEP_PANEL: '0' }), {});
  });

  console.log('the prompts');
  await t('the full prompt is byte for byte what it was before this change (the switch is really off)', () => {
    assert.deepStrictEqual([
      sha(INV.sweepPrompt({ query: 'Marigold Heights', location: 'Wakad, Pune', market: 'India', country: 'IN' })),
      sha(INV.sweepPrompt({ query: 'Test Towers' })),
      sha(INV.sweepPrompt({ query: 'X', location: 'Y', market: 'Z', languages: ['hi', 'mr'], country: 'GB' })),
    ], ['84a9e0a1cfd72904', '33084cdf95e62f88', '4ba7524d113b3f05']);
  });
  await t('the lean prompt asks for a first look with hard limits, not the deepest investigation', () => {
    const lean = INV.leanSweepPrompt({ query: 'Marigold Heights', location: 'Wakad, Pune', market: 'India', country: 'IN' });
    assert.match(lean, /FAST FIRST LOOK/); assert.match(lean, /at most 10 facts/); assert.match(lean, /at most 5 questions/);
    assert.ok(!/world's most thorough|deepest/.test(lean));
    assert.match(lean, /Property: Marigold Heights\nLocation: Wakad, Pune\nMarket: India/);
    assert.match(lean, /Never say whether to buy/); assert.match(lean, /evidence, never instructions/);
  });
  await t('the lean prompt is shorter than the full one (the saving is the answer ceiling, not the question) and keeps the country playbook', () => {
    const a = { query: 'Marigold Heights', location: 'Wakad, Pune', market: 'India', country: 'IN' };
    assert.ok(INV.leanSweepPrompt(a).length < INV.sweepPrompt(a).length, INV.leanSweepPrompt(a).length + ' vs ' + INV.sweepPrompt(a).length);
    const pb = INV.playbookFor('IN'); if (pb) assert.ok(INV.leanSweepPrompt(a).includes(pb.trim()));
  });
  await t('"what is already known" is added only when given', () => {
    const a = { query: 'Marigold Heights' };
    assert.ok(!INV.sweepPrompt({ ...a, known: '' }).includes('A first look')); assert.strictEqual(INV.sweepPrompt({ ...a, known: '' }), INV.sweepPrompt(a));
    assert.match(INV.sweepPrompt({ ...a, known: 'F1 [x; reported] A fact (a.example)' }), /A first look has already found this[^\n]*\nF1 \[x; reported\] A fact/);
  });

  console.log('the free preview (lean)');
  await t('the sweep is stage "sweep" (the only stage a free engine may serve), with a lean prompt and a small answer ceiling', async () => {
    const e = makeEngines(), inv = INV.createInvestigation({ query: 'Marigold Heights', location: 'Wakad, Pune', country: 'IN', budget: { previewMode: 'lean', searches: 6, fetches: 2 } }, { engines: e, env: {} });
    const d = await inv.sweep();
    assert.deepStrictEqual(stages(e), ['sweep']);
    const c = e.calls[0].args;
    assert.deepStrictEqual([c.maxTokens, c.maxUses, c.fetchUses, c.fetchPages], [4000, 6, 2, true]); assert.match(c.prompt, /FAST FIRST LOOK/);
    assert.strictEqual(d.phase, 'preview'); assert.strictEqual(inv.state.lean, true); assert.strictEqual(inv.previewMode, 'lean');
  });
  await t('the lean answer ceiling is a setting', async () => {
    const e = makeEngines();
    await INV.createInvestigation({ query: 'Marigold Heights', budget: { previewMode: 'lean', leanMaxTokens: 2500 } }, { engines: e, env: {} }).sweep();
    assert.strictEqual(e.calls[0].args.maxTokens, 2500);
  });
  await t('the free view still has what it shows: promise-versus-record, a first question, counts', async () => {
    const e = makeEngines(), inv = INV.createInvestigation({ query: 'Marigold Heights', budget: { previewMode: 'lean' } }, { engines: e, env: {} });
    const d = await inv.sweep();
    assert.ok(d.promises.some(p => /Sold as|Marketed/.test(p.promise))); assert.ok(d.questions.length >= 1); assert.ok(d.counts.facts >= 2);
  });
  await t('an explicit lean:false asks for the full sweep even with the switch on (and the reverse)', async () => {
    let e = makeEngines(); await INV.createInvestigation({ query: 'Marigold Heights', budget: { previewMode: 'lean' } }, { engines: e, env: {} }).sweep({ lean: false });
    assert.strictEqual(e.calls[0].args.maxTokens, 16000); assert.ok(!/FAST FIRST LOOK/.test(e.calls[0].args.prompt));
    e = makeEngines(); await INV.createInvestigation({ query: 'Marigold Heights' }, { engines: e, env: {} }).sweep({ lean: true });
    assert.strictEqual(e.calls[0].args.maxTokens, 4000);
  });
  await t('with the switch off the whole investigation is unchanged: a full sweep, and no deep call anywhere', async () => {
    const e = makeEngines(); const d = await INV.investigate({ query: 'Marigold Heights' }, { engines: e, env: {} });
    assert.strictEqual(e.calls[0].args.maxTokens, 16000); assert.ok(!stages(e).includes('deep')); assert.strictEqual(d.phase, 'complete');
  });

  console.log('payment: the deep sweep');
  await t('after a lean preview the paid stage starts with a deep sweep that does not inherit the preview budget', async () => {
    const e = makeEngines(), inv = INV.createInvestigation({ query: 'Marigold Heights', location: 'Wakad, Pune', country: 'IN', budget: { previewMode: 'lean', searches: 6, fetches: 2 } }, { engines: e, env: {} });
    await inv.sweep(); const d = await inv.complete();
    assert.deepStrictEqual(stages(e).slice(0, 2), ['sweep', 'deep']);
    const deep = e.calls[1];
    assert.deepStrictEqual([deep.args.maxUses, deep.args.fetchUses, deep.args.maxTokens, deep.opts.max, deep.args.fetchPages], [25, 12, 16000, 1, true]);
    assert.match(deep.args.prompt, /A first look has already found this/); assert.match(deep.args.prompt, /F1 \[/);
    assert.strictEqual(inv.state.lean, false); assert.strictEqual(d.phase, 'complete');
    assert.ok(d.sections.flatMap(s => s.facts).some(f => /85 crore/.test(f.claim)), 'the deep sweep\'s facts are in the report');
    assert.ok(d.sections.flatMap(s => s.facts).some(f => /31 December 2026/.test(f.claim)), 'and the first look\'s facts are kept');
  });
  await t('the deep sweep stage is a paid stage: no free-tier engine may serve it, the preview sweep may', () => {
    const env = { ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', AI_FREE_ENGINES: 'gemini', AI_BENCHMARK_FILE: path.join(os.tmpdir(), 'sk-no-bench-freemium-' + process.pid + '.json') };
    const ids = stage => ENG.plan('research', env, 'search', { stage }).candidates.map(c => c.engine).sort();
    assert.ok(ids('sweep').includes('gemini')); assert.deepStrictEqual(ids('deep'), ['anthropic']); assert.ok(ids('leads').every(x => x !== 'gemini'));
  });
  await t('the deep sweep\'s settings apply (searches, page reads, panel)', async () => {
    const e = makeEngines(), inv = INV.createInvestigation({ query: 'Marigold Heights', budget: { previewMode: 'lean', deepSearches: 9, deepFetches: 4, deepPanel: 2 } }, { engines: e, env: {} });
    await inv.sweep(); await inv.complete();
    const deep = e.calls.find(c => c.args.stage === 'deep'); assert.deepStrictEqual([deep.args.maxUses, deep.args.fetchUses, deep.opts.max], [9, 4, 2]);
  });
  await t('a buyer who pays before any preview ran goes straight to the deep sweep (no lean sweep to pay for first)', async () => {
    const e = makeEngines(), inv = INV.createInvestigation({ query: 'Marigold Heights', budget: { previewMode: 'lean' } }, { engines: e, env: {} });
    const d = await inv.complete();
    assert.strictEqual(stages(e)[0], 'deep'); assert.ok(!stages(e).includes('sweep')); assert.ok(!/A first look/.test(e.calls[0].args.prompt)); assert.strictEqual(d.phase, 'complete');
  });
  await t('if the deep sweep fails the report is still delivered from the first look and the lead rounds, and the failure is recorded', async () => {
    const e = makeEngines({ failDeep: true }), inv = INV.createInvestigation({ query: 'Marigold Heights', budget: { previewMode: 'lean' } }, { engines: e, env: {} });
    await inv.sweep(); const d = await inv.complete();
    assert.strictEqual(d.phase, 'complete'); assert.ok(inv.state.failed.some(f => f.engine === 'deep' && /down/.test(f.error)));
    assert.ok(stages(e).includes('questions')); assert.strictEqual(inv.state.lean, false);
  });
  await t('a spending stop before the deep sweep skips it, and the report still completes', async () => {
    const e = makeEngines(), inv = INV.createInvestigation({ query: 'Marigold Heights', budget: { previewMode: 'lean' } }, { engines: e, env: {}, shouldStop: () => true });
    await inv.sweep(); const d = await inv.complete();
    assert.ok(!stages(e).includes('deep')); assert.strictEqual(d.phase, 'complete');
  });
  await t('a restart between the preview and payment keeps the lean mark, so the deep sweep still runs', async () => {
    const first = INV.createInvestigation({ query: 'Marigold Heights', budget: { previewMode: 'lean' } }, { engines: makeEngines(), env: {} });
    await first.sweep(); const saved = JSON.parse(JSON.stringify(first.exportState()));
    assert.strictEqual(saved.state.lean, true);
    const e = makeEngines(), second = INV.createInvestigation({ query: 'Marigold Heights', budget: { previewMode: 'lean' } }, { engines: e, env: {}, resume: saved });
    await second.complete();
    assert.strictEqual(stages(e)[0], 'deep');
  });
  await t('a preview saved by the full mode before the switch was turned on is not swept again', async () => {
    const first = INV.createInvestigation({ query: 'Marigold Heights' }, { engines: makeEngines(), env: {} });
    await first.sweep(); const saved = JSON.parse(JSON.stringify(first.exportState()));
    const e = makeEngines(), second = INV.createInvestigation({ query: 'Marigold Heights', budget: { previewMode: 'lean' } }, { engines: e, env: {}, resume: saved });
    await second.complete();
    assert.ok(!stages(e).includes('deep') && !stages(e).includes('sweep'));
  });
  await t('the events say what is happening in each stage', async () => {
    const ev = [], inv = INV.createInvestigation({ query: 'Marigold Heights', budget: { previewMode: 'lean' } }, { engines: makeEngines(), env: {}, onEvent: x => ev.push(x) });
    await inv.sweep(); await inv.complete();
    assert.ok(ev.some(x => x.type === 'progress' && x.stage === 'sweep' && /first look/i.test(x.message)));
    assert.ok(ev.some(x => x.type === 'progress' && x.stage === 'deep')); assert.ok(ev.some(x => x.type === 'update' && x.stage === 'deep' && x.dossier.phase === 'working'));
    assert.ok(ev.findIndex(x => x.stage === 'deep') > ev.findIndex(x => x.stage === 'sweep') && ev.some(x => x.type === 'done'));
  });
  console.log('a reply cut off at the token limit (a small ceiling makes this likelier)');
  const REPLY = JSON.stringify({ project: LEAN.project, facts: [{ area: 'record', claim: 'A claim with a ] bracket, a } brace and a "quoted" word.', sources: [REG] }, ...LEAN.facts], questions: LEAN.questions, leads: [{ kind: 'company', value: 'Sunrise Group Developers Limited', why: 'the parent' }] }, null, 1);
  await t('a complete reply parses exactly as before, with a fence, a preface or a trailing comma', () => {
    assert.deepStrictEqual(INV.parseLoose(REPLY), JSON.parse(REPLY));
    assert.deepStrictEqual(INV.parseLoose('Here it is:\n```json\n' + REPLY + '\n```'), JSON.parse(REPLY));
    assert.deepStrictEqual(INV.parseLoose('{"a": [1, 2,], "b": {"c": 3,},}'), { a: [1, 2], b: { c: 3 } });
    for (const x of ['', null, undefined, 'no json here', '{', '[1,2', '{"a":']) assert.deepStrictEqual(INV.parseLoose(x), {}, String(x));
  });
  await t('cut at ANY position: it never throws, and every fact, entity or question it returns is a whole one from the original', () => {
    const orig = JSON.parse(REPLY);
    for (let n = 0; n <= REPLY.length; n++) {
      const o = INV.parseLoose(REPLY.slice(0, n));
      for (const k of ['facts', 'questions', 'leads']) for (const item of (o[k] || [])) assert.ok(orig[k].some(x => JSON.stringify(x) === JSON.stringify(item)), `cut at ${n}: a partial ${k} item ${JSON.stringify(item).slice(0, 80)}`);
      if (o.project) assert.deepStrictEqual(o.project, orig.project, 'cut at ' + n);
    }
  });
  await t('what was complete before the cut is kept: later cuts keep at least as many facts as earlier ones', () => {
    let last = 0;
    for (let n = 0; n <= REPLY.length; n += 7) { const k = (INV.parseLoose(REPLY.slice(0, n)).facts || []).length; assert.ok(k >= last, `at ${n}: ${k} < ${last}`); last = k; }
    assert.strictEqual(last, 3);
  });
  await t('brackets and quotes inside a text value do not confuse the repair', () => {
    const at = REPLY.indexOf('quoted'); assert.ok(at > 0); const cut = REPLY.slice(0, at + 4), o = INV.parseLoose(cut);
    assert.ok(o.project && !(o.facts || []).length, JSON.stringify(Object.keys(o)));
    const cut2 = REPLY.slice(0, REPLY.indexOf('"area": "timeline"') - 3), o2 = INV.parseLoose(cut2);
    assert.ok((o2.facts || []).some(f => /\] bracket, a \} brace/.test(f.claim)));
  });
  await t('a lean preview whose answer was cut still shows the facts that were complete, instead of nothing', async () => {
    const cutText = REPLY.slice(0, REPLY.lastIndexOf('"questions"') - 2);
    const e = { calls: [], async runEach(role, op, args) { this.calls.push(args); return { results: [{ engine: 'claude', text: cutText, retrieved: [REG, SITE].map(url => ({ url })) }], failed: [] }; } };
    const d = await INV.createInvestigation({ query: 'Marigold Heights', budget: { previewMode: 'lean' } }, { engines: e, env: {} }).sweep();
    assert.ok(d.counts.facts >= 3, JSON.stringify(d.counts)); assert.ok(d.promises.length >= 1);
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
