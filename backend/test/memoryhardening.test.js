'use strict';
const assert = require('assert');
const T = require('../engine/translate');
const egress = require('../connectors/egress');
const { makeKeeper } = require('../social/keeper'), K = require('../social/kb'), S = require('../social/schedule'), M = require('../social/marketer'), { makeStore } = require('../social/store');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } }

const markets = S.WHEEL.markets.map(m => ({ code: m.code, name: m.name })), topics = M.CURRICULUM.topics, today = () => '2026-10-25';
const PARAGRAPH = '<p>The promoter must register the project with the state authority before advertising or selling any unit, and must show the registration number in every advertisement.</p>';
const PAGE = '<html><head><title>Registering a project | Test Authority</title></head><body><main>' + PARAGRAPH.repeat(6) + '</main></body></html>';
const engines = { modelFor: role => ({ provider: role === 'adviser' ? 'alpha' : 'beta' }), async run() { return { text: '' }; } };
const keeperWith = fetchImpl => { const store = makeStore(), kb = K.makeKb({ markets: markets.map(m => m.code), topics: topics.map(x => x.id), today, onChange: it => store.kb.put(it.id, it) });
  return makeKeeper({ kb, store, engines, ...(fetchImpl ? { fetchImpl } : {}), env: {}, now: () => Date.parse('2026-10-25T12:00:00Z'), markets, topics }); };
const URL_OK = 'https://rera.example.gov/register';
function streamed({ chunks, size, type = 'text/html; charset=utf-8', length = null, payload = null }) {
  const state = { read: 0, cancelled: false, arrayBufferCalled: false };
  const res = { ok: true, status: 200, url: URL_OK, headers: { get: k => ({ 'content-type': type, 'content-length': length == null ? null : String(length) })[k.toLowerCase()] || null },
    body: { getReader() { let i = 0; return { async read() { if (i >= chunks) return { done: true }; const piece = payload ? payload.subarray(i * size, (i + 1) * size) : new Uint8Array(size).fill(65); i++; state.read += piece.length; return { done: false, value: piece }; }, async cancel() { state.cancelled = true; } }; } },
    arrayBuffer: async () => { state.arrayBufferCalled = true; throw new Error('the whole body must not be read at once'); } };
  return { res, state };
}

(async () => {
  console.log('the keeper reads a page in pieces and stops at the limit');
  await t('a page with no declared length that goes on past the limit is abandoned after the limit, not read to the end', async () => {
    const { res, state } = streamed({ chunks: 5000, size: 65536 });
    const r = await keeperWith(async () => res).fetchPage(URL_OK, 'IN');
    assert.strictEqual(r.reason, 'too_large'); assert.strictEqual(state.cancelled, true);
    assert.ok(state.read <= 1500000 + 65536, 'read ' + state.read + ' bytes'); assert.strictEqual(state.arrayBufferCalled, false);
  });
  await t('the same for a PDF, against its own larger limit', async () => {
    const { res, state } = streamed({ chunks: 5000, size: 65536, type: 'application/pdf' });
    const k = makeKeeper({ kb: K.makeKb({ markets: markets.map(m => m.code), topics: topics.map(x => x.id), today }), store: makeStore(), engines, fetchImpl: async () => res, env: {}, markets, topics, pdfToText: async () => 'text' });
    const r = await k.fetchPage(URL_OK, 'IN');
    assert.strictEqual(r.reason, 'too_large'); assert.strictEqual(state.cancelled, true); assert.ok(state.read <= 8000000 + 65536, 'read ' + state.read);
  });
  await t('a normal page arrives in several pieces and is read exactly as before', async () => {
    const bytes = Buffer.from(PAGE), pieces = Math.ceil(bytes.length / 400), { res, state } = streamed({ chunks: pieces, size: 400, payload: bytes });
    const r = await keeperWith(async () => res).fetchPage(URL_OK, 'IN');
    assert.strictEqual(r.ok, true); assert.match(r.text, /must register the project/); assert.strictEqual(r.title, 'Registering a project | Test Authority'); assert.strictEqual(state.cancelled, false);
  });
  await t('a page whose declared length is already too large is refused before any of it is read', async () => {
    const { res, state } = streamed({ chunks: 10, size: 10, length: 9999999 });
    assert.strictEqual((await keeperWith(async () => res).fetchPage(URL_OK, 'IN')).reason, 'too_large'); assert.strictEqual(state.read, 0);
  });
  await t('a response with no stream (a fake, or an old client) still works through arrayBuffer, and is still capped', async () => {
    const small = { ok: true, status: 200, url: URL_OK, headers: { get: k => ({ 'content-type': 'text/html' })[k.toLowerCase()] || null }, arrayBuffer: async () => Buffer.from(PAGE) };
    assert.strictEqual((await keeperWith(async () => small).fetchPage(URL_OK, 'IN')).ok, true);
    const big = { ...small, arrayBuffer: async () => Buffer.alloc(1600000, 65) };
    assert.strictEqual((await keeperWith(async () => big).fetchPage(URL_OK, 'IN')).reason, 'too_large');
  });
  await t('without an injected fetch the keeper uses the guarded one (the address checked is the address connected to)', async () => {
    const original = egress.defaultFetch; let used = 0;
    egress.defaultFetch = () => async () => { used++; return { ok: false, status: 404, url: URL_OK, headers: { get: () => '' }, text: async () => '' }; };
    try { await keeperWith(null).fetchPage(URL_OK, 'IN'); } finally { egress.defaultFetch = original; }
    assert.strictEqual(used, 1);
  });
  await t('an injected fetch is still used as given', async () => {
    let used = 0; await keeperWith(async () => { used++; return { ok: false, status: 404, url: URL_OK, headers: { get: () => '' }, text: async () => '' }; }).fetchPage(URL_OK, 'IN'); assert.strictEqual(used, 1);
  });

  console.log('the translation memory');
  await t('it is capped: the oldest entries go first, the newest stay, and the cap is a setting with a floor', () => {
    const env = { TRANSLATE_MEMORY_MAX: '100' }; T._memory.clear();
    for (let i = 0; i < 250; i++) T.remember('k' + i, 'text ' + i, env);
    assert.strictEqual(T._memory.size, 100); assert.ok(!T._memory.has('k0') && !T._memory.has('k149') && T._memory.has('k150') && T._memory.has('k249'));
    assert.strictEqual(T.memoryMax({}), 20000); assert.strictEqual(T.memoryMax({ TRANSLATE_MEMORY_MAX: '5' }), 20000); assert.strictEqual(T.memoryMax({ TRANSLATE_MEMORY_MAX: 'x' }), 20000); assert.strictEqual(T.memoryMax({ TRANSLATE_MEMORY_MAX: '500' }), 500);
    T._memory.clear();
  });
  await t('writing a key again makes it the newest, so a repeated sentence is not the first to go', () => {
    const env = { TRANSLATE_MEMORY_MAX: '100' }; T._memory.clear();
    for (let i = 0; i < 100; i++) T.remember('k' + i, 'v' + i, env);
    T.remember('k0', 'again', env); T.remember('new', 'x', env);
    assert.ok(T._memory.has('k0') && !T._memory.has('k1') && T._memory.get('k0') === 'again'); T._memory.clear();
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
