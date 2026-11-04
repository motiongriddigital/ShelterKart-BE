'use strict';
/** Users by country: the edge header is cleaned, never taken from the address, and the per-market table adds up. */
const assert = require('assert');
const { cleanCountry, countryFromRequest, marketOf, buildGeo } = require('../accounts/geo');
const { MARKETS } = require('../engine/markets');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

(async () => {
  console.log('the edge header');
  await t('two letters are kept, in upper case', async () => { assert.strictEqual(cleanCountry('in'), 'IN'); assert.strictEqual(cleanCountry(' GB '), 'GB'); });
  await t('the edge\'s unknown and Tor codes are not countries', async () => { for (const v of ['XX', 'T1', 'ZZ', 'xx']) assert.strictEqual(cleanCountry(v), null, v); });
  await t('anything else becomes null', async () => {
    for (const v of ['India', 'IND', '', '  ', null, undefined, 'I', '<s', '1A', 'A'.repeat(300), 5, {}]) assert.strictEqual(cleanCountry(v), null, String(v));
  });
  await t('the country comes from the named header only, never from the address', async () => {
    const req = { ip: '8.8.8.8', headers: { 'x-forwarded-for': '8.8.8.8' }, get: k => ({ 'cf-ipcountry': 'FR' })[k.toLowerCase()] };
    assert.strictEqual(countryFromRequest(req, 'cf-ipcountry'), 'FR');
    assert.strictEqual(countryFromRequest(req, 'x-other'), null);
    assert.strictEqual(countryFromRequest({ ip: '8.8.8.8', get: () => undefined }, 'cf-ipcountry'), null);
  });

  console.log('markets');
  await t('there are 36, and the United Kingdom is GB', async () => {
    const g = buildGeo([], []);
    assert.strictEqual(g.markets.length, Object.keys(MARKETS).length); assert.strictEqual(g.markets.length, 36);
    assert.strictEqual(g.markets.find(m => m.code === 'uk').iso, 'GB');
    assert.strictEqual(marketOf('GB'), 'uk'); assert.strictEqual(marketOf('UK'), 'uk'); assert.strictEqual(marketOf('IN'), 'in'); assert.strictEqual(marketOf('AE'), 'ae'); assert.strictEqual(marketOf('CN'), null);
  });
  await t('every market iso code is two letters', async () => { for (const m of buildGeo([], []).markets) assert(/^[A-Z]{2}$/.test(m.iso), m.code); });

  console.log('the table');
  const rows = [{ country: 'IN', users: 10, newUsers: 3 }, { country: 'GB', users: 4, newUsers: 1 }, { country: 'CN', users: 2, newUsers: 2 }, { country: null, users: 5, newUsers: 0 }, { country: '', users: 1, newUsers: 1 }];
  const paid = [{ country: 'IN', paid: 2 }, { country: 'GB', paid: 1 }, { country: 'CN', paid: 1 }];
  const g = buildGeo(rows, paid), by = c => g.markets.find(m => m.code === c);
  await t('users, new this week and paid land in the right market', async () => {
    assert.deepStrictEqual([by('in').users, by('in').newThisWeek, by('in').paid], [10, 3, 2]);
    assert.deepStrictEqual([by('uk').users, by('uk').newThisWeek, by('uk').paid], [4, 1, 1]);
  });
  await t('a country that is not a market goes to other, no country goes to unknown', async () => {
    assert.deepStrictEqual([g.other.users, g.other.paid], [2, 1]); assert.deepStrictEqual([g.unknown.users, g.unknown.newThisWeek], [6, 1]);
  });
  await t('the totals equal the sum of everything', async () => { assert.deepStrictEqual([g.totals.users, g.totals.newThisWeek, g.totals.paid], [22, 7, 4]); });
  await t('conversion is paid over users, rounded to four places', async () => { assert.strictEqual(by('in').conversion, 0.2); assert.strictEqual(buildGeo([{ country: 'IN', users: 3, newUsers: 0 }], [{ country: 'IN', paid: 1 }]).markets.find(m => m.code === 'in').conversion, 0.3333); });
  await t('a market with no users has conversion 0, never NaN or Infinity', async () => {
    assert.strictEqual(by('jp').users, 0); assert.strictEqual(by('jp').conversion, 0);
    assert(!/NaN|Infinity|null/.test(JSON.stringify(buildGeo([], []))));
  });
  await t('lower-case and mixed input is counted with its market', async () => { assert.strictEqual(buildGeo([{ country: 'in', users: 1, newUsers: 0 }, { country: 'IN', users: 1, newUsers: 0 }], []).markets.find(m => m.code === 'in').users, 2); });
  await t('numbers that arrive as strings are added as numbers', async () => { assert.strictEqual(buildGeo([{ country: 'IN', users: '4', newUsers: '1' }], []).markets.find(m => m.code === 'in').users, 4); });

  console.log('\n' + (failed ? failed + ' FAILED' : 'all ' + passed + ' passing'));
  if (failed) process.exitCode = 1;
})();
