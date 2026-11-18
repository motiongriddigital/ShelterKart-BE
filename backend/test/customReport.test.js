'use strict';
/** The custom report pipeline (backend/custom/*): Tavily search + Groq formatting, with mocked HTTP - no real
 * network calls and no real API keys needed to run this file. */
const assert = require('assert');
const tavily = require('../custom/tavilyClient');
const groq = require('../custom/groqClient');
const CUSTOM_REPORT = require('../custom/customReport');
const { renderReportHtml } = require('../custom/reportHtml');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const okJson = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });
const errRes = (status, body = '') => ({ ok: false, status, json: async () => ({}), text: async () => body, headers: { get: () => null } });
const noSleep = async () => {};

const SEARCH_RESULTS = [
  { title: 'Hubtown Celeste - RERA page', url: 'https://maharerait.maharashtra.gov.in/project/celeste', content: 'Registered project, possession June 2029.' },
  { title: 'Hubtown Celeste news', url: 'https://example-news.com/celeste', content: 'Delay reported by buyers.' },
];
const GROQ_REPLY = { summary: 'A registered project with a reported delay.', highlights: ['RERA registered', 'Possession delayed to 2029'],
  sections: [{ heading: 'Legal & Registration', body: 'Registered under RERA.', sourceUrls: ['https://maharerait.maharashtra.gov.in/project/celeste'] }],
  sources: [{ title: 'RERA page', url: 'https://maharerait.maharashtra.gov.in/project/celeste' }, { title: 'Made up', url: 'https://not-a-real-result.example' }] };

