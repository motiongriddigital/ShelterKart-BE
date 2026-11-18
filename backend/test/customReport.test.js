'use strict';
/** The custom report pipeline (backend/custom/*): Tavily search + Groq formatting, with mocked HTTP - no real
 * network calls and no real API keys needed to run this file. */
const assert = require('assert');
const tavily = require('../custom/tavilyClient');
const groq = require('../custom/groqClient');
const gemini = require('../custom/geminiClient');
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
const GROQ_REPLY = {
  summary: 'A registered project with a reported delay.',
  highlights: ['RERA registered', 'Possession delayed to 2029'],
  keyFacts: [
    { label: 'Registered entity', value: 'Nayan Real Estate Pvt Ltd', sourceUrl: 'https://maharerait.maharashtra.gov.in/project/celeste' },
    { label: 'Made up fact', value: 'x', sourceUrl: 'https://not-a-real-result.example' },
  ],
  differences: [{
    title: 'Timeline gap', category: 'Timeline',
    sellerClaim: { value: 'Dec 2027', detail: 'Sales pitch', sourceUrl: null },
    officialRecord: { value: 'June 2029', detail: 'RERA filing', sourceUrl: 'https://maharerait.maharashtra.gov.in/project/celeste' },
    impact: 'No delay compensation until the registered date passes.',
  }, {
    title: 'Ungrounded difference', category: 'x',
    sellerClaim: { value: 'x', detail: 'x', sourceUrl: null },
    officialRecord: { value: 'x', detail: 'x', sourceUrl: 'https://not-a-real-result.example' },
    impact: 'x',
  }],
  questions: [
    { category: 'Legal', question: 'Which entity signs the agreement?', whyItMatters: 'Recourse', goodAnswer: 'A tripartite agreement', redFlag: '"Same thing"', priority: 'top' },
    { category: 'Accounts', question: 'What is the registered possession date?', whyItMatters: 'Delay interest', goodAnswer: 'June 2029 stated', redFlag: 'Vague date', priority: 'bogus' },
  ],
  pricing: [
    { label: '1 BHK', size: '330 sq ft', quotedPrice: '1.99 Cr', benchmarkPrice: '1.52 Cr', differenceNote: '+24.5%', sourceUrl: 'https://maharerait.maharashtra.gov.in/project/celeste' },
    { label: 'Ungrounded', size: 'x', quotedPrice: 'x', benchmarkPrice: 'x', differenceNote: 'x', sourceUrl: 'https://not-a-real-result.example' },
  ],
  sources: [
    { name: 'MahaRERA', detail: 'Registration record', status: 'confirmed', url: 'https://maharerait.maharashtra.gov.in/project/celeste' },
    { name: 'Made up', detail: 'x', status: 'confirmed', url: 'https://not-a-real-result.example' },
  ],
};

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

  console.log('geminiClient');
  await t('GEMINI_API_KEY missing is refused before any call', async () => {
    await assert.rejects(() => gemini.format({ system: 's', user: 'u' }, { env: {} }), /GEMINI_API_KEY/);
  });
  await t('a good call parses the JSON content and sends responseMimeType json by default', async () => {
    let sentUrl = null, sentBody = null;
    const fetchImpl = async (url, opts) => { sentUrl = url; sentBody = JSON.parse(opts.body); return okJson({ candidates: [{ content: { parts: [{ text: JSON.stringify({ a: 1 }) }] } }] }); };
    const r = await gemini.format({ system: 's', user: 'u' }, { env: { GEMINI_API_KEY: 'k' }, fetchImpl, sleep: noSleep });
    assert.deepStrictEqual(r, { a: 1 });
    assert.strictEqual(sentBody.generationConfig.responseMimeType, 'application/json');
    assert(sentUrl.includes(gemini.DEFAULT_MODEL)); assert(sentUrl.includes('key=k'));
  });
  await t('GEMINI_MODEL overrides the default', async () => {
    let sentUrl = null;
    const fetchImpl = async (url) => { sentUrl = url; return okJson({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }); };
    await gemini.format({ system: 's', user: 'u' }, { env: { GEMINI_API_KEY: 'k', GEMINI_MODEL: 'other-model' }, fetchImpl, sleep: noSleep });
    assert(sentUrl.includes('other-model'));
  });
  await t('a non-JSON reply is a gemini_bad_json error, not a crash', async () => {
    const fetchImpl = async () => okJson({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] });
    await assert.rejects(() => gemini.format({ system: 's', user: 'u' }, { env: { GEMINI_API_KEY: 'k' }, fetchImpl, sleep: noSleep }), e => e.code === 'gemini_bad_json');
  });
  await t('one retry on 429, then success', async () => {
    let n = 0;
    const fetchImpl = async () => { n++; return n === 1 ? errRes(429) : okJson({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }); };
    await gemini.format({ system: 's', user: 'u' }, { env: { GEMINI_API_KEY: 'k' }, fetchImpl, sleep: noSleep });
    assert.strictEqual(n, 2);
  });

  console.log('customReport: Groq-then-Gemini fallback');
  await t('Groq failing falls back to Gemini and reports formattedBy "gemini"', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('tavily')) return okJson({ results: SEARCH_RESULTS });
      if (url.includes('groq')) return errRes(500, 'groq down');
      return okJson({ candidates: [{ content: { parts: [{ text: JSON.stringify(GROQ_REPLY) }] } }] }); // gemini
    };
    const report = await CUSTOM_REPORT.generate({ query: 'Hubtown Celeste', tier: 'free' }, { env: { TAVILY_API_KEY: 'k', GROQ_API_KEY: 'k', GEMINI_API_KEY: 'k' }, fetchImpl, sleep: noSleep });
    assert.strictEqual(report.formattedBy, 'gemini');
    assert.strictEqual(report.keyFacts.length, 1, 'grounding still applies to the Gemini reply');
  });
  await t('Groq succeeding never calls Gemini, and formattedBy is "groq"', async () => {
    let geminiCalled = false;
    const fetchImpl = async (url) => {
      if (url.includes('tavily')) return okJson({ results: SEARCH_RESULTS });
      if (url.includes('generativelanguage')) { geminiCalled = true; return okJson({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }); }
      return okJson({ choices: [{ message: { content: JSON.stringify(GROQ_REPLY) } }] });
    };
    const report = await CUSTOM_REPORT.generate({ query: 'Hubtown Celeste', tier: 'free' }, { env: { TAVILY_API_KEY: 'k', GROQ_API_KEY: 'k', GEMINI_API_KEY: 'k' }, fetchImpl, sleep: noSleep });
    assert.strictEqual(report.formattedBy, 'groq'); assert.strictEqual(geminiCalled, false);
  });
  await t('both Groq and Gemini failing surfaces the original Groq error code', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('tavily')) return okJson({ results: SEARCH_RESULTS });
      return errRes(500, 'down');
    };
    await assert.rejects(
      () => CUSTOM_REPORT.generate({ query: 'x', tier: 'free' }, { env: { TAVILY_API_KEY: 'k', GROQ_API_KEY: 'k', GEMINI_API_KEY: 'k' }, fetchImpl, sleep: noSleep }),
      e => e.code === 'groq_error' && e.geminiCode === 'gemini_error',
    );
  });
  await t('Groq failing with no GEMINI_API_KEY set still surfaces the Groq error (fallback skipped cheaply)', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('tavily')) return okJson({ results: SEARCH_RESULTS });
      return errRes(500, 'down');
    };
    await assert.rejects(
      () => CUSTOM_REPORT.generate({ query: 'x', tier: 'free' }, { env: { TAVILY_API_KEY: 'k', GROQ_API_KEY: 'k' }, fetchImpl, sleep: noSleep }),
      e => e.code === 'groq_error' && e.geminiCode === 'gemini_unconfigured',
    );
  });

  console.log('customReport: the full pipeline');
  await t('free tier: basic search depth, 5 results, full schema but ungrounded entries dropped', async () => {
    let tavilyBody = null;
    const fetchImpl = async (url, opts) => {
      if (url.includes('tavily')) { tavilyBody = JSON.parse(opts.body); return okJson({ results: SEARCH_RESULTS }); }
      return okJson({ choices: [{ message: { content: JSON.stringify(GROQ_REPLY) } }] });
    };
    const report = await CUSTOM_REPORT.generate({ query: 'Hubtown Celeste', location: 'Mumbai', tier: 'free' }, { env: { TAVILY_API_KEY: 'k', GROQ_API_KEY: 'k' }, fetchImpl, sleep: noSleep });
    assert.strictEqual(tavilyBody.search_depth, 'basic'); assert.strictEqual(tavilyBody.max_results, 5);
    assert.strictEqual(report.tier, 'free'); assert.strictEqual(report.summary, GROQ_REPLY.summary); assert(/^CR-[0-9A-F]{12}$/.test(report.ref));

    assert.strictEqual(report.keyFacts.length, 1, 'the ungrounded keyFact must be dropped');
    assert.strictEqual(report.keyFacts[0].label, 'Registered entity');

    assert.strictEqual(report.differences.length, 1, 'the difference whose officialRecord URL is not a real result must be dropped');
    assert.strictEqual(report.differences[0].sellerClaim.sourceUrl, null);
    assert.strictEqual(report.differences[0].officialRecord.sourceUrl, 'https://maharerait.maharashtra.gov.in/project/celeste');

    assert.strictEqual(report.questions.length, 2, 'questions need no URL grounding');
    assert.strictEqual(report.questions[0].priority, 'top');
    assert.strictEqual(report.questions[1].priority, 'standard', 'an invalid priority value falls back to standard');

    assert.strictEqual(report.pricing.length, 1, 'the ungrounded pricing row must be dropped');
    assert.strictEqual(report.sources.length, 1, 'the made-up source URL must be dropped');
    assert.strictEqual(report.sources[0].url, 'https://maharerait.maharashtra.gov.in/project/celeste');

    assert.deepStrictEqual(report.counts, { sourcesChecked: 2, confirmedFacts: 1, differencesFound: 1, questionsToAsk: 2 });
  });
  await t('paid tier: advanced search depth, 8 results, higher caps', async () => {
    let tavilyBody = null;
    const fetchImpl = async (url, opts) => {
      if (url.includes('tavily')) { tavilyBody = JSON.parse(opts.body); return okJson({ results: SEARCH_RESULTS }); }
      return okJson({ choices: [{ message: { content: JSON.stringify(GROQ_REPLY) } }] });
    };
    const report = await CUSTOM_REPORT.generate({ query: 'Hubtown Celeste', tier: 'paid' }, { env: { TAVILY_API_KEY: 'k', GROQ_API_KEY: 'k' }, fetchImpl, sleep: noSleep });
    assert.strictEqual(tavilyBody.search_depth, 'advanced'); assert.strictEqual(tavilyBody.max_results, 8);
    assert.strictEqual(report.tier, 'paid');
    assert.strictEqual(report.keyFacts.length, 1); assert.strictEqual(report.differences.length, 1);
  });
  await t('an invalid source status falls back to "reported"', async () => {
    const reply = { ...GROQ_REPLY, sources: [{ name: 'News', detail: 'x', status: 'bogus', url: 'https://maharerait.maharashtra.gov.in/project/celeste' }] };
    const fetchImpl = async (url, opts) => {
      if (url.includes('tavily')) return okJson({ results: SEARCH_RESULTS });
      return okJson({ choices: [{ message: { content: JSON.stringify(reply) } }] });
    };
    const report = await CUSTOM_REPORT.generate({ query: 'x', tier: 'free' }, { env: { TAVILY_API_KEY: 'k', GROQ_API_KEY: 'k' }, fetchImpl, sleep: noSleep });
    assert.strictEqual(report.sources[0].status, 'reported');
  });
  await t('a missing query is refused before any network call', async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return okJson({}); };
    await assert.rejects(() => CUSTOM_REPORT.generate({ query: '' }, { env: { TAVILY_API_KEY: 'k', GROQ_API_KEY: 'k' }, fetchImpl }), e => e.code === 'invalid_query');
    assert.strictEqual(called, false);
  });

  console.log('reportHtml');
  const BLANK_REPORT = { query: '', tier: 'free', summary: '', highlights: [], keyFacts: [], differences: [], questions: [], pricing: [], sources: [] };
  await t('every value is escaped, and the disclaimer names Tavily and Groq', async () => {
    const html = renderReportHtml({ ...BLANK_REPORT, query: '<script>x</script>', summary: 'ok & good' });
    assert(!html.includes('<script>x</script>')); assert(html.includes('&lt;script&gt;'));
    assert(/Tavily/.test(html) && /Groq/.test(html));
  });
  await t('a non-http(s) "url" is shown as plain text, never as a link', async () => {
    const html = renderReportHtml({ ...BLANK_REPORT, tier: 'paid', sources: [{ name: 't', detail: 'd', status: 'reported', url: 'javascript:alert(1)' }] });
    assert(!html.includes('<a href="javascript:'));
  });
  await t('differences, questions and pricing render their fields', async () => {
    const html = renderReportHtml({
      ...BLANK_REPORT,
      differences: [{ title: 'Timeline gap', category: 'Timeline', sellerClaim: { value: 'Dec 2027', detail: 'pitch', sourceUrl: null }, officialRecord: { value: 'Jul 2028', detail: 'RERA', sourceUrl: 'https://example.com/r' }, impact: 'No penalty yet' }],
      questions: [{ category: 'Legal', question: 'Who signs?', whyItMatters: 'Recourse', goodAnswer: 'Tripartite', redFlag: 'Vague', priority: 'top' }],
      pricing: [{ label: '1 BHK', size: '330 sq ft', quotedPrice: '1.99 Cr', benchmarkPrice: '1.52 Cr', differenceNote: '+24.5%', sourceUrl: 'https://example.com/r' }],
    });
    assert(html.includes('Timeline gap')); assert(html.includes('Who signs?')); assert(html.includes('1.99 Cr'));
  });

  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
