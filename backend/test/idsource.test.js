'use strict';
const assert = require('assert');
const { EntityIndex } = require('../engine/entities');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

(async () => {
  await t('a registration number typed into a search is not remembered as that project\'s number', async () => {
    const ix = new EntityIndex();
    ix.register({ key: 'in|harmless garden|pune', market: 'in', query: 'Harmless Garden P52100012345', location: 'Pune', project: { name: 'Harmless Garden', ids: [], location: 'Pune' } });
    assert.strictEqual(ix.resolve({ market: 'in', query: 'P52100012345', location: '' }), null);
  });
  await t('a number the report itself carries still finds the report', async () => {
    const ix = new EntityIndex();
    ix.register({ key: 'in|hubtown celeste|mumbai', market: 'in', query: 'Hubtown Celeste', location: 'Mumbai', project: { name: 'Hubtown Celeste', ids: ['P51900008925'], location: 'Mumbai' } });
    const hit = ix.resolve({ market: 'in', query: 'P51900008925', location: '' });
    assert.ok(hit && hit.key === 'in|hubtown celeste|mumbai' && hit.via === 'registration number');
  });
  await t('searching by name still resolves after the change', async () => {
    const ix = new EntityIndex();
    ix.register({ key: 'k', market: 'in', query: 'Hubtown Celeste', location: 'Mumbai', project: { name: 'Hubtown Celeste', ids: [], location: 'Mumbai' } });
    assert.strictEqual(ix.resolve({ market: 'in', query: 'Hubtown Celeste', location: 'Mumbai' }).via, 'name');
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
