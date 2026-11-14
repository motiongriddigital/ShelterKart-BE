const crypto = require('crypto');
const env = { ANTHROPIC_API_KEY:'k', AI_PERSONAL_DATA_ENGINES:'anthropic', PAYMENT_WEBHOOK_SECRET:'whsec', ACCESS_TOKEN_SECRET:'tok-secret', GSTIN: '27ABCDE1234F1Z5', RAZORPAY_KEY_ID:'rzp_test_id', RAZORPAY_KEY_SECRET:'key_secret',
  ACCOUNTS_ENABLED:'on', AUTH_PEPPER:'x'.repeat(40), ACCOUNTS_ALLOW_MEMORY:'true', ACCOUNTS_DEV_ECHO:'on', PAYMENTS_ENABLED:'true',
  RESEND_API_KEY:'re_test', DELIVERY_FROM:'ShelterKart <no-reply@shelterkart.test>', PUBLIC_BASE_URL:'https://shelterkart.test' };
Object.assign(process.env, env, { ADMIN_USERNAME: 'a', ADMIN_PASSWORD: 'b' });
const fs = require('fs'), os = require('os'), nodePath = require('path');
process.env.PDF_AUTO = 'on';
process.env.PDF_DIR = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'skpdf-harness-'));
const RET=[['https://maharerait.maharashtra.gov.in/x','MahaRERA'],['https://a.com/1','A'],['https://b.com/2','B'],['https://c.com/3','C'],['https://d.com/4','D']];
const OUT={project:{name:'Hubtown Celeste',location:'Mumbai',developer:'Hubtown Limited',ids:['P51900008925']},sources:RET.map(r=>r[0]),
  findings:RET.map((r,i)=>({id:'f'+i,topic:'other',claim:'Claim number '+i+'.',kind:'fact',src:[i]})),
  conflicts:[{topic:'Possession date',versions:[{value:'Dec 2027',src:1},{value:'Jul 2029',src:2}]}],gaps:[]};
const MAILS = []; let _o=0; globalThis.fetch = async (url, o) => { const mk = c => ({ ok:true, status:200, json: async()=>c });
  if (url === 'https://api.resend.com/emails') { MAILS.push(JSON.parse(o.body)); return mk({ id:'em_' + MAILS.length }); } if (url === 'https://api.razorpay.com/v1/orders') { const q = JSON.parse(o.body); return mk({ id:'order_A'+(++_o), amount:q.amount, currency:q.currency, status:'created' }); } const b = JSON.parse(o.body);
  if (b.tools) return mk({stop_reason:'end_turn',content:[{type:'server_tool_use',name:'web_search'},{type:'web_search_tool_result',content:RET.map(([u,t])=>({url:u,title:t}))},{type:'text',text:JSON.stringify(/due-diligence investigator/.test(JSON.stringify(b.messages)) ? { ...OUT, questions:[{question:'Please share the registered agreement for sale.',why:'It matters.',to:'legal team',when:'before signing',good:'The document.',not_accepted:'A verbal answer.'}] } : OUT)}]});
  return mk({content:[{type:'text',text:'{"reading":[{"observation":"Dates differ.","based_on":["f1"],"question":"Which?"}],"questions":[]}'}]}); };
const app = require(require('path').join(__dirname, '..', '..', 'server.js'));
const { _db } = require('pg');
const ANALYTICS = require('../../engine/analytics');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const eventsOf = name => ANALYTICS._memory.filter(e => e.event === name);
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route, body, { headers = {}, params = {}, query = {}, path = '' } = {}) { return new Promise(resolve => {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const res = { code: 200, headers: {}, cookies: [], status(c) { this.code = c; return this; }, set(k, v) { if (typeof k === 'object') Object.assign(this.headers, k); else this.headers[k] = v; return this; },
    append(k, v) { if (k === 'Set-Cookie') this.cookies.push(v); return this; }, json(o) { resolve({ code: this.code, body: o, cookies: this.cookies, headers: this.headers }); },
    send(o) { resolve({ code: this.code, body: o, cookies: this.cookies, headers: this.headers }); }, redirect(c, u) { resolve({ code: c, location: u }); }, write() {}, end() { resolve({ code: this.code, ended: true }); }, flushHeaders() {} };
  const req = { body, params, query, ip: '3.3.3.3', path, headers: h, originalUrl: path, get: k => h[k.toLowerCase()], on() {} };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const fn = hs[i++]; if (fn) fn(req, res, next); }; next(); }); }
