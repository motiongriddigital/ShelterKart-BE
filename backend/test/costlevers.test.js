'use strict';
/* Premium engine cost levers (SHEL-60): every AI call carries a stage name, the per-stage cost adds up on the job,
   and the lead budget can be tuned from settings without changing today's defaults. No network. */
const assert = require('assert');
const INV = require('../engine/investigator');
const { costedEngines, stageTotals, addStageCost } = require('../engine/jobCosts');
const anthropic = require('../engines/anthropic');

let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } }

const SRC = 'https://example.org/record';
const SWEEP = { project: { name: 'Test Towers' }, facts: [
  { area: 'legal', claim: 'Case M.A.S. No. 5714 of 2015 is reported against the project and complaint CC006000000123 is open.', value: 'case', sources: [SRC] }],
  leads: [{ kind: 'company-id', value: 'U70102MH2010PTC205728', why: 'the selling company' }, { kind: 'company', value: 'Alpha Builders Private Limited', why: 'the selling company' }] };

function makeEngines() {
  const calls = [];
  return {
    calls,
    async runEach(role, op, args, opts) {
      calls.push({ role, op, args, opts });
      if (role === 'research') {
        const lead = (args.prompt.match(/Lead: [a-z-]+: (.+)/) || [])[1];
        return { results: [{ engine: 'claude', text: lead ? '{}' : JSON.stringify(SWEEP), retrieved: [] }], failed: [] };
      }
      return { results: [{ engine: 'claude', text: JSON.stringify({ questions: [{ question: 'Who signs?', to: 'legal', when: 'before booking' }], leads: [], challenges: [] }) }], failed: [] };
    },
  };
}
const leadCalls = e => e.calls.filter(c => c.role === 'research' && /Lead: /.test(c.args.prompt));

