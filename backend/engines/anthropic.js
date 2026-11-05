'use strict';
/**
 * Anthropic (Claude) adapter. It sends exactly the requests ShelterKart sent before the engine layer existed, so the
 * default behaviour is unchanged: the same endpoint, headers, model settings, web-search tool and pause_turn handling.
 */
const API = 'https://api.anthropic.com/v1/messages';
const MEDIA = { 'application/pdf': 'document', 'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image' };

async function post(body, env, fetchImpl, label) {
  const headers = { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' };
  // Only if the account still needs it: newer API versions run web fetch without a beta header.
  if (env.ANTHROPIC_WEB_FETCH_BETA) headers['anthropic-beta'] = env.ANTHROPIC_WEB_FETCH_BETA;
  const res = await fetchImpl(API, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) { const e = new Error(label + ' ' + res.status); e.status = res.status; throw e; }
  return res.json();
}
const textOf = blocks => (blocks || []).filter(b => b.type === 'text').map(b => b.text).join('');
const usageOf = d => ({ input: Number(d && d.usage && d.usage.input_tokens) || 0, output: Number(d && d.usage && d.usage.output_tokens) || 0 });
const modelOf = (env, model) => model || env.ANTHROPIC_MODEL || require('./catalog').engine('anthropic').defaultModel;

module.exports = {
  id: 'anthropic', label: 'Anthropic (Claude)',
  configured: env => Boolean(env.ANTHROPIC_API_KEY),
  supports: (op, o = {}) => (op === 'read' ? Boolean(MEDIA[o.mediaType]) : op === 'search' || op === 'complete'),

  /** Research with the server-side web-search tool. retrieved = every page the search returned (what grounding checks claims against). */
  async search({ prompt, maxUses, model, maxTokens = 4000, rounds = 4, fetchPages = false, fetchUses, maxContentTokens }, { env, fetchImpl }) {
    let messages = [{ role: 'user', content: prompt }];
    const blocks = []; let stop = ''; const usage = { input: 0, output: 0 };
    // Tool versions are configurable, so a new release can be adopted without a code change.
    const tools = [{ type: env.ANTHROPIC_WEB_SEARCH_TOOL || 'web_search_20250305', name: 'web_search', ...(maxUses ? { max_uses: maxUses } : {}) }];
    // Page reading: the API fetches a page the search returned and the model reads all of it, tables included.
    if (fetchPages && env.ANTHROPIC_WEB_FETCH !== 'off') tools.push({ type: env.ANTHROPIC_WEB_FETCH_TOOL || 'web_fetch_20250910', name: 'web_fetch', ...(fetchUses ? { max_uses: fetchUses } : {}), ...(maxContentTokens ? { max_content_tokens: maxContentTokens } : {}) });
    for (let round = 0; round < rounds; round++) {
      const data = await post({ model: modelOf(env, model), max_tokens: maxTokens, messages, tools }, env, fetchImpl, 'research service error');
      blocks.push(...(data.content || [])); stop = data.stop_reason;
      const u = usageOf(data); usage.input += u.input; usage.output += u.output;
      if (stop === 'pause_turn') { messages = [...messages, { role: 'assistant', content: data.content }]; continue; }
      break;
    }
    const retrieved = []; let searches = 0;
    for (const b of blocks) {
      if (b.type === 'server_tool_use' && b.name === 'web_search') searches++;
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r && r.url) retrieved.push({ url: r.url, title: r.title || '' });
      // A page the model opened in full counts as retrieved, and is marked as read.
      if (b.type === 'web_fetch_tool_result' && b.content && b.content.url) retrieved.push({ url: b.content.url, title: (b.content.content && b.content.content.title) || '', read: true });
    }
    return { text: textOf(blocks), retrieved, searches, stop, usage, model: modelOf(env, model), retrievedKind: 'all-results' };
  },

  async complete({ prompt, maxTokens, model, label = 'model' }, { env, fetchImpl }) {
    const data = await post({ model: modelOf(env, model), max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }, env, fetchImpl, label);
    return { text: textOf(data.content), usage: usageOf(data), model: modelOf(env, model), raw: data };
  },

  async read({ prompt, data, mediaType, maxTokens, model, label = 'document' }, { env, fetchImpl }) {
    const body = await post({ model: modelOf(env, model), max_tokens: maxTokens,
      messages: [{ role: 'user', content: [{ type: MEDIA[mediaType], source: { type: 'base64', media_type: mediaType, data } }, { type: 'text', text: prompt }] }] }, env, fetchImpl, label);
    return { text: textOf(body.content), usage: usageOf(body), model: modelOf(env, model) };
  },
};
