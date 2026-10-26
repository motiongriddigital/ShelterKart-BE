'use strict';
/**
 * DeepSeek. OpenAI-compatible chat completions. As reported (October 2026): no web search through the API and no image
 * input, so it can serve the adviser, translation and the meaning check, never research or the document check.
 * Its data is processed in China and used for training by default unless opted out: the router never sends it the
 * buyer's documents, and the company decides whether to allow it at all (AI_ENGINES).
 */
const { makeChatEngine } = require('./chat');
module.exports = makeChatEngine({ id: 'deepseek', label: 'DeepSeek', baseUrl: env => env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com', keyEnv: 'DEEPSEEK_API_KEY' });
