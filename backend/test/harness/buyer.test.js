// The buyer's path, end to end through the real server.js, the real engine layer, the real quote, checkout and
// Razorpay verification, with the AI, Razorpay and the e-mail provider mocked:
// start -> free preview -> contact -> quote -> checkout -> verified payment -> the paid investigation completes ->
// the report is e-mailed -> the full report and its PDF open with the token. Plus the review hold, reuse and the cap.
const crypto = require('crypto');
Object.assign(process.env, { ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN_SECRET: 'tok-secret', GSTIN: '27ABCDE1234F1Z5', PAYMENTS_ENABLED: 'true', BOT_GUARD: 'off',
  RAZORPAY_KEY_ID: 'rzp_test_id', RAZORPAY_KEY_SECRET: 'key_secret', RESEND_API_KEY: 're_test', DELIVERY_FROM: 'reports@shelterkart.example', PUBLIC_BASE_URL: 'https://shelterkart.example' });
delete process.env.DATABASE_URL; delete process.env.AI_ENGINES; delete process.env.ADVERSE_HOLD_MARKETS;
const AURUM = 'https://www.aurumproptech.in/pulse/rera/maharashtra/mumbai-city/hubtown-celeste-P51900008925';
const TOPICS = ['the agreement signatory and its company number', 'every extension of the completion date and the allottee consents', 'the approved area statement reconciling carpet and sanctioned area', 'lender charges over the land or receivables', 'the occupation certificate for each floor'];
const Q = n => ({ question: `Question number ${n}: please share ${TOPICS[n - 1]}.`, why: 'It matters.', to: 'legal team', when: 'before signing', good: 'The document.', not_accepted: 'A verbal answer.' });
const SWEEP = { project: { name: 'Hubtown Celeste', location: 'Worli, Mumbai', brand: 'Hubtown', promoter_legal_name: 'Nayan Real Estate Private Limited', registration_ids: ['P51900008925'] },
  facts: [{ area: 'identity', field: 'registered promoter', value: 'Nayan Real Estate Private Limited', claim: 'The record names Nayan Real Estate Private Limited as promoter.', sources: [AURUM] }],
  filed_completion: { value: '31 Jul 2029', source: AURUM }, marketed_dates: [{ value: 'December 2027', source: AURUM }],
  listings: [{ label: '1 BHK', price: 19900000, currency: 'INR', area_sqft: 330, source: AURUM }, { label: '2 BHK', price: 41000000, currency: 'INR', area_sqft: 660, source: AURUM }],
  questions: [Q(1), Q(2), Q(3), Q(4), Q(5)], leads: [{ kind: 'company', value: 'Nayan Real Estate Private Limited', why: 'the seller' }] };
