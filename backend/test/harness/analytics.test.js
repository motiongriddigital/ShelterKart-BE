// Analytics end to end: the real server, real analytics module, real persistence (SQL-aware stub).
const crypto = require('crypto');
Object.assign(process.env, { ANTHROPIC_API_KEY: 'k', DATABASE_URL: 'postgres://stub', ADMIN_USERNAME: 'ops', ADMIN_PASSWORD: 'pw-123456',
  PAYMENTS_ENABLED: 'true', ACCESS_TOKEN_SECRET: 'tok', GSTIN: '27ABCDE1234F1Z5',
  RAZORPAY_KEY_ID: 'rzp_test_id', RAZORPAY_KEY_SECRET: 'key_secret', RAZORPAY_WEBHOOK_SECRET: 'rzp_whsec' });
const RET = [['https://maharerait.maharashtra.gov.in/x', 'MahaRERA'], ['https://a.com/1', 'A']];
const OUT = { project: { name: 'Casagrand Casamia', location: 'Chennai', developer: 'Casagrand', ids: [] }, sources: RET.map(r => r[0]),
  findings: RET.map((r, i) => ({ id: 'f' + i, topic: 'other', claim: 'Claim ' + i + '.', kind: 'fact', src: [i] })), conflicts: [], gaps: [] };