(async () => {
  console.log('tavilyClient');
  await t('TAVILY_API_KEY missing is refused before any call', async () => {
    await assert.rejects(() => tavily.search({ query: 'x' }, { env: {} }), /TAVILY_API_KEY/);
  });
  await t('an empty query is refused', async () => {
    await assert.rejects(() => tavily.search({ query: '' }, { env: { TAVILY_API_KEY: 'k' } }), /query/);
  });
  await t('a good call returns trimmed results; max_results is clamped to 10', async () => {
    let sentBody = null;
    const fetchImpl = async (url, opts) => { sentBody = JSON.parse(opts.body); return okJson({ results: SEARCH_RESULTS, answer: 'a' }); };
    const r = await tavily.search({ query: 'Hubtown Celeste', maxResults: 99 }, { env: { TAVILY_API_KEY: 'k' }, fetchImpl, sleep: noSleep });
    assert.strictEqual(r.results.length, 2); assert.strictEqual(r.answer, 'a');
    assert.strictEqual(sentBody.max_results, 10); assert.strictEqual(sentBody.api_key, 'k');
  });
  await t('one retry on 429, then success', async () => {
    let n = 0;
    const fetchImpl = async () => { n++; return n === 1 ? errRes(429) : okJson({ results: [] }); };
    const r = await tavily.search({ query: 'x' }, { env: { TAVILY_API_KEY: 'k' }, fetchImpl, sleep: noSleep });
    assert.strictEqual(n, 2); assert.deepStrictEqual(r.results, []);
  });
  await t('a second failure is not retried again and surfaces the status', async () => {
    const fetchImpl = async () => errRes(500, 'boom');
    await assert.rejects(() => tavily.search({ query: 'x' }, { env: { TAVILY_API_KEY: 'k' }, fetchImpl, sleep: noSleep }), e => e.code === 'tavily_error');
  });

  console.log('groqClient');
  await t('GROQ_API_KEY missing is refused before any call', async () => {
    await assert.rejects(() => groq.format({ system: 's', user: 'u' }, { env: {} }), /GROQ_API_KEY/);
  });
  await t('a good call parses the JSON content and sends json mode by default', async () => {
    let sentBody = null;
    const fetchImpl = async (url, opts) => { sentBody = JSON.parse(opts.body); return okJson({ choices: [{ message: { content: JSON.stringify({ a: 1 }) } }] }); };
    const r = await groq.format({ system: 's', user: 'u' }, { env: { GROQ_API_KEY: 'k' }, fetchImpl, sleep: noSleep });
    assert.deepStrictEqual(r, { a: 1 });
    assert.strictEqual(sentBody.response_format.type, 'json_object'); assert.strictEqual(sentBody.model, groq.DEFAULT_MODEL);
  });
  await t('GROQ_MODEL overrides the default', async () => {
    let sentBody = null;
    const fetchImpl = async (url, opts) => { sentBody = JSON.parse(opts.body); return okJson({ choices: [{ message: { content: '{}' } }] }); };
    await groq.format({ system: 's', user: 'u' }, { env: { GROQ_API_KEY: 'k', GROQ_MODEL: 'other-model' }, fetchImpl, sleep: noSleep });
    assert.strictEqual(sentBody.model, 'other-model');
  });
  await t('a non-JSON reply is a groq_bad_json error, not a crash', async () => {
    const fetchImpl = async () => okJson({ choices: [{ message: { content: 'not json' } }] });
    await assert.rejects(() => groq.format({ system: 's', user: 'u' }, { env: { GROQ_API_KEY: 'k' }, fetchImpl, sleep: noSleep }), e => e.code === 'groq_bad_json');
  });

  console.log('customReport: the full pipeline');
  await t('free tier: basic search depth, 5 results, and sections/sources stay empty even if Groq sent them', async () => {
    let tavilyBody = null;
    const fetchImpl = async (url, opts) => {
      if (url.includes('tavily')) { tavilyBody = JSON.parse(opts.body); return okJson({ results: SEARCH_RESULTS }); }
      return okJson({ choices: [{ message: { content: JSON.stringify(GROQ_REPLY) } }] });
    };
    const report = await CUSTOM_REPORT.generate({ query: 'Hubtown Celeste', location: 'Mumbai', tier: 'free' }, { env: { TAVILY_API_KEY: 'k', GROQ_API_KEY: 'k' }, fetchImpl, sleep: noSleep });
    assert.strictEqual(tavilyBody.search_depth, 'basic'); assert.strictEqual(tavilyBody.max_results, 5);
    assert.strictEqual(report.tier, 'free'); assert.strictEqual(report.sections.length, 0); assert.strictEqual(report.sources.length, 0);
    assert.strictEqual(report.summary, GROQ_REPLY.summary); assert(/^CR-[0-9A-F]{12}$/.test(report.ref));
  });
  await t('paid tier: advanced search depth, 8 results, sections/sources kept only when their URL was in the search results', async () => {
    let tavilyBody = null;
    const fetchImpl = async (url, opts) => {
      if (url.includes('tavily')) { tavilyBody = JSON.parse(opts.body); return okJson({ results: SEARCH_RESULTS }); }
      return okJson({ choices: [{ message: { content: JSON.stringify(GROQ_REPLY) } }] });
    };
    const report = await CUSTOM_REPORT.generate({ query: 'Hubtown Celeste', tier: 'paid' }, { env: { TAVILY_API_KEY: 'k', GROQ_API_KEY: 'k' }, fetchImpl, sleep: noSleep });
    assert.strictEqual(tavilyBody.search_depth, 'advanced'); assert.strictEqual(tavilyBody.max_results, 8);
    assert.strictEqual(report.sections.length, 1); assert.strictEqual(report.sections[0].sourceUrls.length, 1);
    assert.strictEqual(report.sources.length, 1, 'the made-up URL must be dropped'); assert.strictEqual(report.sources[0].url, 'https://maharerait.maharashtra.gov.in/project/celeste');
  });
  await t('a missing query is refused before any network call', async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return okJson({}); };
    await assert.rejects(() => CUSTOM_REPORT.generate({ query: '' }, { env: { TAVILY_API_KEY: 'k', GROQ_API_KEY: 'k' }, fetchImpl }), e => e.code === 'invalid_query');
    assert.strictEqual(called, false);
  });

  console.log('reportHtml');
  await t('every value is escaped, and the disclaimer names Tavily and Groq', async () => {
    const html = renderReportHtml({ query: '<script>x</script>', tier: 'free', summary: 'ok & good', highlights: [], sections: [], sources: [] });
    assert(!html.includes('<script>x</script>')); assert(html.includes('&lt;script&gt;'));
    assert(/Tavily/.test(html) && /Groq/.test(html));
  });
  await t('a non-http(s) "url" is shown as plain text, never as a link', async () => {
    const html = renderReportHtml({ query: 'q', tier: 'paid', summary: 's', highlights: [], sections: [], sources: [{ title: 't', url: 'javascript:alert(1)' }] });
    assert(!html.includes('<a href="javascript:'));
  });

  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
