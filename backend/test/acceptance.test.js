'use strict';
/** The offline market acceptance harness: every listed market is checked, the counts agree with the readiness tool, a broken market fails visibly, and no live gate is ever reported as passed. */
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { MARKETS } = require('../engine/markets.js');
const A = require('../../tools/market_acceptance.js');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
(async () => {
  const rows = await A.evaluate();
  await t('every market the site lists is checked exactly once', () => {
    assert.deepStrictEqual(rows.map(r => r.key).sort(), Object.keys(MARKETS).sort());
  });
  await t('every market passes the offline gates: research wiring with a stubbed model, and a price from the price book', () => {
    assert.deepStrictEqual(A.failing(rows).map(r => r.label), []);
  });
  await t('the payable counts agree with the readiness tool, today and with the merchant live', () => {
    const out = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'tools', 'market_readiness.js')], { encoding: 'utf8' }).stdout;
    const today = /today: (\d+) of (\d+)/.exec(out), live = /merchant live: (\d+) of (\d+)/.exec(out);
    assert(today && live, 'readiness summary not found');
    assert.deepStrictEqual([rows.filter(r => r.payableToday.pass).length, rows.length], [Number(today[1]), Number(today[2])]);
    assert.strictEqual(rows.filter(r => r.payableMerchant.pass).length, Number(live[1]));
    assert.strictEqual(rows.find(r => r.code === 'IN').payableMerchant.pass, false, 'India must stay closed without its own registration');
  });
  await t('a market that is not set up fails visibly instead of being skipped', async () => {
    const bad = await A.evaluate({ ...MARKETS, zz: { label: 'Atlantis', status: 'evidence', registry: null } });
    const names = A.failing(bad).map(r => r.label);
    assert.deepStrictEqual(names, ['Atlantis']);
    assert(/FAIL/.test(A.render(bad)));
  });
  await t('gates that need a live run, a delivery account or a person are never reported as passed', () => {
    assert(rows.every(r => r.liveRun === 'not run' && r.delivered === 'not run' && r.reviewed === 'not run'));
    const md = A.render(rows, '2026-01-01');
    assert(md.includes('not run') && !/Live run \| Delivered \| Reviewed[\s\S]*\| pass \| pass \| pass \|\n/.test(md));
  });
  console.log(failed ? '\n' + failed + ' FAILED' : '\nall passing');
  process.exit(failed ? 1 : 0);
})();
