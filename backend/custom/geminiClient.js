'use strict';
/**
 * Formats search results into a report with Gemini (Google AI), used as the fallback when Groq fails - same
 * format({system, user, json, maxTokens}) interface as groqClient.js so customReport.js can swap one for the other.
 * One request, one retry on a network error, 429 or 5xx.
 */
const ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const RETRY_STATUS = new Set([429, 500, 502, 503]);
// gemini-2.5-pro/gemini-3.1-pro-preview need a billed Cloud project (a Gemini app "Pro" subscription doesn't grant
// API quota) - this flash-lite model is free-tier and stable (non-preview). Override with GEMINI_MODEL once billing
// is set up, and check https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY for what your key can use.
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';

const defaultSleep = ms => new Promise(r => setTimeout(r, ms));
const waitMs = res => {
  const asked = Number(res && res.headers && res.headers.get && res.headers.get('retry-after'));
  return Number.isFinite(asked) && asked > 0 ? Math.min(asked, 20) * 1000 : 2000;
};

/**
 * system/user: the two prompt halves (see reportPrompts.js) - identical to what groqClient.js receives, so the
 * fallback sees exactly the same instructions and search results Groq did. Asks for a JSON reply (json=true, the
 * default) and parses it; a reply that is not valid JSON is a gemini_bad_json error rather than a silent empty report.
 */
async function format({ system, user, json = true, model, maxTokens = 2000 }, { env = process.env, fetchImpl = fetch, sleep = defaultSleep } = {}) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw Object.assign(new Error('GEMINI_API_KEY is not set'), { code: 'gemini_unconfigured' });

  const useModel = model || env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `${ENDPOINT_BASE}/${encodeURIComponent(useModel)}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    // thinkingBudget: 0 - this is formatting/compression of search results already handed to it, not a reasoning
    // task, and 2.5+/3.x models otherwise spend part of maxOutputTokens on hidden "thinking" tokens before replying
    // (observed live: a small maxOutputTokens can be fully consumed by thinking, leaving no room for the answer).
    generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 }, ...(json ? { responseMimeType: 'application/json' } : {}) },
  });

  let res;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    } catch (e) {
      if (attempt === 0) { await sleep(2000); continue; }
      throw Object.assign(new Error('Gemini could not be reached: ' + e.message), { code: 'gemini_unreachable' });
    }
    if (attempt === 0 && RETRY_STATUS.has(res.status)) { await sleep(waitMs(res)); continue; }
    break;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`Gemini answered ${res.status}: ${text.slice(0, 200)}`), { code: 'gemini_error', status: res.status });
  }
  const data = await res.json();
  const content = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
  if (!content) throw Object.assign(new Error('Gemini returned no content'), { code: 'gemini_empty' });
  if (!json) return content;
  try { return JSON.parse(content); }
  catch { throw Object.assign(new Error('Gemini did not return valid JSON'), { code: 'gemini_bad_json' }); }
}

module.exports = { format, DEFAULT_MODEL };
