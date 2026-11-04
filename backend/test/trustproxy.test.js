'use strict';
/** TRUST_PROXY: parsing, and a real HTTP request with a forged X-Forwarded-For through real express. */
const assert = require('assert');
const http = require('http');
const express = require('express');
const { parse } = require('../engine/trustproxy');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

function seen(setting, headers) {
  const app = express();
  app.set('trust proxy', setting);
  app.get('/', (req, res) => res.json({ ip: req.ip }));
  return new Promise((resolve, reject) => {
    const srv = app.listen(0, '127.0.0.1', () => {
      http.get({ host: '127.0.0.1', port: srv.address().port, path: '/', headers }, res => {
        let b = ''; res.on('data', c => { b += c; }); res.on('end', () => { srv.close(); resolve(JSON.parse(b).ip.replace(/^::ffff:/, '')); });
      }).on('error', e => { srv.close(); reject(e); });
    });
  });
}

(async () => {
  console.log('parsing');
  await t('unset, empty and "off" mean no proxy', async () => {
    for (const v of [undefined, '', '  ', 'off', 'false', '0', 'none']) assert.deepStrictEqual(parse(v), { setting: false, problem: null }, String(v));
  });
  await t('a hop count is accepted', async () => { assert.strictEqual(parse('1').setting, 1); assert.strictEqual(parse(' 2 ').setting, 2); });
  await t('a count out of range is refused and trusts nothing', async () => { const r = parse('99'); assert.strictEqual(r.setting, false); assert(r.problem); });
  await t('"true" is refused, because it would trust every hop', async () => { const r = parse('true'); assert.strictEqual(r.setting, false); assert(/every hop/.test(r.problem)); });
  await t('named ranges and addresses are accepted', async () => {
    assert.deepStrictEqual(parse('loopback, 10.0.0.0/8').setting, ['loopback', '10.0.0.0/8']);
    assert.deepStrictEqual(parse('2001:db8::/32').setting, ['2001:db8::/32']);
  });
  await t('an entry that is not an address is refused and trusts nothing', async () => { const r = parse('loopback, not-an-ip'); assert.strictEqual(r.setting, false); assert(/not-an-ip/.test(r.problem)); });

  console.log('a forged header through real express');
  const forged = { 'x-forwarded-for': '6.6.6.6' };
  await t('with no proxy trusted, a forged X-Forwarded-For changes nothing', async () => {
    const plain = await seen(parse(undefined).setting, {});
    const spoof = await seen(parse(undefined).setting, forged);
    assert.strictEqual(plain, '127.0.0.1'); assert.strictEqual(spoof, plain);
  });
  await t('a malformed setting also leaves a forged header without effect', async () => {
    assert.strictEqual(await seen(parse('true').setting, forged), '127.0.0.1');
    assert.strictEqual(await seen(parse('nonsense!').setting, forged), '127.0.0.1');
  });
  await t('with one proxy trusted, the address that proxy reports is used', async () => {
    assert.strictEqual(await seen(parse('1').setting, forged), '6.6.6.6');
  });
  await t('with the proxy named by address, a header from it is believed; from anyone else it is not', async () => {
    assert.strictEqual(await seen(parse('127.0.0.1').setting, forged), '6.6.6.6');
    assert.strictEqual(await seen(parse('10.0.0.0/8').setting, forged), '127.0.0.1');
  });

  console.log('\n' + (failed ? failed + ' FAILED' : 'all ' + passed + ' passing'));
  if (failed) process.exitCode = 1;
})();