let orderN = 0;
globalThis.fetch = async (url, o) => {
  const mk = c => ({ ok: true, status: 200, json: async () => c });
  if (url === 'https://api.razorpay.com/v1/orders') { const b = JSON.parse(o.body); return mk({ id: 'order_A' + (++orderN), amount: b.amount, currency: b.currency }); }
  const b = JSON.parse(o.body);
  if (b.tools) return mk({ stop_reason: 'end_turn', content: [{ type: 'server_tool_use', name: 'web_search' },
    { type: 'web_search_tool_result', content: RET.map(([u, t]) => ({ url: u, title: t })) }, { type: 'text', text: JSON.stringify(OUT) }] });
  return mk({ content: [{ type: 'text', text: '{"reading":[],"questions":[]}' }] });
};
const path = require('path');
const app = require(path.join(__dirname, '..', '..', 'server.js'));
const A = require(path.join(__dirname, '..', '..', 'engine', 'analytics.js'));
const { _db } = require('pg');
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
function call(route, { body = {}, params = {}, query = {}, ip = '1.1.1.1', ua = IPHONE, headers = {} } = {}) { return new Promise(resolve => {
  const h = { 'user-agent': ua, origin: 'https://shelterkart.com', 'cf-ipcountry': 'IN', ...headers };
  const res = { code: 200, status(c) { this.code = c; return this; }, set() { return this; }, end() { resolve({ code: this.code }); }, json(o) { resolve({ code: this.code, body: o }); } };
  const req = { body, params, query, ip, headers: h, path: route.path, get: k => h[k.toLowerCase()] };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const x = hs[i++]; if (x) x(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });
const settle = () => new Promise(r => setTimeout(r, 30));
const AUTH = { authorization: 'Basic ' + Buffer.from('ops:pw-123456').toString('base64') };

(async () => {
  const track = find('post', '/api/track');
  // Visitor 1 arrives from Instagram on an iPhone; visitor 2 from Google on a Mac; a WhatsApp preview fetches the page too.
  await call(track, { ip: '10.0.0.1', body: { event: 'page_view', path: '/', referrer: '', utm: { source: 'instagram', medium: 'social', campaign: 'launch' } } });
  await call(track, { ip: '10.0.0.2', ua: MAC, headers: { 'cf-ipcountry': 'GB' }, body: { event: 'page_view', path: '/', referrer: 'https://www.google.com/' } });
  await call(track, { ip: '10.0.0.9', ua: 'WhatsApp/2.24.1 A', body: { event: 'page_view', path: '/' } });
  await call(track, { ip: '10.0.0.1', body: { event: 'page_view', path: '/' } });                   // same visitor, same day
  const fake = await call(track, { ip: '10.0.0.1', body: { event: 'purchase_paid', value: 99999, currency: 'INR' } });
  ok('a script cannot record a purchase through the tracking endpoint', fake.code === 400);
  ok('unknown event names are refused', (await call(track, { body: { event: 'drop_table' } })).code === 400);

  // Visitor 1 searches, opens the report by link, clicks unlock, starts checkout, pays in the browser, saves the PDF, shares.
  const s = await call(find('post', '/api/research'), { ip: '10.0.0.1', body: { query: 'Casagrand Casamia', market: 'in', country: 'IN' } });
  const qOf = async (ip, session) => (await call(find('post', '/api/research/quote'), { ip, body: { ref: s.body.brief.ref, country: 'IN', session } })).body.quote;
  const ref = s.body.brief.ref;
  await call(find('get', '/api/research/by-ref/:ref'), { ip: '10.0.0.1', params: { ref } });
  await call(track, { ip: '10.0.0.1', body: { event: 'unlock_click', ref } });
  const q1 = await qOf('10.0.0.1', 'analytics-one'), PRICE = q1.gross;
  const co = await call(find('post', '/api/research/checkout'), { ip: '10.0.0.1', body: { ref, idempotencyKey: 'analytics-buyer-one-aaaa', quoteId: q1.id, billingCountry: 'IN' } });
  await call(find('post', '/api/research/checkout'), { ip: '10.0.0.1', body: { ref, idempotencyKey: 'analytics-buyer-one-aaaa', quoteId: q1.id, billingCountry: 'IN' } });   // a retry
  const sig = crypto.createHmac('sha256', 'key_secret').update(co.body.razorpay.orderId + '|pay_ANALYTICSONE1').digest('hex');
  const v = await call(find('post', '/api/research/razorpay/verify'), { ip: '10.0.0.1', body: { ref, purchaseId: co.body.purchaseId, razorpay_payment_id: 'pay_ANALYTICSONE1', razorpay_signature: sig } });
  ok('the browser-verified payment went through', v.code === 200 && v.body.token);
  await call(track, { ip: '10.0.0.1', body: { event: 'save_pdf', ref } });
  await call(track, { ip: '10.0.0.1', body: { event: 'guide_open', detail: 'ch2' } });
  await call(track, { ip: '10.0.0.1', body: { event: 'guide_download' } });
  await call(track, { ip: '10.0.0.1', body: { event: 'share_whatsapp', ref } });

  // A second buyer pays, but the tab closes: Razorpay's webhook settles it.
  const q2 = await qOf('10.0.0.2', 'analytics-two');
  const co2 = await call(find('post', '/api/research/checkout'), { ip: '10.0.0.2', ua: MAC, body: { ref, idempotencyKey: 'analytics-buyer-two-bbbb', quoteId: q2.id, billingCountry: 'IN' } });
  const raw = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_WEBHOOKTWO22', order_id: co2.body.razorpay.orderId, amount: Math.round(PRICE * 100), currency: 'INR' } } } }));
  const wsig = crypto.createHmac('sha256', 'rzp_whsec').update(raw).digest('hex');
  await call(find('post', '/api/payments/razorpay/webhook'), { body: raw, ua: 'Razorpay-Webhook/v1', headers: { 'x-razorpay-signature': wsig } });
  await settle();

  // The dashboard
  const r = await call(find('get', '/api/admin/analytics'), { query: { days: '7' }, headers: AUTH });
  const d = r.body;
  ok('the dashboard answers', r.code === 200 && d.ok && d.stored === true);
  ok('2 visitors: the WhatsApp preview is not one, the repeat visit is not a second', d.totals.visitors === 2);
  ok('page views: 3 (the preview excluded)', d.totals.page_views === 3);
  const ch = Object.fromEntries(d.channels.map(c => [c.key, c.count]));
  ok('where page views came from: Instagram 1, Google 1, and the untagged repeat visit counted as direct', ch.instagram === 1 && ch.google === 1 && ch.direct === 1 && d.channels.length === 3);
  ok('the Instagram launch campaign is attributed', d.campaigns.some(c => c.key === 'instagram / launch'));
  ok('countries come from the edge header: India and the UK', d.countries.some(c => c.key === 'IN') && d.countries.some(c => c.key === 'GB'));
  ok('devices: mobile and desktop', d.devices.some(x => x.key === 'mobile') && d.devices.some(x => x.key === 'desktop'));
  ok('searches: 1, and the searched project is listed', d.totals.searches === 1 && d.top_searches[0].key === 'casagrand casamia');
  ok('report opens, unlock clicks, PDF saves, WhatsApp shares each counted once', d.totals.report_opens === 1 && d.totals.unlock_clicks === 1 && d.totals.pdf_saves === 1 && d.totals.whatsapp_shares === 1);
  ok('checkouts started: 2 -- the idempotent retry is not counted again', d.totals.checkouts_started === 2);
  ok('purchases: 2 -- the browser payment AND the webhook-settled one', d.totals.purchases === 2);
  ok('revenue: two purchases at the quoted price, exactly what was paid', JSON.stringify(d.totals.revenue) === JSON.stringify([{ currency: 'INR', amount: 2 * PRICE }]));
  ok('funnel: visited 2, searched 1, paid 2', d.funnel[0].count === 2 && d.funnel[1].count === 1 && d.funnel[5].count === 2);
  ok('the admin analytics route is refused without credentials', (await (async () => { const o = console.error; console.error = () => {}; try { return await call(find('get', '/api/admin/analytics')); } finally { console.error = o; } })()).code === 401);

  // Privacy, checked in what was actually stored
  const stored = JSON.stringify(_db.analyticsEvents);
  ok('no IP address was stored', !/10\.0\.0\.\d/.test(stored));
  ok('no user-agent string was stored', !stored.includes('Safari/604.1') && !stored.includes('Macintosh'));
  ok("only today's salt is kept in the database", _db.salt.size === 1 && _db.salt.has(A.today()));
  const before = A.visitorId('10.0.0.1', IPHONE);
  A._salts.clear();
  A.loadSalt(A.today(), _db.salt.get(A.today()));
  ok('after a restart, the restored salt gives the same visitor id (no double counting)', A.visitorId('10.0.0.1', IPHONE) === before);

  // The admin Reports panel, live: admin-only, and the owner sees the report in full
  const quietCall = async (...args) => { const o = console.error; console.error = () => {}; try { return await call(...args); } finally { console.error = o; } };
  ok('admin reports: refused without credentials', (await quietCall(find('get', '/api/admin/reports'))).code === 401);
  const list = await call(find('get', '/api/admin/reports'), { headers: AUTH });
  ok('admin reports: lists the report just researched, with its findings count', list.code === 200 && list.body.reports.some(r => r.ref === ref && typeof r.findings === 'number'));
  const one = await call(find('get', '/api/admin/reports/:ref'), { params: { ref }, headers: AUTH });
  ok('admin reports: the owner gets the FULL report, never the paywalled preview', one.code === 200 && one.body.brief.ref === ref && one.body.brief.locked !== true && one.body.brief.pages.length > 0);
  ok('admin reports: a malformed reference is refused', (await call(find('get', '/api/admin/reports/:ref'), { params: { ref: 'nope' }, headers: AUTH })).code === 400);
  ok('admin reports: the full report is refused without credentials', (await quietCall(find('get', '/api/admin/reports/:ref'), { params: { ref } })).code === 401);

  // Getting paid access back
  const rec = find('post', '/api/research/recover');
  ok('recovery rejects anything that is not a Razorpay payment ID', (await call(rec, { body: { paymentId: 'hello' } })).code === 400);
  ok('recovery refuses a payment ID that paid for nothing', (await call(rec, { body: { paymentId: 'pay_NOTAREALONE99' } })).code === 404);
  const back = await call(rec, { body: { paymentId: 'pay_WEBHOOKTWO22' } });
  ok('the buyer whose tab closed gets their report and access back from the receipt', back.code === 200 && back.body.ref === ref && back.body.token);
  const full = await call(find('get', '/api/research/by-ref/:ref'), { params: { ref }, headers: { 'x-report-access': back.body.token } });
  ok('...and that access really opens the full report', full.code === 200 && full.body.brief.locked === false);
})();
