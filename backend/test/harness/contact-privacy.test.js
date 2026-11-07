// SHEL-41: the buyer's e-mail and phone live in the report record for delivery and must never come back out through a public response,
// with or without a token, with the paywall on or off, in JSON or in a page.
const crypto = require('crypto');
Object.assign(process.env, { ADMIN_USERNAME: 'a', ADMIN_PASSWORD: 'b', ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN_SECRET: 'tok-secret-for-the-contact-test-0123456789', GSTIN: '27ABCDE1234F1Z5', PUBLIC_BASE_URL: 'https://shelterkart.test' });
delete process.env.DATABASE_URL; delete process.env.ACCOUNTS_ENABLED;
const path = require('path');
const app = require(path.join(__dirname, '..', '..', 'server.js'));
const R = require('../../engine/research');
const { issueToken } = require('../../engine/access');
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route, { body = {}, params = {}, headers = {}, query = {} } = {}) { return new Promise(resolve => {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const res = { code: 200, status(x) { this.code = x; return this; }, set() { return this; }, json(o) { resolve({ code: this.code, text: JSON.stringify(o), body: o }); }, send(o) { resolve({ code: this.code, text: String(o), body: o }); } };
  const req = { body, params, query, ip: '3.3.3.3', path: route.path, headers: h, originalUrl: route.path, get: k => h[k.toLowerCase()], on() {} };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, text: String(err.message), body: {} }); const f = hs[i++]; if (f) f(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, x) => { if (!x) failures++; console.log((x ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });

const EMAIL = 'buyer-private@example.com', PHONE = '+919820000123';
const REF = 'SK-C0DE00000001';
const leaks = text => text.includes(EMAIL) || text.includes(PHONE.slice(3)) || /"contact"/.test(text);

(async () => {
  R.registerBrief({ kind: 'dossier', ref: REF, phase: 'done', query: 'dossier:Contact Tower', location: 'Mumbai', market: 'in', marketLabel: 'India', project: { name: 'Contact Tower', location: 'Mumbai', developer: 'D', ids: [] },
    findings: [], conflicts: [], checkedAt: new Date().toISOString(), contact: { email: EMAIL, phone: PHONE },
    dossier: { ref: REF, query: 'Contact Tower', location: 'Mumbai', market: 'in', asOf: '2026-11-07', project: { name: 'Contact Tower', ids: [] }, counts: { facts: 0, questions: 1 }, promises: [], questions: [{ id: 'q1', to: 'sales team', when: 'before booking', question: 'Q?' }], inferences: [], sections: [], sources: [], conflicts: [], entities: [], checks: {}, phase: 'done' } });
  const byRef = find('get', '/api/research/by-ref/:ref');

  console.log('paywall off (no payments configured): the full report is open');
  const open = await call(byRef, { params: { ref: REF } });
  ok('by-ref serves the report and no contact', open.code === 200 && open.body.brief && open.body.brief.locked === false && !leaks(open.text));

  console.log('\npaywall on, preview (no token)');
  Object.assign(process.env, { PAYMENTS_ENABLED: 'true', RAZORPAY_KEY_ID: 'rzp_test_id', RAZORPAY_KEY_SECRET: 'rzp_secret' });
  const prev = await call(byRef, { params: { ref: REF } });
  ok('by-ref preview has no contact', prev.code === 200 && prev.body.brief.locked === true && !leaks(prev.text));

  console.log('\npaywall on, with an access token');
  const tok = issueToken(REF, process.env.ACCESS_TOKEN_SECRET);
  const full = await call(byRef, { params: { ref: REF }, headers: { 'x-report-access': tok } });
  ok('a token that opens the report (any token that verifies) still gets no contact', full.code === 200 && !leaks(full.text));

  console.log('\nthe pages');
  const page = find('get', '/r/:ref'), withTok = await call(page, { params: { ref: REF }, query: { t: tok } }), noTok = await call(page, { params: { ref: REF } });
  ok('the report page, with and without a token, shows no contact', !leaks(withTok.text) && !leaks(noTok.text));

  console.log('\nresearch and the live stream');
  const search = find('post', '/api/research');
  const s = await call(search, { body: { query: 'Contact Tower', location: 'Mumbai', market: 'in' } });
  ok('a search that reaches this report returns no contact', !leaks(s.text));
  const admin = await call(find('get', '/api/admin/reports/:ref'), { params: { ref: REF }, headers: { authorization: 'Basic ' + Buffer.from('a:b').toString('base64') } });
  ok('(the admin view is the one place the contact is shown, for follow-up)', admin.code === 200 && admin.text.includes(EMAIL));
})();
