'use strict';
/**
 * OpenAI. Responses API with the web_search tool. OpenAI's docs: the `sources` field returns "the complete list of URLs
 * the model consulted", unlike inline citations; it is requested with include and read from each web_search_call.
 */
const { makeResponsesEngine } = require('./responses');
module.exports = makeResponsesEngine({
  id: 'openai', label: 'OpenAI',
  baseUrl: env => env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  keyEnv: 'OPENAI_API_KEY', modelEnv: 'OPENAI_MODEL',
  include: ['web_search_call.action.sources'],
  searchTools: () => [{ type: 'web_search' }],
  extraBody: (env, { maxUses }) => (maxUses ? { max_tool_calls: maxUses } : {}),
  retrievedFrom: d => (d.output || []).filter(i => i && i.type === 'web_search_call').flatMap(i => (i.action && Array.isArray(i.action.sources) ? i.action.sources : []))
    .map(s => (s && s.url ? { url: s.url, title: s.title || '' } : null)).filter(Boolean),
});
