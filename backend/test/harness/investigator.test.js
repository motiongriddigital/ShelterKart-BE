// The investigator's admin routes, end to end through the real server.js and the real engine layer, with the
// Anthropic API mocked: start, refuse without login, stream, finish, render the report page, and check the request
// asks Claude to read pages and answer at length.
const env = { ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN_SECRET: 'tok-secret', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'pw', DELAY_RATE_PCT: '11.10' };
Object.assign(process.env, env); delete process.env.DATABASE_URL; delete process.env.AI_ENGINES;
const AURUM = 'https://www.aurumproptech.in/pulse/rera/maharashtra/mumbai-city/hubtown-celeste-P51900008925';
const SWEEP = { project: { name: 'Hubtown Celeste', location: 'Worli, Mumbai', brand: 'Hubtown', promoter_legal_name: 'Nayan Real Estate Private Limited', registration_ids: ['P51900008925'] },
  facts: [{ area: 'identity', field: 'registered promoter', value: 'Nayan Real Estate Private Limited', claim: 'The record names Nayan Real Estate Private Limited as promoter.', sources: [AURUM] }],
  questions: [{ question: 'Which company signs my agreement?', why: 'Enforceability.', to: 'legal team', when: 'before booking', good: 'Named in writing.', not_accepted: 'A brand name.' }] };
const bodies = [];
globalThis.fetch = async (url, o) => {
  const b = JSON.parse(o.body); bodies.push(b);
  const mk = c => ({ ok: true, status: 200, json: async () => c });
  if (b.tools) return mk({ stop_reason: 'end_turn', content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: [{ url: AURUM, title: 'Celeste' }] },
    { type: 'web_fetch_tool_result', content: { type: 'web_fetch_result', url: AURUM, content: { title: 'Celeste record' } } }, { type: 'text', text: JSON.stringify(SWEEP) }], usage: { input_tokens: 10, output_tokens: 10 } });
  return mk({ content: [{ type: 'text', text: '{"questions":[{"question":"Please share the latest quarterly progress report.","to":"legal team","when":"before signing"}]}' }], usage: { input_tokens: 5, output_tokens: 5 } });
};
const app = require(require('path').join(__dirname, '..', '..', 'server.js'));
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
const AUTH = 'Basic ' + Buffer.from('admin:pw').toString('base64');
function call(route, { body = {}, params = {}, headers = {} } = {}) { return new Promise(resolve => {
  const res = { code: 200, headers: {}, chunks: [], status(c) { this.code = c; return this; }, set(k, v) { if (typeof k === 'object') Object.assign(this.headers, k); else this.headers[k] = v; return this; },
    json(o) { resolve({ code: this.code, body: o, headers: this.headers }); }, send(t) { resolve({ code: this.code, text: t, headers: this.headers }); },
    write(c) { this.chunks.push(c); }, end() { resolve({ code: this.code, text: this.chunks.join(''), headers: this.headers }); }, flushHeaders() {} };
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const req = { body, params, query: {}, ip: '4.4.4.4', path: route.path, headers: h, get: k => h[k.toLowerCase()], on() {} };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const fn = hs[i++]; if (fn) fn(req, res, next); }; next();
}); }
let failures = 0; const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });

(async () => {
  const start = find('post', '/api/admin/investigate');
  ok('the investigator needs an admin login', (await call(start, { body: { query: 'Hubtown Celeste' } })).code === 401);
  ok('a vague request is refused', (await call(start, { body: { query: 'x' }, headers: { authorization: AUTH } })).code === 400);
  const r = await call(start, { body: { query: 'Hubtown Celeste', location: 'Worli, Mumbai', market: 'India' }, headers: { authorization: AUTH } });
  ok('starting returns 202 with links to the live events and the report', r.code === 202 && r.body.id && /events$/.test(r.body.events));
  const id = r.body.id; let st;
  for (let i = 0; i < 50; i++) { st = await call(find('get', '/api/admin/investigate/:id'), { params: { id }, headers: { authorization: AUTH } }); if (st.body.status !== 'running') break; await new Promise(x => setTimeout(x, 20)); }
  ok('the investigation finishes with a dossier', st.body.status === 'done' && st.body.dossier && st.body.dossier.kind === 'shelterkart-dossier');
  ok('progress events were recorded (sweep, questions, done)', ['sweep', 'questions'].every(s => st.body.events.some(e => e.stage === s)) && st.body.events.some(e => e.type === 'done'));
  const d = st.body.dossier;
  ok('the finding carries its link and status, and the page that was read counts as retrieved', d.sections.flatMap(s => s.facts).some(f => f.sources.some(s => s.url === AURUM && s.seen)));
  ok('questions include the panel\'s and the question writer\'s', d.questions.some(q => /signs my agreement/.test(q.question)) && d.questions.some(q => /quarterly progress/.test(q.question)));
  const sweepReq = bodies.find(b => b.tools);
  ok('Claude is asked to search AND read pages (web_fetch), with long answers', sweepReq.tools.some(t => t.name === 'web_fetch' && /^web_fetch_/.test(t.type)) && sweepReq.max_tokens >= 16000);
  const page = await call(find('get', '/api/admin/investigate/:id/report'), { params: { id }, headers: { authorization: AUTH } });
  ok('the report page renders, questions first', page.code === 200 && /text\/html/.test(page.headers['Content-Type']) && page.text.indexOf('Start here') < page.text.indexOf('What we found'));
  const ev = await call(find('get', '/api/admin/investigate/:id/events'), { params: { id }, headers: { authorization: AUTH } });
  ok('the event stream replays progress for a finished investigation', /event: progress/.test(ev.text) && /event: done/.test(ev.text));
  ok('an unknown investigation is a 404', (await call(find('get', '/api/admin/investigate/:id'), { params: { id: 'nope' }, headers: { authorization: AUTH } })).code === 404);
})();
