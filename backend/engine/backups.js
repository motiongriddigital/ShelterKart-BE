'use strict';
/**
 * ShelterKart: encrypted database backups behind the admin panel's Settings, Database backups screens.
 *
 * pg_dump (custom format) is streamed through AES-256-GCM into a file in the destination folder, the file is hashed and
 * re-read to check the hash, and the attempt is recorded in `backups`. The key comes from the environment
 * (BACKUP_KEY_<id> = 64 hex characters, BACKUP_KEY_ID = the id to encrypt with); it is never stored, logged or returned.
 * File layout: "SKBK1" | key id length (1 byte) | key id | iv (12) | ciphertext | auth tag (16). tools/backup-decrypt.js reverses it.
 * Runs every BACKUP_EVERY_DAYS (14) days and on demand; keeps the newest BACKUP_KEEP (6) good files. Off until a key is set.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MAGIC = Buffer.from('SKBK1');
const KEY_ID_RE = /^[A-Za-z0-9]{1,16}$/;
const HOUR = 3600e3, DAY = 86400e3;

/** Removes connection strings, passwords and long tokens from a message before it is stored or shown. */
function scrubError(text) {
  return String(text == null ? '' : text).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi, '[url]')
    .replace(/(password|passwd|pwd)\s*[=:]\s*\S+/gi, '$1=[hidden]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[token]').trim().slice(0, 300);
}

/** Active key id and the keys that can decrypt, from the environment. Bad entries are ignored, never echoed. */
function readKeys(env) {
  const keys = new Map();
  for (const [name, value] of Object.entries(env)) {
    const m = /^BACKUP_KEY_([A-Za-z0-9]{1,16})$/.exec(name);
    if (m && m[1] !== 'ID' && /^[0-9a-fA-F]{64}$/.test(String(value || ''))) keys.set(m[1], Buffer.from(value, 'hex'));
  }
  const active = String(env.BACKUP_KEY_ID || '');
  return { keys, active: KEY_ID_RE.test(active) && keys.has(active) ? active : null };
}

/** pg_dump reads the connection from PG* variables, so the password never appears in the process list. */
function pgEnv(url) {
  const u = new URL(url), e = { PGHOST: u.hostname, PGPORT: u.port || '5432', PGDATABASE: decodeURIComponent(u.pathname.slice(1)), PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password) };
  const ssl = u.searchParams.get('sslmode'); if (ssl) e.PGSSLMODE = ssl;
  return e;
}

function realDump(url) {
  return () => {
    const child = spawn('pg_dump', ['--format=custom', '--no-owner'], { env: { ...process.env, ...pgEnv(url) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => { if (err.length < 2000) err += d; });
    const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => (code === 0 ? resolve() : reject(new Error('pg_dump exited ' + code + (err ? ': ' + err : ''))))); });
    done.catch(() => {});
    return { stream: child.stdout, done };
  };
}

function memoryRecords() {
  const rows = []; let seq = 0;
  return {
    async start(r) { const row = { id: ++seq, startedAt: r.at, finishedAt: null, trigger: r.trigger, status: 'running', fileName: null, sizeBytes: null, sha256: null, keyId: r.keyId, destination: r.destination, error: null }; rows.push(row); return row.id; },
    async finish(id, f) { Object.assign(rows.find(r => r.id === id), f); },
    async list(limit) { return rows.slice().reverse().slice(0, limit).map(r => ({ ...r })); },
    async lastOk() { return rows.slice().reverse().find(r => r.status === 'ok') || null; },
    async last() { return rows[rows.length - 1] || null; },
    async keyFirstUsed() { const m = new Map(); for (const r of rows) if (r.keyId && !m.has(r.keyId)) m.set(r.keyId, r.startedAt); return m; },
    async failRunning(why, at) { for (const r of rows) if (r.status === 'running') { r.status = 'failed'; r.finishedAt = at; r.error = why; } },
  };
}

