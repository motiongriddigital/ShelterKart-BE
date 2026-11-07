// SHEL-33: a legal takedown must work once investigator reports exist. Dossier reports have no `pages`; the purge used to throw on them
// (500, nothing removed from storage). Now it reads the sources inside the dossier, in memory, in storage, and in saved investigations.
const env = { ADMIN_USERNAME: 'a', ADMIN_PASSWORD: 'b', ANTHROPIC_API_KEY: 'k', AI_PERSONAL_DATA_ENGINES: 'anthropic', ACCESS_TOKEN_SECRET: 'tok-secret', PUBLIC_BASE_URL: 'https://shelterkart.test' };
Object.assign(process.env, env);
delete process.env.DATABASE_URL;
const path = require('path');
const app = require(path.join(__dirname, '..', '..', 'server.js'));
const { c } = require(path.join(__dirname, '..', '..', 'app.js'));
const R = require('../../engine/research');
const { pagesOf, cites } = require('../../engine/briefPages');
const { makePgStore } = require('../../engine/persistence');
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
const ADMIN = { authorization: 'Basic ' + Buffer.from('a:b').toString('base64') };
function call(route, body) { return new Promise(resolve => {
  const res = { code: 200, status(x) { this.code = x; return this; }, set() { return this; }, json(o) { resolve({ code: this.code, body: o }); } };
  const req = { body, params: {}, query: {}, ip: '3.3.3.3', path: '/api/admin/purge', headers: ADMIN, originalUrl: '/api/admin/purge', get: k => ADMIN[k.toLowerCase()], on() {} };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const h = hs[i++]; if (h) h(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, x) => { if (!x) failures++; console.log((x ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });

const dossierBrief = (ref, urls) => ({ kind: 'dossier', ref, query: 'dossier:' + ref, location: '', market: 'in', project: { name: 'P ' + ref, ids: [] }, findings: [], conflicts: [], checkedAt: new Date().toISOString(),
  dossier: { sources: urls.map(url => ({ url, title: 't' })), sections: [{ title: 'S', facts: [{ claim: 'c', sources: [{ url: urls[0], title: 'x' }] }] }], questions: [{ id: 'q1', sources: [{ url: urls[urls.length - 1] }] }], checks: {} } });

(async () => {
  console.log('which pages a report cites');
  ok('a search-lane report: its pages', pagesOf({ pages: [{ url: 'https://a.example/1' }, { url: 'https://a.example/1' }, { url: '' }] }).length === 1);
  const d = dossierBrief('SK-AAAAAAAAAAAA', ['https://regulator.example/x', 'https://news.example/y']);
  ok('a dossier: every url anywhere inside it, once each', pagesOf(d).map(p => p.url).sort().join() === 'https://news.example/y,https://regulator.example/x');
  ok('odd shapes never throw', pagesOf(null).length === 0 && pagesOf({}).length === 0 && pagesOf({ dossier: 'x' }).length === 0 && pagesOf({ pages: 'no', dossier: { sources: [null, 3, { url: 5 }] } }).length === 0);
  ok('by exact url, and by host with or without www', cites(d, { url: 'https://regulator.example/x' }) && cites(d, { host: 'regulator.example' }) && cites(d, { host: 'WWW.Regulator.example' }) && !cites(d, { host: 'other.example' }) && !cites(d, { url: 'https://regulator.example/other' }));

  console.log('\nthe purge with a dossier report present (this was a 500)');
  R.registerBrief(dossierBrief('SK-BBBBBBBBBBBB', ['https://takedown.example/p1', 'https://keep.example/z']));
  R.registerBrief(dossierBrief('SK-CCCCCCCCCCCC', ['https://keep.example/only']));
  R.registerBrief({ ref: 'SK-DDDDDDDDDDDD', query: 'q', location: '', market: 'uk', project: { name: 'S' }, findings: [], pages: [{ url: 'https://takedown.example/p2' }], checkedAt: new Date().toISOString() });
  const route = find('post', '/api/admin/purge');
  const byUrl = await call(route, { url: 'https://takedown.example/p1' });
  ok('purge by url answers 200, not 500', byUrl.code === 200 && byUrl.body.ok === true);
  ok('the dossier citing it is gone, the other dossier and the search-lane report remain', !(await R.getByRefAsync('SK-BBBBBBBBBBBB')) && Boolean(await R.getByRefAsync('SK-CCCCCCCCCCCC')) && Boolean(await R.getByRefAsync('SK-DDDDDDDDDDDD')));
  const byHost = await call(route, { host: 'takedown.example' });
  ok('purge by host removes the search-lane report on that host too', byHost.code === 200 && !(await R.getByRefAsync('SK-DDDDDDDDDDDD')) && Boolean(await R.getByRefAsync('SK-CCCCCCCCCCCC')));

  console.log('\nsaved investigations');
  const jobFor = (ref, status, urls) => ({ ref, status, created: Date.now(), events: [], listeners: new Set(), saved: { dossier: { sources: urls.map(url => ({ url })) } }, input: {} });
  c.liveJobs.set('SK-EEEEEEEEEEEE', jobFor('SK-EEEEEEEEEEEE', 'done', ['https://gone.example/a']));
  c.liveJobs.set('SK-FFFFFFFFFFFF', jobFor('SK-FFFFFFFFFFFF', 'sweeping', ['https://gone.example/b']));
  c.liveJobs.set('SK-111111111111', jobFor('SK-111111111111', 'done', ['https://fine.example/c']));
  c.liveIndex.set('some-project', { ref: 'SK-EEEEEEEEEEEE', at: Date.now() });
  const j = await call(route, { host: 'gone.example' });
  ok('a finished saved investigation citing the host is removed, with its index entry', j.code === 200 && j.body.purgedInvestigations === 1 && !c.liveJobs.has('SK-EEEEEEEEEEEE') && !c.liveIndex.has('some-project'));
  ok('one still working is left alone and counted, so the call can be repeated', j.body.investigationsStillRunning === 1 && c.liveJobs.has('SK-FFFFFFFFFFFF'));
  ok('an unrelated one is untouched', c.liveJobs.has('SK-111111111111'));

  console.log('\nstorage');
  const queries = [];
  const pool = { async query(sql, p) { queries.push({ sql, p });
    if (/^SELECT ref, brief FROM research_briefs/.test(sql)) return { rows: [{ ref: 'SK-OLD', brief: dossierBrief('SK-OLD', ['https://www.old.example/x']) }, { ref: 'SK-EMPTY', brief: { kind: 'dossier', dossier: {} } }] };
    return { rows: [] }; } };
  const store = makePgStore(pool);
  await store.saveBrief('k', dossierBrief('SK-GGGGGGGGGGGG', ['https://www.stored.example/x', 'https://other.example/y']));
  const saved = queries.find(q => /^INSERT INTO research_briefs/.test(q.sql)).p;
  ok('a dossier is stored WITH the pages it cites, so deleteCiting can find it', saved[3].length === 2 && saved[4].sort().join() === 'other.example,stored.example');
  const n = await store.backfillPageIndex();
  const upd = queries.find(q => /^UPDATE research_briefs SET page_urls/.test(q.sql));
  ok('reports saved before this fix are indexed on start (and one with nothing to index is skipped)', n === 1 && upd.p[0] === 'SK-OLD' && upd.p[2][0] === 'old.example');
})();
