'use strict';
/** OpenAI-compatible chat-completions engines (DeepSeek, and others that copy the format). Text in, text out: no search, no images. */
function makeChatEngine({ id, label, baseUrl, keyEnv }) {
  return {
    id, label,
    configured: env => Boolean(env[keyEnv]),
    supports: op => op === 'complete',
    async complete({ prompt, maxTokens, model }, { env, fetchImpl }) {
      const res = await fetchImpl(baseUrl(env).replace(/\/$/, '') + '/chat/completions', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env[keyEnv] },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens }) });
      if (!res.ok) { const e = new Error(`${id} completion error ${res.status}`); e.status = res.status; throw e; }
      const d = await res.json();
      const text = (((d.choices || [])[0] || {}).message || {}).content || '';
      return { text, usage: { input: Number(d.usage && d.usage.prompt_tokens) || 0, output: Number(d.usage && d.usage.completion_tokens) || 0 }, model };
    },
  };
}
module.exports = { makeChatEngine };
