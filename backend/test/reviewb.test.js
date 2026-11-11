'use strict';
const assert = require('assert');
const INV = require('../engine/investigator');
const { ProjectIndex } = require('../search/index');
const JC = require('../engine/jobCosts');
const { makePgStore } = require('../engine/persistence');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const newState = retrieved => ({ project: { ids: [] }, raw: [], entities: [], units: [], sanctioned: [], filed: [], marketed: [], listings: [], botLeads: [], questions: [], unreachable: [], retrieved: new Set(retrieved || []), leads: new Map(), used: new Set(), failed: [], round: 0 });
const factsOf = d => d.sections.flatMap(s => s.facts);
const OFFICIAL = 'https://ecourts.gov.in/case-search?cnr=1';

(async () => {
  await t('a null inside the model\'s arrays does not discard the rest of the reply', async () => {
    const st = newState();
    INV.ingest(st, { facts: [{ area: 'legal', claim: 'First.', sources: [] }, null, 7, { area: 'legal', claim: 'Second.', sources: [] }], entities: [null, { name: 'Acme Homes Ltd', sources: [] }], units: [null], sanctioned: [null], filed: [null], marketed: [null], listings: [null], questions: [null] }, 'anthropic', 0);
    assert.strictEqual(st.raw.length, 2);
    assert.strictEqual(st.entities.length, 1);
    const d = INV.build(st, { query: 'X', location: '', market: 'in' });
    assert.strictEqual(factsOf(d).length, 2);
  });

  await t('a fact is verified only when an official page it cites was actually retrieved', async () => {
    const claim = { area: 'legal', claim: 'No court case is pending against the promoter.', kind: 'fact', sources: [OFFICIAL] };
    const unseen = newState(['https://some-blog.example/post']); INV.ingest(unseen, { facts: [claim] }, 'anthropic', 0);
    const f1 = factsOf(INV.build(unseen, { query: 'X', location: '', market: 'in' }))[0];
    assert.notStrictEqual(f1.status, 'verified');
    assert.strictEqual(f1.sources[0].seen, false);
    const seen = newState([OFFICIAL]); INV.ingest(seen, { facts: [claim] }, 'anthropic', 0);
    assert.strictEqual(factsOf(INV.build(seen, { query: 'X', location: '', market: 'in' }))[0].status, 'verified');
  });
  await t('a retrieved page counts as seen when only the trailing slash, www or fragment differs', async () => {
    const st = newState(['https://www.ecourts.gov.in/case-search/?cnr=1#top']); INV.ingest(st, { facts: [{ area: 'legal', claim: 'A.', sources: [OFFICIAL] }] }, 'anthropic', 0);
    const f = factsOf(INV.build(st, { query: 'X', location: '', market: 'in' }))[0];
    assert.strictEqual(f.sources[0].seen, true);
    assert.strictEqual(f.status, 'verified');
  });

  await t('matching with an unknown place stays fast as the index grows, and a new place is learned', async () => {
    const idx = new ProjectIndex(), words = ['alpha', 'beta', 'gamma', 'delta', 'omega', 'sigma', 'lotus', 'harbor', 'vista', 'garden', 'orchid', 'maple', 'cedar', 'pearl', 'jade'];
    for (let i = 0; i < 1500; i++) idx.addBrief({ ref: 'SK-' + String(i).padStart(12, '0'), project: { name: `${words[i % 15]} ${words[(i * 7) % 15]} ${i}`, location: `${words[(i * 3) % 15]} nagar`, developer: `${words[(i * 5) % 15]} realty`, ids: ['P' + (5e10 + i)] } }, 'in');
    const t0 = Date.now(); idx.match({ query: 'lotus heights', location: 'zzzz', market: 'in' }); const ms = Date.now() - t0;
    assert.ok(ms < 400, `matching took ${ms} ms at 1,500 projects`);
    assert.strictEqual(idx._isPlace('in', 'zzzz'), false);
    idx.addBrief({ ref: 'SK-999999999999', project: { name: 'New Tower', location: 'zzzz', developer: 'X', ids: [] } }, 'in');
    assert.strictEqual(idx._isPlace('in', 'zzzz'), true);
  });

  await t('a call on a model the catalogue does not list is priced like the engine\'s default model, never as free', async () => {
    const run = model => new Promise(resolve => { let usd = -1; const eng = { run: async () => ({ engine: 'anthropic', model, usage: { input: 5e6, output: 5e5 }, searches: 0, text: '' }) }; JC.costedEngines(eng, u => { usd = u; }).run('research', 'search', { stage: 'leads' }).then(() => resolve(usd)); });
    const known = await run(require('../engines/catalog').engine('anthropic').defaultModel), unlisted = await run('claude-unlisted-9');
    assert.ok(known > 0);
    assert.strictEqual(unlisted, known);
  });

  await t('after a restart the cache is rebuilt from the newest reports, oldest of those first', async () => {
    const sqls = []; const pool = { async query(sql, args) { sqls.push(sql); return { rows: [] }; } };
    await makePgStore(pool).loadRecent(new Date(0), 2000);
    const sql = sqls.join(' ').replace(/\s+/g, ' ');
    assert.ok(/ORDER BY created_at DESC LIMIT/i.test(sql), sql);
    assert.ok(/ORDER BY created_at ASC/i.test(sql.slice(sql.toUpperCase().lastIndexOf(')'))), sql);
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
