'use strict';
/** The admin audit ledger: rows kept with who, what and which object; ids that are not uuids are not stored as object ids; reading is bounded. */
const assert = require('assert');
const { createAdminAudit, actorOf } = require('../engine/adminAudit');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const ID = '5f0c1c1e-8a3b-4c52-9d3a-1b2c3d4e5f60';
(async () => {
  console.log('recording');
  await t('a row keeps the actor, the action, the object and the reason', async () => {
    const a = createAdminAudit({ now: () => Date.parse('2026-11-04T12:00:00Z') });
    await a.record({ actor: 'admin:ops', action: 'DISPUTE_RESOLVED', objectType: 'dispute', objectId: ID, reason: 'closed after review' });
    const [r] = await a.list();
    assert.deepStrictEqual([r.actor, r.action, r.objectType, r.objectId, r.reason, r.at], ['admin:ops', 'DISPUTE_RESOLVED', 'dispute', ID, 'closed after review', '2026-11-04T12:00:00.000Z']);
  });
  await t('an object id that is not a uuid (a report reference) is not stored as one', async () => {
    const a = createAdminAudit(); await a.record({ action: 'HELD_FINDINGS_RELEASED', objectType: 'report', objectId: 'SK-ABCDEF123456', reason: 'report SK-ABCDEF123456' });
    const [r] = await a.list(); assert.strictEqual(r.objectId, null); assert(/SK-ABCDEF123456/.test(r.reason));
  });
  await t('a row with no action is refused', async () => { await assert.rejects(createAdminAudit().record({ actor: 'admin' }), /action/); });
  await t('control characters are removed and long text is cut', async () => {
    const a = createAdminAudit(); await a.record({ action: 'X', reason: 'a\u0000b\nc' + 'z'.repeat(900) });
    const [r] = await a.list(); assert(!/[\u0000-\u001f]/.test(r.reason) && r.reason.length <= 500);
  });
  await t('the newest row comes first, and a filter picks one kind of action', async () => {
    const a = createAdminAudit(); await a.record({ action: 'A' }); await a.record({ action: 'B' }); await a.record({ action: 'A' });
    assert.deepStrictEqual((await a.list()).map(r => r.action), ['A', 'B', 'A']); assert.strictEqual((await a.list({ action: 'B' })).length, 1);
  });
  await t('reading is bounded to 200 rows', async () => { const a = createAdminAudit(); for (let i = 0; i < 230; i++) await a.record({ action: 'A' }); assert.strictEqual((await a.list({ limit: 9999 })).length, 200); });

  console.log('the database');
  await t('one parameterised insert into audit_log, json text for the states, no string built into the SQL', async () => {
    const seen = []; const a = createAdminAudit({ pool: { query: async (sql, args) => { seen.push([sql, args]); return { rows: [] }; } } });
    await a.record({ actor: 'admin:ops', action: 'REPLY_APPROVED', objectType: 'developer_reply', objectId: ID, after: { status: 'approved' }, reason: "x'); DROP TABLE audit_log; --" });
    assert.strictEqual(seen.length, 1); assert(/INSERT INTO audit_log/.test(seen[0][0]) && !/DROP/.test(seen[0][0]));
    assert.strictEqual(seen[0][1][5], '{"status":"approved"}'); assert(/DROP TABLE/.test(seen[0][1][6]));
  });
  await t('a database error reaches the caller, which decides what to tell the operator', async () => {
    const a = createAdminAudit({ pool: { query: async () => { throw new Error('db down'); } } }); await assert.rejects(a.record({ action: 'A' }), /db down/);
  });

  console.log('the actor');
  await t('the actor is the username of the Basic login, never the password', async () => {
    const hdr = 'Basic ' + Buffer.from('maya:s3cret:with:colons').toString('base64');
    assert.strictEqual(actorOf({ headers: { authorization: hdr } }), 'admin:maya');
    assert(!/s3cret/.test(actorOf({ headers: { authorization: hdr } })));
    assert.strictEqual(actorOf({ headers: {} }), 'admin'); assert.strictEqual(actorOf({}), 'admin');
  });

  console.log('\n' + (failed ? failed + ' FAILED' : 'all ' + passed + ' passing'));
  if (failed) process.exitCode = 1;
})();