function pgRecords(pool) {
  const rowOf = r => ({ id: Number(r.id), startedAt: new Date(r.started_at), finishedAt: r.finished_at ? new Date(r.finished_at) : null, trigger: r.trigger, status: r.status, fileName: r.file_name, sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes), sha256: r.sha256, keyId: r.key_id, destination: r.destination, error: r.error });
  const COLS = 'id, started_at, finished_at, trigger, status, file_name, size_bytes, sha256, key_id, destination, error';
  return {
    async start(r) { return Number((await pool.query(`INSERT INTO backups (started_at, trigger, status, key_id, destination) VALUES ($1,$2,'running',$3,$4) RETURNING id`, [r.at, r.trigger, r.keyId, r.destination])).rows[0].id); },
    async finish(id, f) { await pool.query(`UPDATE backups SET status=$2, finished_at=$3, file_name=$4, size_bytes=$5, sha256=$6, error=$7 WHERE id=$1`, [id, f.status, f.finishedAt, f.fileName || null, f.sizeBytes == null ? null : f.sizeBytes, f.sha256 || null, f.error || null]); },
    async list(limit) { return (await pool.query(`SELECT ${COLS} FROM backups ORDER BY started_at DESC, id DESC LIMIT $1`, [limit])).rows.map(rowOf); },
    async lastOk() { const r = (await pool.query(`SELECT ${COLS} FROM backups WHERE status='ok' ORDER BY started_at DESC, id DESC LIMIT 1`)).rows[0]; return r ? rowOf(r) : null; },
    async last() { const r = (await pool.query(`SELECT ${COLS} FROM backups ORDER BY started_at DESC, id DESC LIMIT 1`)).rows[0]; return r ? rowOf(r) : null; },
    async keyFirstUsed() { const m = new Map(); for (const r of (await pool.query(`SELECT key_id, MIN(started_at) AS first FROM backups WHERE key_id IS NOT NULL GROUP BY key_id`)).rows) m.set(r.key_id, new Date(r.first)); return m; },
    async failRunning(why, at) { await pool.query(`UPDATE backups SET status='failed', finished_at=$2, error=$1 WHERE status='running'`, [why, at]); },
  };
}

/** The destination is a folder. An object store would implement the same three calls: put(tmpPath, name), list(), remove(name). */
function folderDestination(dir) {
  return {
    name: 'folder',
    async put(tmp, name) { await fs.promises.mkdir(dir, { recursive: true }); await fs.promises.rename(tmp, path.join(dir, name)); return path.join(dir, name); },
    async list() { try { return (await fs.promises.readdir(dir)).filter(f => /^db-.*\.skbk$/.test(f)).sort(); } catch { return []; } },
    async remove(name) { await fs.promises.unlink(path.join(dir, name)).catch(() => {}); },
    dir,
  };
}

