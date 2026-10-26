'use strict';
/**
 * Google Gemini. generateContent with the google_search tool. Its grounding metadata lists every source it used
 * (groundingChunks) and every query it ran (webSearchQueries). Source links may come back as Google redirect links;
 * each is resolved to the real page address (only for Google's own redirect host, never following anything else), and
 * both forms are kept, so a claim citing either one can be checked. Reads PDFs and images.
 */
const REDIRECT_HOST = 'vertexaisearch.cloud.google.com';
const MEDIA = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const base = env => (env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
async function post(model, body, env, fetchImpl, what) {
  const res = await fetchImpl(`${base(env)}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: JSON.stringify(body) });
  if (!res.ok) { const e = new Error(`gemini ${what} error ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}
const cand = d => (d.candidates || [])[0] || {};
const textOf = d => ((cand(d).content || {}).parts || []).map(p => p.text || '').join('');
const usageOf = d => { const u = d.usageMetadata || {}; return { input: Number(u.promptTokenCount) || 0, output: (Number(u.candidatesTokenCount) || 0) + (Number(u.thoughtsTokenCount) || 0) }; };
const stopOf = d => (cand(d).finishReason === 'MAX_TOKENS' ? 'max_tokens' : (cand(d).finishReason || 'STOP'));
async function resolveRedirect(uri, fetchImpl) {
  let host = ''; try { host = new URL(uri).host; } catch { return null; }
  if (host !== REDIRECT_HOST) return null;
  try {
    const r = await fetchImpl(uri, { method: 'GET', redirect: 'manual' });
    const loc = r && r.headers && (typeof r.headers.get === 'function' ? r.headers.get('location') : r.headers.location);
    return loc && /^https?:\/\//i.test(loc) ? loc : null;
  } catch { return null; }
}
module.exports = {
  id: 'gemini', label: 'Google (Gemini)',
  configured: env => Boolean(env.GEMINI_API_KEY),
  supports: (op, o = {}) => (op === 'read' ? MEDIA.has(o.mediaType) : op === 'search' || op === 'complete'),
  async search({ prompt, model, maxTokens }, { env, fetchImpl }) {
    const d = await post(model, { contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: maxTokens || 4000 } }, env, fetchImpl, 'research');
    const gm = cand(d).groundingMetadata || {}, chunks = (gm.groundingChunks || []).map(c => c && c.web).filter(w => w && w.uri).slice(0, 40);
    const retrieved = []; let unresolved = 0;
    for (const w of chunks) {
      const real = await resolveRedirect(w.uri, fetchImpl);
      if (real) retrieved.push({ url: real, title: w.title || '', alias: w.uri });
      else { let host = ''; try { host = new URL(w.uri).host; } catch {} if (host === REDIRECT_HOST) unresolved++; retrieved.push({ url: w.uri, title: w.title || '' }); }
    }
    return { text: textOf(d), retrieved, searches: (gm.webSearchQueries || []).length, stop: stopOf(d), usage: usageOf(d), model,
      retrievedKind: !chunks.length ? 'none' : unresolved ? 'partly-unresolved' : 'all-results' };
  },
  async complete({ prompt, maxTokens, model }, { env, fetchImpl }) {
    const d = await post(model, { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens } }, env, fetchImpl, 'completion');
    return { text: textOf(d), usage: usageOf(d), model };
  },
  async read({ prompt, data, mediaType, maxTokens, model }, { env, fetchImpl }) {
    const d = await post(model, { contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mediaType, data } }, { text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens } }, env, fetchImpl, 'document');
    return { text: textOf(d), usage: usageOf(d), model };
  },
};
