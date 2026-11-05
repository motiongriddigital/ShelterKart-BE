'use strict';
/** The search service: the mode switch, the routes and their checks, the shadow comparison, and keeping the index on disk. */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { createSearch } = require('../../search/service'), F = require('./fixtures');
let passed = 0, failed = 0; const t = async (n, f) => { try { await f(); passed++; console.log('  ok   ' + n); } catch (e) { failed++; console.log('  FAIL ' + n + '\n       ' + String(e && e.message).split('\n')[0]); } };
const MARKETS = { in: {}, ae: {}, uk: {} }, quiet = { error() {} };
function serve(svc) {
  const routes = []; const add = m => (p, ...h) => routes.push({ m, p, h }); const app = { get: add('GET'), post: add('POST') }; const authed = [];
  svc.mount(app, { adminAuth: (q, r, n) => { authed.push(q.path); return n(); }, ah: f => async (q, r, n) => { try { await f(q, r, n); } catch (e) { r.status(500).json({ ok: false, error: e.message }); } }, jsonParser: (q, r, n) => n(), markets: MARKETS, stripPII: s => String(s).replace(/\b\d{10}\b/g, '[phone]') });
  const req = async (m, p, body) => { const r = routes.find(x => x.m === m && x.p === p); const res = { code: 200, body: null, done: false, set() { return this; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; this.done = true; return this; } };
    const rq = { path: p, body: body || {}, query: {}, headers: {} }; let i = 0; const next = async () => { const h = r.h[i++]; if (h && !res.done) await h(rq, res, next); }; await next(); return res; };
  return { req, authed };
}
const brief = (ref, name, location, ids = []) => ({ ref, project: { name, location, developer: '', ids } });

