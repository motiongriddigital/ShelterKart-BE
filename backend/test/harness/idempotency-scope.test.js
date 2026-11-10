// Suspected item 3 of the 2026-10 security review: an idempotency key was global. Reusing a key with a different report returned the earlier purchase's
// order. A key now only repeats the same attempt: the same report and, with accounts on, the same signed-in buyer.
const crypto = require('crypto');
Object.assign(process.env, { ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN_SECRET: 'tok', GSTIN: '27ABCDE1234F1Z5', PAYMENTS_ENABLED: 'true', RAZORPAY_KEY_ID: 'rzp_test_id', RAZORPAY_KEY_SECRET: 'key_secret' });
let orderN = 0;
const RET = [['https://maharerait.maharashtra.gov.in/x', 'MahaRERA'], ['https://a.com/1', 'A'], ['https://b.com/2', 'B'], ['https://c.com/3', 'C']];
const outFor = name => ({ project: { name, location: 'Mumbai', developer: 'Dev Limited', ids: ['P5190000' + (Math.abs([...name].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7)) % 9000 + 1000)] }, sources: RET.map(r => r[0]),
  findings: RET.map((r, i) => ({ id: 'f' + i, topic: 'other', claim: 'Claim ' + i + '.', kind: 'fact', src: [i] })), conflicts: [], gaps: [] });
globalThis.fetch = async (url, o = {}) => {
  const mk = (c, status = 200) => ({ ok: status < 300, status, json: async () => c });
  if (url === 'https://api.razorpay.com/v1/orders') { const b = JSON.parse(o.body); return mk({ id: 'order_I' + (++orderN), entity: 'order', amount: b.amount, currency: b.currency, status: 'created' }); }
  const b = JSON.parse(o.body), name = (JSON.stringify(b.messages).match(/Hubtown [A-Za-z]+|Lodha [A-Za-z]+/) || ['Hubtown Celeste'])[0];
  if (b.tools) return mk({ stop_reason: 'end_turn', content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: RET.map(([u, t]) => ({ url: u, title: t })) }, { type: 'text', text: JSON.stringify(outFor(name)) }] });
  return mk({ content: [{ type: 'text', text: '{"reading":[],"questions":[]}' }] });
};
const app = require(require('path').join(__dirname, '..', '..', 'server.js'));
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
  const report = async name => (await call(find('post', '/api/research'), { query: name, market: 'in', country: 'IN' })).body.brief.ref;
  const quote = async (ref, session) => (await call(find('post', '/api/research/quote'), { ref, country: 'IN', session })).body.quote.id;
  const refA = await report('Hubtown Celeste'), refB = await report('Lodha Park');
  ok('two different reports to test with', refA && refB && refA !== refB);
  const KEY = 'scope-test-key-aaaaaaaaaaaa';
  const first = await call(co, { ref: refA, idempotencyKey: KEY, quoteId: await quote(refA, 's1'), billingCountry: 'IN' });
  ok('a first checkout creates the purchase and an order', first.code === 200 && first.body.razorpay && first.body.razorpay.orderId);
  const retry = await call(co, { ref: refA, idempotencyKey: KEY, quoteId: await quote(refA, 's1'), billingCountry: 'IN' });
  ok('a retry of the same attempt (same key, same report) returns the same purchase and order', retry.code === 200 && retry.body.purchaseId === first.body.purchaseId && retry.body.razorpay.orderId === first.body.razorpay.orderId);
  const other = await call(co, { ref: refB, idempotencyKey: KEY, quoteId: await quote(refB, 's2'), billingCountry: 'IN' });
  ok('the same key for a different report is refused with 409 and no order', other.code === 409 && !other.body.razorpay && !other.body.purchaseId && /already been used/.test(other.body.error));
  const fresh = await call(co, { ref: refB, idempotencyKey: 'scope-test-key-bbbbbbbbbbbb', quoteId: await quote(refB, 's3'), billingCountry: 'IN' });
  ok('a new key for that other report works normally', fresh.code === 200 && fresh.body.purchaseId !== first.body.purchaseId);
  process.exit(failures ? 1 : 0);
})();
