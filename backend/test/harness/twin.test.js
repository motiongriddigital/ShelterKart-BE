Object.assign(process.env, { ADMIN_USERNAME: 'a', ADMIN_PASSWORD: 'b', ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN_SECRET: 'tok-secret-for-the-twin-test-0123456789', PAYMENTS_ENABLED: 'true',
  RAZORPAY_KEY_ID: 'rzp_test_id', RAZORPAY_KEY_SECRET: 'rzp_secret', GSTIN: '27ABCDE1234F1Z5', PUBLIC_BASE_URL: 'https://shelterkart.test' });
delete process.env.DATABASE_URL; delete process.env.ACCOUNTS_ENABLED; delete process.env.AI_ENGINES;
const path = require('path'), fs = require('fs'), os = require('os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-twin-')); process.env.LIVE_JOBS_DIR = dir;
const { createJobStore } = require('../../engine/jobStore');
const store = createJobStore({ dir });
let n = 0;
const dossier = (ref, project, phase) => ({ kind: 'shelterkart-dossier', version: 1, ref, phase, query: project.name, location: 'Pune', market: 'IN', asOf: '2026-11-01', project,
  counts: { facts: 1, verified: 0, reported: 1, conflicts: 0, inferences: 0, questions: 1, sources: 1 }, glance: [], promises: [], entities: [], inferences: [], conflicts: [], checks: {}, sections: [],
  questions: [{ id: 'Q1', question: 'Q?', to: 'legal team', when: 'before booking' }], sources: [], leads: [], unreachable: [], panel: { engines: [], failed: [], rounds: 0 }, notice: '' });
const hex = k => 'SK-' + String(k).padStart(12, '0').replace(/[^0-9A-F]/g, 'A').toUpperCase();
function seed({ status, country = 'IN', project }) {
  const ref = hex(++n), done = status === 'done';
  store.save({ ref, input: { query: project.name, location: 'Pune', country, market: 'India' }, key: 'k' + n, status, paid: false, purchaseId: null, contact: null, costUsd: 0, stageCosts: null, capUsd: null, delivered: false,
    createdAt: Date.now() - 5000, failedAt: null, failError: null, updatedAt: Date.now() - 1000, saved: { state: null, dossier: dossier(ref, project, done ? 'complete' : 'preview'), swept: true } });
  return ref;
}
const P = (id, extra = {}) => ({ name: 'Tower ' + id, ids: [id], promoter_legal_name: 'Marigold Realty Ventures Private Limited', brand: 'Marigold', ...extra });
const cases = [
  { label: 'same registration number, market and developer', a: P('P52100010001'), b: P('P52100010001'), reused: true },
  { label: 'the developer written another way (Pvt. Ltd. against Private Limited)', a: P('P52100010002'), b: P('P52100010002', { promoter_legal_name: 'Marigold Realty Ventures Pvt. Ltd.' }), reused: true },
  { label: 'no registered company named, the same brand', a: P('P52100010003', { promoter_legal_name: '' }), b: P('P52100010003', { promoter_legal_name: '' }), reused: true },
  { label: 'another market', a: P('P52100010004'), b: P('P52100010004'), bCountry: 'GB', reused: false },
  { label: 'another developer', a: P('P52100010005'), b: P('P52100010005', { promoter_legal_name: 'Beta Constructions Private Limited', brand: 'Beta' }), reused: false },
  { label: 'the new report names no developer at all', a: P('P52100010006'), b: P('P52100010006', { promoter_legal_name: '', brand: '' }), reused: false },
  { label: 'a short id that two projects both carry (a year)', a: P('2026'), b: P('2026'), reused: false },
  { label: 'an id of seven characters', a: P('P521000'), b: P('P521000'), reused: false },
];
const plan = cases.map(c => ({ ...c, aRef: seed({ status: 'done', project: c.a }), bRef: seed({ status: 'preview', project: c.b, country: c.bCountry || 'IN' }) }));
let aiCalls = 0;
globalThis.fetch = async (url, o) => { aiCalls++; const mk = j => ({ ok: true, status: 200, json: async () => j }); return mk({ stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 }, content: [{ type: 'text', text: '{}' }] }); };
const app = require(path.join(__dirname, '..', '..', 'server.js'));
const { c } = require(path.join(__dirname, '..', '..', 'app.js'));
let failures = 0;
const ok = (label, x) => { if (!x) failures++; console.log((x ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { fs.rmSync(dir, { recursive: true, force: true }); console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 25)); } return false; };

(async () => {
  console.log('a finished report is another buyer\'s twin only for the same project');
  for (const p of plan) {
    const before = aiCalls; c.onReportPaid(p.bRef);
    const finished = await until(() => ['done', 'failed'].includes((c.liveJobs.get(p.bRef) || {}).status));
    const job = c.liveJobs.get(p.bRef), reused = job.reusedFrom === p.aRef;
    ok(`${p.label}: ${p.reused ? 'the finished report is given, no research is paid for again' : 'it is not given; the research runs'}`, finished && reused === p.reused && (p.reused ? aiCalls === before : aiCalls > before));
  }
  ok('a reused report is the twin\'s own dossier under the buyer\'s reference', (() => { const j = c.liveJobs.get(plan[0].bRef), d = j.saved.dossier; return d.ref === plan[0].bRef && d.reusedFrom === plan[0].aRef && d.phase === 'complete'; })());
})();
