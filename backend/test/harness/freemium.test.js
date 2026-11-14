Object.assign(process.env, { ADMIN_USERNAME: 'a', ADMIN_PASSWORD: 'b', ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN_SECRET: 'tok-secret-for-the-freemium-test-0123456789', PAYMENTS_ENABLED: 'true',
  RAZORPAY_KEY_ID: 'rzp_test_id', RAZORPAY_KEY_SECRET: 'rzp_secret', GSTIN: '27ABCDE1234F1Z5', PUBLIC_BASE_URL: 'https://shelterkart.test', INVESTIGATE_PREVIEW_MODE: 'lean' });
delete process.env.DATABASE_URL; delete process.env.ACCOUNTS_ENABLED; delete process.env.AI_ENGINES;
const path = require('path');
const REG = 'https://maharera.maharashtra.gov.in/project/P52100099001', SITE = 'https://sunrise-sandbox.example/marigold';
const LEAN = { project: { name: 'Marigold Heights', location: 'Wakad, Pune', country: 'India', brand: 'Marigold Heights by Sunrise', promoter_legal_name: 'Marigold Realty Ventures Private Limited', registration_ids: ['P52100099001'] },
  facts: [{ area: 'record', field: 'filed completion date', value: '31 Dec 2026', claim: 'The filed completion date is 31 December 2026.', sources: [REG] }, { area: 'timeline', claim: 'The brochure promises possession by March 2026.', kind: 'developer_claim', sources: [SITE] }],
  marketed_dates: [{ value: 'March 2026', source: SITE }], filed_completion: { value: '31 Dec 2026', source: REG },
  questions: [{ question: 'Which date will my agreement carry?', why: 'Only the registered date gives a remedy.', to: 'legal team', when: 'before signing', good: 'The registered date.', not_accepted: 'A brochure date.' }] };
const DEEP = { facts: [{ area: 'money', claim: 'A charge of 85 crore rupees is registered against the promoter.', sources: ['https://charges-sandbox.example/c1'] }] };
const bodies = [];
globalThis.fetch = async (url, o) => {
  const b = JSON.parse((o && o.body) || '{}'); bodies.push(b);
  const mk = c => ({ ok: true, status: 200, json: async () => c });
  const prompt = JSON.stringify(b.messages || []);
  if (b.tools) { const text = /FAST FIRST LOOK/.test(prompt) ? LEAN : DEEP;
    return mk({ stop_reason: 'end_turn', usage: { input_tokens: 9000, output_tokens: 1500 }, content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: [REG, SITE, 'https://charges-sandbox.example/c1'].map(u => ({ url: u, title: '' })) }, { type: 'text', text: JSON.stringify(text) }] }); }
  return mk({ stop_reason: 'end_turn', usage: { input_tokens: 500, output_tokens: 50 }, content: [{ type: 'text', text: '{"questions":[{"question":"Who signs my agreement?","to":"legal team","when":"before booking"}],"leads":[],"challenges":[]}' }] });
};
const app = require(path.join(__dirname, '..', '..', 'server.js'));
const { c } = require(path.join(__dirname, '..', '..', 'app.js'));
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route, { body = {}, params = {}, headers = {}, query = {} } = {}) { return new Promise(resolve => {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const res = { code: 200, headers: {}, status(x) { this.code = x; return this; }, set(k, v) { if (typeof k === 'object') Object.assign(this.headers, k); else this.headers[k] = v; return this; }, json(o) { resolve({ code: this.code, body: o, headers: this.headers }); }, send(o) { resolve({ code: this.code, body: o }); } };
  const req = { body, params, query, ip: '3.3.3.3', path: route.path, headers: h, originalUrl: route.path, get: k => h[k.toLowerCase()], on() {} };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const f = hs[i++]; if (f) f(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, x) => { if (!x) failures++; console.log((x ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 25)); } return false; };

(async () => {
  console.log('the free preview of a buyer, in lean mode');
  const started = await call(find('post', '/api/investigate'), { body: { query: 'Marigold Heights', location: 'Wakad, Pune', country: 'IN', market: 'India' } });
  ok('starting a search is accepted', started.code === 202 || started.code === 200); const ref = started.body.ref;
  ok('the first look finishes', await until(() => (c.liveJobs.get(ref) || {}).status === 'preview'));
  const sweep = bodies.filter(b => b.tools);
  ok('exactly one AI call was made for the free preview', sweep.length === 1 && bodies.length === 1);
  ok('it asked for a short answer (4,000 tokens, not 16,000)', sweep[0].max_tokens === 4000);
  ok('it used the preview budget: 6 searches and 2 page reads', sweep[0].tools.find(t => t.name === 'web_search').max_uses === 6 && sweep[0].tools.find(t => t.name === 'web_fetch').max_uses === 2);
  const page = await call(find('get', '/r/:ref'), { params: { ref } });
  const html = String(page.body || '');
  ok('the free preview page is served from the first look', page.code === 200 && /Unlock the full report/.test(html) && /Marigold Heights/.test(html));
  ok('with the marketing-against-record cards and the first question', /Where the marketing and the record part ways/.test(html) && /Three questions to start with/.test(html));
  ok('and nothing paid: no sources list, no tracker', !/Sources<|Tracker/.test(html) && !/charges-sandbox/.test(html));

  console.log('\nafter payment');
  c.onReportPaid(ref);
  ok('the paid completion finishes', await until(() => (c.liveJobs.get(ref) || {}).status === 'done', 8000));
  const deep = bodies.find(b => b.tools && /A first look has already found this/.test(JSON.stringify(b.messages)));
  ok('a deep sweep ran, told what the first look found', Boolean(deep));
  ok('with the paid budget: 25 searches, 12 page reads, 16,000 tokens', Boolean(deep) && deep.max_tokens === 16000 && deep.tools.find(t => t.name === 'web_search').max_uses === 25 && deep.tools.find(t => t.name === 'web_fetch').max_uses === 12);
  ok('the deep sweep came after the preview and the first look was not paid for twice', bodies.filter(b => b.tools && /FAST FIRST LOOK/.test(JSON.stringify(b.messages))).length === 1);
  const costs = (c.liveJobs.get(ref) || {}).stageCosts || {};
  ok('the cost of each stage is tracked, the deep sweep as its own line', ['sweep', 'deep'].every(k => costs[k] && costs[k].calls >= 1));
  const after = await call(find('get', '/r/:ref'), { params: { ref }, query: { t: 'garbage' } });
  ok('a stranger still gets only the preview page after the report completed', /Unlock the full report/.test(String(after.body || '')) && !/charges-sandbox/.test(String(after.body || '')));
  ok('the finished dossier holds the deep sweep\'s facts', (c.liveJobs.get(ref).inv ? c.liveJobs.get(ref).inv.dossier : c.liveJobs.get(ref).saved.dossier).sections.flatMap(s => s.facts).some(f => /85 crore/.test(f.claim)));
})();
