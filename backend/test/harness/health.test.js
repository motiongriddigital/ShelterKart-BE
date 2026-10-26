// The real server, the real guarded fetch (SSRF guard included), the real
// health module and persistence -- only the network and DNS are faked.
Object.assign(process.env, { ANTHROPIC_API_KEY: 'k', DATABASE_URL: 'postgres://stub', ADMIN_USERNAME: 'ops', ADMIN_PASSWORD: 'correct-horse',
  ALERT_WEBHOOK_URL: 'https://hooks.example.com/services/T/B/x' });
// DNS: every host resolves to a public address, so the guard runs but nothing leaves the machine
require('dns').promises.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
const SG_OK = { result: { records: [{ uen: '197600660W', entity_name: 'GUOCOLAND LIMITED', uen_status_desc: 'Registered', entity_type_desc: 'Local Company' }] } };
const net = { sgApi: 'ok', asked: [], hooks: [], delayMs: 0 };
const R = (status, body) => ({ status, ok: status < 300, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url); net.asked.push(`${o.method || 'GET'} ${u.host}${u.pathname}`);
  if (u.host === 'hooks.example.com') { net.hooks.push(JSON.parse(o.body)); return R(200, 'ok'); }
  if (net.delayMs) await new Promise(r => setTimeout(r, net.delayMs));
  if (u.pathname === '/robots.txt') return R(404, '');
  if (u.host === 'data.gov.sg') return net.sgApi === 'ok' ? R(200, SG_OK) : R(500, {});
  if (u.host === 'api.anthropic.com') {
    const b = JSON.parse(o.body);
    if (b.tools) { const out = { project: { name: b.messages[0].content.match(/"([^"]+)"/) ? 'River Modern' : 'River Modern', location: 'Singapore', developer: 'GuocoLand Limited', ids: [] },
        sources: ['https://www.99.co/x'], findings: [{ id: 'f1', topic: 'other', claim: 'A claim.', kind: 'fact', src: [0] }], conflicts: [], gaps: [] };
      return R(200, { stop_reason: 'end_turn', content: [{ type: 'server_tool_use', name: 'web_search' },
        { type: 'web_search_tool_result', content: [{ url: 'https://www.99.co/x', title: 'River Modern' }] }, { type: 'text', text: JSON.stringify(out) }] }); }
    return R(200, { content: [{ type: 'text', text: '{"reading":[],"questions":[]}' }] });
  }
  return R(500, {});
};
const path = require('path');
const app = require(path.join(__dirname, '..', '..', 'server.js'));
const H = require(path.join(__dirname, '..', '..', 'engine', 'health.js'));
const RS = require(path.join(__dirname, '..', '..', 'engine', 'research.js'));
const { _db } = require('pg');
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
function call(route, { body = {}, headers = {} } = {}) { return new Promise(resolve => {
  const res = { code: 200, status(c) { this.code = c; return this; }, set() { return this; }, json(o) { resolve({ code: this.code, body: o }); } };
  const req = { body, params: {}, headers, ip: '8.8.8.8', path: route.path, get: k => headers[k.toLowerCase()] };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const h = hs[i++]; if (h) h(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });
const AUTH = { authorization: basic('ops', 'correct-horse') };
const quiet = async fn => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };

(async () => {
  // 1. structure: nothing under /api/admin can be registered outside the limiter
  const layers = app.routes.map((r, i) => ({ ...r, i }));
  const limiter = layers.find(r => r.method === 'use' && r.path === '/api/admin');
  const adminRoutes = layers.filter(r => r.method !== 'use' && typeof r.path === 'string' && r.path.startsWith('/api/admin'));
  ok('the admin rate limiter is registered', Boolean(limiter));
  ok(`every admin route (${adminRoutes.length}) is registered AFTER the limiter, so none escapes it`, adminRoutes.length >= 4 && adminRoutes.every(r => r.i > limiter.i));

  // 1b. the retired routes answer 410 -- nothing anonymous can create purchases or leads any more
  const gone = layers.find(r => r.method === 'all' && Array.isArray(r.path));
  ok('the retired legacy routes are all covered by one 410 handler',
     gone && ['/api/send-otp', '/api/verify-otp', '/api/checkout', '/api/report-checkout', '/api/resolve', '/api/report/:type/:id'].every(p => gone.path.includes(p)));
  const goneRes = await new Promise(resolve => { const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); } }; gone.handlers[0]({}, res); });
  ok('...and it says 410, so a stale cached site gets an explicit answer', goneRes.code === 410 && /retired/.test(goneRes.body.error));
  const liveRoutes = new Set(layers.filter(r => r.method !== 'use' && typeof r.path === 'string').map(r => r.method + ' ' + r.path));
  ok('nothing else still creates buyer_leads or client-priced purchases',
     !['post /api/send-otp', 'post /api/verify-otp', 'post /api/checkout', 'post /api/report-checkout'].some(x => liveRoutes.has(x)));

  // 2. access control
  const get = find('get', '/api/admin/source-health'), run = find('post', '/api/admin/source-health/run');
  ok('source-health is refused without credentials', (await quiet(() => call(get))).code === 401);
  ok('...and with wrong ones', (await quiet(() => call(get, { headers: { authorization: basic('ops', 'wrong') } }))).code === 401);
  const before = await call(get, { headers: AUTH });
  ok('before any run, every register is listed as not yet checked', before.code === 200 && before.body.markets.length >= 9 && before.body.markets.every(m => m.state === 'not_checked'));

  // 3. a real run through the real guarded client
  await RS.hydrate();
  const r1 = await quiet(() => call(run, { headers: AUTH }));
  const by = m => (r1.body.results || []).find(x => x.market === m) || {};
  ok('a run completes', r1.code === 200 && r1.body.ok);
  ok('Singapore, answering correctly, is healthy', by('sg').state === 'healthy');
  ok('registers that need a key this server lacks are skipped, not failed', by('uk').state === 'skipped' && by('au').state === 'skipped' && by('tw').state === 'skipped');
  ok('registers that fail their first-ever check are "unconfirmed", still in use', by('cz').state === 'unconfirmed' && by('fr').state === 'unconfirmed');
  ok('the requests really went through the guarded client, including robots.txt for the path used',
     net.asked.includes('GET data.gov.sg/api/action/datastore_search') && net.asked.includes('GET data.gov.sg/robots.txt'));
  ok('the Czech canary reached ARES as a POST (the dropped-body bug)', net.asked.some(a => a.startsWith('POST ares.gov.cz')));
  ok('a first run sends ONE digest about the registers that have never passed, and says nothing about Singapore',
     net.hooks.length === 1 && /never passed for 5 market/.test(net.hooks[0].text) && /France \(fr\)/.test(net.hooks[0].text) && !/Singapore/.test(net.hooks[0].text));
  ok('every result was saved to Postgres', _db.health.get('sg') && _db.health.get('sg').state === 'healthy' && _db.health.has('cz'));

  // 4. a restart keeps what was learned
  H._health.clear();
  ok('after a restart, memory has forgotten', H.getHealth('sg') === null);
  const h = await RS.hydrate();
  ok('startup reload restores the health records', h.healthRecords >= 5 && H.getHealth('sg').state === 'healthy');

  // 5. Singapore's register breaks: two runs, then it is switched off, and everyone is told
  net.sgApi = 'broken';
  await quiet(() => call(run, { headers: AUTH }));
  ok('one failure: degraded, still used, nobody paged', H.getHealth('sg').state === 'degraded' && net.hooks.length === 1);
  await quiet(() => call(run, { headers: AUTH }));
  ok('two failures: switched off', H.getHealth('sg').state === 'down');
  ok('the webhook was called once more, naming the market and the fix', net.hooks.length === 2 && /Singapore/.test(net.hooks[1].text) && /research-only/.test(net.hooks[1].text));
  ok('the admin view says so', (await call(get, { headers: AUTH })).body.markets.find(m => m.market === 'sg').state === 'down');
  const markets = await new Promise(resolve => { const res = { json: resolve }; find('get', '/api/markets').handlers[0]({}, res); });
  const sg = markets.find(m => m.code === 'sg');
  ok('the public market list now shows Singapore as research-only, with the reason', sg.depth === 'Research' && /temporarily switched off/.test(sg.note));

  // 6. and a real search there says so instead of "no match"
  const before2 = net.asked.filter(a => a.includes('data.gov.sg/api')).length;
  const search = await call(find('post', '/api/research'), { body: { query: 'River Modern', market: 'sg' } });
  ok('a search in Singapore still returns a complete report', search.code === 200 && search.body.brief.findings.length >= 1);
  ok('...made no request to the switched-off register', net.asked.filter(a => a.includes('data.gov.sg/api')).length === before2);
  ok('...says the register is switched off, instead of implying "no match"', search.body.brief.notes.some(n => /temporarily switched off/.test(n)) && search.body.brief.pipeline_status.registry === 'switched_off');
  ok('...and never claims a register check that did not happen', search.body.brief.depth === 'Research');

  // 7. recovery
  net.sgApi = 'ok';
  await quiet(() => call(run, { headers: AUTH }));
  ok('when it answers again it is back in use, and the operator hears about that too', H.getHealth('sg').state === 'healthy' && net.hooks.length === 3 && /recovered/.test(net.hooks[2].text));
  const beforeRecovered = net.asked.filter(a => a.includes('data.gov.sg/api')).length;
  const again = await call(find('post', '/api/research'), { body: { query: 'River Modern Residences', market: 'sg' } });
  ok('after recovery, a new search queries the register again', again.code === 200 && net.asked.filter(a => a.includes('data.gov.sg/api')).length > beforeRecovered);

  // 8. no overlapping runs
  net.delayMs = 40;
  const [a, b] = await quiet(() => Promise.all([call(run, { headers: AUTH }), call(run, { headers: AUTH })]));
  ok('two runs cannot overlap: the second is told one is already running', [a.code, b.code].sort().join() === '200,409');
  net.delayMs = 0;
})();
