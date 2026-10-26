// The AI engine layer, vendor-neutral: Anthropic, OpenAI, Gemini, xAI and DeepSeek on equal terms, ranked by cost, gated
// by quality and by the company's personal-data rule. Grounding, the score and translation rules are the same for all.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const ENG = require('../engines'), CAT = require('../engines/catalog');
const { research } = require('../engine/searchLane');
const { ground } = require('../engine/grounding');
let fails = 0; const out = [];
const t = async (label, fn) => { ENG.meter.reset(); try { await fn(); out.push('  ok   ' + label); } catch (e) { fails++; out.push('  FAIL ' + label + '\n       ' + String(e.message).split('\n')[0]); } };
const json = (body, status = 200, headers = {}) => ({ ok: status < 400, status, headers: { get: k => headers[k.toLowerCase()] }, json: async () => body });
const ALL = { ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g', XAI_API_KEY: 'x', DEEPSEEK_API_KEY: 'd' };
const NOBENCH = { AI_BENCHMARK_FILE: path.join(os.tmpdir(), 'sk-no-bench-' + process.pid + '.json') };

const RESEARCH = { project: { name: 'Hubtown Celeste', location: 'Worli, Mumbai', developer: 'Hubtown Ltd', ids: ['P51900008925'] },
  sources: ['https://maharera.maharashtra.gov.in/p51900008925', 'https://never-returned.example/page'],
  findings: [{ id: 'f1', topic: 'registration', claim: 'Registered with MahaRERA as P51900008925.', kind: 'fact', src: [0] },
             { id: 'f2', topic: 'dates', claim: 'Possession promised for 2027.', kind: 'fact', src: [1] }], conflicts: [], gaps: [] };
const anthropicReply = { stop_reason: 'end_turn', content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: [{ url: 'https://maharera.maharashtra.gov.in/p51900008925', title: 'MahaRERA' }] }, { type: 'text', text: JSON.stringify(RESEARCH) }], usage: { input_tokens: 900, output_tokens: 300 } };
const xaiReply = { status: 'completed', output: [{ type: 'web_search_call' }, { type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(RESEARCH) }] }],
  citations: ['https://maharera.maharashtra.gov.in/p51900008925'], usage: { input_tokens: 1200, output_tokens: 400 } };
const REDIRECT = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC123';
const geminiReply = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ ...RESEARCH, sources: [REDIRECT, 'https://never-returned.example/page'] }) }] },
  groundingMetadata: { webSearchQueries: ['hubtown celeste rera', 'hubtown delays', 'hubtown reviews'], groundingChunks: [{ web: { uri: REDIRECT, title: 'maharera.maharashtra.gov.in' } }] } }],
  usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 500, thoughtsTokenCount: 100 } };
function recorder(handler) { const calls = []; const f = async (url, o = {}) => { const body = o.body ? JSON.parse(o.body) : null; calls.push({ url, method: o.method, redirect: o.redirect, headers: o.headers, body }); return handler(url, body, o); }; f.calls = calls; return f; }

