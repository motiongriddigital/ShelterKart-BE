Object.assign(process.env, { ADMIN_USERNAME: 'a', ADMIN_PASSWORD: 'b', ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN_SECRET: 'tok-secret-for-the-reuse-test-0123456789', PAYMENTS_ENABLED: 'true',
  RAZORPAY_KEY_ID: 'rzp_test_id', RAZORPAY_KEY_SECRET: 'rzp_secret', GSTIN: '27ABCDE1234F1Z5', PUBLIC_BASE_URL: 'https://shelterkart.test' });
delete process.env.DATABASE_URL; delete process.env.ACCOUNTS_ENABLED; delete process.env.AI_ENGINES;
const path = require('path'), fs = require('fs'), os = require('os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-reuse-')); process.env.LIVE_JOBS_DIR = dir;
const REG = 'P52100099001', SEEDED_REG = 'P52100077777', SEEDED_REF = 'SK-5EEDED000001';
const { createJobStore } = require('../../engine/jobStore');
const seededDossier = { kind: 'shelterkart-dossier', version: 1, ref: SEEDED_REF, phase: 'preview', query: 'Seeded Gardens', location: 'Pune', market: 'IN', asOf: '2026-11-01', project: { name: 'Seeded Gardens', ids: [SEEDED_REG] },
  counts: { facts: 1, verified: 0, reported: 1, conflicts: 0, inferences: 0, questions: 1, sources: 1 }, glance: [], promises: [], entities: [], inferences: [], conflicts: [], checks: {}, sections: [], questions: [{ id: 'Q1', question: 'Q?', to: 'legal team', when: 'before booking' }], sources: [], leads: [], unreachable: [], panel: { engines: [], failed: [], rounds: 0 }, notice: '' };
createJobStore({ dir }).save({ ref: SEEDED_REF, input: { query: 'Seeded Gardens', location: 'Pune', country: 'IN', market: 'India' }, key: 'seeded|pune|in', status: 'preview', paid: false, purchaseId: null, contact: null, costUsd: 0, stageCosts: null, capUsd: null,
  delivered: false, createdAt: Date.now() - 1000, failedAt: null, failError: null, updatedAt: Date.now() - 1000, saved: { state: null, dossier: seededDossier, swept: true } });
const SITE = 'https://sunrise-sandbox.example/marigold', RERA = 'https://maharera.maharashtra.gov.in/project/' + REG;
const SWEEP = { project: { name: 'Marigold Heights', location: 'Wakad, Pune', country: 'India', brand: 'Marigold Heights by Sunrise', promoter_legal_name: 'Marigold Realty Ventures Private Limited', registration_ids: [REG] },
  facts: [{ area: 'record', field: 'filed completion date', value: '31 Dec 2026', claim: 'The filed completion date is 31 December 2026.', sources: [RERA] }], filed_completion: { value: '31 Dec 2026', source: RERA },
  questions: [{ question: 'Which date will my agreement carry?', why: 'x', to: 'legal team', when: 'before signing', good: 'The registered date.', not_accepted: 'A brochure date.' }] };
let aiCalls = 0;
globalThis.fetch = async (url, o) => { const b = JSON.parse((o && o.body) || '{}'), mk = c => ({ ok: true, status: 200, json: async () => c });
  if (b.tools) { aiCalls++; return mk({ stop_reason: 'end_turn', usage: { input_tokens: 9000, output_tokens: 1500 }, content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: [RERA, SITE].map(u => ({ url: u, title: '' })) }, { type: 'text', text: JSON.stringify(SWEEP) }] }); }
  return mk({ stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 }, content: [{ type: 'text', text: '{}' }] }); };
const app = require(path.join(__dirname, '..', '..', 'server.js'));
const { c } = require(path.join(__dirname, '..', '..', 'app.js'));
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route, { body = {} } = {}) { return new Promise(resolve => {
  const res = { code: 200, status(x) { this.code = x; return this; }, set() { return this; }, json(o) { resolve({ code: this.code, body: o }); }, send(o) { resolve({ code: this.code, body: o }); } };
  const req = { body, params: {}, query: {}, ip: '3.3.3.3', path: route.path, headers: {}, originalUrl: route.path, get: () => undefined, on() {} };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const f = hs[i++]; if (f) f(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, x) => { if (!x) failures++; console.log((x ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { fs.rmSync(dir, { recursive: true, force: true }); console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 25)); } return false; };
const start = (query, location = '') => call(find('post', '/api/investigate'), { body: { query, location, country: 'IN', market: 'India' } });

(async () => {
  console.log('a first look is reused when the buyer types its registration number');
  const first = await start('Marigold Heights', 'Wakad, Pune'); const ref = first.body.ref;
  ok('the first search runs one sweep', first.body.ok === true && !first.body.reused && await until(() => (c.liveJobs.get(ref) || {}).status === 'preview') && aiCalls === 1);
  const same = await start('marigold heights', 'Wakad, Pune');
  ok('the same name is reused as before (the name key still works)', same.body.reused === true && same.body.ref === ref && aiCalls === 1);
  const typed = await start('Sunrise Marigold ' + REG.toLowerCase().replace(/^(p5210)(.*)$/, '$1-$2'));
  ok('a different name with the registration number typed (any case, with a hyphen) gets that report, with no second sweep', typed.body.reused === true && typed.body.ref === ref && aiCalls === 1);
  const inLocation = await start('Marigold Phase 2', 'RERA ' + REG);
  ok('the number in the location field matches too', inLocation.body.reused === true && inLocation.body.ref === ref && aiCalls === 1);
  const other = await start('Totally Different Towers', 'Thane');
  ok('an unrelated project starts its own sweep', other.body.ok === true && !other.body.reused && other.body.ref !== ref && await until(() => aiCalls === 2));
  ok('a short or year-like word never matches', c.previewTwin('Tower 2026 Phase 1', '') === null && c.previewTwin('P52100', '') === null && c.previewTwin('', '') === null);
  c.liveJobs.set('SK-AAAAAAAAAAAA', { status: 'preview' }); c.indexPreview({ ref: 'SK-AAAAAAAAAAAA' }, { project: { ids: ['2026', 'TOWER7'] } });
  ok('a short registration number (a year, a word) that a project carries is never matched from a typed name', c.previewTwin('Tower 2026', '') === null && c.previewTwin('Tower 7 phase', '') === null);
  c.liveJobs.delete('SK-AAAAAAAAAAAA');
  const job = c.liveJobs.get(ref); job.status = 'failed';
  ok('a failed first look is never reused', c.previewTwin(REG, '') === null); job.status = 'interrupted';
  ok('nor an interrupted one', c.previewTwin(REG, '') === null); job.status = 'preview';
  ok('and it is reused again once it is fine', c.previewTwin(REG, '') === ref);
  console.log('\nafter a restart');
  const seeded = await start('Some Other Name', 'SEEDED ' + SEEDED_REG);
  ok('a saved first look from before the restart is found by its registration number', seeded.body.reused === true && seeded.body.ref === SEEDED_REF && aiCalls === 2);
  console.log('\nretention');
  c.pruneLiveJobs(Date.now() + 40 * 24 * 3600 * 1000);
  ok('after the 30 days the report is deleted and its number stops matching', c.previewTwin(REG, '') === null && c.previewTwin(SEEDED_REG, '') === null);
})();
