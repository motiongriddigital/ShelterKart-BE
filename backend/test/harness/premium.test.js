const env = { ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN_SECRET: 'tok-secret', ACCOUNTS_ENABLED: 'on', AUTH_PEPPER: 'x'.repeat(40), ACCOUNTS_ALLOW_MEMORY: 'true', ACCOUNTS_DEV_ECHO: 'on', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'pw',
  PREMIUM_SEARCH: process.env.PREMIUM_SEARCH_TEST || 'on', RESEND_API_KEY: 're_test', DELIVERY_FROM: 'ShelterKart <no-reply@shelterkart.test>' };
Object.assign(process.env, env);
const HOST = 'https://maharerait.maharashtra.gov.in/x', A1 = 'https://alpha-news.example/1', B1 = 'https://beta-forum.example.org/2';
const OUT = { project: { name: 'Hubtown Celeste', location: 'Mumbai', promoter_legal_name: 'Hubtown Limited', registration_ids: ['P51900008925'] },
  facts: [{ area: 'identity', field: 'registered promoter', value: 'Hubtown Limited', claim: 'The regulator names Hubtown Limited.', sources: [HOST] }, { area: 'money', claim: 'A charge of 50 crore is reported.', sources: [A1, B1] }, { area: 'buyers', claim: 'Buyers report delays.', sources: [A1] }] };
let searches = 0;
globalThis.fetch = async (url, o) => { const mk = c => ({ ok: true, status: 200, json: async () => c }), b = JSON.parse((o && o.body) || '{}');
  if (b.tools) { searches++; return mk({ stop_reason: 'end_turn', usage: { input_tokens: 30000, output_tokens: 3000 }, content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: [HOST, A1, B1].map(u => ({ url: u, title: 't' })) }, { type: 'text', text: JSON.stringify(OUT) }] }); }
  return mk({ content: [{ type: 'text', text: '{}' }] }); };
const app = require(require('path').join(__dirname, '..', '..', 'server.js'));
const { _db } = require('pg');
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route, body, { headers = {}, query = {} } = {}) { return new Promise(resolve => {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const res = { code: 200, headers: {}, cookies: [], status(c) { this.code = c; return this; }, set(k, v) { if (typeof k === 'object') Object.assign(this.headers, k); else this.headers[k] = v; return this; },
    append(k, v) { if (k === 'Set-Cookie') this.cookies.push(v); return this; }, json(o) { resolve({ code: this.code, body: o, cookies: this.cookies, headers: this.headers }); }, send(o) { resolve({ code: this.code, body: o }); }, end() { resolve({ code: this.code }); } };
  const req = { body, params: {}, query, ip: '3.3.3.3', path: '', headers: h, originalUrl: '', get: k => h[k.toLowerCase()], on() {} };
  let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const fn = route.handlers[i++]; if (fn) fn(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });
async function signIn(email) {
  const ua = { 'user-agent': 'Mozilla/5.0 (Macintosh)' };
  const rc = await call(find('post', '/api/auth/request-code'), { email }, { headers: ua });
  const vc = await call(find('post', '/api/auth/verify-code'), { email, code: rc.body.devCode, termsAccepted: true }, { headers: ua });
  return { cookie: (vc.cookies[0] || '').split(';')[0], user: vc.body.user };
}

(async () => {
  const on = process.env.PREMIUM_SEARCH === 'on';
  if (!on) {
    console.log('the flag is off');
    ok('POST /api/search/premium is not registered', !find('post', '/api/search/premium'));
    ok('GET /api/admin/search/premium/episodes is not registered', !find('get', '/api/admin/search/premium/episodes'));
    ok('the free search routes are all still there', Boolean(find('post', '/api/search/candidates') && find('post', '/api/investigate') && find('post', '/api/research')));
    return;
  }
  console.log('the flag is on');
  const route = find('post', '/api/search/premium'), body = { query: 'Hubtown Celeste', location: 'Worli', country: 'IN' };
  ok('the premium route and the admin route are registered', Boolean(route && find('get', '/api/admin/search/premium/episodes')));
  const anon = await call(route, body);
  ok('signed out: 401 and no search', anon.code === 401 && searches === 0);
  const A = await signIn('reader@example.com');
  const free = await call(route, body, { headers: { cookie: A.cookie } });
  ok('signed in with no purchase: 403 not_premium and no search', free.code === 403 && free.body.code === 'not_premium' && searches === 0);
  _db.purchases.push({ id: 'p-1', user_id: A.user.id, report_ref: 'SK-AAAAAAAAAAAA', status: 'pending_payment', amount: 3700, currency: 'INR' });
  ok('a purchase that is not paid does not make a reader premium', (await call(route, body, { headers: { cookie: A.cookie } })).code === 403);
  _db.purchases[0].status = 'paid';
  const r = await call(route, body, { headers: { cookie: A.cookie } });
  ok('a paid purchase makes the reader premium: 200 with findings', r.code === 200 && r.body.ok === true && r.body.findings.length >= 1 && searches >= 1);
  ok('the official finding and the two-site finding are accepted; the one-site finding is unconfirmed', r.body.findings.some(f => f.corroboration.official) && r.body.findings.some(f => /charge/.test(f.claim)) && r.body.unconfirmed.some(f => /delays/.test(f.claim)));
  ok('the answer carries no cost, no episode and no personal data', !/usage|episode|Usd|reader@|\"id\"/.test(JSON.stringify(r.body)) && r.headers['Cache-Control'] === 'no-store');
  _db.purchases[0].status = 'refunded';
  ok('a refund ends it at the next request', (await call(route, body, { headers: { cookie: A.cookie } })).code === 403);
  const adm = find('get', '/api/admin/search/premium/episodes');
  ok('the admin route refuses without the admin login', (await call(adm, null)).code === 401);
  const auth = { authorization: 'Basic ' + Buffer.from('admin:pw').toString('base64') };
  const ep = await call(adm, null, { headers: auth, query: {} });
  ok('with it, the episode log shows one search and holds no personal data', ep.code === 200 && ep.body.summary.episodes === 1 && ep.body.recent.length === 2 && !/Hubtown|Worli|reader@/.test(JSON.stringify(ep.body)));
  ok('the cost was counted in the day\'s AI spend and in the log', ep.body.recent[0].cost.measuredUsd > 0 && ep.body.summary.avgSpentUsd > 0);
})();