const LEAD = { facts: [{ area: 'money', claim: 'A lead round found a fact only the paid report holds: open charges on the seller.', sources: ['https://example-data.com/nayan'] }] };
const sent = []; let orderN = 0;
globalThis.fetch = async (url, o) => {
  const mk = (c, status = 200) => ({ ok: status < 400, status, json: async () => c });
  if (url === 'https://api.razorpay.com/v1/orders') { const q = JSON.parse(o.body); return mk({ id: 'order_B' + (++orderN), amount: q.amount, currency: q.currency }); }
  if (url === 'https://api.resend.com/emails') { sent.push(JSON.parse(o.body)); return mk({ id: 'em_' + sent.length }); }
  const b = JSON.parse(o.body), prompt = JSON.stringify(b.messages);
  if (b.tools) return mk({ stop_reason: 'end_turn', content: [{ type: 'web_search_tool_result', content: [{ url: AURUM, title: 'Celeste' }] }, { type: 'text', text: JSON.stringify(/Lead: /.test(prompt) ? LEAD : SWEEP) }], usage: { input_tokens: 1, output_tokens: 1 } });
  return mk({ content: [{ type: 'text', text: /most demanding partner/.test(prompt) ? '{"questions":[{"question":"A reviewer question that only the paid report holds.","to":"accounts team","when":"before signing"}]}' : '{"questions":[]}' }], usage: { input_tokens: 1, output_tokens: 1 } });
};
const app = require(require('path').join(__dirname, '..', '..', 'server.js'));
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route, { body = {}, params = {}, query = {}, headers = {} } = {}) { return new Promise(resolve => {
  const res = { code: 200, headers: {}, chunks: [], status(c) { this.code = c; return this; }, set(k, v) { if (typeof k === 'object') Object.assign(this.headers, k); else this.headers[k] = v; return this; },
    json(o) { resolve({ code: this.code, body: o, headers: this.headers }); }, send(t) { resolve({ code: this.code, text: Buffer.isBuffer(t) ? t : String(t), headers: this.headers }); },
    write(c) { this.chunks.push(c); }, end() { resolve({ code: this.code, text: this.chunks.join(''), headers: this.headers }); }, flushHeaders() {} };
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const req = { body, params, query, ip: '5.5.5.' + Math.floor(Math.random() * 200), path: route.path, headers: h, get: k => h[k.toLowerCase()], on() {} };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const fn = hs[i++]; if (fn) fn(req, res, next); }; next();
}); }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, tries = 120) { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await wait(25); } return null; }
let failures = 0; const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });

