'use strict';
/**
 * The egress guard's redirect handling, with DNS and the network faked. Found by the sandbox run: a 304 (Not Modified, the answer to a
 * conditional request) was treated as a redirect with no destination and refused, so every "nothing changed" check failed.
 */
const assert = require('assert');
const dns = require('dns').promises;
dns.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
const { guardedFetch, EgressBlocked } = require('../connectors/egress');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
const allowSet = new Set(['data.example', 'other.example']);
const res = (status, headers = {}) => ({ status, headers: { get: k => headers[k.toLowerCase()] ?? null } });
const net = steps => { const seen = []; const f = async (url, o) => { seen.push({ url, headers: o.headers, method: o.method }); return steps[Math.min(seen.length - 1, steps.length - 1)]; }; f.seen = seen; return f; };

(async () => {
  console.log('\negress guard: redirects');
  await t('a 304 is an answer, not a redirect: returned as it is, one request', async () => {
    const f = net([res(304)]);
    const r = await guardedFetch('https://data.example/f.csv', { allowSet, fetchImpl: f, headers: { 'if-none-match': '"e"' } });
    assert.strictEqual(r.response.status, 304); assert.strictEqual(f.seen.length, 1); assert.strictEqual(f.seen[0].headers['if-none-match'], '"e"');
  });
  await t('300 and 305 have no destination to follow and are returned as they are', async () => {
    for (const s of [300, 305]) assert.strictEqual((await guardedFetch('https://data.example/', { allowSet, fetchImpl: net([res(s)]) })).response.status, s);
  });
  await t('a real redirect without a Location is still refused', async () => {
    await assert.rejects(() => guardedFetch('https://data.example/', { allowSet, fetchImpl: net([res(302)]) }), EgressBlocked);
  });
  await t('301, 302, 303, 307 and 308 are followed, and each hop is checked against the allow-list', async () => {
    for (const s of [301, 302, 303, 307, 308]) {
      const f = net([res(s, { location: 'https://other.example/x' }), res(200)]);
      const r = await guardedFetch('https://data.example/', { allowSet, fetchImpl: f });
      assert.strictEqual(r.response.status, 200); assert.strictEqual(f.seen[1].url, 'https://other.example/x');
    }
    await assert.rejects(() => guardedFetch('https://data.example/', { allowSet, fetchImpl: net([res(302, { location: 'https://evil.example/' })]) }), EgressBlocked);
  });
  await t('headers such as an API key go to the first host only, never to the redirect target', async () => {
    const f = net([res(302, { location: 'https://other.example/x' }), res(200)]);
    await guardedFetch('https://data.example/', { allowSet, fetchImpl: f, headers: { authorization: 'secret' } });
    assert.strictEqual(f.seen[0].headers.authorization, 'secret'); assert.strictEqual(f.seen[1].headers.authorization, undefined);
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
