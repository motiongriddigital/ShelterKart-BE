Object.assign(process.env, { ADMIN_USERNAME: 'a', ADMIN_PASSWORD: 'b', ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN_SECRET: 'tok-secret-for-the-report-view-test-0123456789', PAYMENTS_ENABLED: 'true',
  RAZORPAY_KEY_ID: 'rzp_test_id', RAZORPAY_KEY_SECRET: 'rzp_secret', GSTIN: '27ABCDE1234F1Z5', PUBLIC_BASE_URL: 'https://shelterkart.test' });
delete process.env.DATABASE_URL; delete process.env.ACCOUNTS_ENABLED;
const path = require('path');
const app = require(path.join(__dirname, '..', '..', 'server.js'));
const { _db } = require('pg');
const R = require('../../engine/research');
const { issueToken } = require('../../engine/access');
const { briefOf } = require('../../engine/dossierBrief');
const SAMPLE = require('../../../tools/samples/dossier-celeste.json');
const SECRET = process.env.ACCESS_TOKEN_SECRET;
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route, { params = {}, headers = {}, query = {} } = {}) { return new Promise(resolve => {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const res = { code: 200, headers: {}, status(x) { this.code = x; return this; }, set(k, v) { if (typeof k === 'object') Object.assign(this.headers, k); else this.headers[k] = v; return this; }, json(o) { resolve({ code: this.code, body: o, headers: this.headers }); } };
  const req = { body: {}, params, query, ip: '3.3.3.3', path: route.path, headers: h, originalUrl: route.path, get: k => h[k.toLowerCase()], on() {} };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const f = hs[i++]; if (f) f(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, x) => { if (!x) failures++; console.log((x ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });

const REF = 'SK-AAAAAAAAAAAA', EARLY = 'SK-BBBBBBBBBBBB', SEARCH = 'SK-CCCCCCCCCCCC';
const PID = '11111111-0000-4000-8000-000000000001';
const purchase = status => { _db.purchases.push({ id: PID, report_ref: REF, status, provider: 'razorpay', provider_order_id: 'order_1', amount: 100, currency: 'INR' }); return _db.purchases[_db.purchases.length - 1]; };

(async () => {
  const route = find('get', '/api/report/:ref');
  console.log('the route');
  ok('GET /api/report/:ref is registered', Boolean(route));
  const dossier = JSON.parse(JSON.stringify(SAMPLE)); dossier.ref = REF; dossier.phase = 'complete';
  R.registerBrief(briefOf({ ref: REF, query: 'Hubtown Celeste', location: 'Mumbai', country: 'IN', marketLabel: 'India', dossier, phase: 'complete', contact: { email: 'first.buyer@example.com', phone: '+919820000000' } }));
  R.registerBrief(briefOf({ ref: EARLY, query: 'Early Towers', location: 'Pune', country: 'IN', marketLabel: 'India', dossier: null, phase: 'starting' }));
  R.registerBrief({ ref: SEARCH, query: 'q', location: '', market: 'uk', project: { name: 'Tower', developer: 'D' }, findings: [], conflicts: [], pages: [], checkedAt: new Date().toISOString() });

  const bad = await call(route, { params: { ref: 'nope' } });
  ok('a malformed reference is 400', bad.code === 400 && bad.body.ok === false);
  const none = await call(route, { params: { ref: 'SK-DDDDDDDDDDDD' } });
  ok('an unknown report is 404', none.code === 404);
  const search = await call(route, { params: { ref: SEARCH } });
  ok('a search report (not an investigation) is 404', search.code === 404);
  const early = await call(route, { params: { ref: EARLY } });
  ok('an investigation with no dossier yet is 202 and says it is not ready', early.code === 202 && early.body.ready === false && early.body.phase === 'starting');

  console.log('\nwithout a purchase');
  const free = await call(route, { params: { ref: REF } });
  ok('the free view is served: 200, ready, locked', free.code === 200 && free.body.ok === true && free.body.ready === true && free.body.report.locked === true);
  ok('it is never cached or indexed', free.headers['Cache-Control'] === 'no-store' && /noindex/.test(free.headers['X-Robots-Tag']));
  const freeText = JSON.stringify(free.body);
  ok('three questions only, no checklist items, no sources, no ledger', free.body.report.questions.length === 3 && free.body.report.checklist.items.length === 0 && free.body.report.sources.length === 0 && free.body.report.ledger.length === 0);
  ok('no locked question or source is in the response', !freeText.includes(SAMPLE.questions[5].question.slice(0, 60)) && !SAMPLE.sources.some(s => freeText.includes(s.url)));
  ok('a garbage token does not open it', JSON.parse(JSON.stringify((await call(route, { params: { ref: REF }, headers: { 'x-report-access': 'garbage' } })).body.report.locked)) === true);
  ok('the stored contact is not in the response', !/first\.buyer|919820000000|"contact"/.test(freeText));

  console.log('\nwith a paid purchase');
  const p = purchase('paid');
  const token = issueToken(REF, SECRET, 30, Date.now(), PID);
  const paid = await call(route, { params: { ref: REF }, headers: { 'x-report-access': token } });
  ok('the full view is served with the header', paid.code === 200 && paid.body.report.locked === false && paid.body.report.questions.length === 8 && paid.body.report.sources.length === 8);
  const viaQuery = await call(route, { params: { ref: REF }, query: { t: token } });
  ok('the token also works as ?t=, as on the report page', viaQuery.body.report.locked === false);
  ok('a token for another report does not open this one', (await call(route, { params: { ref: REF }, headers: { 'x-report-access': issueToken('SK-EEEEEEEEEEEE', SECRET, 30, Date.now(), PID) } })).body.report.locked === true);
  ok('the stored contact is not in the full view either', !/first\.buyer|919820000000|"contact"/.test(JSON.stringify(paid.body)));
  p.status = 'refunded';
  const refunded = await call(route, { params: { ref: REF }, headers: { 'x-report-access': token } });
  ok('after a refund the same token gets the free view again', refunded.code === 200 && refunded.body.report.locked === true);

  console.log('\nwhen payments are switched off');
  process.env.PAYMENTS_ENABLED = 'false';
  const open = await call(route, { params: { ref: REF } });
  ok('nothing is for sale, so the report is open, as on /api/research/by-ref', open.code === 200 && open.body.report.locked === false && open.body.report.sources.length === 8);
  process.env.PAYMENTS_ENABLED = 'true';
  ok('and locked again once payments are on', (await call(route, { params: { ref: REF } })).body.report.locked === true);
})();