(async () => {
  console.log('the mode switch');
  await t('shadow is the default; on and off are honoured; anything else falls back to shadow', () => {
    assert.strictEqual(createSearch({ env: {}, log: quiet }).mode(), 'shadow'); assert.strictEqual(createSearch({ env: { SEARCH_V2: 'ON' }, log: quiet }).mode(), 'on');
    assert.strictEqual(createSearch({ env: { SEARCH_V2: 'off' }, log: quiet }).mode(), 'off'); assert.strictEqual(createSearch({ env: { SEARCH_V2: 'maybe' }, log: quiet }).mode(), 'shadow');
  });
  await t('switched off, the candidate route refuses and nothing is compared or added', async () => {
    const svc = createSearch({ env: { SEARCH_V2: 'off' }, log: quiet }), s = serve(svc); assert.strictEqual((await s.req('POST', '/api/search/candidates', { query: 'x', market: 'in' })).code, 404);
    assert.strictEqual(svc.afterResearch({ query: 'Coral Bay', market: 'in', brief: brief('SK-1', 'Coral Bay', 'Bandra') }), null); assert.strictEqual(svc.index.size, 0);
  });

  console.log('the routes');
  await t('candidates: a market and at least two letters are required; personal details are removed before matching', async () => {
    const svc = createSearch({ env: {}, log: quiet }); svc.index.load(F); const s = serve(svc);
    assert.strictEqual((await s.req('POST', '/api/search/candidates', { query: 'Vasant', market: 'zz' })).code, 400); assert.strictEqual((await s.req('POST', '/api/search/candidates', { query: 'V', market: 'in' })).code, 400);
    const r = await s.req('POST', '/api/search/candidates', { query: 'vasant hieghts 9820012345', market: 'in' }); assert.strictEqual(r.code, 200); assert.strictEqual(r.body.candidates[0].id, 't-vasant-heights'); assert.strictEqual(r.body.indexSize, F.length);
  });
  await t('remember: the developer, the area and the year find the project', async () => {
    const svc = createSearch({ env: {}, log: quiet }); svc.index.load(F); const s = serve(svc);
    const r = await s.req('POST', '/api/search/candidates', { query: '', market: 'in', remember: { developer: 'Arihant', locality: 'Juhu' } }); assert.strictEqual(r.body.candidates[0].id, 't-skyline-towers');
  });
  await t('admin: projects are loaded in bulk, bad ones are refused with reasons, and both admin routes sit behind the admin login', async () => {
    const svc = createSearch({ env: {}, log: quiet }), s = serve(svc);
    const r = await s.req('POST', '/api/admin/search/projects', { projects: [...F, { id: 'bad', market: 'india', name: 'X' }] }); assert.strictEqual(r.body.added, F.length); assert.strictEqual(r.body.refused[0].id, 'bad');
    assert.strictEqual((await s.req('POST', '/api/admin/search/projects', { projects: 'nope' })).code, 400); await s.req('GET', '/api/admin/search/shadow');
    assert(s.authed.includes('/api/admin/search/projects') && s.authed.includes('/api/admin/search/shadow'));
  });

  console.log('the shadow comparison');
  await t('each research is compared: agree, a project the new search already knew while the old one researched afresh, or neither', async () => {
    const svc = createSearch({ env: {}, log: quiet }); svc.index.load(F);
    assert.strictEqual(svc.afterResearch({ query: 'vasant hieghts', location: '', market: 'in', brief: { ...brief('SK-2', 'Vasant Heights', 'Worli'), cached: true } }), 'agree');
    assert.strictEqual(svc.afterResearch({ query: 'wasant heights', location: '', market: 'in', brief: brief('SK-3', 'Some Other Name', 'Worli') }), 'new_found_old_researched_fresh');
    assert.strictEqual(svc.afterResearch({ query: 'Coral Bay', location: '', market: 'in', brief: brief('SK-4', 'Coral Bay', 'Bandra') }), 'neither');
    const r = await serve(svc).req('GET', '/api/admin/search/shadow'); assert.strictEqual(r.body.compared, 3); assert.strictEqual(r.body.recent[0].query, 'Coral Bay'); assert.strictEqual(r.body.counts.agree, 1);
  });
  await t('a researched project becomes a candidate for the next buyer', async () => {
    const svc = createSearch({ env: {}, log: quiet }); svc.afterResearch({ query: 'Coral Bay', location: 'Bandra', market: 'in', brief: brief('SK-5', 'Coral Bay Residences', 'Bandra West', ['P51800099999']) });
    assert.strictEqual(svc.index.match({ query: 'coral bay residnces', market: 'in' }).candidates[0].id, 'r:SK-5'); assert.strictEqual(svc.index.match({ query: 'P51800099999', market: 'in' }).confidence, 'sure');
  });

  await t('the live investigator is compared too: a fresh investigation the new search could have matched, an earlier one served again, and the investigated project added', async () => {
    const svc = createSearch({ env: {}, log: quiet }); svc.index.load(F);
    assert.strictEqual(svc.observeInvestigate({ query: 'vasant hieghts', location: '', market: 'in', reused: false }), 'new_found_old_researched_fresh');
    assert.strictEqual(svc.observeInvestigate({ query: 'Coral Bay', location: '', market: 'in', reused: false }), 'neither');
    assert.strictEqual(svc.observeInvestigate({ query: 'vasant heights', location: '', market: 'in', reused: true }), 'old_reused');
    assert.strictEqual(svc.marketOfCountry('GB'), 'uk'); assert.strictEqual(svc.marketOfCountry('IN'), 'in');
    svc.afterInvestigation({ ref: 'SK-9', project: { name: 'Coral Bay Residences', location: 'Bandra West' } }, 'in'); assert.strictEqual(svc.index.match({ query: 'coral bay', market: 'in' }).candidates[0].id, 'r:SK-9');
    assert.strictEqual(svc.shadow.recent[0].route, 'investigate');
  });

  console.log('keeping the index');
  await t('with a data directory, the index is saved and comes back after a restart; the seed file is read first', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-search-')), seed = path.join(dir, 'seed.json'); fs.writeFileSync(seed, JSON.stringify([F[0]]));
    const a = createSearch({ env: { SEARCH_DATA_DIR: dir }, log: quiet, seedFile: seed }); assert.strictEqual(a.index.size, 1);
    a.afterResearch({ query: 'Coral Bay', market: 'in', brief: brief('SK-6', 'Coral Bay', 'Bandra') }); await new Promise(r => setTimeout(r, 2300));
    assert(fs.existsSync(path.join(dir, 'search-index.json'))); const b = createSearch({ env: { SEARCH_DATA_DIR: dir }, log: quiet, seedFile: seed }); assert.strictEqual(b.index.size, 2);
    fs.writeFileSync(path.join(dir, 'search-index.json'), '{not json'); assert.strictEqual(createSearch({ env: { SEARCH_DATA_DIR: dir }, log: quiet, seedFile: seed }).index.size, 1, 'a damaged file is skipped, not fatal');
  });

  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
