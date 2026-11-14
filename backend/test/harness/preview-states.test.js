// Money and scale: the free preview's depth, the per-report AI cap, saved jobs that survive a restart (tested in a second
// process), the per-market daily cap, the daily spending stop, and the cost view. AI, Razorpay and e-mail are mocked.
const crypto = require('crypto'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const JOBS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-jobs-'));
const ENV = { ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN_SECRET: 'tok-secret', GSTIN: '27ABCDE1234F1Z5', PAYMENTS_ENABLED: 'true', BOT_GUARD: 'off',
  RAZORPAY_KEY_ID: 'rzp_test_id', RAZORPAY_KEY_SECRET: 'key_secret', LIVE_JOBS_DIR: JOBS_DIR, INVESTIGATE_MARKET_DAILY_CAP: '2',
  ADMIN_USERNAME: 'ops', ADMIN_PASSWORD: 'ops-pass-123', ANTHROPIC_RETRY_WAIT_MS: '1' };
Object.assign(process.env, ENV);
for (const k of ['DATABASE_URL', 'AI_ENGINES', 'ADVERSE_HOLD_MARKETS', 'AI_DAILY_MAX_USD', 'AI_CAP_SHARE', 'INVESTIGATE_PREVIEW_PANEL', 'PREVIEW_SEARCHES', 'PREVIEW_FETCHES']) delete process.env[k];
const SRC = 'https://www.aurumproptech.in/pulse/rera/maharashtra/mumbai-city/example-project';
const regFor = name => /Gardens/.test(name) ? 'GBSHARED0001' : 'P519' + crypto.createHash('md5').update(name).digest('hex').slice(0, 8).toUpperCase();
const sweepFor = name => ({ project: { name, location: 'Worli, Mumbai', brand: 'Example', promoter_legal_name: 'Example Realty Private Limited', registration_ids: [regFor(name)] },
  facts: [{ area: 'identity', field: 'registered promoter', value: 'Example Realty Private Limited', claim: 'The record names Example Realty Private Limited as promoter.', sources: [SRC] }],
  listings: [{ label: '2 BHK', price: 21000000, currency: 'INR', area_sqft: 700, source: SRC }],
  questions: [{ question: 'Please share the registered agreement for sale.', why: 'It matters.', to: 'legal team', when: 'before signing', good: 'The document.', not_accepted: 'A verbal answer.' }],
  leads: [{ kind: 'company', value: 'Example Realty Private Limited', why: 'the seller' }] });
const tools = []; let orderN = 0, aiCalls = 0, aiDown = false, aiDelay = 0;
globalThis.fetch = async (url, o) => {
  const mk = (c, status = 200) => ({ ok: status < 400, status, json: async () => c });
  if (url === 'https://api.razorpay.com/v1/orders') { const q = JSON.parse(o.body); return mk({ id: 'order_S' + (++orderN), amount: q.amount, currency: q.currency }); }
  aiCalls++; if (aiDelay) await new Promise(r => setTimeout(r, aiDelay)); if (aiDown) return mk({ error: 'down' }, 500);
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


const PS = require('../../engine/previewStates');
const ADMIN = { authorization: 'Basic ' + Buffer.from('ops:ops-pass-123').toString('base64') };
const adminStatus = async () => (await call(find('get', '/api/admin/delivery'), { headers: ADMIN })).body.freePreview;
const eventsOf = async ref => (await call(find('get', '/api/investigate/:ref/events'), { params: { ref } })).text || '';
const isMidnight = iso => /T00:00:00\.000Z$/.test(iso) && Date.parse(iso) > Date.now() && Date.parse(iso) - Date.now() <= 24 * 3600 * 1000;
const isSoon = (iso, minutes) => Date.parse(iso) > Date.now() && Date.parse(iso) - Date.now() <= minutes * 60000 + 1500;

(async () => {
  const start = find('post', '/api/investigate'), go = (name, country, loc = 'Somewhere') => call(start, { body: { query: name, location: loc, country } });
  console.log('a preview that is working says so');
  aiDelay = 150;
  const w = await go('Working Tower Residency', 'IN', 'Worli, Mumbai');
  const early = await call(find('get', '/api/report/:ref'), { params: { ref: w.body.ref } });
  ok('while the first sweep runs the report call answers 202 with state working', w.code === 202 && early.code === 202 && early.body.state === 'working' && early.body.ready === false);
  aiDelay = 0;
  await until(() => { const s = saved(w.body.ref); return s && s.status === 'preview' ? s : null; });

  console.log('refusals carry a reason');
  const s0 = await adminStatus();
  const second = await go('Second Tower Residency', 'IN', 'Worli, Mumbai'); await until(() => { const s = saved(second.body.ref); return s && s.status === 'preview'; });
  const callsBefore = aiCalls;
  const m = await go('Third Tower Residency', 'IN', 'Worli, Mumbai');
  ok('a market at its share of the day: 503, code paused (unchanged), reason market_cap, retry at the next UTC midnight', m.code === 503 && m.body.code === 'paused' && m.body.reason === 'market_cap' && isMidnight(m.body.retryAt) && /this market/.test(m.body.error) && m.body.ok === false);
  process.env.INVESTIGATE_DAILY_CAP = '2';
  const d = await go('Fourth Tower Residency', 'GB', 'Sutton, London');
  ok('the day’s count reached: reason daily_cap, retry at the next UTC midnight', d.code === 503 && d.body.code === 'paused' && d.body.reason === 'daily_cap' && isMidnight(d.body.retryAt) && d.body.error === PS.PAUSED_TODAY);
  process.env.INVESTIGATE_DAILY_CAP = '0';
  const z = await go('Fifth Tower Residency', 'GB', 'Sutton, London');
  ok('a daily cap of 0 is an operator pause: reason paused, no retry time', z.code === 503 && z.body.reason === 'paused' && !('retryAt' in z.body) && z.body.error === PS.PAUSED_TODAY);
  delete process.env.INVESTIGATE_DAILY_CAP;
  process.env.AI_DAILY_MAX_USD = '0.0001';
  const b = await go('Sixth Tower Residency', 'AE', 'Dubai Creek Harbour');
  delete process.env.AI_DAILY_MAX_USD;
  ok('the dollar ceiling reached: reason daily_budget, retry at the next UTC midnight', b.code === 503 && b.body.code === 'paused' && b.body.reason === 'daily_budget' && isMidnight(b.body.retryAt));
  process.env.RESEARCH_PAUSED = 'true';
  const p = await go('Seventh Tower Residency', 'AE', 'Dubai Creek Harbour');
  delete process.env.RESEARCH_PAUSED;
  ok('an operator pause: reason paused, the operator’s own sentence, no retry time', p.code === 503 && p.body.reason === 'paused' && /^New research is paused/.test(p.body.error) && !('retryAt' in p.body));
  ok('none of the refusals asked the AI anything', aiCalls === callsBefore);
  const reused = await go('Second Tower Residency', 'IN', 'Worli, Mumbai');
  ok('a project already investigated is still served, and is not counted as a refusal', reused.code === 200 && reused.body.reused === true);
  const s1 = await adminStatus();
  const delta = k => (s1.refused[k] || 0) - ((s0.refused || {})[k] || 0);
  ok('the operator status counts each refusal by reason and the new starts', delta('market_cap') === 1 && delta('daily_cap') === 1 && delta('paused') === 2 && delta('daily_budget') === 1 && s1.started - s0.started === 1 && /^\d{4}-\d\d-\d\d$/.test(s1.day));

  console.log('busy');
  process.env.INVESTIGATE_CONCURRENCY = '1'; aiDelay = 400;
  const r1 = await go('Busy One Residency', 'SG', 'Marina'), r2 = await go('Busy Two Residency', 'FR', 'Paris'), r3 = await go('Busy Three Residency', 'DE', 'Berlin');
  ok('too many running at once: 429, code busy, reason busy, retry in minutes', r1.code === 202 && r2.code === 202 && r3.code === 429 && r3.body.code === 'busy' && r3.body.reason === 'busy' && isSoon(r3.body.retryAt, 3));
  delete process.env.INVESTIGATE_CONCURRENCY; aiDelay = 0;
  await until(() => [r1, r2].every(r => { const s = saved(r.body.ref); return s && s.status === 'preview'; }), 400);

  console.log('a failed preview is shown as failed');
  aiDown = true;
  const f = await go('Failing Tower Residency', 'CA', 'Toronto');
  const failed = await until(() => { const s = saved(f.body.ref); return s && s.status === 'failed' ? s : null; });
  ok('the sweep fails and the job is saved as failed with its reason', f.code === 202 && Boolean(failed) && failed.failReason === 'engines_unavailable' && failed.previewFailedAt > 0);
  const view = await call(find('get', '/api/report/:ref'), { params: { ref: f.body.ref } });
  ok('the report call says unavailable with the reason, the sentence and a retry time, not "working" for ever', view.code === 200 && view.body.ok === true && view.body.ready === false && view.body.state === 'unavailable' && view.body.phase === 'failed' && view.body.reason === 'engines_unavailable' && /Nothing was charged/.test(view.body.error) && isSoon(view.body.retryAt, 5));
  const ev = await eventsOf(f.body.ref);
  ok('the progress stream’s error event carries the reason and the retry time', /event: error/.test(ev) && /"reason":"engines_unavailable"/.test(ev) && /"retryAt":"/.test(ev));
  const s2 = await adminStatus();
  ok('the failure is counted', s2.failed - s1.failed === 1);
  aiDown = false;
  const again = await go('Failing Tower Residency', 'CA', 'Toronto');
  ok('searching the same project again starts a new attempt, not the dead report', again.code === 202 && again.body.ref !== f.body.ref && again.body.reused !== true);
  const okNow = await until(() => { const s = saved(again.body.ref); return s && s.status === 'preview' ? s : null; });
  const view2 = await call(find('get', '/api/report/:ref'), { params: { ref: again.body.ref } });
  ok('and it works: the new attempt reaches a preview and the report call serves it', Boolean(okNow) && view2.code === 200 && view2.body.ready === true && view2.body.report);
  const old = await call(find('get', '/api/report/:ref'), { params: { ref: f.body.ref } });
  ok('the old failed reference still says unavailable', old.body.state === 'unavailable');
})();
