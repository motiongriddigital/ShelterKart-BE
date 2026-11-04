'use strict';
/** Failed jobs: a delivery that gave up, retried by hand once and never twice; the list; the id check; the register series. */
const assert = require('assert');
const { createDelivery } = require('../engine/delivery');
const { listFailed, retryFailed, registerSeries } = require('../engine/jobsAdmin');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const ENV = { RESEND_API_KEY: 'k', DELIVERY_FROM: 'ShelterKart <no-reply@shelterkart.test>' };
function rig() {
  const r = { up: false, sent: 0, gaveUp: [] };
  const fetchImpl = async () => { r.sent++; return r.up ? { ok: true, status: 200, json: async () => ({ id: 'em_' + r.sent }) } : { ok: false, status: 500, json: async () => ({}) }; };
  r.d = createDelivery({ env: ENV, fetchImpl, delays: [], onGiveUp: x => r.gaveUp.push(x) });
  return r;
}
const send = r => r.d.send({ ref: 'SK-ABC123', project: 'Hubtown Celeste', email: 'buyer.name@example.com', link: 'https://x.test/r/SK-ABC123', pdfLink: 'https://x.test/r/SK-ABC123/pdf' });

(async () => {
  console.log('a delivery that gave up');
  await t('it is listed with a masked address and the reason, and the operator was alerted once', async () => {
    const r = rig(); await send(r).done;
    const f = r.d.failed();
    assert.strictEqual(f.length, 1); assert.strictEqual(f[0].ref, 'SK-ABC123'); assert.strictEqual(f[0].channel, 'email'); assert.strictEqual(f[0].attempts, 1);
    assert(!/buyer\.name/.test(JSON.stringify(f)) && f[0].to === 'b•••@example.com', JSON.stringify(f)); assert(/Resend answered 500/.test(f[0].error)); assert.strictEqual(r.gaveUp.length, 1);
  });
  await t('a retry that fails again stays in the list, counts the attempt, and does not alert again', async () => {
    const r = rig(); await send(r).done;
    const out = r.d.retry('SK-ABC123', 'email'); assert.strictEqual(out.ok, true); await out.done;
    assert.strictEqual(r.d.failed().length, 1); assert.strictEqual(r.d.failed()[0].attempts, 2); assert.strictEqual(r.gaveUp.length, 1); assert.strictEqual(r.sent, 2);
  });
  await t('a retry that works removes it, and sends exactly one message', async () => {
    const r = rig(); await send(r).done; r.up = true; const before = r.sent;
    const out = r.d.retry('SK-ABC123', 'email'); await out.done;
    assert.strictEqual(r.d.failed().length, 0); assert.strictEqual(r.sent - before, 1);
  });
  await t('two retries at once run once; the second is refused as busy', async () => {
    const r = rig(); await send(r).done; r.up = true; const before = r.sent;
    const a = r.d.retry('SK-ABC123', 'email'), b = r.d.retry('SK-ABC123', 'email');
    assert.strictEqual(a.ok, true); assert.deepStrictEqual(b, { ok: false, code: 'busy' });
    await a.done; assert.strictEqual(r.sent - before, 1);
  });
  await t('a retry after it worked, or for a job that never failed, is refused', async () => {
    const r = rig(); await send(r).done; r.up = true; await r.d.retry('SK-ABC123', 'email').done;
    assert.deepStrictEqual(r.d.retry('SK-ABC123', 'email'), { ok: false, code: 'not_failed' }); assert.deepStrictEqual(r.d.retry('SK-NEVER', 'email'), { ok: false, code: 'not_failed' });
    assert.strictEqual(r.sent, 2);
  });
  await t('a delivery that works the first time is never listed', async () => { const r = rig(); r.up = true; await send(r).done; assert.strictEqual(r.d.failed().length, 0); });

  console.log('the list');
  const jobs = new Map([
    ['SK-REPORT1', { ref: 'SK-REPORT1', paid: true, status: 'failed', failedAt: Date.parse('2026-11-04T10:00:00Z'), failError: 'engine said no for someone@example.com at 10.1.2.3' }],
    ['SK-FREE1', { ref: 'SK-FREE1', paid: false, status: 'failed', failedAt: Date.now() }],
    ['SK-DONE1', { ref: 'SK-DONE1', paid: true, status: 'done' }],
    ['SK-RUN1', { ref: 'SK-RUN1', paid: true, status: 'completing' }],
  ]);
  await t('only paid reports that are failed now are listed, with the reason scrubbed', async () => {
    const r = rig(); await send(r).done;
    const out = listFailed({ liveJobs: jobs, delivery: r.d });
    assert.strictEqual(out.total, 2); assert.deepStrictEqual(out.jobs.map(j => j.id).sort(), ['delivery:SK-ABC123:email', 'report:SK-REPORT1']);
    assert(!/someone@example|10\.1\.2\.3/.test(JSON.stringify(out)), JSON.stringify(out)); assert(out.jobs.every(j => j.retryable === true));
  });
  await t('the list can be limited', async () => { const r = rig(); await send(r).done; assert.strictEqual(listFailed({ liveJobs: jobs, delivery: r.d, limit: 1 }).jobs.length, 1); });
  await t('an empty system gives an empty list', async () => assert.deepStrictEqual(listFailed({ liveJobs: new Map(), delivery: rig().d }), { total: 0, jobs: [] }));

  console.log('the retry id');
  const calls = []; const retryReport = ref => { calls.push(ref); return { ok: true }; };
  await t('ids that are not in the list shape are invalid and run nothing', async () => {
    const r = rig();
    for (const id of ['', 'abc', 'report:', 'report', 'delivery:SK-ABC123', 'report:SK-1:email', 'job:SK-1', '../etc/passwd', 'report:SK 1', 'delivery:SK-1:sms', 'report:' + 'A'.repeat(200), undefined, null])
      assert.deepStrictEqual(retryFailed(id, { liveJobs: jobs, delivery: r.d, retryReport }), { ok: false, code: 'invalid' }, String(id));
    assert.strictEqual(calls.length, 0);
  });
  await t('a report id calls the report retry once with the reference', async () => { assert.deepStrictEqual(retryFailed('report:SK-REPORT1', { liveJobs: jobs, delivery: rig().d, retryReport }), { ok: true }); assert.deepStrictEqual(calls, ['SK-REPORT1']); });
  await t('a delivery id goes to the delivery retry', async () => {
    const r = rig(); await send(r).done; r.up = true;
    assert.deepStrictEqual(retryFailed('delivery:SK-ABC123:email', { liveJobs: jobs, delivery: r.d, retryReport }), { ok: true });
    assert.deepStrictEqual(retryFailed('delivery:SK-ABC123:whatsapp', { liveJobs: jobs, delivery: r.d, retryReport }), { ok: false, code: 'not_failed' });
  });

  console.log('register history');
  const markets = { in: { label: 'India', registry: 'in' }, uk: { label: 'United Kingdom', registry: 'gb' }, jp: { label: 'Japan', registry: null } };
  await t('one series per market with a register, oldest first, with the uptime of the counted checks', async () => {
    const s = registerSeries([
      { market: 'in', state: 'down', reason: 'failing', at: '2026-11-03T00:00:00Z' }, { market: 'in', state: 'healthy', at: '2026-11-02T00:00:00Z' },
      { market: 'in', state: 'healthy', at: '2026-11-04T00:00:00Z' }, { market: 'in', state: 'skipped', at: '2026-11-04T01:00:00Z' }], markets);
    assert.deepStrictEqual(s.map(x => x.market), ['in', 'uk']);
    assert.deepStrictEqual(s[0].points.map(p => p.at), ['2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z', '2026-11-04T00:00:00Z', '2026-11-04T01:00:00Z']);
    assert.strictEqual(s[0].checks, 4); assert.strictEqual(s[0].healthy, 2); assert.strictEqual(s[0].uptime, 0.667); assert.strictEqual(s[0].latest, 'skipped');
    assert.deepStrictEqual([s[1].checks, s[1].uptime, s[1].latest, s[1].points], [0, null, null, []]);
  });

  console.log('\n' + (failed ? failed + ' FAILED' : 'all ' + passed + ' passing'));
  if (failed) process.exitCode = 1;
})();