(async () => {
  const startPage = await call(find('get', '/start'));
  ok('the start page asks for the project and loads the page script', /id="sk-start"/.test(startPage.text) && /\/assets\/report-live\.js/.test(startPage.text));
  const script = await call(find('get', '/assets/report-live.js'));
  ok('the page script is served as JavaScript and calls the existing quote, checkout and verify routes', /javascript/.test(script.headers['Content-Type']) && ['/api/research/quote', '/api/research/checkout', '/api/research/razorpay/verify'].every(u => script.text.includes(u)));

  const start = find('post', '/api/investigate');
  ok('a vague request is refused', (await call(start, { body: { query: 'x' } })).code === 400);
  const s = await call(start, { body: { query: 'Hubtown Celeste', location: 'Worli, Mumbai', country: 'IN' } });
  const ref = s.body.ref;
  ok('starting returns 202 and a normal report reference', s.code === 202 && /^SK-[0-9A-F]{12}$/.test(ref));
  const page = find('get', '/r/:ref');
  const preview = await until(async () => { const p = await call(page, { params: { ref } }); return /Free preview/.test(p.text) ? p : null; });
  ok('the free preview appears when the first sweep finishes', Boolean(preview));
  ok('the preview shows who really sells it, with the gold-standard price from the price book', /Registered to Nayan Real Estate Private Limited/.test(preview.text) && /₹[\d,]+/.test(preview.text) && /id="sk-unlock"/.test(preview.text));
  ok('the preview shows three questions and keeps the rest locked', /Question number 3/.test(preview.text) && !/Question number 4/.test(preview.text) && /more questions are in the full report/.test(preview.text));
  const ev = await call(find('get', '/api/investigate/:ref/events'), { params: { ref } });
  ok('the public event stream closes once the preview is ready and carries no paid content', /event: update/.test(ev.text) && !/Following|dossier/.test(ev.text));

  const contact = find('post', '/api/investigate/:ref/contact');
  ok('a bad e-mail address is refused', (await call(contact, { params: { ref }, body: { email: 'not-an-email' } })).code === 400);
  ok('the buyer leaves an e-mail for the report', (await call(contact, { params: { ref }, body: { email: 'Buyer@Example.com' } })).code === 200);
  const q = await call(find('post', '/api/research/quote'), { body: { ref, country: 'IN' } });
  ok('the existing quote route prices the report at gold-standard depth', q.code === 200 && q.body.quote.depthLabel === 'Gold standard' && q.body.quote.currency === 'INR');
  const co = await call(find('post', '/api/research/checkout'), { body: { ref, idempotencyKey: 'buyer-test-checkout-0001', quoteId: q.body.quote.id, billingCountry: 'IN' } });
  ok('the existing checkout creates a Razorpay order for the quoted amount', co.code === 200 && /^order_B/.test(co.body.razorpay.orderId) && co.body.amount === q.body.quote.gross);
  const sig = crypto.createHmac('sha256', 'key_secret').update(co.body.razorpay.orderId + '|pay_BUYER1').digest('hex');
  const v = await call(find('post', '/api/research/razorpay/verify'), { body: { ref, purchaseId: co.body.purchaseId, razorpay_payment_id: 'pay_BUYER1', razorpay_signature: sig } });
  ok('the existing verification confirms the payment and returns an access token', v.code === 200 && v.body.token);
  const token = v.body.token;

  const mail = await until(() => sent.length && sent[0]);
  ok('when the paid investigation completes, the report is e-mailed to the buyer with a link to it', mail && mail.to[0] === 'buyer@example.com' && mail.text.includes(`https://shelterkart.example/r/${ref}?t=`));
  const full = await call(page, { params: { ref }, query: { t: token } });
  ok('the full report opens with the token, complete, with the PDF button and no unlock form', /Every question, by stage/.test(full.text) && /, complete/.test(full.text) && /Download the PDF/.test(full.text) && !/id="sk-unlock"/.test(full.text));
  ok('the paid report holds what only the lead rounds and the reviewer found', /open charges on the seller/.test(full.text) && /A reviewer question that only the paid report holds/.test(full.text));
  ok('the same page without the token still shows only the preview', !/open charges on the seller/.test((await call(page, { params: { ref } })).text));
  const pdfRoute = find('get', '/r/:ref/pdf');
  ok('the PDF refuses a missing or wrong token', (await call(pdfRoute, { params: { ref }, query: { t: 'nope' } })).code === 403);
  const pdf = await call(pdfRoute, { params: { ref }, query: { t: token } });
  ok('the PDF downloads with the token (where Chromium is installed) or says how to print one', (pdf.code === 200 && /application\/pdf/.test(pdf.headers['Content-Type']) && Buffer.from(pdf.text).slice(0, 4).toString() === '%PDF') || pdf.code === 503);

  ok('the same project asked again returns the same report, with no second investigation', (await call(start, { body: { query: 'Hubtown Celeste', location: 'Worli, Mumbai', country: 'IN' } })).body.ref === ref);
  process.env.ADVERSE_HOLD_MARKETS = 'in';
  const h = await call(start, { body: { query: 'Another Tower', location: 'Pune', country: 'IN' } });
  await until(async () => /Free preview/.test((await call(page, { params: { ref: h.body.ref } })).text));
  ok('in a held market the preview says a person is checking it, and the quote is refused until released', /A person is checking this report/.test((await call(page, { params: { ref: h.body.ref } })).text) && (await call(find('post', '/api/research/quote'), { body: { ref: h.body.ref, country: 'IN' } })).body.code === 'held');
  process.env.INVESTIGATE_DAILY_CAP = '0';
  ok('a daily cap of 0 pauses new investigations', (await call(start, { body: { query: 'Third Project', country: 'IN' } })).code === 503);
  const dl = await call(find('get', '/api/admin/delivery'), { headers: { authorization: 'Basic ' + Buffer.from('a:b').toString('base64') } });
  ok('the delivery status is admin only', dl.code === 401 || dl.code === 503);
  const sample = await call(find('get', '/samples/:id'), { params: { id: 'celeste' } });
  ok('the public sample report opens, marked as a sample, with a way to start one\'s own', sample.code === 200 && /Sample report, built from published research/.test(sample.text) && /Nayan Real Estate Private Limited/.test(sample.text) && /href="\/start"/.test(sample.text));
  ok('an unknown or malformed sample is a 404', (await call(find('get', '/samples/:id'), { params: { id: '../server' } })).code === 404);
  process.exit(failures ? 1 : 0);
})();
