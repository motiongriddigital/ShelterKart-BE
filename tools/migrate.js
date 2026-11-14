#!/usr/bin/env node
'use strict';
/**
 * Run ShelterKart's database migrations, in order, exactly once each (blind-spot review #1).
 *
 *   DATABASE_URL=postgres://... node tools/migrate.js          apply what is not yet applied
 *   node tools/migrate.js --dry-run                            list what would run, touch nothing
 *
 * Each file runs in its own transaction and is recorded in schema_migrations with a checksum. A file already applied
 * is skipped; a file whose contents CHANGED after being applied stops the run, because silently re-running or
 * ignoring an edited migration is how two environments drift apart. The 13 older .sql files are never run.
 *
 * A file whose first line is `-- migrate: no-transaction` runs one statement at a time without BEGIN, for
 * CREATE INDEX CONCURRENTLY on a large table. A failed concurrent build leaves an invalid index: the run stops and names it.
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const DIR = path.join(__dirname, '..', 'backend');
const MIGRATIONS = ['schema.sql', 'schema_evidence.sql', 'razorpay_orders.sql', 'idempotent_checkout.sql', 'research_persistence.sql',
  'source_health.sql', 'analytics.sql', 'translations.sql', 'pricing_v2.sql', 'responses.sql', 'social.sql', 'purchase_attribution.sql', 'accounts.sql', 'error_log.sql', 'health_history.sql', 'engine_usage.sql', 'backups.sql', 'fk_indexes.sql', 'bulk_registers.sql', 'accounts_password.sql'];
const NO_TRANSACTION = /^--\s*migrate:\s*no-transaction\b/;
const sha = t => crypto.createHash('sha256').update(t).digest('hex');

/** The files and their checksums, in order. Throws if one is missing. */
function plan(dir = DIR) {
  return MIGRATIONS.map(name => {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) throw new Error(`migration ${name} is missing from ${dir}`);
    const sql = fs.readFileSync(file, 'utf8');
    return { name, sql, checksum: sha(sql) };
  });
}

const statements = sql => sql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n').split(';').map(x => x.trim()).filter(Boolean);

async function applyOutsideTransaction(client, m) {
  const invalid = async () => (await client.query(`SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE NOT i.indisvalid`)).rows.map(r => r.relname);
  const before = await invalid();
  if (before.length) throw new Error(`${m.name} cannot run: invalid index left by an earlier failed build (${before.join(', ')}). DROP INDEX it, then retry.`);
  try { for (const stmt of statements(m.sql)) await client.query(stmt); }
  catch (e) { throw new Error(`${m.name} failed outside a transaction and may have left an invalid index: ${e.message}`); }
  const after = await invalid();
  if (after.length) throw new Error(`${m.name} left an invalid index (${after.join(', ')}). DROP INDEX it, then retry.`);
  await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [m.name, m.checksum]);
}

/** Apply pending migrations through `client` (a pg Client or anything with query()). Returns what happened. */
async function migrate(client, { dir = DIR, dryRun = false, log = () => {} } = {}) {
  const steps = plan(dir);
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const done = new Map((await client.query('SELECT name, checksum FROM schema_migrations')).rows.map(r => [r.name, r.checksum]));
  const result = { applied: [], skipped: [], pending: [] };
  for (const m of steps) {
    if (done.has(m.name)) {
      if (done.get(m.name) !== m.checksum) throw new Error(`${m.name} was changed after it was applied (checksum differs). Write a new migration instead of editing an applied one.`);
      result.skipped.push(m.name); continue;
    }
    if (dryRun) { result.pending.push(m.name); log(`would apply ${m.name}`); continue; }
    if (NO_TRANSACTION.test(m.sql)) { await applyOutsideTransaction(client, m); result.applied.push(m.name); log(`applied ${m.name}`); continue; }
    await client.query('BEGIN');
    try {
      await client.query(m.sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [m.name, m.checksum]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw new Error(`${m.name} failed and was rolled back: ${e.message}`); }
    result.applied.push(m.name); log(`applied ${m.name}`);
  }
  return result;
}

module.exports = { MIGRATIONS, plan, migrate, statements };

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  (async () => {
    if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2); }
    const { Client } = require(path.join(DIR, 'node_modules', 'pg'));
    const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
    try {
      const r = await migrate(client, { dryRun, log: console.log });
      console.log(dryRun ? `${r.pending.length} would be applied, ${r.skipped.length} already applied.` : `${r.applied.length} applied, ${r.skipped.length} already applied. Next: node tools/seed_pricing.js`);
    } catch (e) { console.error(e.message); process.exitCode = 1; }
    finally { await client.end(); }
  })();
}
