const crypto = require('crypto');
Object.assign(process.env, { ANTHROPIC_API_KEY:'k', ACCESS_TOKEN_SECRET:'tok', GSTIN: '27ABCDE1234F1Z5', PAYMENTS_ENABLED:'true',
  RAZORPAY_KEY_ID:'rzp_test_id', RAZORPAY_KEY_SECRET:'key_secret', RAZORPAY_WEBHOOK_SECRET:'rzp_whsec',
  DODO_API_KEY:'dk_test_secret_value', DODO_WEBHOOK_KEY:'whsec_' + Buffer.from('a-test-signing-key-0123456789').toString('base64'), DODO_MODE:'test',
  PUBLIC_BASE_URL:'https://shelterkart.test', PRICING_STORE:'pg', NODE_ENV:'test', RESEND_API_KEY:'re_test_key', DELIVERY_FROM:'ShelterKart <no-reply@shelterkart.test>', ADMIN_USERNAME:'admin', ADMIN_PASSWORD:'s3cret-pass', MOR_PRODUCTS: JSON.stringify({ USD:'pdt_usd', GBP:'pdt_gbp' }) });
let orderN = 0, razorpayDown = false; const mails = [];
const RET=[['https://maharerait.maharashtra.gov.in/x','MahaRERA'],['https://a.com/1','A'],['https://b.com/2','B'],['https://c.com/3','C']];
const OUT={project:{name:'Hubtown Celeste',location:'Mumbai',developer:'Hubtown Limited',ids:['P51900008925']},sources:RET.map(r=>r[0]),
  findings:RET.map((r,i)=>({id:'f'+i,topic:'other',claim:'Claim '+i+'.',kind:'fact',src:[i]})),conflicts:[],gaps:[]};
