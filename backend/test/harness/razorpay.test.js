const crypto = require('crypto');
Object.assign(process.env, { ANTHROPIC_API_KEY:'k', ACCESS_TOKEN_SECRET:'tok', GSTIN: '27ABCDE1234F1Z5', PAYMENTS_ENABLED:'true',
  RAZORPAY_KEY_ID:'rzp_test_id', RAZORPAY_KEY_SECRET:'key_secret', RAZORPAY_WEBHOOK_SECRET:'rzp_whsec' });
let orderN = 0, razorpayDown = false;
const RET=[['https://maharerait.maharashtra.gov.in/x','MahaRERA'],['https://a.com/1','A'],['https://b.com/2','B'],['https://c.com/3','C']];
const OUT={project:{name:'Hubtown Celeste',location:'Mumbai',developer:'Hubtown Limited',ids:['P51900008925']},sources:RET.map(r=>r[0]),
  findings:RET.map((r,i)=>({id:'f'+i,topic:'other',claim:'Claim '+i+'.',kind:'fact',src:[i]})),conflicts:[],gaps:[]};
globalThis.fetch = async (url, o) => {
  const mk = (c, status=200) => ({ ok: status < 300, status, json: async()=>c });
  if (url === 'https://api.razorpay.com/v1/orders') { if (razorpayDown) return mk({}, 500); const b = JSON.parse(o.body); return mk({ id:'order_T'+(++orderN), entity:'order', amount:b.amount, currency:b.currency, status:'created' }); }
  const b = JSON.parse(o.body);
  if (b.tools) return mk({stop_reason:'end_turn',content:[{type:'server_tool_use',name:'web_search'},{type:'web_search_tool_result',content:RET.map(([u,t])=>({url:u,title:t}))},{type:'text',text:JSON.stringify(OUT)}]});
  return mk({content:[{type:'text',text:'{"reading":[],"questions":[]}'}]});
};
const app = require(require('path').join(__dirname, '..', '..', 'server.js'));
const { _db, Pool } = require('pg');
const pool = new Pool();
const find = (m,p) => app.routes.find(r => r.method===m && r.path===p);
function call(route, body, headers={}) { return new Promise(resolve => {
  const res = { code:200, status(c){this.code=c;return this;}, set(){return this;}, json(o){ resolve({ code:this.code, body:o }); } };
  const req = { body, ip:'9.9.9.9', path: route.path, get: k => headers[k.toLowerCase()] };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code:500, body:{ error:err.message } }); const h = hs[i++]; if (h) h(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });
