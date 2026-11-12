const crypto = require('crypto');
const env = { ANTHROPIC_API_KEY:'k', AI_PERSONAL_DATA_ENGINES:'anthropic', PAYMENT_WEBHOOK_SECRET:'whsec', ACCESS_TOKEN_SECRET:'tok-secret', GSTIN: '27ABCDE1234F1Z5', RAZORPAY_KEY_ID:'rzp_test_id', RAZORPAY_KEY_SECRET:'key_secret' };
Object.assign(process.env, env);
const RET=[['https://maharerait.maharashtra.gov.in/x','MahaRERA'],['https://a.com/1','A'],['https://b.com/2','B'],['https://c.com/3','C'],['https://d.com/4','D']];
const OUT={project:{name:'Hubtown Celeste',location:'Mumbai',developer:'Hubtown Limited',ids:['P51900008925']},sources:RET.map(r=>r[0]),
  findings:RET.map((r,i)=>({id:'f'+i,topic:'other',claim:'Claim number '+i+'.',kind:'fact',src:[i]})),
  conflicts:[{topic:'Possession date',versions:[{value:'Dec 2027',src:1},{value:'Jul 2029',src:2}]}],gaps:[]};
let _o=0; globalThis.fetch = async (url, o) => { const mk = c => ({ ok:true, status:200, json: async()=>c }); if (url === 'https://api.razorpay.com/v1/orders') { const q = JSON.parse(o.body); return mk({ id:'order_P'+(++_o), amount:q.amount, currency:q.currency }); } const b = JSON.parse(o.body);
  if (b.tools) return mk({stop_reason:'end_turn',content:[{type:'server_tool_use',name:'web_search'},{type:'web_search_tool_result',content:RET.map(([u,t])=>({url:u,title:t}))},{type:'text',text:JSON.stringify(OUT)}]});
  if (b.messages[0].content[0] && b.messages[0].content[0].source) return mk({content:[{type:'text',text:JSON.stringify({document_type:'allotment_letter',project_name:'Hubtown Celeste',registration_numbers:['P51900008925'],seller_company:'Hubtown Limited',possession_date:'Dec 2027',payment_bank:''})}]});
  return mk({content:[{type:'text',text:'{"reading":[{"observation":"Dates differ.","based_on":["f1"],"question":"Which?"}],"questions":[]}'}]}); };
const app = require(require('path').join(__dirname, '..', '..', 'server.js'));
const { _db } = require('pg');
const find = (m,p) => app.routes.find(r => r.method===m && r.path===p);
function call(route, body, headers={}, path='') { return new Promise(resolve => {
  const res = { code:200, headers:{}, status(c){this.code=c;return this;}, set(k,v){this.headers[k]=v;return this;}, json(o){ resolve({ code:this.code, body:o }); } };
  const req = { body, ip:'3.3.3.3', path, get: k => headers[k.toLowerCase()] };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code:500, body:{ error: err.message } }); const h = hs[i++]; if (h) h(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });
(async () => {
  const research = find('post','/api/research');
  // 1. payments OFF -> complete brief
  const off = await call(research, { query:'Hubtown Celeste', market:'in', country:'IN' });
  ok('payments off: the full brief is served, nothing locked', off.code===200 && off.body.brief.locked===false && off.body.brief.reading.length===1 && off.body.paywall.active===false);
  ok('payments off: checkout honestly refuses', (await call(find('post','/api/research/checkout'), { ref: off.body.brief.ref, idempotencyKey:'preflight-check-attempt-x' })).code === 503);
  // 2. payments ON, no token -> preview
  process.env.PAYMENTS_ENABLED = 'true';
  const pv = await call(research, { query:'Hubtown Celeste', market:'in', country:'IN' });
  const pvJson = JSON.stringify(pv.body);
  ok('payments on, unpaid: preview only, withheld at source', pv.body.brief.locked===true && pv.body.brief.reading.length===0 && pv.body.brief.pages.length===0 && !pvJson.includes('Jul 2029') && !pvJson.includes('Claim number 4'));
  ok('payments on: the buyer\u2019s price is shown for the unlock button, in rupees, with GST inside it', pv.body.paywall.active && pv.body.paywall.price > 0 && pv.body.paywall.currency === 'INR' && pv.body.paywall.fee.taxName === 'GST' && pv.body.paywall.buyer.country === 'IN');
  ok('unpaid document check is refused with 402', (await call(find('post','/api/research/document-check'), { query:'Hubtown Celeste', market:'in', country:'IN', file:'AAAA', mediaType:'application/pdf' })).code === 402);
  // 3. two buyers start purchases of the SAME project
  const ref = pv.body.brief.ref;
  const quoteFor = async session => (await call(find('post','/api/research/quote'), { ref, country:'IN', session })).body.quote;
  const q1 = await quoteFor('buyer-one'), q2 = await quoteFor('buyer-two');
  ok('each buyer gets their own signed quote, at the price the preview showed', q1 && q2 && q1.id !== q2.id && q1.gross === pv.body.paywall.price && q1.currency === 'INR');
  const c1 = await call(find('post','/api/research/checkout'), { ref, idempotencyKey:'legacy-buyer-one-aaaaaaaa', quoteId: q1.id, billingCountry:'IN', source: { utm: { source:'instagram', medium:'social', campaign:'in-t07' }, referrer:'https://l.instagram.com/' } });
  const c2 = await call(find('post','/api/research/checkout'), { ref, idempotencyKey:'legacy-buyer-two-bbbbbbbb', quoteId: q2.id, billingCountry:'IN' });
  ok('checkout charges exactly the quote total', c1.body.amount === q1.gross && c1.body.currency === 'INR');
  ok('two buyers get two separate purchase ids', c1.body.purchaseId && c2.body.purchaseId && c1.body.purchaseId !== c2.body.purchaseId);
  ok('before payment, access is refused (402)', (await call(find('post','/api/research/access'), { ref, purchaseId: c1.body.purchaseId })).code === 402);
  // 4. the webhook, signed over raw bytes, for buyer 1 only
  const hook = find('post','/api/payments/webhook');
  const raw = Buffer.from(JSON.stringify({ id:'evt_1', type:'payment.succeeded', data:{ reportRef: ref, purchaseId: c1.body.purchaseId, amount: c1.body.amount, currency: c1.body.currency } }));
  const sig = crypto.createHmac('sha256','whsec').update(raw).digest('hex');
  const wh = await call(hook, raw, { 'x-sk-provider':'test', 'x-sk-signature': sig }, '/api/payments/webhook');
  ok('signed webhook processed', wh.code===200 && wh.body.ok);
  const p1 = _db.purchases.find(p => p.id === c1.body.purchaseId), p2 = _db.purchases.find(p => p.id === c2.body.purchaseId);
  ok('ONLY the paying buyer\u2019s purchase is marked paid -- the other buyer\u2019s stays pending', p1.status==='paid' && p2.status==='pending_payment');
  // Where the paying buyer came from travels from the checkout to the paid event, with the property's market, so the marketing
  // dashboard can trace the sale to its channel; a checkout whose browser sent nothing records nothing.
  ok('the checkout keeps the buyer\u2019s source and the market with the purchase', p1.attribution && p1.attribution.captured === true && p1.attribution.utm.source === 'instagram' && p1.attribution.market === pv.body.brief.market && p2.attribution && !p2.attribution.captured);
  const paidEv = (await require('../../engine/analytics').loadRows('2000-01-01')).filter(e => e.event === 'purchase_paid' && e.ref === ref).pop();
  ok('the paid event carries the market and the source, marked as traced', paidEv && paidEv.market === pv.body.brief.market && paidEv.utm_source === 'instagram' && paidEv.channel === 'instagram' && /:src$/.test(paidEv.detail));
  ok('replayed webhook is acknowledged, not processed twice', (await call(hook, raw, { 'x-sk-provider':'test', 'x-sk-signature': sig }, '/api/payments/webhook')).body.duplicate === true);
  const bad = Buffer.from(JSON.stringify({ id:'evt_2', type:'payment.succeeded', data:{ reportRef: ref, purchaseId: c2.body.purchaseId, amount: 1 } }));
  const badSig = crypto.createHmac('sha256','whsec').update(bad).digest('hex');
  await call(hook, bad, { 'x-sk-provider':'test', 'x-sk-signature': badSig }, '/api/payments/webhook');
  ok('an underpayment does not unlock anything', p2.status === 'pending_payment');
  const forged = Buffer.from(JSON.stringify({ id:'evt_3', type:'payment.succeeded', data:{ reportRef: ref, purchaseId: c2.body.purchaseId, amount: c2.body.amount } }));
  ok('a forged signature is rejected', (await call(hook, forged, { 'x-sk-provider':'test', 'x-sk-signature': 'ab'.repeat(32) }, '/api/payments/webhook')).code === 401 && p2.status === 'pending_payment');
  // 5. buyer 1 exchanges the paid purchase for a token and gets the full brief
  const acc = await call(find('post','/api/research/access'), { ref, purchaseId: c1.body.purchaseId });
  ok('paid purchase is exchanged for an access token', acc.code===200 && acc.body.token);
  const full = await call(research, { query:'Hubtown Celeste', market:'in' }, { 'x-report-access': acc.body.token });
  ok('with the token, the full brief is served', full.body.brief.locked===false && full.body.brief.reading.length===1);
  const doc = await call(find('post','/api/research/document-check'), { query:'Hubtown Celeste', market:'in', country:'IN', file:'AAAA', mediaType:'application/pdf' }, { 'x-report-access': acc.body.token });
  ok('with the token, the document check runs and matches the registration', doc.code===200 && doc.body.result.checks.find(c=>c.topic==='Registration number').status==='match');
  // 6. the body-parser fix
  const mw = app.routes.find(r => r.method==='use' && r.handlers.some(h => String(h).includes('OWN_BODY_PARSER')));
  const probe = path => new Promise(r => { const req = { path }; mw.handlers[0](req, {}, () => r(req._jsonParsed === true)); });
  ok('the global JSON parser now skips the webhook (raw bytes preserved for the signature)', (await probe('/api/payments/webhook')) === false);
  ok('...and the document upload', (await probe('/api/research/document-check')) === false);
  ok('...but still parses every other route', (await probe('/api/research')) === true);
})();