const dodo = { n: 0, down: false, created: [], sessionPaid: {}, payments: {} };
function dodoFetch(path, o, mk) {
  if (dodo.down) return mk({ message: 'down' }, 503);
  if (o.method === 'POST' && path === '/checkouts') { const b = JSON.parse(o.body); const id = 'cks_' + (++dodo.n); dodo.created.push({ id, body: b, auth: o.headers.Authorization }); return mk({ session_id: id, checkout_url: 'https://test.checkout.dodopayments.com/session/' + id }); }
  let m = path.match(/^\/checkouts\/(cks_\w+)$/); if (m) { const p = dodo.sessionPaid[m[1]]; return mk({ id: m[1], payment_id: p ? p.payment_id : null, payment_status: p ? 'succeeded' : null }); }
  m = path.match(/^\/payments\/(pay_\w+)$/); if (m) return dodo.payments[m[1]] ? mk(dodo.payments[m[1]]) : mk({}, 404);
  return mk({}, 404);
}
globalThis.fetch = async (url, o) => {
  const mk = (c, status=200) => ({ ok: status < 300, status, json: async()=>c });
  if (url === 'https://api.resend.com/emails') { mails.push(JSON.parse(o.body)); return mk({ id: 'em_' + mails.length }); }
  if (String(url).startsWith('https://test.dodopayments.com')) return dodoFetch(String(url).slice('https://test.dodopayments.com'.length), o, mk);
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

const R = (m, p, { body, params = {}, query = {}, headers = {} } = {}) => new Promise(resolve => {
  const route = find(m, p); if (!route) return resolve({ code: 404, body: { error: 'no such route ' + p } });
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const res = { code: 200, status(c) { this.code = c; return this; }, set() { return this; }, json(o) { resolve({ code: this.code, body: o }); } };
  const req = { body, params, query, ip: '9.9.9.9', path: route.path, headers: h, get: k => h[k.toLowerCase()] };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const fn = hs[i++]; if (fn) fn(req, res, next); }; next();
});
const ADMIN = { authorization: 'Basic ' + Buffer.from('admin:s3cret-pass').toString('base64') };
const lastMail = () => mails[mails.length - 1];
const tokenOf = m => (m.text.match(/sk_respond_confirm=([0-9a-f]+)/) || [])[1];
(async () => {
  const pv = await call(find('post', '/api/research'), { query: 'Hubtown Celeste', market: 'in', country: 'IN' });
  const ref = pv.body.brief.ref, f0 = (pv.body.brief.findings || [])[0] || {}, FID = f0.id || 'F1';
  const reply = (o = {}) => ({ reportRef: ref, role: 'developer', kind: 'reply', findingId: FID, body: 'This finding is out of date: the filing was updated this month and the handover date is unchanged.', email: 'press@developer.test', ...o });
  const pub = async () => (await R('get', '/api/responses/:reportRef', { params: { reportRef: ref } })).body;

  console.log('submit and confirm');
  const bad = await R('post', '/api/responses', { body: reply({ body: 'short' }) }), nope = await R('post', '/api/responses', { body: reply({ reportRef: 'SK-ABCDEF012345' }) });
  ok('a message that is too short, or for a report that does not exist, is refused', bad.code === 400 && nope.code === 404);
  const s1 = await R('post', '/api/responses', { body: reply() });
  ok('a reply is accepted with a reference and a status key', s1.code === 200 && /^SKR-[A-Z0-9]{8}$/.test(s1.body.publicRef) && s1.body.statusKey);
  ok('a confirmation e-mail goes to the sender with a link back to the site', mails.length === 1 && mails[0].to[0] === 'press@developer.test' && /^https:\/\/shelterkart\.test\/\?sk_respond_confirm=[0-9a-f]+$/m.test(mails[0].text.split('\n').find(l => l.includes('sk_respond_confirm'))));
  ok('nothing is public until the e-mail is confirmed', (await pub()).counts.replies === 0);
  const c1 = await R('post', '/api/responses/confirm', { body: { token: tokenOf(lastMail()) } });
  ok('confirming a clean reply publishes it at once', c1.code === 200 && c1.body.state === 'published');
  const p1 = await pub();
  ok('it is public beside its finding, and no e-mail address is in the public data', p1.counts.replies === 1 && p1.replies[0].findingId === FID && !JSON.stringify(p1).includes('developer.test'));
  const st = await R('get', '/api/responses/status/:publicRef', { params: { publicRef: s1.body.publicRef }, query: { key: s1.body.statusKey } });
  const stBad = await R('get', '/api/responses/status/:publicRef', { params: { publicRef: s1.body.publicRef }, query: { key: 'wrong' } });
  ok('the sender can read the status with the key, and not without it', st.body.state === 'published' && stBad.code === 404);
  ok('a bad confirmation link does nothing', (await R('post', '/api/responses/confirm', { body: { token: 'f'.repeat(48) } })).code === 404);

  console.log('held, and a person decides');
  const s2 = await R('post', '/api/responses', { body: reply({ body: 'The reviewer who wrote this is a fraud and the finding is a lie told by them.', email: 'other@developer.test' }) });
  const c2 = await R('post', '/api/responses/confirm', { body: { token: tokenOf(lastMail()) } });
  ok('a flagged reply is held, not published', c2.body.state === 'held' && (await pub()).counts.replies === 1);
  ok('the held queue is for the admin only', (await R('get', '/api/admin/response-queue', { query: { status: 'held' } })).code === 401 && (await R('get', '/api/admin/response-queue', { query: { status: 'held' }, headers: ADMIN })).body.responses.length === 1);
  const held = (await R('get', '/api/admin/response-queue', { query: { status: 'held' }, headers: ADMIN })).body.responses[0];
  const approve = await R('post', '/api/admin/response-queue/:id/resolve', { params: { id: held.id }, body: { outcome: 'published' }, headers: ADMIN });
  ok('approving it publishes it and tells the sender', approve.body.ok && (await pub()).counts.replies === 2 && /published/.test(lastMail().subject));

  console.log('corrections');
  const s3 = await R('post', '/api/responses', { body: { reportRef: ref, role: 'reader', kind: 'error', findingId: FID, body: 'The date in this finding is wrong: the regulator page shows a later date.', evidenceUrls: ['https://maharerait.maharashtra.gov.in/p'], email: 'reader@example.com' } });
  const c3 = await R('post', '/api/responses/confirm', { body: { token: tokenOf(lastMail()) } });
  ok('an error report with evidence waits for the research check and is not public', s3.code === 200 && c3.body.state === 'in_review' && (await pub()).counts.corrections === 0);
  const noEv = await R('post', '/api/responses', { body: { reportRef: ref, role: 'reader', kind: 'error', findingId: FID, body: 'The date in this finding is wrong, trust me on this one please.', email: 'reader@example.com' } });
  ok('a change without evidence is refused', noEv.code === 400);
  const rv = (await R('get', '/api/admin/response-queue', { query: { status: 'in_review' }, headers: ADMIN })).body.responses[0];
  const fix = await R('post', '/api/admin/response-queue/:id/resolve', { params: { id: rv.id }, body: { outcome: 'corrected', note: 'The completion date now reads as the regulator\u2019s filing of this month shows.' }, headers: ADMIN });
  const p3 = await pub();
  ok('a correction with a note becomes public and dated, and the sender is told', fix.body.ok && p3.counts.corrections === 1 && /regulator/.test(p3.corrections[0].note) && lastMail().to[0] === 'reader@example.com');
  ok('it cannot be resolved twice', (await R('post', '/api/admin/response-queue/:id/resolve', { params: { id: rv.id }, body: { outcome: 'declined', note: 'x' }, headers: ADMIN })).code === 409);

  console.log('abuse');
  const before = mails.length, bot = await R('post', '/api/responses', { body: reply({ website: 'http://spam.test' }) });
  ok('a bot that fills the hidden field is accepted silently and nothing is sent', bot.code === 200 && mails.length === before);
  const leg = await R('post', '/api/responses', { body: { reportRef: ref, role: 'named', kind: 'legal', body: 'This is a legal notice concerning a statement made about us in this report.', email: 'counsel@developer.test' } });
  const cl = await R('post', '/api/responses/confirm', { body: { token: tokenOf(lastMail()) } });
  ok('a legal notice always goes to a person and is never published', leg.code === 200 && cl.body.state === 'held' && (await pub()).counts.replies === 2);
  ok('a developer cannot send a privacy removal request as a developer, and a reader cannot reply', (await R('post', '/api/responses', { body: reply({ kind: 'privacy' }) })).code === 400 && (await R('post', '/api/responses', { body: reply({ role: 'reader' }) })).code === 400);
})();