(async () => {
  console.log('the defaults');
  await t('today\'s budget is unchanged', () => {
    assert.deepStrictEqual(INV.DEFAULT_BUDGET, { rounds: 4, leadsPerRound: 6, searches: 25, fetches: 12, leadSearches: 10, leadFetches: 6, maxTokens: 16000, minutes: 15, panel: 0, leadPanel: 2,
      pauseRounds: 12, criticMaxTokens: 8000, questionMaxTokens: 12000, criticPanel: 2, questionPanel: 2, leadMaxTokens: 0, fetchMaxTokens: 0, rankLeads: false, leadLimit: 0 });
  });
  await t('no settings means no change', () => { assert.deepStrictEqual(INV.budgetFromEnv({}), {}); });

  console.log('the settings');
  await t('each setting maps to one budget key', () => {
    const b = INV.budgetFromEnv({ INVESTIGATE_LEAD_PANEL: '1', INVESTIGATE_LEAD_SEARCHES: '5', INVESTIGATE_LEAD_FETCHES: '3', INVESTIGATE_LEAD_ROUNDS: '2', INVESTIGATE_LEADS_PER_ROUND: '4',
      INVESTIGATE_PAUSE_ROUNDS: '5', INVESTIGATE_LEAD_MAX_TOKENS: '6000', INVESTIGATE_CRITIC_MAX_TOKENS: '4000', INVESTIGATE_QUESTION_MAX_TOKENS: '8000', INVESTIGATE_CRITIC_PANEL: '1',
      INVESTIGATE_QUESTION_PANEL: '1', INVESTIGATE_FETCH_MAX_TOKENS: '9000', INVESTIGATE_RANK_LEADS: 'on', INVESTIGATE_LEAD_LIMIT: '8' });
    assert.deepStrictEqual(b, { leadPanel: 1, leadSearches: 5, leadFetches: 3, rounds: 2, leadsPerRound: 4, pauseRounds: 5, leadMaxTokens: 6000, criticMaxTokens: 4000, questionMaxTokens: 8000,
      criticPanel: 1, questionPanel: 1, fetchMaxTokens: 9000, rankLeads: true, leadLimit: 8 });
  });
  await t('a bad value is ignored, never turned into zero or NaN', () => {
    assert.deepStrictEqual(INV.budgetFromEnv({ INVESTIGATE_LEAD_PANEL: 'abc', INVESTIGATE_LEAD_SEARCHES: '-3', INVESTIGATE_PAUSE_ROUNDS: '0', INVESTIGATE_RANK_LEADS: 'maybe', INVESTIGATE_LEAD_FETCHES: '' }), {});
  });
  await t('values are clamped to safe ranges', () => {
    const b = INV.budgetFromEnv({ INVESTIGATE_LEAD_PANEL: '9', INVESTIGATE_LEAD_SEARCHES: '999', INVESTIGATE_PAUSE_ROUNDS: '99', INVESTIGATE_LEAD_ROUNDS: '50' });
    assert.deepStrictEqual(b, { leadPanel: 3, leadSearches: 25, pauseRounds: 12, rounds: 8 });
  });

  console.log('stages');
  await t('every call carries its stage', async () => {
    const e = makeEngines();
    await INV.investigate({ query: 'Test Towers' }, { engines: e, env: {} });
    const seen = [...new Set(e.calls.map(c => c.args.stage))];
    for (const s of ['sweep', 'leads', 'reviewer', 'questions']) assert(seen.includes(s), s + ' missing from ' + seen.join(','));
    assert(!seen.includes(undefined));
  });
  await t('the reviewer\'s own lead round is its own stage', async () => {
    const e = makeEngines();
    const orig = e.runEach;
    e.runEach = async (role, op, args, opts) => {
      const r = await orig(role, op, args, opts);
      if (role === 'verify' && args.stage === 'reviewer') r.results[0].text = JSON.stringify({ leads: [{ kind: 'company', value: 'Zeta Holdings Private Limited', why: 'x' }], questions: [], challenges: [] });
      return r;
    };
    await INV.investigate({ query: 'Test Towers' }, { engines: e, env: {} });
    assert(e.calls.some(c => c.args.stage === 'reviewer-leads'));
  });

  console.log('the levers');
  await t('lead panel, search, fetch, token and pause limits reach the lead calls', async () => {
    const e = makeEngines();
    await INV.investigate({ query: 'Test Towers', budget: { leadPanel: 1, leadSearches: 5, leadFetches: 3, leadMaxTokens: 6000, pauseRounds: 5, fetchMaxTokens: 9000 } }, { engines: e, env: {} });
    const lc = leadCalls(e); assert(lc.length >= 1);
    for (const c of lc) { assert.strictEqual(c.opts.max, 1); assert.strictEqual(c.args.maxUses, 5); assert.strictEqual(c.args.fetchUses, 3); assert.strictEqual(c.args.maxTokens, 6000); assert.strictEqual(c.args.rounds, 5); assert.strictEqual(c.args.maxContentTokens, 9000); }
  });
  await t('the sweep keeps the general token limit when the lead limit is set', async () => {
    const e = makeEngines();
    await INV.investigate({ query: 'Test Towers', budget: { leadMaxTokens: 6000 } }, { engines: e, env: {} });
    assert.strictEqual(e.calls.find(c => c.args.stage === 'sweep').args.maxTokens, 16000);
  });
  await t('reviewer and question writer limits apply', async () => {
    const e = makeEngines();
    await INV.investigate({ query: 'Test Towers', budget: { criticMaxTokens: 4000, questionMaxTokens: 8000, criticPanel: 1, questionPanel: 1 } }, { engines: e, env: {} });
    const r = e.calls.find(c => c.args.stage === 'reviewer'), q = e.calls.find(c => c.args.stage === 'questions');
    assert.deepStrictEqual([r.args.maxTokens, r.opts.max, q.args.maxTokens, q.opts.max], [4000, 1, 8000, 1]);
  });
  await t('by default nothing sent to the engines changes except the stage name', async () => {
    const e = makeEngines();
    await INV.investigate({ query: 'Test Towers' }, { engines: e, env: {} });
    const lc = leadCalls(e)[0];
    assert.deepStrictEqual([lc.opts.max, lc.args.maxUses, lc.args.fetchUses, lc.args.maxTokens, lc.args.rounds, 'maxContentTokens' in lc.args], [2, 10, 6, 16000, 12, false]);
    assert.strictEqual(e.calls.find(c => c.args.stage === 'reviewer').args.maxTokens, 8000);
    assert.strictEqual(e.calls.find(c => c.args.stage === 'questions').args.maxTokens, 12000);
  });
  await t('with ranking on, identity leads are followed before cases and complaints', async () => {
    const e = makeEngines();
    await INV.investigate({ query: 'Test Towers', budget: { rankLeads: true, leadsPerRound: 2, rounds: 1 } }, { engines: e, env: {} });
    const order = leadCalls(e).filter(c => c.args.stage === 'leads').map(c => (c.args.prompt.match(/Lead: ([a-z-]+):/) || [])[1]);
    assert.deepStrictEqual(order, ['company-id', 'company']);
  });
  await t('with ranking off, the order is the order the leads were found', async () => {
    const e = makeEngines();
    await INV.investigate({ query: 'Test Towers', budget: { leadsPerRound: 2, rounds: 1 } }, { engines: e, env: {} });
    const order = leadCalls(e).filter(c => c.args.stage === 'leads').map(c => (c.args.prompt.match(/Lead: ([a-z-]+):/) || [])[1]);
    assert(order.includes('case'), order.join(','));
  });
  await t('the total lead limit stops following leads once it is reached', async () => {
    const e = makeEngines();
    await INV.investigate({ query: 'Test Towers', budget: { leadLimit: 2 } }, { engines: e, env: {} });
    assert.strictEqual(leadCalls(e).length, 2);
  });
  await t('a lead limit of zero means no limit', async () => {
    const e = makeEngines();
    await INV.investigate({ query: 'Test Towers' }, { engines: e, env: {} });
    assert(leadCalls(e).length >= 4);
  });

  console.log('the fetch tool');
  await t('max_content_tokens is sent on the fetch tool only when set', async () => {
    const bodies = [];
    const fetchImpl = async (url, o) => { bodies.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), text: async () => '' }; };
    const env = { ANTHROPIC_API_KEY: 'test-key' };
    await anthropic.search({ prompt: 'p', maxUses: 3, fetchPages: true, fetchUses: 2, maxContentTokens: 9000 }, { env, fetchImpl });
    await anthropic.search({ prompt: 'p', maxUses: 3, fetchPages: true, fetchUses: 2 }, { env, fetchImpl });
    const fetchTool = b => b.tools.find(x => x.name === 'web_fetch');
    assert.strictEqual(fetchTool(bodies[0]).max_content_tokens, 9000);
    assert(!('max_content_tokens' in fetchTool(bodies[1])));
  });

  console.log('cost per stage');
  await t('a priced result is reported with its stage, tokens and searches', async () => {
    const seen = [];
    const E = { runEach: async () => ({ results: [{ engine: 'anthropic', model: 'claude-sonnet-5-5', usage: { input: 100000, output: 5000 }, searches: 6 }], failed: [] }) };
    await costedEngines(E, (usd, info) => seen.push({ usd, info })).runEach('research', 'search', { stage: 'leads' });
    assert.strictEqual(seen.length, 1); assert(seen[0].usd > 0);
    assert.deepStrictEqual(seen[0].info, { stage: 'leads', engine: 'anthropic', input: 100000, output: 5000, searches: 6 });
  });
  await t('a call with no stage is counted as other', async () => {
    const seen = [];
    const E = { run: async () => ({ engine: 'anthropic', model: 'claude-sonnet-5-5', usage: { input: 10, output: 10 }, searches: 0 }) };
    await costedEngines(E, (usd, info) => seen.push(info)).run('complete', 'complete', {});
    assert.strictEqual(seen[0].stage, 'other');
  });
  await t('stage totals add calls, tokens, searches and dollars', () => {
    const s = {};
    addStageCost(s, 0.5, { stage: 'leads', input: 1000, output: 200, searches: 10 });
    addStageCost(s, 0.25, { stage: 'leads', input: 500, output: 100, searches: 10 });
    addStageCost(s, 0.1, { stage: 'questions', input: 50, output: 60, searches: 0 });
    assert.deepStrictEqual(s.leads, { usd: 0.75, calls: 2, input: 1500, output: 300, searches: 20 });
    assert.deepStrictEqual(s.questions, { usd: 0.1, calls: 1, input: 50, output: 60, searches: 0 });
  });
  await t('stage totals are rounded and sorted by cost, and survive junk', () => {
    const s = { a: { usd: 0.1 + 0.2, calls: 1, input: 1, output: 1, searches: 0 }, b: { usd: 1.23456789, calls: 1, input: 1, output: 1, searches: 0 }, junk: null };
    const out = stageTotals(s);
    assert.deepStrictEqual(out.map(x => x.stage), ['b', 'a']);
    assert.strictEqual(out[0].usd, 1.2346); assert.strictEqual(out[1].usd, 0.3);
    assert.deepStrictEqual(stageTotals(undefined), []);
    addStageCost(s, NaN, { stage: 'a' }); addStageCost(s, -1, { stage: 'a' }); addStageCost(s, 0, { stage: 'a' });
    assert.strictEqual(s.a.calls, 1);
  });

  console.log('\n' + (failed ? failed + ' FAILED' : 'all ' + passed + ' passing'));
  if (failed) process.exitCode = 1;
})();
