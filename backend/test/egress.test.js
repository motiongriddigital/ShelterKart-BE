'use strict';
/**
 * The egress guard's redirect handling, with DNS and the network faked. Found by the sandbox run: a 304 (Not Modified, the answer to a
 * conditional request) was treated as a redirect with no destination and refused, so every "nothing changed" check failed.
 */
const assert = require('assert');
const dns = require('dns').promises;
dns.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
const { guardedFetch, guardedLookup, classifyIp, validateTarget, EgressBlocked } = require('../connectors/egress');
const http = require('http');
const dnsCb = require('dns');
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
  console.log('\negress guard: address ranges');
  await t('IPv6 forms that wrap or hide a private IPv4 address are blocked', async () => {
    for (const ip of ['::ffff:7f00:1', '::ffff:127.0.0.1', '::ffff:a9fe:a9fe', '::127.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::1', '2002:a9fe:a9fe::1', 'fe90::1', 'febf::1', 'fec0::1', 'fe80::1%en0', 'fd00::1', 'ff02::1', '::1', '::', '2001::1', '2001:db8::1'])
      assert.strictEqual(classifyIp(ip).blocked, true, ip);
  });
  await t('public IPv6 and IPv4 (also wrapped) stay allowed', async () => {
    for (const ip of ['2606:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '2002:808:808::1', '93.184.216.34'])
      assert.strictEqual(classifyIp(ip).blocked, false, ip);
  });
  await t('documentation and relay IPv4 ranges are blocked', async () => {
    for (const ip of ['192.0.2.1', '198.51.100.9', '203.0.113.5', '192.88.99.1', '255.255.255.255'])
      assert.strictEqual(classifyIp(ip).blocked, true, ip);
  });

  console.log('\negress guard: ports');
  await t('only the standard port is permitted unless a caller adds one', async () => {
    const ok = async (u, o) => validateTarget(u, allowSet, o);
    await ok('https://data.example/');
    await ok('https://data.example:443/');
    await assert.rejects(() => ok('https://data.example:8443/'), EgressBlocked);
    await assert.rejects(() => ok('https://data.example:5432/'), EgressBlocked);
    await assert.rejects(() => ok('http://data.example:80/'), EgressBlocked);
    await ok('http://data.example/', { allowHttp: true });
    await assert.rejects(() => ok('http://data.example:8080/', { allowHttp: true }), EgressBlocked);
    await ok('http://data.example:8080/', { allowHttp: true, allowPorts: [8080] });
  });
  await t('a redirect to another port is refused', async () => {
    await assert.rejects(() => guardedFetch('https://data.example/', { allowSet, fetchImpl: net([res(302, { location: 'https://other.example:6379/' })]) }), EgressBlocked);
  });

  console.log('\negress guard: DNS rebinding');
  await t('the connect-time lookup refuses a name that now points at loopback', async () => {
    const origLookup = dnsCb.lookup;
    dnsCb.lookup = (h, o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]);
    try {
      const err = await new Promise(r => guardedLookup('data.example', {}, e => r(e)));
      assert(err instanceof EgressBlocked, 'refused');
      const ok = await new Promise(r => { dnsCb.lookup = (h, o, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]); guardedLookup('data.example', { all: true }, (e, a) => r(e || a)); });
      assert.deepStrictEqual(ok, [{ address: '93.184.216.34', family: 4 }]);
      const single = await new Promise(r => guardedLookup('data.example', {}, (e, a, f) => r(e || [a, f])));
      assert.deepStrictEqual(single, ['93.184.216.34', 4]);
    } finally { dnsCb.lookup = origLookup; }
  });
  await t('a real request is stopped when DNS answers public to the guard and loopback to the connection', async () => {
    const srv = http.createServer((q, r) => r.end('INTERNAL-SECRET'));
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const origLookup = dnsCb.lookup;
    dnsCb.lookup = (h, o, cb) => (h === 'rebind.example' ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : origLookup.call(dnsCb, h, o, cb));
    try {
      await assert.rejects(
        () => guardedFetch(`http://rebind.example:${port}/`, { allowSet: new Set(['rebind.example']), allowHttp: true, allowPorts: [port] }),
        e => e instanceof EgressBlocked && /loopback/.test(e.message));
    } finally { dnsCb.lookup = origLookup; srv.close(); }
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
