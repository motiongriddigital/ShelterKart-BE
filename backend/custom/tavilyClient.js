'use strict';
/**
 * Internet search via Tavily (tavily.com), free tier. One request, one retry on a network error, 429 or 5xx -
 * a failed call was not billed against the free quota, so the retry costs nothing extra.
 */
const ENDPOINT = 'https://api.tavily.com/search';
const RETRY_STATUS = new Set([429, 500, 502, 503]);

const defaultSleep = ms => new Promise(r => setTimeout(r, ms));
const waitMs = res => {
  const asked = Number(res && res.headers && res.headers.get && res.headers.get('retry-after'));
  return Number.isFinite(asked) && asked > 0 ? Math.min(asked, 20) * 1000 : 1500;
};

/**
 * query: the search text. searchDepth: 'basic' (1 credit) or 'advanced' (2 credits) - free-tier accounts have a
 * monthly credit cap, so basic is the default and advanced is reserved for the paid report tier.
 * Returns { answer, results: [{ title, url, content }] }, results capped to maxResults.
 */
async function search({ query, searchDepth = 'basic', maxResults = 5, includeAnswer = false }, { env = process.env, fetchImpl = fetch, sleep = defaultSleep } = {}) {
  const apiKey = env.TAVILY_API_KEY;
  if (!apiKey) throw Object.assign(new Error('TAVILY_API_KEY is not set'), { code: 'tavily_unconfigured' });
  if (!query || typeof query !== 'string' || !query.trim()) throw Object.assign(new Error('a search query is required'), { code: 'invalid_query' });

  const body = JSON.stringify({ api_key: apiKey, query: query.trim(), search_depth: searchDepth, max_results: Math.max(1, Math.min(10, maxResults)), include_answer: includeAnswer });
  let res;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetchImpl(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    } catch (e) {
      if (attempt === 0) { await sleep(1500); continue; }
      throw Object.assign(new Error('Tavily could not be reached: ' + e.message), { code: 'tavily_unreachable' });
    }
    if (attempt === 0 && RETRY_STATUS.has(res.status)) { await sleep(waitMs(res)); continue; }
    break;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`Tavily answered ${res.status}: ${text.slice(0, 200)}`), { code: 'tavily_error', status: res.status });
  }
  const data = await res.json();
  const results = Array.isArray(data.results) ? data.results.map(r => ({ title: String(r.title || '').slice(0, 300), url: String(r.url || ''), content: String(r.content || '').slice(0, 2000) })).filter(r => r.url) : [];
  return { answer: data.answer || null, results };
}

module.exports = { search };
