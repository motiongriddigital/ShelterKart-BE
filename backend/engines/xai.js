'use strict';
/**
 * xAI (Grok). OpenAI-compatible Responses API with server-side web_search, and x_search for posts on X.
 * xAI's docs: the response's `citations` field is "a comprehensive list of URLs for all sources the agent encountered",
 * which is the list grounding needs. Inline citations are switched off so they never land inside the JSON reply.
 * x_search is used only for the "what buyers say" pass, and only when XAI_X_SEARCH=true: a single post stays a single
 * person's view under the existing evidence rules.
 */
const { makeResponsesEngine } = require('./responses');
module.exports = makeResponsesEngine({
  id: 'xai', label: 'xAI (Grok)',
  baseUrl: env => env.XAI_BASE_URL || 'https://api.x.ai/v1',               // a regional endpoint can be set here
  keyEnv: 'XAI_API_KEY', modelEnv: 'XAI_MODEL',
  include: ['no_inline_citations'],
  searchTools: (env, facet) => [{ type: 'web_search' }, ...(facet === 'voice' && env.XAI_X_SEARCH === 'true' ? [{ type: 'x_search' }] : [])],
  retrievedFrom: d => (Array.isArray(d.citations) ? d.citations : []).map(c => (typeof c === 'string' ? { url: c, title: '' } : c && c.url ? { url: c.url, title: c.title || '' } : null)).filter(Boolean),
});
