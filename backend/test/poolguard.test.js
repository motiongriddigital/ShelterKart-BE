'use strict';
const assert = require('assert');
const { EventEmitter } = require('events');
const { Pool } = require('pg');
const { guardPool, scrub } = require('../engine/poolGuard');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

(async () => {
  console.log('the database pool');
  await t('an error on a pool with no listener throws, which is what stopped the server', () => {
    assert.throws(() => new EventEmitter().emit('error', new Error('terminating connection due to administrator command')), /terminating connection/);
  });
  await t('a guarded pool logs an idle connection error and does not throw', () => {
    const lines = []; const pool = guardPool(new EventEmitter(), { error: (...a) => lines.push(a.join(' ')) });
    pool.emit('error', new Error('terminating connection due to administrator command'));
    assert.strictEqual(lines.length, 1); assert(/terminating connection/.test(lines[0]));
  });
  await t('the log line carries no connection string or password', () => {
    const lines = []; const pool = guardPool(new EventEmitter(), { error: (...a) => lines.push(a.join(' ')) });
    pool.emit('error', new Error('connect failed postgres://user:secret@db.example.com/shelter password=hunter2'));
    assert(!/secret|hunter2|postgres:/.test(lines[0])); assert(/\[url\]/.test(lines[0]));
    assert(scrub(null) === '' && scrub('x'.repeat(500)).length === 200);
  });
  await t('a real pg Pool survives an error event once guarded', async () => {
    const lines = []; const pool = guardPool(new Pool({ connectionString: 'postgres://u:pw@127.0.0.1:1/none' }), { error: (...a) => lines.push(a.join(' ')) });
    pool.emit('error', new Error('Connection terminated unexpectedly'));
    assert.strictEqual(lines.length, 1); await pool.end();
  });
  await t('guarding something that is not a pool, or no pool, changes nothing', () => {
    assert.strictEqual(guardPool(null), null); const o = {}; assert.strictEqual(guardPool(o), o);
  });
  console.log(failed ? '\n' + failed + ' FAILED' : '\nall ' + passed + ' passing');
  if (failed) process.exitCode = 1;
})();