function createBackups({ pool = null, env = process.env, now = () => Date.now(), dump = null, destination = null, records = null, log = console, tmpDir = null } = {}) {
  const { keys, active } = readKeys(env);
  const everyDays = Math.min(90, Math.max(1, Number(env.BACKUP_EVERY_DAYS) || 14));
  const keep = Math.min(100, Math.max(1, Number(env.BACKUP_KEEP) || 6));
  const dest = destination || folderDestination(env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups'));
  const dumper = dump || (env.DATABASE_URL ? realDump(env.DATABASE_URL) : null);
  const rec = records || (pool ? pgRecords(pool) : memoryRecords());
  const enabled = Boolean(active && dumper);
  let running = false, timer = null;
  const recent = [];
  const remember = row => { recent.unshift(row); if (recent.length > 20) recent.length = 20; };
  if (String(env.BACKUP_KEY_ID || '').trim() && !active)
    (log.warn || log.error).call(log, '[backups] backups are off: BACKUP_KEY_ID names ' + (KEY_ID_RE.test(String(env.BACKUP_KEY_ID)) ? 'a key id with no valid BACKUP_KEY_<id> (64 hexadecimal characters)' : 'an invalid key id (1 to 16 letters or digits)') + '.');

  async function encryptTo(stream, file, keyId) {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', keys.get(keyId), iv);
    const head = Buffer.concat([MAGIC, Buffer.from([keyId.length]), Buffer.from(keyId), iv]);
    const out = fs.createWriteStream(file, { mode: 0o600 });
    await new Promise((resolve, reject) => {
      out.on('error', reject); stream.on('error', reject); cipher.on('error', reject);
      out.on('finish', resolve);
      out.write(head);
      stream.pipe(cipher, { end: true });
      cipher.on('data', c => { if (!out.write(c)) { cipher.pause(); out.once('drain', () => cipher.resume()); } });
      cipher.on('end', () => { out.end(cipher.getAuthTag()); });
    });
  }

  async function hashFile(file) {
    const h = crypto.createHash('sha256'); let size = 0;
    await new Promise((resolve, reject) => { const s = fs.createReadStream(file); s.on('data', c => { h.update(c); size += c.length; }); s.on('error', reject); s.on('end', resolve); });
    return { sha256: h.digest('hex'), size };
  }

  /** One backup. Never throws: the outcome is the returned row and the `backups` record. */
  async function run(trigger = 'manual') {
    if (!enabled) return { ok: false, status: 409, code: 'not_configured', error: 'Backups are not set up: a key and a database are needed.' };
    if (running) return { ok: false, status: 409, code: 'running', error: 'A backup is already running.' };
    running = true;
    const startedAt = new Date(now()), stamp = startedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''), name = `db-${stamp}-${active}.skbk`;
    const tmpBase = tmpDir || (dest.dir ? dest.dir : require('os').tmpdir()), tmp = path.join(tmpBase, `.${name}.partial`);
    let id = null;
    try {
      await fs.promises.mkdir(tmpBase, { recursive: true });
      id = await rec.start({ at: startedAt, trigger, keyId: active, destination: dest.name });
      const d = dumper();
      const settled = await Promise.allSettled([encryptTo(d.stream, tmp, active), d.done]);
      const bad = settled.find(x => x.status === 'rejected'); if (bad) throw bad.reason;
      const first = await hashFile(tmp);
      if (first.size <= 6 + active.length + 12 + 16) throw new Error('the backup came out empty');
      await dest.put(tmp, name);
      const check = await hashFile(path.join(dest.dir || tmpBase, name));
      if (check.sha256 !== first.sha256) throw new Error('the stored file does not match what was written');
      await rec.finish(id, { status: 'ok', finishedAt: new Date(now()), fileName: name, sizeBytes: first.size, sha256: first.sha256 });
      await prune();
      return { ok: true, status: 200, backup: { id, fileName: name, sizeBytes: first.size, sha256: first.sha256, keyId: active } };
    } catch (e) {
      await fs.promises.unlink(tmp).catch(() => {});
      const why = scrubError(e && e.message);
      log.error('[backups] backup failed:', why);
      if (id != null) await rec.finish(id, { status: 'failed', finishedAt: new Date(now()), error: why }).catch(() => {});
      remember({ id, startedAt, finishedAt: new Date(now()), trigger, status: 'failed', fileName: null, sizeBytes: null, sha256: null, keyId: active, destination: dest.name, error: why });
      return { ok: false, status: 502, code: 'failed', error: 'The backup failed: ' + why };
    } finally { running = false; }
  }

  async function prune() {
    try {
      const good = new Set((await rec.list(200)).filter(r => r.status === 'ok' && r.fileName).map(r => r.fileName));
      const files = (await dest.list()).filter(f => good.has(f));
      for (const f of files.slice(0, Math.max(0, files.length - keep))) await dest.remove(f);
    } catch (e) { log.error('[backups] clean-up failed:', scrubError(e && e.message)); }
  }

  /** What the admin header shows. level: off | ok | warn | error. */
  async function notice() {
    const t = now();
    if (!enabled) return { level: 'off', text: 'Backups are not set up yet.', lastOkAt: null, nextDueAt: null, overdue: false, everyDays };
    let ok, last;
    try { [ok, last] = [await rec.lastOk(), await rec.last()]; }
    catch (e) {
      log.error('[backups] the backup records cannot be read:', scrubError(e && e.message));
      return { level: 'error', text: 'The backup records cannot be read, so the state of the backups is unknown.' + (recent.length ? ' The last attempt on this server failed.' : ''), lastOkAt: null, nextDueAt: null, overdue: true, everyDays, recordsAvailable: false };
    }
    const lastOkAt = ok ? ok.finishedAt || ok.startedAt : null, nextDue = lastOkAt ? new Date(lastOkAt.getTime() + everyDays * DAY) : null;
    const overdue = !nextDue || t > nextDue.getTime() + 2 * DAY;
    const day = d => d.toISOString().slice(0, 10);
    let level = 'ok', text = ok ? `Last backup ${day(lastOkAt)}; next due ${day(nextDue)}.` : '';
    if (!ok) { level = last ? 'error' : 'warn'; text = last ? 'No backup has succeeded yet; the last attempt failed.' : 'No backup has been taken yet.'; }
    else if (last && last.status === 'failed' && last.startedAt > lastOkAt) { level = 'error'; text = 'The last backup failed. The previous good one is from ' + day(lastOkAt) + '.'; }
    else if (overdue) { level = 'warn'; text = 'A backup is overdue. The last good one is from ' + day(lastOkAt) + '.'; }
    return { level, text, lastOkAt: lastOkAt ? lastOkAt.toISOString() : null, nextDueAt: nextDue ? nextDue.toISOString() : null, overdue, everyDays };
  }

  const out = r => ({ id: r.id, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null, trigger: r.trigger, status: r.status, fileName: r.fileName, sizeBytes: r.sizeBytes, sha256: r.sha256, keyId: r.keyId, destination: r.destination, error: r.error });

  /** Key ids and ages only. Age counts from the first backup that used the key. */
  async function keyInfo() {
    let first;
    try { first = await rec.keyFirstUsed(); } catch (e) { log.error('[backups] key ages cannot be read:', scrubError(e && e.message)); first = new Map(); }
    const t = now();
    return [...keys.keys()].sort().map(id => ({ id, active: id === active, firstUsedAt: first.has(id) ? first.get(id).toISOString() : null, ageDays: first.has(id) ? Math.floor((t - first.get(id).getTime()) / DAY) : null }));
  }

  /** Check hourly; start a scheduled backup when none has succeeded for the period. A failure is retried after six hours, not every hour. */
  async function checkDue() {
    try {
      if (running) return;
      const ok = await rec.lastOk(), last = await rec.last(), t = now();
      const due = !ok || t - (ok.finishedAt || ok.startedAt).getTime() >= everyDays * DAY;
      const coolingOff = last && last.status === 'failed' && t - last.startedAt.getTime() < 6 * HOUR;
      if (due && !coolingOff) await run('schedule');
    } catch (e) { log.error('[backups] schedule check failed:', scrubError(e && e.message)); }
  }

  function startSchedule() {
    if (timer || !enabled) return;
    timer = setInterval(checkDue, HOUR); if (timer.unref) timer.unref();
    const first = setTimeout(checkDue, 2 * 60e3); if (first.unref) first.unref();
    rec.failRunning('the server stopped during this backup', new Date(now())).catch(() => {});
  }

  function mountAdmin(app, { adminAuth, ah, rateLimit }) {
    const lim = (windowMs, max) => (rateLimit ? rateLimit({ windowMs, max, message: { ok: false, error: 'Too many requests. Please try again later.' } }) : (q, r, n) => n());
    const A = [lim(15 * 60e3, 300), adminAuth], json = (res, body) => { res.set('Cache-Control', 'no-store'); res.json({ ok: true, ...body }); };
    app.get('/api/admin/backups/notice', ...A, ah(async (req, res) => json(res, { notice: await notice() })));
    app.get('/api/admin/backups/keys', ...A, ah(async (req, res) => json(res, { keys: await keyInfo() })));
    app.get('/api/admin/backups', ...A, ah(async (req, res) => {
      const limit = Math.min(100, Math.max(1, parseInt((req.query || {}).limit, 10) || 30));
      let rows, recordsAvailable = true;
      try { rows = await rec.list(limit); }
      catch (e) { log.error('[backups] the backup records cannot be read:', scrubError(e && e.message)); rows = recent.slice(0, limit); recordsAvailable = false; }
      json(res, { enabled, everyDays, keep, destination: dest.name, recordsAvailable, backups: rows.map(out) });
    }));
    app.post('/api/admin/backups/run', A[0], adminAuth, lim(3600e3, 3), ah(async (req, res) => {
      const r = await run('manual');
      res.set('Cache-Control', 'no-store');
      res.status(r.status).json(r.ok ? { ok: true, backup: r.backup } : { ok: false, code: r.code, error: r.error });
    }));
  }

  return { enabled, run, notice, keyInfo, list: n => rec.list(n || 30), checkDue, startSchedule, stopSchedule: () => { if (timer) clearInterval(timer); timer = null; }, mountAdmin, prune, everyDays, keep };
}