(async () => {
  await t('no vendor is preferred by name: with every key set, research is ranked by expected cost, cheapest first', async () => {
    const p = ENG.plan('research', { ...ALL, ...NOBENCH });
    const costs = p.candidates.map(c => c.estUsd);
    assert.deepStrictEqual([...costs].sort((a, b) => a - b), costs, 'ascending cost');
    assert.strictEqual(p.routing, 'cost'); assert(p.candidates.every(c => c.basis === 'catalogue prices'));
    assert.deepStrictEqual(p.candidates.map(c => c.engine).sort(), ['anthropic', 'gemini', 'openai', 'xai'], 'every engine that can search competes');
    assert.deepStrictEqual(p.excluded, [{ engine: 'deepseek', reason: 'cannot search the web' }]);
  });
  await t('the cost estimate follows the catalogue: tokens times the model price plus searches times the search price', async () => {
    const d = CAT.catalog().roleDefaults.research;
    for (const c of ENG.plan('research', { ...ALL, ...NOBENCH }).candidates) {
      const e = CAT.engine(c.engine), m = e.models[c.model];
      assert(Math.abs(c.estUsd - (d.in / 1e6 * m.in + d.out / 1e6 * m.out + d.searches / 1000 * e.searchPer1kUsd)) < 1e-9, c.engine);
    }
  });
  await t('an engine with only an Anthropic key works exactly as before: same request, same default model', async () => {
    const f = recorder(() => json(anthropicReply));
    const r = await ENG.run('research', 'search', { prompt: 'p', maxUses: 8, facet: 'record' }, { env: { ANTHROPIC_API_KEY: 'k', ...NOBENCH }, fetchImpl: f });
    const c = f.calls[0];
    assert.strictEqual(c.url, 'https://api.anthropic.com/v1/messages'); assert.deepStrictEqual(c.body.tools, [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }]);
    assert.strictEqual(c.body.model, 'claude-sonnet-5-5'); assert.deepStrictEqual([r.engine, r.searches, r.retrievedKind], ['anthropic', 1, 'all-results']);
  });
  await t('the company can fix the order instead (AI_ROUTING=order), or restrict which engines are allowed at all', async () => {
    assert.deepStrictEqual(ENG.order('research', { ...ALL, ...NOBENCH, AI_ROUTING: 'order', AI_ENGINES_RESEARCH: 'gemini,anthropic' }), ['gemini', 'anthropic']);
    const p = ENG.plan('adviser', { ...ALL, ...NOBENCH, AI_ENGINES: 'openai,deepseek' });
    assert.deepStrictEqual(p.candidates.map(c => c.engine).sort(), ['deepseek', 'openai']);
  });
  await t('a cheaper model per agent is a setting (ANTHROPIC_MODEL_ADVISER=claude-haiku-5-5), and it lowers that agent\'s estimate', async () => {
    const env = { ANTHROPIC_API_KEY: 'k', ...NOBENCH };
    const sonnet = ENG.plan('adviser', env).candidates[0], haiku = ENG.plan('adviser', { ...env, ANTHROPIC_MODEL_ADVISER: 'claude-haiku-5-5' }).candidates[0];
    assert.deepStrictEqual([sonnet.model, haiku.model], ['claude-sonnet-5-5', 'claude-haiku-5-5']); assert(haiku.estUsd < sonnet.estUsd / 10);
    const f = recorder(() => json({ content: [{ type: 'text', text: '{}' }] }));
    await ENG.run('adviser', 'complete', { prompt: 'p', maxTokens: 10 }, { env: { ...env, ANTHROPIC_MODEL_ADVISER: 'claude-haiku-5-5' }, fetchImpl: f });
    assert.strictEqual(f.calls[0].body.model, 'claude-haiku-5-5');
  });
  await t('personal data: the buyer\'s documents go only to engines the company approved; none are approved by default', async () => {
    const p = ENG.plan('documents', { ...ALL, ...NOBENCH }, 'read', { mediaType: 'application/pdf' });
    assert.strictEqual(p.candidates.length, 0); assert(p.excluded.some(x => x.engine === 'anthropic' && x.reason === 'not approved for personal data'));
    const ok = ENG.plan('documents', { ...ALL, ...NOBENCH, AI_PERSONAL_DATA_ENGINES: 'gemini' }, 'read', { mediaType: 'application/pdf' });
    assert.deepStrictEqual(ok.candidates.map(c => c.engine), ['gemini']);
    const f = recorder(() => json({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }));
    await ENG.run('documents', 'read', { prompt: 'p', data: 'AAAA', mediaType: 'application/pdf', maxTokens: 800 }, { env: { ...ALL, ...NOBENCH, AI_PERSONAL_DATA_ENGINES: 'gemini' }, fetchImpl: f });
    assert.deepStrictEqual(f.calls[0].body.contents[0].parts[0], { inline_data: { mime_type: 'application/pdf', data: 'AAAA' } });
  });
  await t('DeepSeek: the cheapest for text jobs, never research (no API search), never documents (no images, not approved)', async () => {
    const adv = ENG.plan('adviser', { ...ALL, ...NOBENCH });
    assert.strictEqual(adv.candidates[0].engine, 'deepseek', 'cheapest by catalogue price');
    const doc = ENG.plan('documents', { ...ALL, ...NOBENCH, AI_PERSONAL_DATA_ENGINES: 'deepseek' }, 'read', { mediaType: 'image/png' });
    assert(doc.excluded.some(x => x.engine === 'deepseek' && x.reason === 'cannot read this file type'));
    const f = recorder(() => json({ choices: [{ message: { content: '{"ok":1}' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
    const r = await ENG.run('adviser', 'complete', { prompt: 'p', maxTokens: 50 }, { env: { DEEPSEEK_API_KEY: 'd', ...NOBENCH }, fetchImpl: f });
    assert.strictEqual(f.calls[0].url, 'https://api.deepseek.com/chat/completions'); assert.strictEqual(f.calls[0].headers.authorization, 'Bearer d');
    assert.deepStrictEqual([f.calls[0].body.model, r.text, r.usage.input], ['deepseek-v4-flash', '{"ok":1}', 100]);
  });
  await t('Gemini: Google Search grounding, its redirect links resolved to the real page, both forms usable for grounding', async () => {
    const f = recorder((url, body, o) => url === REDIRECT ? json({}, 302, { location: 'https://maharera.maharashtra.gov.in/p51900008925' }) : json(geminiReply));
    const r = await ENG.run('research', 'search', { prompt: 'p', facet: 'record' }, { env: { GEMINI_API_KEY: 'g', ...NOBENCH }, fetchImpl: f });
    assert(f.calls[0].url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent')); assert.strictEqual(f.calls[0].headers['x-goog-api-key'], 'g');
    assert.deepStrictEqual(f.calls[0].body.tools, [{ google_search: {} }]);
    assert.deepStrictEqual([f.calls[1].url, f.calls[1].redirect], [REDIRECT, 'manual'], 'only Google\'s redirect is followed, one hop, by hand');
    assert.deepStrictEqual(r.retrieved, [{ url: 'https://maharera.maharashtra.gov.in/p51900008925', title: 'maharera.maharashtra.gov.in', alias: REDIRECT }]);
    assert.deepStrictEqual([r.searches, r.usage.output, r.retrievedKind], [3, 600, 'all-results']);
    const g = recorder((url) => url === REDIRECT ? json({}, 302, { location: 'https://maharera.maharashtra.gov.in/p51900008925' }) : json(geminiReply));
    const rr = await research('Hubtown Celeste', { env: { GEMINI_API_KEY: 'g', SEARCH_FACETS: 'record', ...NOBENCH }, fetchImpl: g });
    const gr = ground(rr.out, rr.retrieved, 'Hubtown Celeste');
    assert.deepStrictEqual(gr.findings.map(x => x.claim), ['Registered with MahaRERA as P51900008925.']); assert.strictEqual(gr.removed, 1);
  });
  await t('Grok and OpenAI keep their formats: xAI citations and OpenAI sources are the pages grounding checks against', async () => {
    const x = recorder(() => json(xaiReply));
    const rx = await ENG.run('research', 'search', { prompt: 'p', facet: 'voice' }, { env: { XAI_API_KEY: 'x', XAI_X_SEARCH: 'true', ...NOBENCH }, fetchImpl: x });
    assert.strictEqual(x.calls[0].url, 'https://api.x.ai/v1/responses'); assert.deepStrictEqual(x.calls[0].body.tools.map(t => t.type), ['web_search', 'x_search']);
    assert.deepStrictEqual([rx.retrieved.length, rx.searches, x.calls[0].body.model], [1, 2, 'grok-4.3']);
    const o = recorder(() => json({ status: 'completed', output: [{ type: 'web_search_call', action: { sources: [{ url: 'https://a.example/1' }] } }, { type: 'message', content: [{ type: 'output_text', text: '{}' }] }] }));
    const ro = await ENG.run('research', 'search', { prompt: 'p', maxUses: 6, facet: 'record' }, { env: { OPENAI_API_KEY: 'o', ...NOBENCH }, fetchImpl: o });
    assert.deepStrictEqual([o.calls[0].body.include, o.calls[0].body.max_tool_calls, o.calls[0].body.model, ro.retrievedKind], [['web_search_call.action.sources'], 6, 'gpt-5.4-mini', 'all-results']);
  });
  await t('fail-over follows the cost order: the cheapest fails, the next cheapest serves, and the meter records the rescue', async () => {
    const env = { ...ALL, ...NOBENCH }, plan = ENG.plan('research', env).candidates.map(c => c.engine);
    const first = plan[0];
    const f = recorder(url => { const own = { anthropic: 'anthropic.com', openai: 'openai.com', gemini: 'googleapis.com', xai: 'x.ai' }[first];
      if (url.includes(own)) return json({}, 503);
      if (url.includes('googleapis')) return json(geminiReply); if (url.includes('anthropic')) return json(anthropicReply);
      return json(xaiReply); });
    const r = await ENG.run('research', 'search', { prompt: 'p', facet: 'record' }, { env, fetchImpl: f });
    assert.strictEqual(r.engine, plan[1]); assert(r.tried.some(t => t.engine === first && /503/.test(t.error)));
    assert.strictEqual(ENG.meter.snapshot()[plan[1]].rescued, 1);
  });
  await t('the quality gate rules: once results exist, a failed or untested engine is excluded; the cheapest that passed serves', async () => {
    const file = path.join(os.tmpdir(), 'sk-bench-' + process.pid + '.json');
    fs.writeFileSync(file, JSON.stringify({ updatedAt: '2026-10-07', results: { research: {
      xai: { pass: false, model: 'grok-4.3', costPerCallUsd: 0.05 }, gemini: { pass: true, model: 'gemini-3.5-flash', costPerCallUsd: 0.21, qualityIndex: 30 },
      anthropic: { pass: true, model: 'claude-sonnet-5-5', costPerCallUsd: 0.18, qualityIndex: 28 } } } }));
    const p = ENG.plan('research', { ...ALL, AI_BENCHMARK_FILE: file });
    assert.deepStrictEqual(p.candidates.map(c => [c.engine, c.basis]), [['anthropic', 'quality gate'], ['gemini', 'quality gate']], 'cheapest passing first, measured gate costs');
    assert(p.excluded.some(x => x.engine === 'xai' && x.reason === 'failed the quality gate') && p.excluded.some(x => x.engine === 'openai' && x.reason === 'not yet through the quality gate'));
    assert.strictEqual(ENG.plan('research', { ...ALL, AI_BENCHMARK_FILE: file, AI_REQUIRE_BENCHMARK: 'false' }).candidates.length, 4);
    fs.unlinkSync(file);
  });
  await t('after five calls, costs measured on this server replace the estimates, so a costly engine drops down the order', async () => {
    const env = { XAI_API_KEY: 'x', OPENAI_API_KEY: 'o', ...NOBENCH };
    const heavy = { ...xaiReply, usage: { input_tokens: 400000, output_tokens: 60000 } };
    for (let i = 0; i < 5; i++) await ENG.run('research', 'search', { prompt: 'p', facet: 'record' }, { env: { XAI_API_KEY: 'x', ...NOBENCH }, fetchImpl: recorder(() => json(heavy)) });
    const p = ENG.plan('research', env);
    assert.deepStrictEqual(p.candidates.map(c => [c.engine, c.basis]), [['openai', 'catalogue prices'], ['xai', 'measured on this server']]);
  });
  await t('the meter prices each call from the model actually used, and says when a price is unknown', async () => {
    await ENG.run('research', 'search', { prompt: 'p', facet: 'record' }, { env: { XAI_API_KEY: 'x', ...NOBENCH }, fetchImpl: recorder(() => json(xaiReply)) });
    const m = ENG.meter.snapshot().xai;
    assert.strictEqual(m.estimatedCostUsd, 0.0125, '1,200 in and 400 out on grok-4.3, plus 2 searches at $5 per 1,000');
    await ENG.run('adviser', 'complete', { prompt: 'p', maxTokens: 10 }, { env: { XAI_API_KEY: 'x', XAI_MODEL: 'grok-unpriced', ...NOBENCH }, fetchImpl: recorder(() => json({ status: 'completed', output: [] })) });
    assert.strictEqual(ENG.meter.snapshot().xai.costComplete, false);
  });
  await t('the record counted (the ledger) is built from the report alone: no network call and no engine layer', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'engine', 'dossierHtml.js'), 'utf8');
    assert(!/require\(['"][^'"]*engines['"]\)|fetch\(|https?:\/\/api\./.test(src));
  });
  await t('the dashboard status: the plan per agent with costs and exclusions, each engine\'s jurisdiction, never a key', async () => {
    const s = ENG.status({ ...ALL, ANTHROPIC_API_KEY: 'sk-ant-secret', DEEPSEEK_API_KEY: 'deepseek-secret', ...NOBENCH });
    assert(!/secret/.test(JSON.stringify(s)));
    assert.strictEqual(s.engines.deepseek.jurisdiction, "People's Republic of China"); assert.strictEqual(s.engines.anthropic.priceVerified, true);
    assert(s.roles.documents.excluded.length === 5 && s.roles.research.candidates.length === 4);
  });
  await t('the quality gate judges facts, not resemblance: the official ID and developer pass; a missing ID fails; fewer findings alone does not', async () => {
    const { compare } = require('../../tools/engine_benchmark');
    const base = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'samples', 'hubtown.json'), 'utf8'));
    assert.strictEqual(compare(base, base).pass, true);
    const shorter = { ...base, findings: base.findings.slice(0, 4), removed: 1 };
    assert.strictEqual(compare(base, shorter).pass, true, 'a shorter report with the right facts is not failed for being different');
    const noId = { ...base, project: { ...base.project, ids: [] } };
    assert(compare(base, noId).fails.some(x => /registration number P51900008925/.test(x)));
    const wrongDev = { ...base, project: { ...base.project, developer: 'Some Other Builders Ltd' } };
    assert(compare(base, wrongDev).fails.some(x => /developer Hubtown Limited/.test(x)));
  });

  console.log(out.join('\n')); console.log(fails ? `\n${fails} FAILED` : '\nall passing'); process.exitCode = fails ? 1 : 0;
})();
