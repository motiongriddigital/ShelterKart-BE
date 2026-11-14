Object.assign(process.env, { ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN_SECRET: 'tok-secret', BOT_GUARD: 'off', INVESTIGATE_DAILY_CAP: '50' });
let aiDown = true, aiCalls = 0;
globalThis.fetch = async (url, o) => { aiCalls++; if (aiDown) return { ok: false, status: 503, json: async () => ({ error: 'down' }), text: async () => 'down' };
  const mk = c => ({ ok: true, status: 200, json: async () => c });
  return mk({ stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 }, content: [{ type: 'text', text: JSON.stringify({ project: { name: 'Hubtown Celeste' }, facts: [{ area: 'identity', claim: 'The record names the promoter.', sources: ['https://example-data.com/record'] }] }) }] }); };
const app = require(require('path').join(__dirname, '..', '..', 'server.js'));
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route, body) { return new Promise(resolve => {
  const res = { code: 200, status(c) { this.code = c; return this; }, set() { return this; }, append() { return this; }, json(o) { resolve({ code: this.code, body: o }); }, send(o) { resolve({ code: this.code, body: o }); } };
  const req = { body, params: {}, query: {}, ip: '4.4.4.4', path: '', headers: {}, originalUrl: '', get: () => undefined, on() {} };
  let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const fn = route.handlers[i++]; if (fn) fn(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const start = find('post', '/api/investigate'), body = { query: 'Hubtown Celeste', location: 'Mumbai', country: 'IN' };
  const first = await call(start, body);
  ok('the first request starts an investigation', first.code === 202 && first.body.ref && !first.body.reused);
  await wait(1500);
  aiDown = false;
  const second = await call(start, body);
  ok('after the sweep failed, the same project is investigated again, not pointed at the dead report', second.code === 202 && !second.body.reused && second.body.ref !== first.body.ref);
  await wait(1500);
  const third = await call(start, body);
  ok('a report that is working is still reused', third.body.reused === true && third.body.ref === second.body.ref);
})();
