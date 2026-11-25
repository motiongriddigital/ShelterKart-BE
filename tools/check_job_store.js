#!/usr/bin/env node
'use strict';
/**
 * Prove the Postgres job store (backend/engine/pgJobStore.js) against a real database, with two server instances sharing it:
 *
 *   DATABASE_URL=postgres://... node tools/check_job_store.js
 *
 * Needs the migrations applied. Uses its own references (SK-CHK...) and removes them afterwards.
 */
const assert = require('assert'), path = require('path');
const { createPgJobStore } = require(path.join(__dirname, '..', 'backend', 'engine', 'pgJobStore'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const quiet = { error() {}, log() {} };
const rec = (ref, over = {}) => ({ ref, input: { query: 'Sky Villas', country: 'IN' }, status: 'sweeping', paid: false, createdAt: Date.now(), updatedAt: Date.now(), saved: null, ...over });
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

(async () => {
  if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2); }
  const { Pool } = require(path.join(__dirname, '..', 'backend', 'node_modules', 'pg'));
  const pool = new Pool(require('../backend/lib/dbConfig').poolOptions(process.env));
  const clean = () => pool.query(`DELETE FROM live_jobs WHERE ref LIKE 'SK-CHK%'`);
  await clean();
  const make = (id, leaseMs = 60000) => createPgJobStore({ pool, instanceId: id, leaseMs, log: quiet });
  const rowOf = async ref => (await pool.query(`SELECT * FROM live_jobs WHERE ref=$1`, [ref])).rows[0];

  await t('a saved job comes back whole, an idle one as saved and a working one as claimed', async () => {
    const A = make('A');
    A.save(rec('SK-CHK000000001', { status: 'done', saved: { dossier: { phase: 'complete' } } })); A.save(rec('SK-CHK000000002', { status: 'sweeping' })); await A.flush();
    const B = make('B'); const r = await B.loadAll();
    assert(r.idle.some(x => x.ref === 'SK-CHK000000001' && x.saved.dossier.phase === 'complete'), 'idle job');
    assert(r.mine.length === 0 && r.elsewhere >= 1, 'a job A is working on is left to A: ' + JSON.stringify({ mine: r.mine.length, elsewhere: r.elsewhere }));
    const again = await A.loadAll(); assert(again.mine.some(x => x.ref === 'SK-CHK000000002'), 'the holder gets its own job back');
    const row = await rowOf('SK-CHK000000001'); assert.strictEqual(row.owner, null); assert.strictEqual(row.lease_until, null);
  });
  await t('an instance that does not hold a working job cannot overwrite or remove it', async () => {
    const A = make('A2'), B = make('B2');
    A.save(rec('SK-CHK000000003', { status: 'completing', paid: true, costUsd: 1 })); await A.flush();
    B.save(rec('SK-CHK000000003', { status: 'failed', paid: true, costUsd: 99 })); await B.flush();
    assert.strictEqual((await rowOf('SK-CHK000000003')).payload.costUsd, 1, 'B overwrote A');
    await B.remove('SK-CHK000000003'); assert(await rowOf('SK-CHK000000003'), 'B removed A’s job');
  });
  await t('a lease is renewed by the heartbeat, and a job whose lease ran out is taken over; the old holder is told', async () => {
    const A = make('A3', 1500), B = make('B3', 1500);
    A.save(rec('SK-CHK000000004', { status: 'completing', paid: true })); await A.flush();
    await sleep(900); assert.deepStrictEqual(await A.heartbeat(['SK-CHK000000004']), []);
    await sleep(900); assert.strictEqual((await B.claim('SK-CHK000000004')), null, 'renewed lease still holds');
    await sleep(1700);
    const took = await B.claim('SK-CHK000000004'); assert(took && took.ref === 'SK-CHK000000004', 'taken over after the lease ran out');
    assert.deepStrictEqual(await A.heartbeat(['SK-CHK000000004']), ['SK-CHK000000004'], 'the old holder learns it lost the job');
    A.save(rec('SK-CHK000000004', { status: 'failed', paid: true, costUsd: 7 })); await A.flush();
    assert.notStrictEqual((await rowOf('SK-CHK000000004')).payload.costUsd, 7, 'the old holder wrote over the new one');
  });
  await t('a start-up takes over jobs of a dead instance and leaves a live instance’s jobs alone', async () => {
    const dead = make('DEAD', 800), live = make('LIVE', 60000);
    dead.save(rec('SK-CHK000000005', { status: 'sweeping' })); live.save(rec('SK-CHK000000006', { status: 'sweeping' })); await dead.flush(); await live.flush();
    await sleep(1400);
    const fresh = make('FRESH'); const r = await fresh.loadAll();
    assert(r.mine.some(x => x.ref === 'SK-CHK000000005'), 'the dead one’s job is claimed');
    assert(!r.mine.some(x => x.ref === 'SK-CHK000000006'), 'the live one’s job is not touched');
    assert.strictEqual((await rowOf('SK-CHK000000005')).owner, 'FRESH');
  });
  await t('a running instance notices a crashed one without a restart: claimExpired takes only what nobody holds', async () => {
    const dead = make('DEAD2', 700), live = make('LIVE2', 60000), me = make('ME2');
    dead.save(rec('SK-CHK000000011', { status: 'completing', paid: true })); live.save(rec('SK-CHK000000012', { status: 'completing', paid: true })); dead.save(rec('SK-CHK000000013', { status: 'preview', paid: false }));
    await dead.flush(); await live.flush();
    const mine = r => r.map(x => x.ref).filter(ref => ['SK-CHK000000011', 'SK-CHK000000012', 'SK-CHK000000013'].includes(ref));
    assert.deepStrictEqual(mine(await me.claimExpired()), [], 'nothing is free while both leases hold');
    await sleep(1400);
    const took = mine(await me.claimExpired()); assert.deepStrictEqual(took, ['SK-CHK000000011'], 'only the dead one\u2019s working job: ' + took);
    assert.deepStrictEqual(mine(await me.claimExpired()), [], 'and only once');
  });
  await t('a payment that lands on another instance is handed to the holder, once, and survives the holder’s own saves', async () => {
    const A = make('A4'), B = make('B4');
    A.save(rec('SK-CHK000000007', { status: 'preview', paid: false })); await A.flush();
    assert.strictEqual((await B.peek('SK-CHK000000007')).held, false, 'an unpaid first look is nobody’s to hold');
    A.save(rec('SK-CHK000000008', { status: 'sweeping', paid: false })); await A.flush();
    const seen = await B.peek('SK-CHK000000008'); assert(seen.held && !seen.heldByMe && seen.owner === 'A4');
    assert.strictEqual(await B.markPaid('SK-CHK000000008', { purchaseId: 'p-1', email: 'buyer@example.com' }), true);
    A.save(rec('SK-CHK000000008', { status: 'sweeping', paid: false, costUsd: 2 })); await A.flush();
    const note = (await A.remotePaid()).find(x => x.ref === 'SK-CHK000000008'); assert(note, 'the holder sees the note after its own save');
    assert.deepStrictEqual([note.purchaseId, note.email], ['p-1', 'buyer@example.com']);
    assert.strictEqual((await rowOf('SK-CHK000000008')).paid, true, 'paid is never taken back by a later save');
    await A.ackPaid('SK-CHK000000008'); assert(!(await A.remotePaid()).some(x => x.ref === 'SK-CHK000000008'), 'acknowledged');
    assert.deepStrictEqual(await B.remotePaid(), [], 'only the holder is told');
  });
  await t('fifty saves in a burst write the newest, and flush waits for them', async () => {
    const A = make('A5'); for (let i = 0; i < 50; i++) A.save(rec('SK-CHK000000009', { status: 'done', costUsd: i }));
    await A.flush(); assert.strictEqual((await rowOf('SK-CHK000000009')).payload.costUsd, 49);
  });
  await t('a removed job is gone, and a held job’s remove by its holder works', async () => {
    const A = make('A6'); A.save(rec('SK-CHK000000010', { status: 'sweeping' })); await A.flush();
    await A.remove('SK-CHK000000010'); assert.strictEqual(await rowOf('SK-CHK000000010'), undefined);
  });

  await clean(); await pool.end();
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
