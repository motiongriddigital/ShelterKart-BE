// The real server and the real persistence module, end to end, against
// a database stand-in that understands persistence.js's exact SQL. Proves
// the wiring: a report written through Postgres survives a simulated
// restart, opens from its link, and a legal purge clears it from storage.
Object.assign(process.env, { ANTHROPIC_API_KEY: 'k', DATABASE_URL: 'postgres://stub' });
const RET = [['https://maharerait.maharashtra.gov.in/x', 'MahaRERA'], ['https://www.housiey.com/y', 'Housiey'], ['https://b.com/2', 'B']];
const OUT = { project: { name: 'Samraat Tropicano', location: 'Nashik', developer: 'Samraat Group', ids: ['P51600012345'] }, sources: RET.map(r => r[0]),
  findings: RET.map((r, i) => ({ id: 'f' + i, topic: 'other', claim: 'Claim ' + i + '.', kind: 'fact', src: [i] })), conflicts: [], gaps: [] };
let searches = 0;
globalThis.fetch = async (url, o) => {
  const mk = c => ({ ok: true, status: 200, json: async () => c });
  const b = JSON.parse(o.body);
  if (b.tools) { searches++; return mk({ stop_reason: 'end_turn', content: [{ type: 'server_tool_use', name: 'web_search' },
    { type: 'web_search_tool_result', content: RET.map(([u, t]) => ({ url: u, title: t })) }, { type: 'text', text: JSON.stringify(OUT) }] }); }
  return mk({ content: [{ type: 'text', text: '{"reading":[],"questions":[]}' }] });
};
const path = require('path');
const app = require(path.join(__dirname, '..', '..', 'server.js'));
const RS = require(path.join(__dirname, '..', '..', 'engine', 'research.js'));
const { _db } = require('pg');
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route, body, params = {}, headers = {}) { return new Promise(resolve => {
  const res = { code: 200, status(c) { this.code = c; return this; }, set() { return this; }, json(o) { resolve({ code: this.code, body: o }); } };
  const req = { body, params, ip: '7.7.7.7', path: route.path, get: k => headers[k.toLowerCase()] };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const h = hs[i++]; if (h) h(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });
const settle = () => new Promise(r => setTimeout(r, 30));
const restart = () => { RS._cache.clear(); RS._refStore.clear(); RS._entities.aliases.clear(); RS._daily.day = ''; RS._daily.count = 0; };

(async () => {
  const errs = []; const origErr = console.error; console.error = (...a) => { errs.push(a.join(' ')); };
  try {
    await RS.hydrate();
    const r = await call(find('post', '/api/research'), { query: 'Samraat Tropicano', location: 'Nashik', market: 'in' });
    const ref = r.body.brief.ref;
    await settle();
    ok('the report is written through to Postgres, keyed by its ref', _db.briefs.has(ref));
    const row = _db.briefs.get(ref) || {};
    ok('...with every page URL stored for a later legal withdrawal', (row.page_urls || []).includes('https://www.housiey.com/y'));
    ok('...and hosts stored without www, matching how purges look them up', (row.page_hosts || []).includes('housiey.com'));
    ok('its aliases are written too (spelling and registration number)', [..._db.aliases.keys()].some(a => a.startsWith('name:in:')) && [..._db.aliases.keys()].some(a => a.startsWith('id:in:')));
    ok("today's research count is recorded", [..._db.daily.values()][0] === 1);

    restart();                                                      // the deploy
    const byRef = find('get', '/api/research/by-ref/:ref');
    const opened = await call(byRef, {}, { ref });
    ok('after a restart, the report link still opens -- read back from Postgres', opened.code === 200 && opened.body.brief.ref === ref);

    restart();
    const h = await RS.hydrate();
    ok('startup reload restores the report and its aliases', h.reports === 1 && h.aliases >= 2 && h.dailyCount === 1);
    const before = searches;
    const variant = await call(find('post', '/api/research'), { query: 'Samrat Tropicano', location: 'Nashik', market: 'in' });
    ok('another spelling after restart is answered from storage, with no new research', searches === before && variant.body.brief.matchedAs && variant.body.brief.ref === ref);

    const purged = await RS.purgeDurably({ host: 'www.housiey.com' });
    ok('a legal purge is confirmed by storage itself', purged.stored === 1 && !_db.briefs.has(ref));
    ok('...and the aliases pointing at the purged report are gone', ![..._db.aliases.values()].some(v => v.cache_key === row.cache_key));
    restart(); await RS.hydrate();
    ok('after another restart, the purged report stays gone', (await call(byRef, {}, { ref })).code === 404);
    ok('no storage statement failed along the way', errs.filter(e => e.includes('[persistence]')).length === 0);
  } finally { console.error = origErr; }
})();