/** Reverse of the file layout, for the restore tool and the tests. Throws if the key is wrong or one byte was changed. */
async function decryptFile(file, out, keyFor) {
  const fd = await fs.promises.open(file, 'r');
  try {
    const { size } = await fd.stat();
    const head = Buffer.alloc(6); await fd.read(head, 0, 6, 0);
    if (!head.subarray(0, 5).equals(MAGIC)) throw new Error('not a ShelterKart backup file');
    const idLen = head[5], rest = Buffer.alloc(idLen + 12); await fd.read(rest, 0, rest.length, 6);
    const keyId = rest.subarray(0, idLen).toString(), iv = rest.subarray(idLen), key = keyFor(keyId);
    if (!key) throw new Error('no key for id ' + keyId);
    const start = 6 + idLen + 12, tag = Buffer.alloc(16); await fd.read(tag, 0, 16, size - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag);
    const dst = fs.createWriteStream(out, { mode: 0o600 });
    try {
      await new Promise((resolve, reject) => {
        const src = fs.createReadStream(file, { start, end: size - 17 });
        src.on('error', reject); decipher.on('error', reject); dst.on('error', reject); dst.on('finish', resolve);
        src.pipe(decipher).pipe(dst);
      });
    } catch (e) { await fs.promises.unlink(out).catch(() => {}); throw new Error('wrong key or the file was changed'); }
    return { keyId };
  } finally { await fd.close(); }
}

module.exports = { createBackups, decryptFile, readKeys, scrubError, pgEnv, folderDestination, MAGIC };
