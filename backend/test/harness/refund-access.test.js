// SHEL-38: a refund ends access at once. Access tokens carry the purchase they were bought with, and the server checks that purchase when the
// token is used; the checkout signature of a refunded purchase no longer mints a token.
const crypto = require('crypto');
Object.assign(process.env, { ADMIN_USERNAME: 'a', ADMIN_PASSWORD: 'b', ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN_SECRET: 'tok-secret-for-the-refund-test-0123456789', PAYMENTS_ENABLED: 'true',
  RAZORPAY_KEY_ID: 'rzp_test_id', RAZORPAY_KEY_SECRET: 'rzp_secret', GSTIN: '27ABCDE1234F1Z5', PUBLIC_BASE_URL: 'https://shelterkart.test' });
delete process.env.DATABASE_URL; delete process.env.ACCOUNTS_ENABLED;
const path = require('path');
const app = require(path.join(__dirname, '..', '..', 'server.js'));
const { c } = require(path.join(__dirname, '..', '..', 'app.js'));
const { _db } = require('pg');
const R = require('../../engine/research');
const { issueToken, tokenInfo } = require('../../engine/access');
const SECRET = process.env.ACCESS_TOKEN_SECRET;
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route, { body = {}, params = {}, headers = {}, query = {} } = {}) { return new Promise(resolve => {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const res = { code: 200, status(x) { this.code = x; return this; }, set() { return this; }, json(o) { resolve({ code: this.code, body: o }); }, send(o) { resolve({ code: this.code, body: o }); } };
  const req = { body, params, query, ip: '3.3.3.3', path: route.path, headers: h, originalUrl: route.path, get: k => h[k.toLowerCase()], on() {} };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const f = hs[i++]; if (f) f(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, x) => { if (!x) failures++; console.log((x ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });

const REF = 'SK-AAAAAAAAAAAA', OTHER = 'SK-BBBBBBBBBBBB';
const PID = '11111111-0000-4000-8000-000000000001', PID2 = '11111111-0000-4000-8000-000000000002';
const purchase = (id, ref, status) => { _db.purchases.push({ id, report_ref: ref, status, provider: 'razorpay', provider_order_id: 'order_' + id.slice(-1), amount: 100, currency: 'INR' }); return _db.purchases[_db.purchases.length - 1]; };
const sign = (order, pay) => crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(order + '|' + pay).digest('hex');

(async () => {
  console.log('the token');
  const t = issueToken(REF, SECRET, 30, Date.now(), PID);
  ok('a token carries the purchase it was bought with', tokenInfo(t, REF, SECRET).pid === PID);
  ok('and still fails for another report, another secret, or when expired', !tokenInfo(t, OTHER, SECRET) && !tokenInfo(t, REF, 'x') && !tokenInfo(issueToken(REF, SECRET, 1, Date.now() - 3 * 86400000, PID), REF, SECRET));

  console.log('\nwhen a token opens a report (c.tokenGrants)');
  const p1 = purchase(PID, REF, 'paid');
  ok('a paid purchase opens it', await c.tokenGrants(t, REF));
  p1.status = 'refunded';
  ok('after a refund the SAME token no longer opens it', !(await c.tokenGrants(t, REF)));
  p1.status = 'paid';
  ok('...and it opens again if the purchase is paid (a refund is reversed)', await c.tokenGrants(t, REF));
  ok('a token with no purchase is not honoured', !(await c.tokenGrants(issueToken(REF, SECRET), REF)));
  ok('a token whose purchase belongs to another report is not honoured', !(await c.tokenGrants(issueToken(OTHER, SECRET, 30, Date.now(), PID), OTHER)));
  ok('a token naming a purchase that does not exist, or is not an id, is not honoured', !(await c.tokenGrants(issueToken(REF, SECRET, 30, Date.now(), PID2), REF)) && !(await c.tokenGrants(issueToken(REF, SECRET, 30, Date.now(), "1' OR 1=1"), REF)));
  ok('no token, a garbage token, or an unpaid purchase is not honoured', !(await c.tokenGrants('', REF)) && !(await c.tokenGrants('garbage', REF)) && !(await c.tokenGrants(issueToken(REF, SECRET, 30, Date.now(), purchase(PID2, REF, 'pending_payment').id), REF)));

  console.log('\nthe report, through the route');
  R.registerBrief({ ref: REF, query: 'q', location: '', market: 'uk', project: { name: 'Tower', developer: 'D' }, findings: [{ id: 'f1', topic: 'legal', claim: 'A paid-only claim.', kind: 'fact', urls: ['https://a.example/'] }], conflicts: [], pages: [], checkedAt: new Date().toISOString() });
  const byRef = find('get', '/api/research/by-ref/:ref');
  const open = await call(byRef, { params: { ref: REF }, headers: { 'x-report-access': t } });
  ok('with a paid purchase the full report is served', open.code === 200 && open.body.brief && open.body.brief.locked === false);
  p1.status = 'refunded';
  const shut = await call(byRef, { params: { ref: REF }, headers: { 'x-report-access': t } });
  ok('after the refund the same token gets the locked preview', shut.code === 200 && shut.body.brief.locked === true);

  console.log('\nverify');
  const verify = find('post', '/api/research/razorpay/verify');
  const body = id => ({ ref: REF, purchaseId: id, razorpay_payment_id: 'pay_Abcdefgh1', razorpay_signature: sign('order_' + id.slice(-1), 'pay_Abcdefgh1') });
  const refunded = await call(verify, { body: body(PID) });
  ok('a refunded purchase with a valid checkout signature gets no token (it used to get one)', refunded.code === 409 && !refunded.body.token && refunded.body.code === 'not_active');
  const p3 = purchase('11111111-0000-4000-8000-000000000003', REF, 'paid');
  const good = await call(verify, { body: body(p3.id) });
  ok('a paid purchase gets a token that carries it', good.code === 200 && tokenInfo(good.body.token, REF, SECRET).pid === p3.id);
  p3.status = 'refunded';
  ok('and that token stops working when the purchase is refunded', !(await c.tokenGrants(good.body.token, REF)));
})();
