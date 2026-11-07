// SHEL-37: the legacy payment webhook used to record every request in payment_events BEFORE checking its signature, so anyone who could reach
// the route could fill the table with unlimited rows. An unsigned request is now refused first and writes nothing; signed events are recorded as before.
const crypto = require('crypto');
Object.assign(process.env, { ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN_SECRET: 'tok', PAYMENT_WEBHOOK_SECRET: 'whsec-legacy', GSTIN: '27ABCDE1234F1Z5', PAYMENTS_ENABLED: 'true', RAZORPAY_KEY_ID: 'rzp_test_id', RAZORPAY_KEY_SECRET: 'rzp_secret' });
delete process.env.DATABASE_URL;
const app = require(require('path').join(__dirname, '..', '..', 'server.js'));
const { _db } = require('pg');
const hook = app.routes.find(r => r.method === 'post' && r.path === '/api/payments/webhook');
function call(body, headers = {}) { return new Promise(resolve => {
  const res = { code: 200, status(c) { this.code = c; return this; }, set() { return this; }, json(o) { resolve({ code: this.code, body: o }); } };
  const req = { body, ip: '9.9.9.9', path: hook.path, get: k => headers[k.toLowerCase()] };
  const hs = hook.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const h = hs[i++]; if (h) h(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });
const signed = obj => { const raw = Buffer.from(JSON.stringify(obj)); return [raw, { 'x-sk-provider': 'legacy', 'x-sk-signature': crypto.createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET).update(raw).digest('hex') }]; };
const quiet = async fn => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };

(async () => {
  console.log('unsigned requests');
  const before = _db.events.size;
  const results = [];
  await quiet(async () => {
    for (let i = 0; i < 20; i++) results.push(await call(Buffer.from(JSON.stringify({ id: 'evt_forged_' + i, type: 'payment.succeeded' })), { 'x-sk-provider': 'p' + i, 'x-sk-signature': 'nope' }));
    results.push(await call(Buffer.from(JSON.stringify({ id: 'evt_nosig', type: 'x' })), {}));
    results.push(await call(Buffer.from('not json at all'), { 'x-sk-signature': 'bad' }));
    results.push(await call(Buffer.from(JSON.stringify({ id: 'evt_wrongkey', type: 'x' })), { 'x-sk-signature': crypto.createHmac('sha256', 'other-secret').update(Buffer.from(JSON.stringify({ id: 'evt_wrongkey', type: 'x' }))).digest('hex') }));
  });
  ok('forged, unsigned, wrong-key and malformed requests are all refused with 401', results.every(r => r.code === 401 && r.body.error === 'Invalid signature'));
  ok('and not one row was written (it used to be one per request)', _db.events.size === before);

  console.log('\nsigned requests');
  const [raw1, h1] = signed({ id: 'evt_ok_1', type: 'something.else' });
  const a = await call(raw1, h1);
  ok('a signed event of another type is acknowledged and recorded', a.code === 200 && a.body.ignored === 'something.else' && _db.events.size === before + 1);
  const b = await call(raw1, h1);
  ok('the same signed event again is a duplicate, acknowledged, and not recorded twice', b.code === 200 && b.body.duplicate === true && _db.events.size === before + 1);
  const [raw2, h2] = signed({ id: 'evt_pay_unknown', type: 'payment.succeeded', data: { reportRef: 'SK-AAAAAAAAAAAA', purchaseId: '11111111-0000-4000-8000-0000000000ff', amount: 100 } });
  const c = await quiet(() => call(raw2, h2));
  ok('a signed payment for an unknown purchase is refused (400) and recorded as failed', c.code === 400 && _db.events.size === before + 2);
  ok('a body that is not raw JSON is refused before anything else (415)', (await call('x', h1)).code === 415);
  delete process.env.PAYMENT_WEBHOOK_SECRET;
  ok('with no secret configured the route refuses everything (503) and writes nothing', (await quiet(() => call(raw1, h1))).code === 503 && _db.events.size === before + 2);
})();
