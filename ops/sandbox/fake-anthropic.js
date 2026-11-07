'use strict';
// A stand-in for the Claude Messages API, for the sandbox only. No key is checked and nothing is real. It plays back a script of replies
// (success, pause for another search round, 429 with Retry-After, 5xx, 4xx, a dropped connection) and keeps its OWN ledger of what it
// billed: tokens count only on a 2xx reply, as with the real service. The tests compare this ledger with what the engine accounted for.
const http = require('http');
let queue = [], ledger = fresh();
function fresh() { return { requests: 0, ok: 0, failed: 0, dropped: 0, billedInput: 0, billedOutput: 0, searches: 0, retryAfterSent: 0 }; }
const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
http.createServer((req, res) => {
  let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
    if (req.url === '/__script' && req.method === 'POST') { queue = JSON.parse(raw || '[]'); ledger = fresh(); return json(res, 200, { queued: queue.length }); }
    if (req.url === '/__ledger') return json(res, 200, ledger);
    if (req.url !== '/v1/messages' || req.method !== 'POST') return json(res, 404, { error: 'not found' });
    ledger.requests++;
    const step = queue.length ? queue.shift() : { kind: 'done' };
    if (step.drop) { ledger.dropped++; return req.socket.destroy(); }
    if (step.status && step.status >= 300) {
      ledger.failed++; if (step.retryAfter != null) ledger.retryAfterSent++;
      return json(res, step.status, { type: 'error', error: { type: 'api_error', message: 'scripted ' + step.status } }, step.retryAfter != null ? { 'retry-after': String(step.retryAfter) } : {});
    }
    const usage = { input_tokens: step.input || 12000, output_tokens: step.output || 800 };
    ledger.ok++; ledger.billedInput += usage.input_tokens; ledger.billedOutput += usage.output_tokens;
    if (step.kind === 'pause') {
      ledger.searches++;
      return json(res, 200, { stop_reason: 'pause_turn', usage, content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: [{ url: 'https://example.test/' + ledger.ok, title: 'Result ' + ledger.ok }] }] });
    }
    if (step.kind === 'cut') return json(res, 200, { stop_reason: 'max_tokens', usage, content: [{ type: 'text', text: '{"facts":[{"claim":"cut' }] });
    return json(res, 200, { stop_reason: 'end_turn', usage, content: [{ type: 'text', text: step.text || '{"ok":true}' }] });
  });
}).listen(8080, '0.0.0.0', () => console.log('stand-in Claude API on :8080'));
