'use strict';
const assert = require('assert');
const DB = require('../lib/dbConfig');
const { pgEnv } = require('../engine/backups');
const { migrate, lockdown, LOCKDOWN_SQL } = require('../../tools/migrate');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const POOLER = 'postgres://postgres.abcd:p%40ss@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';
const DIRECT = 'postgres://postgres:secret@db.abcd.supabase.co:5432/postgres';

(async () => {
  console.log('database connection settings');
  await t('a local database stays unencrypted and unchanged', () => {
    const o = DB.poolOptions({ DATABASE_URL: 'postgres://u:p@db:5432/shelterkart' });
    assert.strictEqual(o.ssl, undefined); assert.strictEqual(o.max, 10); assert.strictEqual(o.connectionString, 'postgres://u:p@db:5432/shelterkart');
  });
  await t('a Supabase host switches TLS on by itself', () => {
    assert.strictEqual(DB.sslMode({ DATABASE_URL: POOLER }), 'require');
    assert.deepStrictEqual(DB.poolOptions({ DATABASE_URL: POOLER }).ssl, { rejectUnauthorized: false });
    assert.strictEqual(DB.sslMode({ DATABASE_URL: DIRECT }), 'require');
  });
  await t('DATABASE_SSL overrides the address; sslmode in the address is honoured', () => {
    assert.strictEqual(DB.sslMode({ DATABASE_URL: POOLER, DATABASE_SSL: 'off' }), 'off');
    assert.strictEqual(DB.sslMode({ DATABASE_URL: 'postgres://u:p@h/db', DATABASE_SSL: 'require' }), 'require');
    assert.strictEqual(DB.sslMode({ DATABASE_URL: 'postgres://u:p@h/db?sslmode=verify-full' }), 'verify');
    assert.strictEqual(DB.sslMode({ DATABASE_URL: DIRECT + '?sslmode=disable' }), 'off');
  });
  await t('verify mode checks the certificate and carries the CA, as text or from a file', () => {
    const pem = '-----BEGIN CERTIFICATE-----\\nAAAA\\n-----END CERTIFICATE-----';
    const o = DB.poolOptions({ DATABASE_URL: POOLER, DATABASE_SSL: 'verify', DATABASE_SSL_CA: pem });
    assert.strictEqual(o.ssl.rejectUnauthorized, true); assert(/BEGIN CERTIFICATE-----\nAAAA\n/.test(o.ssl.ca));
    const file = require('path').join(require('os').tmpdir(), 'dbconfig-test-ca.pem'); require('fs').writeFileSync(file, 'PEMTEXT');
    assert.strictEqual(DB.poolOptions({ DATABASE_URL: POOLER, DATABASE_SSL: 'verify', DATABASE_SSL_CA: file }).ssl.ca, 'PEMTEXT');
    assert.strictEqual(DB.poolOptions({ DATABASE_URL: POOLER, DATABASE_SSL: 'verify' }).ssl.ca, undefined);
  });
  await t('sslmode is removed from the address so the explicit ssl setting wins', () => {
    const o = DB.poolOptions({ DATABASE_URL: DIRECT + '?sslmode=require&application_name=sk' });
    assert(!/sslmode/.test(o.connectionString)); assert(/application_name=sk/.test(o.connectionString));
  });
  await t('pool size, timeouts and statement timeout come from the environment, with bounds', () => {
    const o = DB.poolOptions({ DATABASE_URL: POOLER, DATABASE_POOL_MAX: '4', DATABASE_IDLE_TIMEOUT_MS: '20000', DATABASE_CONNECT_TIMEOUT_MS: '5000', DATABASE_STATEMENT_TIMEOUT_MS: '30000' });
    assert.strictEqual(o.max, 4); assert.strictEqual(o.idleTimeoutMillis, 20000); assert.strictEqual(o.connectionTimeoutMillis, 5000); assert.strictEqual(o.statement_timeout, 30000);
    assert.strictEqual(DB.poolOptions({ DATABASE_URL: POOLER, DATABASE_POOL_MAX: '9999' }).max, 100);
    assert.strictEqual(DB.poolOptions({ DATABASE_URL: POOLER, DATABASE_POOL_MAX: 'x' }).max, 10);
    assert.strictEqual(DB.poolOptions({ DATABASE_URL: POOLER }).statement_timeout, undefined);
  });
  await t('migrations and backups use the direct address when one is set', () => {
    const env = { DATABASE_URL: POOLER, DATABASE_DIRECT_URL: DIRECT };
    assert.strictEqual(DB.directUrl(env), DIRECT); assert(/db\.abcd\.supabase\.co/.test(DB.directOptions(env).connectionString));
    assert.strictEqual(DB.directUrl({ DATABASE_URL: POOLER }), POOLER);
    assert.strictEqual(DB.kindOf(POOLER), 'transaction-pooler'); assert.strictEqual(DB.kindOf(DIRECT), 'direct');
    assert.strictEqual(DB.kindOf('postgres://u:p@aws-0-x.pooler.supabase.com:5432/postgres'), 'session-pooler');
  });
  await t('pg_dump gets TLS settings from the same variables', () => {
    assert.strictEqual(pgEnv(DIRECT, {}).PGSSLMODE, 'require');
    assert.strictEqual(pgEnv('postgres://u:p@localhost:5432/db', {}).PGSSLMODE, undefined);
    assert.strictEqual(pgEnv('postgres://u:p@localhost:5432/db', { DATABASE_SSL: 'off' }).PGSSLMODE, 'disable');
    const e = pgEnv(DIRECT, { DATABASE_SSL: 'verify', DATABASE_SSL_CA: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----' });
    assert.strictEqual(e.PGSSLMODE, 'verify-full'); assert(require('fs').readFileSync(e.PGSSLROOTCERT, 'utf8').includes('AAAA'));
  });
  await t('row level security is applied only where the Supabase roles exist', async () => {
    const seen = [];
    const fake = has => ({ async query(sql) { seen.push(sql); return { rows: [{ n: has ? 2 : 0 }] }; } });
    assert.strictEqual(await lockdown(fake(false)), false); assert.strictEqual(seen.length, 1);
    seen.length = 0; assert.strictEqual(await lockdown(fake(true)), true); assert.strictEqual(seen[1], LOCKDOWN_SQL);
    assert(/ENABLE ROW LEVEL SECURITY/.test(LOCKDOWN_SQL) && /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated/.test(LOCKDOWN_SQL));
    assert(/ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES/.test(LOCKDOWN_SQL));
  });
  await t('the lockdown is not a recorded migration, so the frozen checksums are untouched', () => {
    assert(!require('../../tools/migrate').MIGRATIONS.some(m => /lockdown/i.test(m)));
  });

  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
