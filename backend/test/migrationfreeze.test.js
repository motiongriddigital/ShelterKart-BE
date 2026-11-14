'use strict';
/** An applied migration is never edited: tools/migrate.js refuses a changed file, so editing one breaks every database that already ran it. Add a new file instead, and record it in fixtures/migration-checksums.json. */
const assert = require('assert');
const { plan, MIGRATIONS } = require('../../tools/migrate');
const frozen = require('./fixtures/migration-checksums.json');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

(async () => {
  await t('every migration in the list is recorded, and its file still has the recorded checksum', () => {
    const changed = [], unrecorded = [];
    for (const m of plan()) { if (!frozen[m.name]) unrecorded.push(m.name); else if (frozen[m.name] !== m.checksum) changed.push(m.name); }
    assert.deepStrictEqual(changed, [], `edited after it was applied (write a new migration instead): ${changed.join(', ')}`);
    assert.deepStrictEqual(unrecorded, [], `new migration not recorded in test/fixtures/migration-checksums.json: ${unrecorded.join(', ')}`);
  });
  await t('nothing recorded has dropped out of the list', () => {
    assert.deepStrictEqual(Object.keys(frozen).filter(n => !MIGRATIONS.includes(n)), []);
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
