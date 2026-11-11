// SHEL-42: a saved investigation file used to keep the buyer's e-mail and phone for ever and sat outside the 30-day deletion.
// Now the address is dropped from the file once the finished report is delivered, and files older than the retention are deleted
// (on start and every six hours), except a paid report that is still owed to the buyer.
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const JOBS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-retention-'));
const ENV = { ADMIN_USERNAME: 'a', ADMIN_PASSWORD: 'b', ACCESS_TOKEN_SECRET: 'tok-secret', PUBLIC_BASE_URL: 'https://shelterkart.test', LIVE_JOBS_DIR: JOBS_DIR,
  RESEND_API_KEY: 're_test', DELIVERY_FROM: 'ShelterKart <no-reply@shelterkart.test>' };
Object.assign(process.env, ENV);
for (const k of ['DATABASE_URL', 'JOB_RETENTION_DAYS']) delete process.env[k];
const sent = [];
globalThis.fetch = async (url, o) => { if (/resend\.com/.test(String(url))) sent.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ id: 'mail_1' }), text: async () => '' }; };
require(path.join(__dirname, '..', '..', 'server.js'));
const { c } = require(path.join(__dirname, '..', '..', 'app.js'));
const DAY = 24 * 3600 * 1000;
const file = ref => path.join(JOBS_DIR, ref + '.json');
const saved = ref => { try { return JSON.parse(fs.readFileSync(file(ref), 'utf8')); } catch { return null; } };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, tries = 200) { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await wait(25); } return null; }
let failures = 0;
const ok = (label, x) => { if (!x) failures++; console.log((x ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { fs.rmSync(JOBS_DIR, { recursive: true, force: true }); console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });

const dossier = ref => ({ ref, phase: 'complete', project: { name: 'Retention ' + ref, ids: [] }, sources: [], sections: [], questions: [], checks: {} });
const fake = (ref, status, extra = {}) => ({ ref, input: { query: 'Retention ' + ref, location: 'Mumbai', country: 'IN' }, status, paid: true, purchaseId: '11111111-1111-4111-8111-111111111111', capUsd: 5, costUsd: 0, createdAt: Date.now(), listeners: new Set(), events: [],
  contact: { email: 'buyer@example.com', phone: '+919820000000' }, saved: { state: null, dossier: dossier(ref), swept: true }, ...extra });
const aged = (ref, status, days, extra = {}) => { const j = fake(ref, status, extra); c.liveJobs.set(ref, j); c.persistJob(j); j.updatedAt = Date.now() - days * DAY; return j; };

(async () => {
  console.log('the buyer’s address in the saved file');
  const ref = 'SK-ABCDEF000001';
  const job = fake(ref, 'preview', { swept: true, inv: { dossier: dossier(ref), complete: async () => {}, exportState: () => ({ state: null, dossier: dossier(ref), swept: true }) } });
  c.liveJobs.set(ref, job); c.persistJob(job);
  ok('while the report is being made, the file carries the address (the delivery still needs it)', saved(ref).contact && saved(ref).contact.email === 'buyer@example.com');
  c.completeLive(job);
  const done = await until(() => { const s = saved(ref); return s && s.status === 'done' && s.delivered && s.contact === null ? s : null; });
  ok('once the finished report is delivered, the saved file carries no address and no phone', Boolean(done) && !/buyer@example\.com|9820000000/.test(fs.readFileSync(file(ref), 'utf8')));
  await until(() => sent.length);
  ok('the report was still sent to that address', sent.length === 1 && [].concat(sent[0].to).includes('buyer@example.com'));
  ok('and the report itself stays in the file', done && done.saved.dossier.ref === ref);

  const failed = fake('SK-ABCDEF000002', 'failed', { failedAt: Date.now(), delivered: true });
  c.liveJobs.set(failed.ref, failed); c.persistJob(failed);
  ok('a report that stopped early keeps the address, because the operator’s retry sends the complete one to the same buyer', saved(failed.ref).contact.email === 'buyer@example.com');

  console.log('\ndeleting past the retention (30 days)');
  const oldDone = aged('SK-ABCDEF000010', 'done', 31, { delivered: true, contact: null });
  const oldPreview = aged('SK-ABCDEF000011', 'preview', 31, { paid: false });
  const freshDone = aged('SK-ABCDEF000012', 'done', 29, { delivered: true, contact: null });
  const oldFailed = aged('SK-ABCDEF000013', 'failed', 40);
  const oldOwed = aged('SK-ABCDEF000014', 'preview', 40);
  const oldInterruptedPaid = aged('SK-ABCDEF000015', 'interrupted', 40);
  const oldRunning = aged('SK-ABCDEF000016', 'sweeping', 40, { paid: false });
  c.liveIndex.set('proj-old', { ref: oldPreview.ref, at: Date.now() });
  for (const j of [oldDone, oldPreview, freshDone, oldFailed, oldOwed, oldInterruptedPaid, oldRunning]) { fs.writeFileSync(file(j.ref), JSON.stringify({ ...saved(j.ref), updatedAt: j.updatedAt })); }
  const n = c.pruneLiveJobs();
  ok('past 30 days: a finished report, an unpaid preview and a failed paid report are deleted, file and memory', n === 3 && ![oldDone, oldPreview, oldFailed].some(j => c.liveJobs.has(j.ref) || fs.existsSync(file(j.ref))));
  ok('the index entry of a deleted preview goes with it', !c.liveIndex.has('proj-old'));
  ok('within 30 days nothing is deleted', c.liveJobs.has(freshDone.ref) && fs.existsSync(file(freshDone.ref)));
  ok('a paid report still owed to the buyer is kept at any age', c.liveJobs.has(oldOwed.ref) && c.liveJobs.has(oldInterruptedPaid.ref) && fs.existsSync(file(oldOwed.ref)));
  ok('one still running is never deleted', c.liveJobs.has(oldRunning.ref));
  ok('a second sweep finds nothing more', c.pruneLiveJobs() === 0);
  process.env.JOB_RETENTION_DAYS = '10';
  ok('the retention can be shortened with JOB_RETENTION_DAYS', c.pruneLiveJobs() === 1 && !c.liveJobs.has(freshDone.ref));
  delete process.env.JOB_RETENTION_DAYS;

  console.log('\nat start');
  const stale = { ...saved(freshDone.ref) || fake('SK-ABCDEF000020', 'done'), ref: 'SK-ABCDEF000020', status: 'done', paid: true, updatedAt: Date.now() - 45 * DAY };
  const young = { ...stale, ref: 'SK-ABCDEF000021', updatedAt: Date.now() - 2 * DAY };
  fs.writeFileSync(file(stale.ref), JSON.stringify(stale)); fs.writeFileSync(file(young.ref), JSON.stringify(young));
  const child = `Object.assign(process.env, ${JSON.stringify(ENV)}); delete process.env.DATABASE_URL; globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
    const app = require(${JSON.stringify(path.join(__dirname, '..', '..', 'server.js'))}); const { c } = require(${JSON.stringify(path.join(__dirname, '..', '..', 'app.js'))});
    console.log(JSON.stringify({ stale: c.liveJobs.has(${JSON.stringify(stale.ref)}), young: c.liveJobs.has(${JSON.stringify(young.ref)}) })); process.exit(0);`;
  const out = cp.spawnSync('node', ['-r', path.join(__dirname, 'stub-loader.js'), '-e', child], { encoding: 'utf8', timeout: 60000, cwd: path.join(__dirname, '..', '..') });
  const r = JSON.parse((out.stdout.trim().split('\n').filter(l => l.startsWith('{')).pop()) || '{}');
  ok('a restart deletes a file past the retention instead of loading it, and keeps a young one', r.stale === false && r.young === true && !fs.existsSync(file(stale.ref)) && fs.existsSync(file(young.ref)));
  if (r.young === undefined) console.log(out.stdout.slice(-300), out.stderr.slice(-500));
  process.exit(failures ? 1 : 0);
})();