const hook = find('post','/api/payments/razorpay/webhook');
const sendHook = (obj, secret='rzp_whsec') => { const raw = Buffer.from(JSON.stringify(obj)); return call(hook, raw, { 'x-razorpay-signature': crypto.createHmac('sha256', secret).update(raw).digest('hex') }); };
const captured = (orderId, payId, amount) => ({ event:'payment.captured', payload:{ payment:{ entity:{ id:payId, order_id:orderId, amount, currency:'INR', status:'captured' } } } });
(async () => {
  const pv = await call(find('post','/api/research'), { query:'Hubtown Celeste', market:'in', country:'IN' });
  const ref = pv.body.brief.ref;
  ok('with Razorpay configured, an unpaid buyer sees the preview and their price', pv.body.brief.locked === true && pv.body.paywall.price > 0 && pv.body.paywall.currency === 'INR');
  const SUB = Math.round(pv.body.paywall.price * 100);
  const qid = async s => (await call(find('post','/api/research/quote'), { ref, country:'IN', session: s })).body.quote.id;
  const co = find('post','/api/research/checkout');
  const [b1, b2, b3] = [await call(co, { ref, idempotencyKey:'buyer-one-attempt-aaaaaaaa', quoteId: await qid('one'), billingCountry:'IN' }), await call(co, { ref, idempotencyKey:'buyer-two-attempt-bbbbbbbb', quoteId: await qid('two'), billingCountry:'IN' }), await call(co, { ref, idempotencyKey:'buyer-three-attempt-cccccc', quoteId: await qid('three'), billingCountry:'IN' })];
  ok('each buyer gets their own Razorpay order, for exactly the quoted total in paise', b1.body.razorpay.orderId !== b2.body.razorpay.orderId && b1.body.razorpay.amountSubunits === SUB);

  // IDEMPOTENCY: the actual fix. A retried checkout -- same key, same
  // ref -- must return the identical purchase and order, not a second
  // one. This is what a network timeout followed by a second click
  // looks like in real traffic.
  const purchasesBefore = _db.purchases.length;
  const retryKey = 'retry-same-attempt-eeeeeeee';
  const retryQuote = await qid('retry');
  const firstTry = await call(co, { ref, idempotencyKey: retryKey, quoteId: retryQuote, billingCountry:'IN' });
  const retried = await call(co, { ref, idempotencyKey: retryKey, quoteId: retryQuote, billingCountry:'IN' });
  ok('a checkout missing its idempotency key is refused outright', (await call(co, { ref })).code === 400);
  ok('retrying with the SAME key returns the SAME purchase id', firstTry.body.purchaseId === retried.body.purchaseId);
  ok('...and the SAME Razorpay order, not a second one', firstTry.body.razorpay.orderId === retried.body.razorpay.orderId);
  ok('...and no second row was ever inserted', _db.purchases.length === purchasesBefore + 1);
  // Simulate the DB's own unique index catching a genuine race -- two
  // requests with the same key arriving at once -- the way real
  // Postgres would, not just the read-first happy path.
  const concurrentKey = 'race-condition-attempt-ffffff';
  const raceCheck = await pool.query(
    `INSERT INTO report_purchases (report_ref, amount, currency, status, provider, idempotency_key) VALUES ($1,$2,$3,'pending_payment','razorpay',$4) RETURNING id`,
    [ref, 499, 'INR', concurrentKey]);
  ok('first insert of a fresh key succeeds', Boolean(raceCheck.rows[0].id));
  let raceThrew = null;
  try {
    await pool.query(
      `INSERT INTO report_purchases (report_ref, amount, currency, status, provider, idempotency_key) VALUES ($1,$2,$3,'pending_payment','razorpay',$4) RETURNING id`,
      [ref, 499, 'INR', concurrentKey]);
  } catch (e) { raceThrew = e; }
  ok('a second insert of the SAME key is rejected with Postgres\u2019 real unique-violation code', raceThrew && raceThrew.code === '23505');
  ok('the order id is stored on the server against the purchase', _db.purchases.find(p => p.id === b1.body.purchaseId).provider_order_id === b1.body.razorpay.orderId);
  const verify = find('post','/api/research/razorpay/verify');
  // buyer 1: genuine instant unlock
  const sig1 = crypto.createHmac('sha256','key_secret').update(b1.body.razorpay.orderId + '|pay_ONE').digest('hex');
  const v1 = await call(verify, { ref, purchaseId: b1.body.purchaseId, razorpay_payment_id:'pay_ONE', razorpay_signature: sig1 });
  ok('buyer 1: verified payment unlocks instantly with a token', v1.code === 200 && v1.body.token && _db.purchases.find(p => p.id === b1.body.purchaseId).status === 'paid');
  // buyer 2 tries to reuse buyer 1's real payment on their own purchase
  const reuse = await call(verify, { ref, purchaseId: b2.body.purchaseId, razorpay_payment_id:'pay_ONE', razorpay_signature: sig1 });
  ok('buyer 2 cannot reuse buyer 1\u2019s payment -- checked against the SERVER\u2019s order id', reuse.code === 400 && _db.purchases.find(p => p.id === b2.body.purchaseId).status === 'pending_payment');
  // buyer 2 pays, closes the tab; the webhook settles it
  const w2 = await sendHook(captured(b2.body.razorpay.orderId, 'pay_TWO', SUB));
  ok('buyer 2: the webhook backstop settles the purchase', w2.code === 200 && _db.purchases.find(p => p.id === b2.body.purchaseId).status === 'paid');
  ok('a redelivered webhook is acknowledged, not processed twice', (await sendHook(captured(b2.body.razorpay.orderId, 'pay_TWO', SUB))).body.duplicate === true);
  const a2 = await call(find('post','/api/research/access'), { ref, purchaseId: b2.body.purchaseId });
  ok('buyer 2 can then exchange the paid purchase for a token', a2.code === 200 && a2.body.token);
  // buyer 3: underpayment and forgery
  await sendHook(captured(b3.body.razorpay.orderId, 'pay_THREE', 100));
  ok('buyer 3: a captured payment for less than the price unlocks nothing', _db.purchases.find(p => p.id === b3.body.purchaseId).status === 'pending_payment');
  ok('a webhook signed with the wrong secret is refused', (await sendHook(captured(b3.body.razorpay.orderId, 'pay_X', SUB), 'wrong')).code === 401
     && _db.purchases.find(p => p.id === b3.body.purchaseId).status === 'pending_payment');
  const unknown = await sendHook(captured('order_NOT_OURS', 'pay_Y', SUB));
  ok('a payment for an order that isn\u2019t ours is acknowledged but changes nothing', unknown.code === 200 && unknown.body.unknown_order === true);
  ok('an event we don\u2019t act on is acknowledged and ignored', (await sendHook({ event:'payment.failed', payload:{} })).body.ignored === 'payment.failed');
  // the full brief with a token
  const full = await call(find('post','/api/research'), { query:'Hubtown Celeste', market:'in', country:'IN' }, { 'x-report-access': v1.body.token });
  ok('with the token, the full brief is served', full.body.brief.locked === false);

  // SHARING BY REF: opening the exact report that was shared, not a
  // fresh re-search that happens to share its name.
  function callGet(route, params={}, headers={}) { return new Promise(resolve => {
    const res = { code:200, status(c){this.code=c;return this;}, set(){return this;}, json(o){ resolve({ code:this.code, body:o }); } };
    const req = { params, ip:'9.9.9.9', path: route.path, get: k => headers[k.toLowerCase()] };
    const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code:500, body:{ error:err.message } }); const h = hs[i++]; if (h) h(req, res, next); }; next(); }); }
  const byRef = find('get', '/api/research/by-ref/:ref');
  const sharedLocked = await callGet(byRef, { ref });
  ok('a shared link, no token: opens the SAME report, still locked', sharedLocked.code === 200 && sharedLocked.body.brief.locked === true);
  ok('...same project as what was actually shared', sharedLocked.body.brief.project.name === pv.body.brief.project.name);
  ok('...never leaks the source pages while locked', sharedLocked.body.brief.pages.length === 0);
  const sharedUnlocked = await callGet(byRef, { ref }, { 'x-report-access': v1.body.token });
  ok('the buyer who paid, opening their own shared link: unlocked', sharedUnlocked.code === 200 && sharedUnlocked.body.brief.locked === false);
  ok('an unknown ref returns 404, not a silent fresh search', (await callGet(byRef, { ref: 'SK-000000000000' })).code === 404);
  ok('a malformed ref is rejected outright', (await callGet(byRef, { ref: 'not-a-real-ref' })).code === 400);
  // Razorpay unavailable
  razorpayDown = true;
  const down = await call(co, { ref, idempotencyKey:'buyer-four-attempt-dddddddd', quoteId: await qid('four'), billingCountry:'IN' });
  ok('if Razorpay is down, checkout says so honestly instead of hanging', down.code === 503);
  // the body parser
  const mw = app.routes.find(r => r.method==='use' && r.handlers.some(h => String(h).includes('OWN_BODY_PARSER')));
  const parsed = await new Promise(r => { const req = { path:'/api/payments/razorpay/webhook' }; mw.handlers[0](req, {}, () => r(req._jsonParsed === true)); });
  ok('the global parser leaves the Razorpay webhook\u2019s raw bytes alone', parsed === false);
})();
