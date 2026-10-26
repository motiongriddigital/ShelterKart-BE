// Money and scale: the free preview's depth, the per-report AI cap, saved jobs that survive a restart (tested in a second
// process), the per-market daily cap, the daily spending stop, and the cost view. AI, Razorpay and e-mail are mocked.
const crypto = require('crypto'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const JOBS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-jobs-'));
const ENV = { ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN_SECRET: 'tok-secret', GSTIN: '27ABCDE1234F1Z5', PAYMENTS_ENABLED: 'true', BOT_GUARD: 'off',
  RAZORPAY_KEY_ID: 'rzp_test_id', RAZORPAY_KEY_SECRET: 'key_secret', LIVE_JOBS_DIR: JOBS_DIR, INVESTIGATE_MARKET_DAILY_CAP: '2',
  ADMIN_USERNAME: 'ops', ADMIN_PASSWORD: 'ops-pass-123' };
Object.assign(process.env, ENV);
for (const k of ['DATABASE_URL', 'AI_ENGINES', 'ADVERSE_HOLD_MARKETS', 'AI_DAILY_MAX_USD', 'AI_CAP_SHARE', 'INVESTIGATE_PREVIEW_PANEL', 'PREVIEW_SEARCHES', 'PREVIEW_FETCHES']) delete process.env[k];
const SRC = 'https://www.aurumproptech.in/pulse/rera/maharashtra/mumbai-city/example-project';
const regFor = name => /Gardens/.test(name) ? 'GBSHARED0001' : 'P519' + crypto.createHash('md5').update(name).digest('hex').slice(0, 8).toUpperCase();
const sweepFor = name => ({ project: { name, location: 'Worli, Mumbai', brand: 'Example', promoter_legal_name: 'Example Realty Private Limited', registration_ids: [regFor(name)] },
  facts: [{ area: 'identity', field: 'registered promoter', value: 'Example Realty Private Limited', claim: 'The record names Example Realty Private Limited as promoter.', sources: [SRC] }],
  listings: [{ label: '2 BHK', price: 21000000, currency: 'INR', area_sqft: 700, source: SRC }],
  questions: [{ question: 'Please share the registered agreement for sale.', why: 'It matters.', to: 'legal team', when: 'before signing', good: 'The document.', not_accepted: 'A verbal answer.' }],
  leads: [{ kind: 'company', value: 'Example Realty Private Limited', why: 'the seller' }] });
const tools = []; let orderN = 0;
globalThis.fetch = async (url, o) => {
  const mk = (c, status = 200) => ({ ok: status < 400, status, json: async () => c });
  if (url === 'https://api.razorpay.com/v1/orders') { const q = JSON.parse(o.body); return mk({ id: 'order_S' + (++orderN), amount: q.amount, currency: q.currency }); }
  const b = JSON.parse(o.body), prompt = JSON.stringify(b.messages), usage = { input_tokens: 50000, output_tokens: 2000 };
  if (b.tools) {
    tools.push({ lead: /Lead: /.test(prompt), tools: b.tools });
    const name = (prompt.match(/"([A-Z][A-Za-z ]+ Residency)"/) || prompt.match(/([A-Z][a-z]+ [A-Z][a-z]+ Residency)/) || [])[1] || 'Example Residency';
    const text = /Lead: /.test(prompt) ? JSON.stringify({ facts: [{ area: 'money', claim: 'A lead round found open charges on the seller.', sources: ['https://example-data.com/charges'] }] }) : JSON.stringify(sweepFor(name));
    return mk({ stop_reason: 'end_turn', usage, content: [{ type: 'web_search_tool_result', content: [{ url: SRC, title: 'Record' }] }, { type: 'text', text }] });
  }
  return mk({ usage, content: [{ type: 'text', text: '{"questions":[],"leads":[]}' }] });
};
const app = require(path.join(__dirname, '..', '..', 'server.js'));
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route, { body = {}, params = {}, query = {}, headers = {} } = {}) { return new Promise(resolve => {
  const res = { code: 200, headers: {}, chunks: [], status(c) { this.code = c; return this; }, set(k, v) { if (typeof k === 'object') Object.assign(this.headers, k); else this.headers[k] = v; return this; },
    json(o) { resolve({ code: this.code, body: o }); }, send(t) { resolve({ code: this.code, text: String(t) }); }, write(c) { this.chunks.push(c); }, end() { resolve({ code: this.code, text: this.chunks.join('') }); }, flushHeaders() {} };
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const req = { body, params, query, ip: '6.6.6.' + Math.floor(Math.random() * 200), path: route.path, headers: h, get: k => h[k.toLowerCase()], on() {} };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const fn = hs[i++]; if (fn) fn(req, res, next); }; next();
}); }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, tries = 200) { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await wait(25); } return null; }
const saved = ref => { try { return JSON.parse(fs.readFileSync(path.join(JOBS_DIR, ref + '.json'), 'utf8')); } catch { return null; } };
let failures = 0; const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { fs.rmSync(JOBS_DIR, { recursive: true, force: true }); console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });

async function pay(ref, key) {
  await call(find('post', '/api/investigate/:ref/contact'), { params: { ref }, body: { email: 'buyer@example.com' } });
  const q = await call(find('post', '/api/research/quote'), { body: { ref, country: 'IN' } });
  const co = await call(find('post', '/api/research/checkout'), { body: { ref, idempotencyKey: key, quoteId: q.body.quote.id, billingCountry: 'IN' } });
  const pid = 'pay_' + key.replace(/[^A-Za-z0-9]/g, '');            // a well-formed Razorpay payment id
  const sig = crypto.createHmac('sha256', 'key_secret').update(co.body.razorpay.orderId + '|' + pid).digest('hex');
  return call(find('post', '/api/research/razorpay/verify'), { body: { ref, purchaseId: co.body.purchaseId, razorpay_payment_id: pid, razorpay_signature: sig } });
}

(async () => {
  const start = find('post', '/api/investigate');
  // 1. The free preview is shallow by default
  const a = await call(start, { body: { query: 'Alpha Bay Residency', location: 'Worli, Mumbai', country: 'IN' } });
  const ra = a.body.ref;
  const sa = await until(() => { const s = saved(ra); return s && s.status === 'preview' ? s : null; });
  const sweepTools = (tools.find(t => !t.lead) || { tools: [] }).tools, uses = sweepTools.map(t => t.max_uses).filter(x => x != null);
  ok('the free preview searches 6 times and reads at most 2 pages by default', uses.includes(6) && uses.includes(2) && !uses.includes(25) && !uses.includes(12));
  ok('the finished preview is saved to disk with its state and its cost', Boolean(sa) && sa.saved && sa.saved.swept === true && sa.costUsd > 0);

  // 2. The per-report cap: a tiny cap stops the paid work before any lead round; the normal cap lets it run
  process.env.AI_CAP_SHARE = '0.000001';
  const vA = await pay(ra, 'scale-test-capped-0001');
  const doneA = await until(() => { const s = saved(ra); return s && s.status === 'done' ? s : null; });
  ok('with a cap smaller than the preview already spent, the paid report completes without another round', vA.code === 200 && Boolean(doneA) && doneA.saved.state.round === 0 && doneA.capUsd > 0 && doneA.capUsd < 0.01);
  delete process.env.AI_CAP_SHARE;
  const b = await call(start, { body: { query: 'Beta Park Residency', location: 'Worli, Mumbai', country: 'IN' } });
  const rb = b.body.ref;
  await until(() => { const s = saved(rb); return s && s.status === 'preview'; });
  await pay(rb, 'scale-test-normal-0002');
  const doneB = await until(() => { const s = saved(rb); return s && s.status === 'done' ? s : null; });
  ok('at the normal 30% cap the paid report follows its leads, and stays under the cap', Boolean(doneB) && doneB.saved.state.round >= 1 && doneB.capUsd > 0.5 && doneB.costUsd <= doneB.capUsd + 1);

  // 3. One market cannot use the whole day
  const c = await call(start, { body: { query: 'Gamma Court Residency', location: 'Worli, Mumbai', country: 'IN' } });
  ok('a third new project in the same market today is paused (market cap 2)', c.code === 503 && c.body.code === 'paused' && /this market/.test(c.body.error));
  const g = await call(start, { body: { query: 'Delta Gardens Residency', location: 'Sutton, London', country: 'GB' } });
  ok('another market is still open', g.code === 202);

  // 4. The daily spending stop
  process.env.AI_DAILY_MAX_USD = '0.0001';
  const x = await call(start, { body: { query: 'Epsilon Tower Residency', location: 'Dubai Creek Harbour', country: 'AE' } });
  ok('once today\u2019s AI spend passes AI_DAILY_MAX_USD, new free previews pause', x.code === 503 && x.body.code === 'paused');
  ok('a project already investigated is still served', (await call(start, { body: { query: 'Alpha Bay Residency', location: 'Worli, Mumbai', country: 'IN' } })).body.reused === true);
  delete process.env.AI_DAILY_MAX_USD;

  // 4b. One project, many names: the reuse key ignores word order, case, punctuation and filler words, and a finished
  //     report is reused for a later buyer of the same registered project at no new AI cost.
  const KEY = require(path.join(__dirname, '..', '..', 'engine', 'dossierBrief')).keyOf;
  ok('the same project typed differently gives the same reuse key; another country does not', KEY('Hubtown Celeste', 'Worli, Mumbai', 'IN') === KEY('celeste by  HUBTOWN', 'mumbai worli', 'in') && KEY('Hubtown Celeste', '', 'IN') !== KEY('Hubtown Celeste', '', 'GB'));
  const rg = g.body.ref;
  await until(() => { const s = saved(rg); return s && s.status === 'preview'; });
  await pay(rg, 'scaletwinfirst0003');
  await until(() => { const s = saved(rg); return s && s.status === 'done'; });
  const z = await call(start, { body: { query: 'Zeta Gardens Residency', location: 'Sutton, London', country: 'GB' } });
  const rz = z.body.ref;
  await until(() => { const s = saved(rz); return s && s.status === 'preview'; });
  const leadsBefore = tools.filter(t => t.lead).length;
  await pay(rz, 'scaletwinsecond0004');
  const dz = await until(() => { const s = saved(rz); return s && s.status === 'done' ? s : null; });
  ok('a second buyer of the same registered project gets the finished report with no new research', Boolean(dz) && dz.saved.dossier.reusedFrom === rg && tools.filter(t => t.lead).length === leadsBefore);
  const zPage = await call(find('get', '/r/:ref'), { params: { ref: rz } });
  ok('that buyer\u2019s report page works under their own reference', zPage.code === 200);

  // 5. The cost view
  const auth = { authorization: 'Basic ' + Buffer.from('ops:ops-pass-123').toString('base64') };
  const costs = await call(find('get', '/api/admin/costs'), { headers: auth });
  ok('the cost view shows today\u2019s spend by market, each report\u2019s cost and cap, and the preview settings', costs.code === 200 && costs.body.today.usd > 0 && costs.body.today.byMarket.IN > 0
    && costs.body.reports.some(r => r.ref === rb && r.costUsd > 0 && r.capUsd > 0) && costs.body.limits.preview.searches === 6 && costs.body.perPaidReport > 0);
  ok('the cost view is admin only', (await call(find('get', '/api/admin/costs'))).code === 401);

  // 6. A real restart, in a second process with the same saved jobs: a paid report left mid-way resumes without
  //    paying for its sweep again, and a finished preview is reused without any new AI call.
  const mid = JSON.parse(JSON.stringify(saved(ra))); const midRef = 'SK-ABCDEF012345';
  Object.assign(mid, { ref: midRef, status: 'completing', paid: true, capUsd: 50, key: null });
  mid.saved.state.round = 0; mid.saved.state.project.ids = ['P519RESUME01']; mid.saved.dossier.project.ids = ['P519RESUME01'];   // its own registered project, so it resumes rather than reusing
  fs.writeFileSync(path.join(JOBS_DIR, midRef + '.json'), JSON.stringify(mid));
  const child = `
    const path = require('path'); Object.assign(process.env, ${JSON.stringify(ENV)}); for (const k of ['DATABASE_URL','AI_ENGINES','AI_DAILY_MAX_USD']) delete process.env[k];
    const calls = { sweep: 0, lead: 0 };
    globalThis.fetch = async (url, o) => { const b = JSON.parse(o.body), p = JSON.stringify(b.messages);
      if (b.tools) { if (/Lead: /.test(p)) calls.lead++; else calls.sweep++; }
      return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 }, content: [{ type: 'text', text: '{"facts":[],"questions":[],"leads":[]}' }] }) }; };
    const app = require(${JSON.stringify(path.join(__dirname, '..', '..', 'server.js'))});
    const fs = require('fs'); const file = path.join(${JSON.stringify(JOBS_DIR)}, '${midRef}.json');
    const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
    const call = (route, body) => new Promise(resolve => { const res = { code: 200, status(c) { this.code = c; return this; }, set() { return this; }, json(o) { resolve({ code: this.code, body: o }); } };
      const req = { body, params: {}, query: {}, ip: '7.7.7.7', path: route.path, headers: {}, get: () => undefined, on() {} }; let i = 0; const next = () => { const fn = route.handlers[i++]; if (fn) fn(req, res, next); }; next(); });
    (async () => {
      let done = null; for (let i = 0; i < 200 && !done; i++) { await new Promise(r => setTimeout(r, 25)); const s = JSON.parse(fs.readFileSync(file, 'utf8')); if (s.status === 'done') done = s; }
      const page = await new Promise(resolve => { const route = find('get', '/r/:ref'); const res = { code: 200, status(c) { this.code = c; return this; }, set() { return this; }, send(t) { resolve({ code: this.code, text: String(t) }); }, json(o) { resolve({ code: this.code, text: JSON.stringify(o) }); } };
        const req = { body: {}, params: { ref: ${JSON.stringify(ra)} }, query: {}, ip: '7.7.7.8', path: route.path, headers: {}, get: () => undefined, on() {} }; let i = 0; const next = () => { const fn = route.handlers[i++]; if (fn) fn(req, res, next); }; next(); });
      const before = calls.sweep;
      const reuse = await call(find('post', '/api/investigate'), { query: 'Alpha Bay Residency', location: 'Worli, Mumbai', country: 'IN' });
      console.log(JSON.stringify({ pageCode: page.code, pageHasName: /Alpha Bay/.test(page.text), resumed: Boolean(done), sweepCalls: before, leadCalls: calls.lead, reused: reuse.body.reused === true, reusedRef: reuse.body.ref, newSweep: calls.sweep - before }));
      process.exit(0);
    })();`;
  const out = cp.spawnSync('node', ['-r', path.join(__dirname, 'stub-loader.js'), '-e', child], { encoding: 'utf8', timeout: 60000, cwd: path.join(__dirname, '..', '..') });
  const line = (out.stdout.trim().split('\n').filter(l => l.startsWith('{')).pop()) || '{}'; const r = JSON.parse(line);
  ok('after a restart, a paid report left mid-way resumes and finishes without paying for its sweep again', r.resumed === true && r.sweepCalls === 0 && r.leadCalls >= 1);
  ok('after a restart, a finished preview is reused for 30 days with no new AI call', r.reused === true && r.reusedRef === ra && r.newSweep === 0);
  ok('after a restart without a database, a buyer\u2019s report link still opens', r.pageCode === 200 && r.pageHasName === true);
  if (!r.resumed) console.log(out.stdout.slice(-400), out.stderr.slice(-600));
  process.exit(failures ? 1 : 0);
})();
