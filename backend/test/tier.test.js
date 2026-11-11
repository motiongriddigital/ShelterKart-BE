'use strict';
const assert = require('assert'), os = require('os'), path = require('path');
const ENG = require('../engines');
let passed = 0, failed = 0;
async function t(name, fn) { ENG.meter.reset(); try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const KEYS = { ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g', XAI_API_KEY: 'x', DEEPSEEK_API_KEY: 'd' };
const NOBENCH = { AI_BENCHMARK_FILE: path.join(os.tmpdir(), 'sk-no-bench-tier-' + process.pid + '.json') };
const base = extra => ({ ...KEYS, ...NOBENCH, ...extra });
const ids = (role, env, stage, op) => ENG.plan(role, env, op || (role === 'research' ? 'search' : 'complete'), stage ? { stage } : {}).candidates.map(c => c.engine).sort();
const reason = (role, env, stage, id) => (ENG.plan(role, env, 'search', { stage }).excluded.find(x => x.engine === id) || {}).reason;
const recorder = () => { const calls = []; const f = async url => { calls.push(url); throw new Error('no network in this test'); }; f.calls = calls; return f; };

(async () => {
  await t('with no tier settings every stage sees the same engines as before', async () => {
    const env = base({});
    assert.deepStrictEqual(ids('research', env, 'sweep'), ids('research', env, 'leads'));
    assert.deepStrictEqual(ids('research', env, undefined), ids('research', env, 'sweep'));
  });
  await t('an engine on a free key serves the preview sweep and nothing else', async () => {
    const env = base({ AI_FREE_ENGINES: 'gemini' });
    assert.ok(ids('research', env, 'sweep').includes('gemini'));
    for (const stage of ['leads', 'reviewer', 'questions', 'other']) assert.ok(!ids('research', env, stage).includes('gemini'), stage);
    assert.ok(/free/.test(reason('research', env, 'leads', 'gemini')));
  });
  await t('an engine on a free key is never used for the agents that read buyer material (no stage given)', async () => {
    const env = base({ AI_FREE_ENGINES: 'gemini,openai' });
    for (const role of ['adviser', 'documents', 'translate', 'verify']) assert.ok(!ids(role, { ...env, AI_PERSONAL_DATA_ENGINES: 'gemini,openai,anthropic' }, undefined).some(e => ['gemini', 'openai'].includes(e)), role);
  });
  await t('the preview list restricts the sweep and leaves the paid stages alone', async () => {
    const env = base({ AI_PREVIEW_ENGINES: 'gemini' });
    assert.deepStrictEqual(ids('research', env, 'sweep'), ['gemini']);
    assert.deepStrictEqual(ids('research', env, 'leads'), ids('research', base({}), 'leads'));
    assert.ok(/preview/.test(reason('research', env, 'sweep', 'anthropic')));
  });
  await t('the paid list restricts the paid stages and leaves the sweep alone', async () => {
    const env = base({ AI_PAID_ENGINES: 'anthropic,openai' });
    assert.deepStrictEqual(ids('research', env, 'leads'), ['anthropic', 'openai']);
    assert.deepStrictEqual(ids('research', env, 'sweep'), ids('research', base({}), 'sweep'));
  });
  await t('a preview whose engines are not set up fails; it never falls back to a paid engine', async () => {
    const env = base({ AI_PREVIEW_ENGINES: 'gemini', GEMINI_API_KEY: '' });
    const f = recorder();
    await assert.rejects(ENG.run('research', 'search', { prompt: 'x', stage: 'sweep' }, { env, fetchImpl: f }), e => e.code === 'no_engine');
    assert.strictEqual(f.calls.length, 0);
  });
  await t('a paid stage never reaches the free-key engine even when it is the only one keyed', async () => {
    const env = { GEMINI_API_KEY: 'g', AI_FREE_ENGINES: 'gemini', ...NOBENCH };
    const f = recorder();
    await assert.rejects(ENG.run('research', 'search', { prompt: 'x', stage: 'leads' }, { env, fetchImpl: f }), e => e.code === 'no_engine');
    assert.strictEqual(f.calls.length, 0);
  });
  await t('unknown names in the lists are ignored', async () => {
    const env = base({ AI_FREE_ENGINES: 'nonesuch', AI_PREVIEW_ENGINES: 'nonesuch', AI_PAID_ENGINES: 'nonesuch' });
    assert.deepStrictEqual(ids('research', env, 'sweep'), ids('research', base({}), 'sweep'));
    assert.deepStrictEqual(ids('research', env, 'leads'), ids('research', base({}), 'leads'));
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