let failures = 0;
const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });

async function signIn(email, ip) {
  const ua = { 'user-agent': 'Mozilla/5.0 (Macintosh)' };
  const rc = await call(find('post', '/api/auth/request-code'), { email }, { headers: ua });
  const vc = await call(find('post', '/api/auth/verify-code'), { email, code: rc.body.devCode, termsAccepted: true }, { headers: ua });
  return { cookie: (vc.cookies[0] || '').split(';')[0], user: vc.body.user };
}

const PDF = require('../../engine/pdf'), REVIEW = require('../../engine/review');
const printed = []; let canPrint = true;
PDF.available = () => canPrint;
PDF.queueState = () => ({ active: 0, waiting: 0, limit: 2 });
PDF.renderPdf = async (html, { footer } = {}) => { printed.push({ html, footer }); return Buffer.from('%PDF-1.4 test ' + printed.length + ' ' + html.length); };
const send = async (path, headers, params) => call(find('get', path), undefined, { headers, params, path });
const rawOf = r => (Buffer.isBuffer(r.body) ? r.body : Buffer.from(String(r.body || '')));
(async () => {
  console.log('a free preview PDF is made when the search finishes');
  const A = await signIn('pdf-a@example.com'), B = await signIn('pdf-b@example.com'), hA = { cookie: A.cookie }, hB = { cookie: B.cookie };
  const start = await call(find('post', '/api/investigate'), { query: 'Hubtown Celeste', country: 'IN', market: 'India' }, { headers: hA, path: '/api/investigate' });
  ok('the search starts', start.code === 202 && Boolean(start.body.ref));
  const ref = start.body.ref;
  let view; for (let i = 0; i < 150; i++) { view = await send('/api/report/:ref', hA, { ref }); if (view.body && view.body.ready && view.body.pdf && view.body.pdf.ready) break; await sleep(40); }
  ok('the report call says a free preview PDF is ready, with its address and name', view.body.pdf && view.body.pdf.kind === 'preview' && view.body.pdf.ready === true && view.body.pdf.url === `/r/${ref}/preview.pdf` && /^[A-Za-z0-9-]+_preview_\d{4}-\d{2}-\d{2}_[0-9A-F]{6}\.pdf$/.test(view.body.pdf.filename) && view.body.pdf.bytes > 0);
  ok('it was printed once, from the free page, with the preview footer', printed.length === 1 && /free preview/i.test(printed[0].footer) && /Free preview/.test(printed[0].html) && !/Every question, by stage/.test(printed[0].html));
  const printedBefore = printed.length;

  console.log('downloading it');
  const dl = await send('/r/:ref/preview.pdf', hA, { ref });
  ok('a visitor gets the stored file at once, as a PDF download, private and not indexed', dl.code === 200 && rawOf(dl).slice(0, 4).toString() === '%PDF' && dl.headers['Content-Type'] === 'application/pdf' && /attachment; filename="[A-Za-z0-9-]+_preview_\d{4}-\d{2}-\d{2}_[0-9A-F]{6}\.pdf"/.test(dl.headers['Content-Disposition']) && /private/.test(dl.headers['Cache-Control']) && /noindex/.test(dl.headers['X-Robots-Tag']) && Number(dl.headers['Content-Length']) === rawOf(dl).length);
  ok('the download did not print again', printed.length === printedBefore);
  const other = await send('/r/:ref/preview.pdf', hB, { ref });
  ok('another signed-in visitor gets the same stored file', other.code === 200 && printed.length === printedBefore);
  ok('a visitor with no session at all gets the free preview PDF too: no sign-in is needed to share or save it', await (async () => { const r = await send('/r/:ref/preview.pdf', {}, { ref }); return r.code === 200 && rawOf(r).slice(0, 4).toString() === '%PDF'; })());
  ok('the full PDF is still refused without a session (401)', (await send('/r/:ref/pdf', {}, { ref })).code === 401);
  ok('a malformed or unknown reference is a 404', (await send('/r/:ref/preview.pdf', hA, { ref: 'nope' })).code === 404 && (await send('/r/:ref/preview.pdf', hA, { ref: 'SK-FFFFFFFFFFFF' })).code === 404);

  console.log('the full PDF stays paid');
  const full = await send('/r/:ref/pdf', hA, { ref });
  ok('an unpaid visitor asking for the full PDF gets 403 payment_required and the address of the free one', full.code === 403 && full.body.code === 'payment_required' && full.body.previewPdf === `/r/${ref}/preview.pdf` && printed.length === printedBefore);
  const stale = await call(find('get', '/r/:ref/pdf'), undefined, { headers: hA, params: { ref }, query: { t: 'expired.token' }, path: '/r/' + ref + '/pdf' });
  ok('an old link with a bad token keeps the generic refusal', stale.code === 403 && !stale.body.code);

  console.log('held and unavailable');
  const realHeld = REVIEW.isHeld; REVIEW.isHeld = () => true;
  const held = await send('/r/:ref/preview.pdf', hA, { ref }), heldView = await send('/api/report/:ref', hA, { ref });
  REVIEW.isHeld = realHeld;
  ok('a held report has no PDF: 423, and the report call says why', held.code === 423 && heldView.body.pdf.ready === false && heldView.body.pdf.reason === 'held');
  canPrint = false;
  const na = await send('/r/:ref/preview.pdf', hA, { ref }), naView = await send('/api/report/:ref', hA, { ref });
  canPrint = true;
  ok('where printing is not installed the route answers 503 with guidance and the report call says unavailable', na.code === 503 && na.body.code === 'pdf_unavailable' && naView.body.pdf.reason === 'unavailable');

  console.log('paying makes the full PDF before the e-mail');
  const q = (await call(find('post', '/api/research/quote'), { ref, country: 'IN', session: 'p' }, { headers: hA })).body.quote;
  const co = await call(find('post', '/api/research/checkout'), { ref, idempotencyKey: 'pdf-buyer-a-aaaaaaaaaaaaaaaa', quoteId: q && q.id, billingCountry: 'IN' }, { headers: hA });
  ok('checkout works', co.code === 200 && Boolean(co.body.purchaseId));
  _db.payerEmail = { [co.body.purchaseId]: 'pdf-a@example.com' };
  const raw = Buffer.from(JSON.stringify({ id: 'evt_pdf1', type: 'payment.succeeded', data: { reportRef: ref, purchaseId: co.body.purchaseId, amount: co.body.amount, currency: co.body.currency } }));
  const wh = await call(find('post', '/api/payments/webhook'), raw, { headers: { 'x-sk-provider': 'test', 'x-sk-signature': crypto.createHmac('sha256', 'whsec').update(raw).digest('hex') }, path: '/api/payments/webhook' });
  ok('the webhook settles it', wh.code === 200 && _db.purchases.find(p => p.id === co.body.purchaseId).status === 'paid');
  let mail; for (let i = 0; i < 300 && !mail; i++) { mail = MAILS.find(m => String(m.text || '').includes('/r/' + ref)); if (!mail) await sleep(40); }
  ok('the report e-mail is sent', Boolean(mail));
  ok('the e-mail carries the full PDF as an attachment named for the developer (or what was searched for when the developer is not known), and says so', Boolean(mail.attachments) && mail.attachments.length === 1 && /^Hubtown-Celeste_\d{4}-\d{2}-\d{2}_[0-9A-F]{6}\.pdf$/.test(mail.attachments[0].filename) && Buffer.from(mail.attachments[0].content, 'base64').slice(0, 4).toString() === '%PDF' && /The PDF is attached/.test(mail.text) && /\/r\/SK-[A-F0-9]{12}\/pdf/.test(mail.text));
  const fullPrints = printed.filter(p => /^ShelterKart report:/.test(p.footer || ''));
  ok('the full PDF was printed once, from the full report, before the e-mail went out', fullPrints.length === 1 && /Every question, by stage/.test(fullPrints[0].html) && /\/r\/SK-[A-F0-9]{12}\/pdf/.test(mail.text));
  const paidView = await send('/api/report/:ref', hA, { ref });
  ok('the report call now offers the full PDF as ready', paidView.body.pdf.kind === 'full' && paidView.body.pdf.ready === true && paidView.body.pdf.url === `/r/${ref}/pdf` && /^Hubtown-Celeste_\d{4}-\d{2}-\d{2}_[0-9A-F]{6}\.pdf$/.test(paidView.body.pdf.filename));
  const printsNow = printed.length;
  const fdl = await send('/r/:ref/pdf', hA, { ref });
  ok('the paid buyer downloads the stored full PDF without another print', fdl.code === 200 && rawOf(fdl).slice(0, 4).toString() === '%PDF' && /attachment; filename="Hubtown-Celeste_\d{4}-\d{2}-\d{2}_[0-9A-F]{6}\.pdf"/.test(fdl.headers['Content-Disposition']) && printed.length === printsNow);
  ok('another buyer still cannot have it', (await send('/r/:ref/pdf', hB, { ref })).code === 403);
  const prev2 = await send('/r/:ref/preview.pdf', hA, { ref });
  ok('the paid buyer can still download the free preview PDF', prev2.code === 200);

  console.log('files on disk, and removal with the report');
  const onDisk = () => { try { return fs.readdirSync(nodePath.join(process.env.PDF_DIR, ref)); } catch { return []; } };
  ok('one preview file and one full file are kept for the report, named by content key', onDisk().length === 2 && onDisk().some(n => /^preview-[a-f0-9]{16}\.pdf$/.test(n)) && onDisk().some(n => /^full-[a-f0-9]{16}\.pdf$/.test(n)));
  const ADMIN = { authorization: 'Basic ' + Buffer.from('a:b').toString('base64') };
  const st = await call(find('get', '/api/admin/delivery'), undefined, { headers: ADMIN, path: '/api/admin/delivery' });
  ok('the admin delivery status shows the PDFs made, the files kept and the printer queue', st.code === 200 && st.body.pdfs.made.preview >= 1 && st.body.pdfs.made.full === 1 && st.body.pdfs.files === 2 && st.body.pdfs.available === true && st.body.pdfQueue.limit === 2);
  { const R = require('../../engine/research'); const b = await R.getByRefAsync(ref); b.dossier.sources = (b.dossier.sources || []).concat([{ url: 'https://takedown.example/page' }]); }
  const purge = await call(find('post', '/api/admin/purge'), { host: 'takedown.example' }, { headers: ADMIN, path: '/api/admin/purge' });
  ok('a takedown of a source the report cites removes the report and its PDF files', purge.code === 200 && purge.body.purgedInvestigations >= 1 && onDisk().length === 0 && !fs.existsSync(nodePath.join(process.env.PDF_DIR, ref)));
  ok('and the PDF routes answer 404 afterwards', (await send('/r/:ref/preview.pdf', hA, { ref })).code === 404 && (await send('/r/:ref/pdf', hA, { ref })).code === 404);
})();
