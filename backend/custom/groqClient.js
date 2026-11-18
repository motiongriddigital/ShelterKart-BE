'use strict';
/**
 * Formats search results into a report with Groq (groq.com), free tier - an OpenAI-compatible chat endpoint.
 * One request, one retry on a network error, 429 or 5xx (the free tier's per-minute limit is the most likely 429).
 */
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const RETRY_STATUS = new Set([429, 500, 502, 503]);
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

const defaultSleep = ms => new Promise(r => setTimeout(r, ms));
const waitMs = res => {
  const asked = Number(res && res.headers && res.headers.get && res.headers.get('retry-after'));
  return Number.isFinite(asked) && asked > 0 ? Math.min(asked, 20) * 1000 : 2000;
};

/**
 * system/user: the two prompt halves (see reportPrompts.js). Asks Groq for a JSON object back (json=true, the
 * default) and parses it; a reply that is not valid JSON is a groq_bad_json error rather than a silent empty report.
 */
async function format({ system, user, json = true, model, maxTokens = 2000 }, { env = process.env, fetchImpl = fetch, sleep = defaultSleep } = {}) {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) throw Object.assign(new Error('GROQ_API_KEY is not set'), { code: 'groq_unconfigured' });

  const body = JSON.stringify({
    model: model || env.GROQ_MODEL || DEFAULT_MODEL,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.2,
    max_tokens: maxTokens,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
  });

  let res;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetchImpl(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body });
    } catch (e) {
      if (attempt === 0) { await sleep(2000); continue; }
      throw Object.assign(new Error('Groq could not be reached: ' + e.message), { code: 'groq_unreachable' });
    }
    if (attempt === 0 && RETRY_STATUS.has(res.status)) { await sleep(waitMs(res)); continue; }
    break;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`Groq answered ${res.status}: ${text.slice(0, 200)}`), { code: 'groq_error', status: res.status });
  }
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw Object.assign(new Error('Groq returned no content'), { code: 'groq_empty' });
  if (!json) return content;
  try { return JSON.parse(content); }
  catch { throw Object.assign(new Error('Groq did not return valid JSON'), { code: 'groq_bad_json' }); }
}

module.exports = { format, DEFAULT_MODEL };
