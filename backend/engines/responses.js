'use strict';
/**
 * A shared adapter for engines that speak the OpenAI-style Responses API (xAI's Grok and OpenAI both do).
 * Each engine supplies its base URL, key and model settings, its search tools, and WHERE its response lists the
 * pages its search actually used -- the evidence our grounding rule checks every claim against.
 *
 * Built to the providers' published formats (October 2026). Verify with a live key before enabling an engine:
 * tools/engine_benchmark.js does exactly that.
 */
const IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function makeResponsesEngine({ id, label, baseUrl, keyEnv, modelEnv, include = [], searchTools, retrievedFrom, extraBody = () => ({}) }) {
  async function post(body, env, fetchImpl, what) {
    const res = await fetchImpl(baseUrl(env).replace(/\/$/, '') + '/responses', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env[keyEnv] }, body: JSON.stringify(body) });
    if (!res.ok) { const e = new Error(`${id} ${what} error ${res.status}`); e.status = res.status; throw e; }
    return res.json();
  }
  const textOf = d => (typeof d.output_text === 'string' && d.output_text) ? d.output_text
    : (d.output || []).filter(i => i && i.type === 'message').flatMap(i => i.content || []).filter(c => c && c.type === 'output_text').map(c => c.text || '').join('');
  const usageOf = d => ({ input: Number(d && d.usage && d.usage.input_tokens) || 0, output: Number(d && d.usage && d.usage.output_tokens) || 0 });
  const stopOf = d => (d.status === 'incomplete' && d.incomplete_details && /max_output_tokens/.test(String(d.incomplete_details.reason)) ? 'max_tokens' : (d.status || 'completed'));
  const modelOf = (env, model) => model || env[modelEnv] || require('./catalog').engine(id).defaultModel;
  const annotationUrls = d => (d.output || []).filter(i => i && i.type === 'message').flatMap(i => i.content || []).flatMap(c => (c && Array.isArray(c.annotations) ? c.annotations : []))
    .map(a => (a && (a.url || (a.url_citation && a.url_citation.url))) ? { url: a.url || a.url_citation.url, title: a.title || (a.url_citation && a.url_citation.title) || '' } : null).filter(Boolean);
  const searchCount = d => (d.output || []).filter(i => i && typeof i.type === 'string' && /(^|_)search_call$/.test(i.type)).length;

  return {
    id, label,
    configured: env => Boolean(env[keyEnv]),                          // the model comes from the router: a setting, or the catalogue's default
    supports: (op, o = {}) => (op === 'read' ? IMAGES.has(o.mediaType) : op === 'search' || op === 'complete'),

    async search({ prompt, maxUses, facet, model, maxTokens }, { env, fetchImpl }) {
      const body = { model: modelOf(env, model), input: [{ role: 'user', content: prompt }], tools: searchTools(env, facet), max_output_tokens: maxTokens || 4000, ...extraBody(env, { maxUses }) };
      if (include.length) body.include = include;
      const d = await post(body, env, fetchImpl, 'research');
      const seen = new Set(), retrieved = [];
      for (const r of [...retrievedFrom(d), ...annotationUrls(d)]) if (r && r.url && !seen.has(r.url)) { seen.add(r.url); retrieved.push(r); }
      const fromList = retrievedFrom(d).length > 0;
      return { text: textOf(d), retrieved, searches: searchCount(d), stop: stopOf(d), usage: usageOf(d), model: modelOf(env, model), retrievedKind: fromList ? 'all-results' : 'cited-only' };
    },

    async complete({ prompt, maxTokens, model }, { env, fetchImpl }) {
      const d = await post({ model: modelOf(env, model), input: [{ role: 'user', content: prompt }], max_output_tokens: maxTokens }, env, fetchImpl, 'completion');
      return { text: textOf(d), usage: usageOf(d), model: modelOf(env, model) };
    },

    async read({ prompt, data, mediaType, maxTokens, model }, { env, fetchImpl }) {
      const d = await post({ model: modelOf(env, model), max_output_tokens: maxTokens,
        input: [{ role: 'user', content: [{ type: 'input_image', image_url: `data:${mediaType};base64,${data}` }, { type: 'input_text', text: prompt }] }] }, env, fetchImpl, 'document');
      return { text: textOf(d), usage: usageOf(d), model: modelOf(env, model) };
    },
  };
}
module.exports = { makeResponsesEngine };
