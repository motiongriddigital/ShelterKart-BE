// Suspected item 1 of the 2026-10 security review: a quote was checked and then marked used in a second step, so two checkouts with the same quote and
// different idempotency keys could both pass. Taking the quote is now one atomic step; the loser is told to review the price and its purchase row is removed.
Object.assign(process.env, { ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN_SECRET: 'tok', GSTIN: '27ABCDE1234F1Z5', PAYMENTS_ENABLED: 'true', RAZORPAY_KEY_ID: 'rzp_test_id', RAZORPAY_KEY_SECRET: 'key_secret' });
let orderN = 0;
const RET = [['https://maharerait.maharashtra.gov.in/x', 'MahaRERA'], ['https://a.com/1', 'A'], ['https://b.com/2', 'B'], ['https://c.com/3', 'C']];
const OUT = { project: { name: 'Hubtown Celeste', location: 'Mumbai', developer: 'Hubtown Limited', ids: ['P51900008925'] }, sources: RET.map(r => r[0]),
  findings: RET.map((r, i) => ({ id: 'f' + i, topic: 'other', claim: 'Claim ' + i + '.', kind: 'fact', src: [i] })), conflicts: [], gaps: [] };
globalThis.fetch = async (url, o = {}) => {
  const mk = (c, status = 200) => ({ ok: status < 300, status, json: async () => c });
  if (url === 'https://api.razorpay.com/v1/orders') { const b = JSON.parse(o.body); return mk({ id: 'order_Q' + (++orderN), entity: 'order', amount: b.amount, currency: b.currency, status: 'created' }); }
  const b = JSON.parse(o.body);
  if (b.tools) return mk({ stop_reason: 'end_turn', content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: RET.map(([u, t]) => ({ url: u, title: t })) }, { type: 'text', text: JSON.stringify(OUT) }] });
  return mk({ content: [{ type: 'text', text: '{"reading":[],"questions":[]}' }] });
};
const app = require(require('path').join(__dirname, '..', '..', 'server.js'));
const { _db } = require('pg');
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route, body) { return new Promise(resolve => {
  const res = { code: 200, status(c) { this.code = c; return this; }, set() { return this; }, json(o) { resolve({ code: this.code, body: o }); } };
  const req = { body, ip: '9.9.9.9', path: route.path, get: () => undefined, headers: {} };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const h = hs[i++]; if (h) h(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });

(async () => {
  const co = find('post', '/api/research/checkout');
  const ref = (await call(find('post', '/api/research'), { query: 'Hubtown Celeste', market: 'in', country: 'IN' })).body.brief.ref;
  const quote = async session => (await call(find('post', '/api/research/quote'), { ref, country: 'IN', session })).body.quote.id;
  const pay = (key, quoteId) => call(co, { ref, idempotencyKey: key, quoteId, billingCountry: 'IN' });
  console.log('one quote, two checkouts at once');
  const q1 = await quote('s1'), before = _db.purchases.filter(x => x.report_ref === ref).length;
  const both = await Promise.all([pay('quote-race-key-aaaaaaaaaaaa', q1), pay('quote-race-key-bbbbbbbbbbbb', q1)]);
  const won = both.filter(b => b.code === 200), lost = both.filter(b => b.code === 409);
  ok('exactly one of the two gets an order', won.length === 1 && lost.length === 1 && Boolean(won[0].body.razorpay));
  ok('the other is told the price was already used and to review it', lost[0].body.code === 'quote_used' && lost[0].body.requote === true && !lost[0].body.razorpay);
  const rows = _db.purchases.filter(x => x.report_ref === ref).slice(before);
  ok('only one purchase row remains for that quote, and it has its order', rows.length === 1 && rows[0].id === won[0].body.purchaseId && Boolean(rows[0].provider_order_id));
  const later = await pay('quote-race-key-cccccccccccc', q1);
  ok('a later checkout with the used quote is refused as before', later.code === 409 && later.body.code === 'quote_used');
  console.log('\nthe usual flow is unchanged');
  const q2 = await quote('s2'), one = await pay('quote-single-key-dddddddddd', q2);
  ok('a single checkout with a fresh quote works', one.code === 200 && one.body.razorpay.orderId && one.body.quoteId === q2);
  const retry = await pay('quote-single-key-dddddddddd', q2);
  ok('and its retry (same key) still returns the same order', retry.code === 200 && retry.body.purchaseId === one.body.purchaseId);
  process.exit(failures ? 1 : 0);
})();
