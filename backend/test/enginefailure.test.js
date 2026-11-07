'use strict';
/* What the AI engine does when a call fails, and whether a failure wastes tokens. The real Claude adapter, router, meter and
   job cost tracker run against a fake network. No keys, no real spend. */
const assert = require('assert');
const anthropic = require('../engines/anthropic');
const engines = require('../engines');
const INV = require('../engine/investigator');
const { costedEngines, addStageCost, stageTotals } = require('../engine/jobCosts');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } }

const env = { ANTHROPIC_API_KEY: 'k', ANTHROPIC_RETRY_WAIT_MS: '0' };
const reply = (data, status = 200, headers = {}) => ({ ok: status < 300, status, headers: { get: k => headers[k.toLowerCase()] ?? null }, json: async () => data });
const pause = (input = 10000, output = 500) => reply({ stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: [{ url: 'https://a.example/x', title: 'A' }] }], usage: { input_tokens: input, output_tokens: output } });
const done = (text = '{"ok":true}', input = 12000, output = 800) => reply({ stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: input, output_tokens: output } });
const script = steps => { const calls = []; let i = 0; const f = async (url, o) => { calls.push(JSON.parse(o.body)); const s = steps[Math.min(i++, steps.length - 1)]; return typeof s === 'function' ? s() : s; }; f.calls = calls; return f; };

(async () => {
  console.log('a call that fails before anything is billed');
  await t('a first-round error is one call, no spend, and says so', async () => {
    const f = script([reply({}, 400)]);
    let err; try { await anthropic.search({ prompt: 'p', maxUses: 5 }, { env, fetchImpl: f }); } catch (e) { err = e; }
    assert(err); assert.strictEqual(f.calls.length, 1, 'a client error is not retried');
    assert.deepStrictEqual(err.usage || { input: 0, output: 0 }, { input: 0, output: 0 });
  });

  console.log('a call that fails after earlier rounds were billed');
  await t('the spend of the rounds that did finish is carried on the error, not lost', async () => {
    const f = script([pause(10000, 500), pause(20000, 600), reply({}, 400)]);
    let err; try { await anthropic.search({ prompt: 'p', maxUses: 5, rounds: 12 }, { env, fetchImpl: f }); } catch (e) { err = e; }
    assert(err, 'it should fail'); assert(err.usage, 'no usage on the error: 30,000 billed tokens would be invisible to the cost cap');
    assert.deepStrictEqual(err.usage, { input: 30000, output: 1100 }); assert.strictEqual(err.searches, 2);
  });
  await t('a panel member that failed halfway is still priced into the job’s stage costs', async () => {
    const f = script([pause(10000, 500), reply({}, 400)]);
    const stages = {}, wrapped = costedEngines(engines, (usd, info) => addStageCost(stages, usd, info));
    let res; try { res = await wrapped.runEach('research', 'search', { prompt: 'p', maxUses: 5, rounds: 12, stage: 'leads' }, { env, fetchImpl: f, max: 1 }); } catch (e) { res = { thrown: e }; }
    const total = stageTotals(stages);
    assert(total.length && total[0].stage === 'leads' && total[0].usd > 0, 'the wasted spend never reached the report: ' + JSON.stringify(total));
  });

  console.log('a transient error');
  await t('one retry on 429, 5xx and 529, and a retry that works costs nothing extra', async () => {
    for (const status of [429, 500, 502, 503, 529]) {
      const f = script([reply({}, status), done()]);
      const r = await anthropic.search({ prompt: 'p', maxUses: 5 }, { env, fetchImpl: f });
      assert.strictEqual(f.calls.length, 2, 'status ' + status); assert.strictEqual(r.text, '{"ok":true}');
    }
  });
  await t('a retry in the middle of a lead saves the rounds already paid for', async () => {
    const f = script([pause(10000, 500), pause(20000, 600), reply({}, 503), done('{"ok":1}', 30000, 900)]);
    const r = await anthropic.search({ prompt: 'p', maxUses: 5, rounds: 12 }, { env, fetchImpl: f });
    assert.strictEqual(r.text, '{"ok":1}'); assert.deepStrictEqual(r.usage, { input: 60000, output: 2000 }); assert.strictEqual(r.searches, 2);
  });
  await t('only one retry: two errors in a row fail, and a client error is never retried', async () => {
    const f = script([reply({}, 500), reply({}, 500), done()]);
    await assert.rejects(() => anthropic.search({ prompt: 'p' }, { env, fetchImpl: f })); assert.strictEqual(f.calls.length, 2);
    const g = script([reply({}, 401), done()]);
    await assert.rejects(() => anthropic.search({ prompt: 'p' }, { env, fetchImpl: g })); assert.strictEqual(g.calls.length, 1);
  });
  await t('a network error is retried once too', async () => {
    const f = script([() => { throw new Error('socket hang up'); }, done()]);
    const r = await anthropic.search({ prompt: 'p' }, { env, fetchImpl: f }); assert.strictEqual(r.text, '{"ok":true}'); assert.strictEqual(f.calls.length, 2);
  });
  await t('the wait honours Retry-After but never more than five seconds', async () => {
    const waits = []; const f = script([reply({}, 429, { 'retry-after': '30' }), done()]);
    await anthropic.search({ prompt: 'p' }, { env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: f, sleep: ms => { waits.push(ms); return Promise.resolve(); } });
    assert.deepStrictEqual(waits, [5000]);
  });

  console.log('a reply cut off by the token limit');
  await t('the adapter reports it, so the caller can see it was cut', async () => {
    const f = script([reply({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"facts":[{"claim":"cut' }], usage: { input_tokens: 9000, output_tokens: 16000 } })]);
    const r = await anthropic.search({ prompt: 'p', maxTokens: 16000 }, { env, fetchImpl: f });
    assert.strictEqual(r.stop, 'max_tokens'); assert.strictEqual(r.usage.output, 16000);
  });

  console.log('an outage while following leads');
  await t('when every lead call fails, the investigation makes one round of attempts and stops', async () => {
    let research = 0;
    const eng = { async runEach(role, op, args) {
      if (role !== 'research') return { results: [], failed: [] };
      if (!/Lead: /.test(args.prompt)) return { results: [{ engine: 'claude', text: JSON.stringify({ project: { name: 'T' }, facts: [{ area: 'legal', claim: 'A case is reported.', value: 'v', sources: ['https://x.example/a'] }],
        leads: Array.from({ length: 10 }, (_, i) => ({ kind: 'company', value: 'Company ' + i + ' Pvt Ltd', why: 'w' })) }), retrieved: [] }], failed: [] };
      research++; throw Object.assign(new Error('every engine on the panel failed'), { code: 'panel_failed' });
    } };
    await INV.investigate({ query: 'Test Towers' }, { engines: eng, env: {} });
    assert(research <= 6, 'made ' + research + ' failing lead calls'); assert(research >= 1);
  });

  console.log(`\n${failed ? failed + ' FAILED, ' : 'all passing, '}${passed} passed`);
  process.exit(failed ? 1 : 0);
})();
