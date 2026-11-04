'use strict';
/** Encrypted backups: the file format and its round trip, tampering, a wrong key, failures, the schedule, the notice and the admin routes. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { createBackups, decryptFile, readKeys, scrubError, pgEnv } = require('../engine/backups');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const KEY_A = crypto.randomBytes(32).toString('hex'), KEY_B = crypto.randomBytes(32).toString('hex');
const quiet = { error() {} };
const DUMP = crypto.randomBytes(300000);
const okDump = (buf = DUMP) => () => ({ stream: Readable.from([buf.subarray(0, 100000), buf.subarray(100000)]), done: Promise.resolve() });
const mk = (over = {}, env = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skbk-')), c = { t: Date.parse('2026-11-04T10:00:00Z') };
  const b = createBackups({ env: { BACKUP_DIR: dir, BACKUP_KEY_ID: 'k1', BACKUP_KEY_k1: KEY_A, DATABASE_URL: 'postgres://u:pw@h/db', ...env }, now: () => c.t, dump: okDump(), log: quiet, ...over });
  return { b, dir, c };
};
const files = dir => fs.readdirSync(dir);
const keyFor = id => ({ k1: Buffer.from(KEY_A, 'hex'), k2: Buffer.from(KEY_B, 'hex') }[id]);

(async () => {
  console.log('keys and settings');
  await t('keys are read from BACKUP_KEY_<id> as 64 hex characters; bad ones and a missing active id leave backups off', () => {
    const r = readKeys({ BACKUP_KEY_ID: 'k1', BACKUP_KEY_k1: KEY_A, BACKUP_KEY_bad: 'zz', BACKUP_KEY_short: 'abcd' });
    assert.deepStrictEqual([...r.keys.keys()], ['k1']); assert.strictEqual(r.active, 'k1');
    assert.strictEqual(readKeys({ BACKUP_KEY_ID: 'k9', BACKUP_KEY_k1: KEY_A }).active, null);
    assert.strictEqual(readKeys({ BACKUP_KEY_k1: KEY_A }).active, null);
  });
  await t('the database connection goes to pg_dump as PG* variables, never as an argument', () => {
    const e = pgEnv('postgres://us%40er:p%40ss@db.example.com:6543/shelter?sslmode=require');
    assert.deepStrictEqual(e, { PGHOST: 'db.example.com', PGPORT: '6543', PGDATABASE: 'shelter', PGUSER: 'us@er', PGPASSWORD: 'p@ss', PGSSLMODE: 'require' });
  });
  await t('an error message loses connection strings, passwords and long tokens', () => {
    const s = scrubError('could not connect postgres://u:secret@h/db password=hunter2 ' + 'a'.repeat(40) + ' \u0007x');
    assert(!/secret|hunter2|aaaa|postgres:/.test(s)); assert(s.length <= 300);
  });

  console.log('a backup');
  await t('without a key, or without a database, nothing runs and the reason is clear', async () => {
    const { b } = mk({}, { BACKUP_KEY_ID: '' }); const r = await b.run('manual');
    assert.strictEqual(r.status, 409); assert.strictEqual(r.code, 'not_configured'); assert.strictEqual(b.enabled, false);
    const n = createBackups({ env: { BACKUP_KEY_ID: 'k1', BACKUP_KEY_k1: KEY_A }, log: quiet }); assert.strictEqual(n.enabled, false);
  });
  await t('a run writes one encrypted file, records it, and the file decrypts to exactly the dump', async () => {
    const { b, dir } = mk(); const r = await b.run('manual');
    assert.strictEqual(r.ok, true); const name = r.backup.fileName; assert.deepStrictEqual(files(dir), [name]);
    const raw = fs.readFileSync(path.join(dir, name));
    assert.strictEqual(raw.subarray(0, 5).toString(), 'SKBK1'); assert(!raw.includes(DUMP.subarray(1000, 1032)));
    assert.strictEqual(r.backup.sha256, crypto.createHash('sha256').update(raw).digest('hex')); assert.strictEqual(r.backup.sizeBytes, raw.length);
    const out = path.join(dir, 'restored.dump'); assert.deepStrictEqual(await decryptFile(path.join(dir, name), out, keyFor), { keyId: 'k1' });
    assert(fs.readFileSync(out).equals(DUMP));
    const rows = await b.list(); assert.strictEqual(rows.length, 1); assert.strictEqual(rows[0].status, 'ok'); assert.strictEqual(rows[0].trigger, 'manual');
  });
  await t('two backups never share an iv, and the stored file mode is private', async () => {
    const { b, dir, c } = mk(); const a = await b.run(); c.t += 1000; const z = await b.run();
    const iv = n => fs.readFileSync(path.join(dir, n)).subarray(8, 20).toString('hex'); assert.notStrictEqual(iv(a.backup.fileName), iv(z.backup.fileName));
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(path.join(dir, a.backup.fileName)).mode & 0o077, 0);
  });
  await t('changing one byte, or using the wrong key, is refused and leaves no output file', async () => {
    const { b, dir } = mk(); const r = await b.run(), f = path.join(dir, r.backup.fileName), raw = fs.readFileSync(f);
    const bad = Buffer.from(raw); bad[bad.length >> 1] ^= 1; const fb = path.join(dir, 'bad.skbk'); fs.writeFileSync(fb, bad);
    await assert.rejects(decryptFile(fb, path.join(dir, 'o1'), keyFor), /wrong key or the file was changed/); assert(!fs.existsSync(path.join(dir, 'o1')));
    await assert.rejects(decryptFile(f, path.join(dir, 'o2'), () => Buffer.from(KEY_B, 'hex')), /wrong key or the file was changed/); assert(!fs.existsSync(path.join(dir, 'o2')));
    await assert.rejects(decryptFile(f, path.join(dir, 'o3'), () => null), /no key for id k1/);
    fs.writeFileSync(path.join(dir, 'x.txt'), 'hello world, not a backup'); await assert.rejects(decryptFile(path.join(dir, 'x.txt'), path.join(dir, 'o4'), keyFor), /not a ShelterKart backup/);
  });
  await t('an old file stays readable after the active key changes; the new file names the new key', async () => {
    const { b, dir } = mk(); const old = await b.run();
    const b2 = createBackups({ env: { BACKUP_DIR: dir, BACKUP_KEY_ID: 'k2', BACKUP_KEY_k1: KEY_A, BACKUP_KEY_k2: KEY_B, DATABASE_URL: 'x://y' }, dump: okDump(), log: quiet });
    const neu = await b2.run(); assert.strictEqual(neu.backup.keyId, 'k2');
    assert.deepStrictEqual(await decryptFile(path.join(dir, old.backup.fileName), path.join(dir, 'a'), keyFor), { keyId: 'k1' });
    assert.deepStrictEqual(await decryptFile(path.join(dir, neu.backup.fileName), path.join(dir, 'b'), keyFor), { keyId: 'k2' });
  });
  await t('a failing dump is recorded as failed with a scrubbed reason, no file is left, and the next run still works', async () => {
    let n = 0; const bad = () => ({ stream: Readable.from([Buffer.from('partial')]), done: Promise.reject(new Error('pg_dump exited 1: connection to postgres://u:topsecret@h/db refused')) });
    const { b, dir } = mk({ dump: () => (n++ ? okDump()() : bad()) });
    const r = await b.run(); assert.strictEqual(r.status, 502); assert.strictEqual(r.code, 'failed'); assert(!/topsecret|postgres:/.test(r.error));
    assert.deepStrictEqual(files(dir), []); const rows = await b.list(); assert.strictEqual(rows[0].status, 'failed'); assert(!/topsecret/.test(rows[0].error));
    assert.strictEqual((await b.run()).ok, true);
  });
  await t('an empty dump is a failure, not a good backup', async () => {
    const { b, dir } = mk({ dump: () => ({ stream: Readable.from([]), done: Promise.resolve() }) });
    const r = await b.run(); assert.strictEqual(r.ok, false); assert.deepStrictEqual(files(dir), []);
  });
  await t('only one backup runs at a time', async () => {
    let release; const gate = new Promise(r => { release = r; });
    const slow = () => ({ stream: Readable.from((async function* () { await gate; yield DUMP; })()), done: Promise.resolve() });
    const { b } = mk({ dump: slow }); const first = b.run(); await new Promise(r => setTimeout(r, 20));
    const second = await b.run(); assert.strictEqual(second.status, 409); assert.strictEqual(second.code, 'running');
    release(); assert.strictEqual((await first).ok, true);
  });
  await t('only the newest BACKUP_KEEP good files are kept; failed attempts never count', async () => {
    const { b, dir, c } = mk({}, { BACKUP_KEEP: '3' }); const names = [];
    for (let i = 0; i < 5; i++) { c.t += 60000; names.push((await b.run()).backup.fileName); }
    assert.deepStrictEqual(files(dir).sort(), names.slice(2).sort());
  });

  console.log('the notice and the schedule');
  await t('the notice: off without setup; a warning before the first backup; ok after one; overdue after the period plus two days; error after a failure', async () => {
    assert.strictEqual((await mk({}, { BACKUP_KEY_ID: '' }).b.notice()).level, 'off');
    const { b, c } = mk(); assert.strictEqual((await b.notice()).level, 'warn');
    await b.run(); let n = await b.notice(); assert.strictEqual(n.level, 'ok'); assert.strictEqual(n.nextDueAt, '2026-11-18T10:00:00.000Z'); assert.strictEqual(n.overdue, false);
    c.t += 15 * 86400e3; assert.strictEqual((await b.notice()).level, 'ok');
    c.t += 2 * 86400e3; n = await b.notice(); assert.strictEqual(n.level, 'warn'); assert.strictEqual(n.overdue, true);
    const f = mk({ dump: () => ({ stream: Readable.from([]), done: Promise.reject(new Error('boom')) }) }); await f.b.run(); assert.strictEqual((await f.b.notice()).level, 'error');
  });
  await t('a failure after a good backup turns the notice to error and names the last good date', async () => {
    let fail = false; const { b, c } = mk({ dump: () => (fail ? { stream: Readable.from([]), done: Promise.reject(new Error('disk full')) } : okDump()()) });
    await b.run(); fail = true; c.t += 1000; await b.run(); const n = await b.notice(); assert.strictEqual(n.level, 'error'); assert(/2026-11-04/.test(n.text));
  });
  await t('the schedule starts a backup when none has succeeded for 14 days, not before, and waits six hours after a failure', async () => {
    let calls = 0; const { b, c } = mk({ dump: () => { calls++; return okDump()(); } });
    await b.checkDue(); assert.strictEqual(calls, 1);
    c.t += 13 * 86400e3; await b.checkDue(); assert.strictEqual(calls, 1);
    c.t += 86400e3; await b.checkDue(); assert.strictEqual(calls, 2);
    let n = 0; const f = mk({ dump: () => { n++; return { stream: Readable.from([]), done: Promise.reject(new Error('x')) }; } });
    await f.b.checkDue(); f.c.t += 3600e3; await f.b.checkDue(); assert.strictEqual(n, 1); f.c.t += 6 * 3600e3; await f.b.checkDue(); assert.strictEqual(n, 2);
  });

  console.log('the admin routes');
  function routes(b) {
    const reg = []; const app = {}; for (const m of ['get', 'post']) app[m] = (p, ...h) => reg.push({ m, p, h });
    const auth = (req, res, next) => (req.headers.authorization === 'ok' ? next() : res.status(401).json({ ok: false, error: 'no' }));
    b.mountAdmin(app, { adminAuth: auth, ah: fn => (q, r, n) => Promise.resolve(fn(q, r, n)).catch(n) });
    return async (m, p, headers = { authorization: 'ok' }, query = {}) => new Promise(resolve => {
      const route = reg.find(r => r.m === m && r.p === p); assert(route, p);
      const res = { code: 200, status(c) { this.code = c; return this; }, set() { return this; }, json(o) { resolve({ code: this.code, body: o }); return this; } };
      let i = 0; const next = () => { const f = route.h[i++]; if (f) f({ headers, query, body: {} }, res, next); }; next();
    });
  }
  await t('every route needs the admin login', async () => {
    const call = routes(mk().b);
    for (const [m, p] of [['get', '/api/admin/backups'], ['post', '/api/admin/backups/run'], ['get', '/api/admin/backups/notice'], ['get', '/api/admin/backups/keys']]) assert.strictEqual((await call(m, p, {})).code, 401, p);
  });
  await t('run, list, notice and keys answer, and no response ever contains key material', async () => {
    const { b } = mk(); const call = routes(b);
    const run = await call('post', '/api/admin/backups/run'); assert.strictEqual(run.code, 200); assert.strictEqual(run.body.backup.keyId, 'k1');
    const list = await call('get', '/api/admin/backups'); assert.strictEqual(list.body.enabled, true); assert.strictEqual(list.body.everyDays, 14); assert.strictEqual(list.body.backups.length, 1);
    const note = await call('get', '/api/admin/backups/notice'); assert.strictEqual(note.body.notice.level, 'ok');
    const keys = await call('get', '/api/admin/backups/keys'); assert.deepStrictEqual(keys.body.keys.map(k => [k.id, k.active, k.ageDays]), [['k1', true, 0]]);
    const all = JSON.stringify([run, list, note, keys]); assert(!all.includes(KEY_A)); assert(!all.includes(Buffer.from(KEY_A, 'hex').toString('base64')));
    const again = await call('get', '/api/admin/backups', undefined, { limit: '1' }); assert.strictEqual(again.body.backups.length, 1);
  });
  await t('a manual run when backups are not set up answers 409 with the reason', async () => {
    const call = routes(mk({}, { BACKUP_KEY_ID: '' }).b); const r = await call('post', '/api/admin/backups/run');
    assert.strictEqual(r.code, 409); assert.strictEqual(r.body.code, 'not_configured');
  });

  console.log(failed ? '\n' + failed + ' FAILED' : '\nall ' + passed + ' passing');
  if (failed) process.exitCode = 1;
})();
