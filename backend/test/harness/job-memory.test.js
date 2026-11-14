Object.assign(process.env, { ADMIN_USERNAME: 'a', ADMIN_PASSWORD: 'b', ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN_SECRET: 'tok-secret-for-the-memory-test-0123456789', PAYMENTS_ENABLED: 'true',
  RAZORPAY_KEY_ID: 'rzp_test_id', RAZORPAY_KEY_SECRET: 'rzp_secret', GSTIN: '27ABCDE1234F1Z5', PUBLIC_BASE_URL: 'https://shelterkart.test' });
delete process.env.DATABASE_URL; delete process.env.ACCOUNTS_ENABLED; delete process.env.AI_ENGINES;
const path = require('path'), fs = require('fs'), os = require('os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-memory-')); process.env.LIVE_JOBS_DIR = dir;
const REG = 'P52100099001', RERA = 'https://maharera.maharashtra.gov.in/project/' + REG, SITE = 'https://sunrise-sandbox.example/marigold';
const SWEEP = { project: { name: 'Marigold Heights', location: 'Wakad, Pune', country: 'India', brand: 'Marigold Heights by Sunrise', promoter_legal_name: 'Marigold Realty Ventures Private Limited', registration_ids: [REG] },
  facts: [{ area: 'record', field: 'filed completion date', value: '31 Dec 2026', claim: 'The filed completion date is 31 December 2026.', sources: [RERA] }, { area: 'timeline', claim: 'The brochure promises possession by March 2026.', kind: 'developer_claim', sources: [SITE] }],
  marketed_dates: [{ value: 'March 2026', source: SITE }], filed_completion: { value: '31 Dec 2026', source: RERA },
  leads: [{ kind: 'company', value: 'Sunrise Group Developers Limited', why: 'the listed parent' }],
  questions: [{ question: 'Which date will my agreement carry?', why: 'x', to: 'legal team', when: 'before signing', good: 'The registered date.', not_accepted: 'A brochure date.' }] };
let sweepCalls = 0, failSweep = false; const prompts = [];
globalThis.fetch = async (url, o) => { const b = JSON.parse((o && o.body) || '{}'), mk = (c, status = 200) => ({ ok: status < 300, status, json: async () => c }), text = JSON.stringify(b.messages || []);
  if (b.tools) { prompts.push(text); if (/most thorough/.test(text)) { sweepCalls++; if (failSweep) return mk({ error: { message: 'down' } }, 400); }
    return mk({ stop_reason: 'end_turn', usage: { input_tokens: 9000, output_tokens: 1500 }, content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: [RERA, SITE].map(u => ({ url: u, title: '' })) }, { type: 'text', text: JSON.stringify(/most thorough/.test(text) ? SWEEP : {}) }] }); }
  return mk({ stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 }, content: [{ type: 'text', text: '{"questions":[{"question":"Who signs my agreement?","to":"legal team","when":"before booking"}],"leads":[],"challenges":[]}' }] }); };
const app = require(path.join(__dirname, '..', '..', 'server.js'));
const { c } = require(path.join(__dirname, '..', '..', 'app.js'));
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route, { body = {}, params = {}, query = {} } = {}) { return new Promise(resolve => {
  const res = { code: 200, status(x) { this.code = x; return this; }, set() { return this; }, json(o) { resolve({ code: this.code, body: o }); }, send(o) { resolve({ code: this.code, body: o }); } };
  const req = { body, params, query, ip: '3.3.3.3', path: route.path, headers: {}, originalUrl: route.path, get: () => undefined, on() {} };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const f = hs[i++]; if (f) f(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, x) => { if (!x) failures++; console.log((x ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { fs.rmSync(dir, { recursive: true, force: true }); console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 25)); } return false; };
const dossierOf = j => (j.inv && j.inv.dossier) || (j.saved && j.saved.dossier);

(async () => {
  console.log('an unpaid first look');
  const s = await call(find('post', '/api/investigate'), { body: { query: 'Marigold Heights', location: 'Wakad, Pune', country: 'IN', market: 'India' } }); const ref = s.body.ref;
  ok('the first look finishes', await until(() => (c.liveJobs.get(ref) || {}).status === 'preview'));
  const job = c.liveJobs.get(ref);
  ok('the finished first look holds its saved state, not a live investigation', job.inv === null && Boolean(job.saved && job.saved.state && job.saved.swept) && Boolean(dossierOf(job)));
  const factsBefore = dossierOf(job).counts.facts;
  const page = await call(find('get', '/r/:ref'), { params: { ref } });
  ok('its preview page is still served', page.code === 200 && /Unlock the full report/.test(String(page.body)));
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, ref + '.json'), 'utf8'));
  ok('and the file on disk holds the same state', onDisk.saved.swept === true && onDisk.saved.dossier.counts.facts === factsBefore);

  console.log('\nthen the buyer pays');
  c.onReportPaid(ref);
  ok('the paid completion finishes from that saved state', await until(() => (c.liveJobs.get(ref) || {}).status === 'done', 8000));
  const done = c.liveJobs.get(ref);
  ok('without sweeping a second time (the free research was not paid for again)', sweepCalls === 1);
  ok('the report is complete and keeps what the first look found', dossierOf(done).phase === 'complete' && dossierOf(done).counts.facts >= factsBefore && dossierOf(done).questions.length >= 1);
  ok('and the finished job holds no live investigation either', done.inv === null && Boolean(done.saved && done.saved.dossier && done.saved.dossier.phase === 'complete'));
  ok('the lead round ran on the facts of the first look: its prompt carries them, so the resumed state reached the paid stage', prompts.some(p => /Lead: company: Sunrise Group Developers Limited/.test(p) && /filed completion date is 31 December 2026/.test(p)));

  console.log('\na failed first look');
  failSweep = true;
  const f = await call(find('post', '/api/investigate'), { body: { query: 'Broken Towers', location: 'Thane', country: 'IN', market: 'India' } });
  ok('it fails', await until(() => (c.liveJobs.get(f.body.ref) || {}).status === 'failed'));
  ok('and holds no live investigation', c.liveJobs.get(f.body.ref).inv === null);
  failSweep = false;
})();
