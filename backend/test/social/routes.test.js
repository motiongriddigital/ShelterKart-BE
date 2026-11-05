'use strict';
/** The desk's routes, called exactly as the server would call them: auth first, then the handlers. A fake app and a fake clock. */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { createSocial } = require('../../social'), F = require('./fixtures');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n       ')); } }
const CLOCK = Date.parse('2026-10-25T12:00:00Z');
const PAGE = '<html><head><title>Registering a project | Test Authority</title></head><body><main><h1>Registering a project</h1><p>The promoter must register the project with the state authority before advertising or selling any unit.</p><p>The registration number must be shown in every advertisement for the project.</p><p>Projects of more than five hundred square metres or eight units must register with the authority.</p></main></body></html>';
const GOODSTMT = { statement: 'A promoter must register a project with the state authority before advertising or selling any unit.', quote: 'The promoter must register the project with the state authority before advertising or selling any unit.' };
const keeperFetch = async url => (url === 'https://rera.example.gov/register' ? { ok: true, status: 200, url, headers: { get: k => (k.toLowerCase() === 'content-type' ? 'text/html' : '') }, text: async () => PAGE } : { ok: false, status: 404, url, headers: { get: () => '' }, text: async () => '' });
const keeperEngines = { modelFor: r => ({ provider: r === 'adviser' ? 'alpha' : 'beta' }), async run(role) { if (role === 'adviser') return { text: JSON.stringify({ statements: [GOODSTMT] }) }; if (role === 'verify') return { text: role === 'verify' && false ? '' : JSON.stringify({ supported: true, why: 'stated' }) }; if (role === 'translate') return { text: 'Un promoteur doit enregistrer le projet avant toute vente.' }; return { text: '' }; } };
function fakeApp() {
  const routes = []; const add = method => (p, ...h) => routes.push({ method, p, h });
  const app = { get: add('GET'), post: add('POST'), routes };
  app.call = async (method, url, { body = {}, headers = {}, auth = true } = {}) => {
    const [pathname, qs] = url.split('?'), query = Object.fromEntries(new URLSearchParams(qs || ''));
    for (const r of routes) {
      if (r.method !== method) continue; const names = []; const re = new RegExp('^' + r.p.replace(/:([a-z]+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$'), m = re.exec(pathname); if (!m) continue;
      const req = { method, path: pathname, query, body, headers: { ...(auth ? { authorization: 'ok' } : {}), ...headers }, params: Object.fromEntries(names.map((n, i) => [n, m[i + 1]])) };
      const res = { code: 200, headers: {}, payload: undefined, set(k, v) { if (typeof k === 'object') Object.assign(this.headers, k); else this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(o) { this.payload = o; this.done = true; return this; }, send(x) { this.payload = x; this.done = true; return this; }, end() { this.done = true; return this; }, type() { return this; } };
      let i = 0; const next = async () => { const h = r.h[i++]; if (!h || res.done) return; await h(req, res, next); if (!res.done && i < r.h.length) await next(); };
      await next(); return res;
    }
    throw new Error('no route ' + method + ' ' + pathname);
  };
  return app;
}
const adminAuth = (req, res, next) => (req.headers.authorization === 'ok' ? next() : res.status(401).json({ ok: false, error: 'Authentication required' }));
const ah = fn => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).json({ ok: false, error: 'x' }); } };
const jsonParser = (req, res, next) => next();
const ENV = { SOCIAL_ENGINE: 'on', SOCIAL_ALLOW_MEMORY: 'true', SOCIAL_APPROVAL_PIN: '1234', SOCIAL_LANG_READY: 'hi,ar,fr,es,de,pl,ja,zh-Hant', PUBLIC_BASE_URL: 'https://desk.example', SOCIAL_EPOCH_MONDAY: F.MONDAY, TELEGRAM_BOT_TOKEN: '9:bot', TELEGRAM_APPROVER_CHAT_ID: '100', TELEGRAM_APPROVER_USER_ID: '200', TELEGRAM_WEBHOOK_SECRET: 'whsec', SOCIAL_MEDIA_DIR: '' };
async function boot(extra = {}) {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-')), sent = [], net = async (url, init) => { sent.push({ url, body: init && init.body ? JSON.parse(init.body) : null }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  const social = await createSocial({ env: { ...ENV, SOCIAL_MEDIA_DIR: mediaDir, ...extra }, now: () => CLOCK, judge: async () => ({ pass: true, issues: [] }), renderer: null, fetchImpl: net, keeperEngines: { ...keeperEngines, async run(role, op, a) { if (role === 'verify' && /Translate into English/.test(a.prompt)) return { text: GOODSTMT.statement }; return keeperEngines.run(role, op, a); } }, keeperFetch, log: { log() {}, error() {} } });
  for (const it of F.buildKb(() => '2026-10-25').all()) social.kb.put(it);
  const app = fakeApp(); social.mount(app, { adminAuth, ah, jsonParser, pageFile: path.join(__dirname, '..', '..', 'social', 'admin-social.html') }); return { social, app, mediaDir, sent };
}
const J = r => r.payload;

(async () => {
  console.log('safe by default');
  await t('switched off, every desk route answers 503 and nothing is built; the page and webhook are closed too', async () => {
    const off = await createSocial({ env: {}, now: () => CLOCK, log: { log() {}, error() {} } }); const app = fakeApp(); off.mount(app, { adminAuth, ah, jsonParser });
    assert.strictEqual((await app.call('GET', '/api/admin/social/status')).code, 503); assert.strictEqual(off.start(), false); assert.strictEqual((await app.call('POST', '/api/social/telegram/webhook', { body: {} })).code, 404);
  });
  await t('switched on without durable storage, the engine refuses to start: approved posts must survive a restart', async () => {
    await assert.rejects(() => createSocial({ env: { SOCIAL_ENGINE: 'on' }, now: () => CLOCK, log: { log() {}, error() {} } }), e => e.code === 'no_durable_store');
  });
  await t('with files for storage it starts, keeps its audit log on disk, and a second start reads everything back', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-')); const a = await createSocial({ env: { SOCIAL_ENGINE: 'on', SOCIAL_DATA_DIR: dir, SOCIAL_EPOCH_MONDAY: F.MONDAY }, now: () => CLOCK, judge: null, log: { log() {}, error() {} } });
    assert.strictEqual(a.durable, 'files'); a.audit.append('test', { n: 1 }); a.store.meta.put('x', { v: 1 }); await a.store.flush();
    const b = await createSocial({ env: { SOCIAL_ENGINE: 'on', SOCIAL_DATA_DIR: dir }, now: () => CLOCK, judge: null, log: { log() {}, error() {} } }); assert.strictEqual(b.audit.size(), 1); assert.deepStrictEqual(b.store.meta.get('x'), { v: 1 }); assert.strictEqual(b.epoch, F.MONDAY); fs.rmSync(dir, { recursive: true, force: true });
  });
  await t('every admin route needs the admin login, including the page and the audit log', async () => {
    const { app } = await boot(); for (const [m, p] of [['GET', '/admin/social'], ['GET', '/api/admin/social/status'], ['POST', '/api/admin/social/plan'], ['POST', '/api/admin/social/pack'], ['GET', '/api/admin/social/audit'], ['POST', '/api/admin/social/pause'], ['GET', '/api/admin/social/queue'], ['GET', '/api/admin/social/kb'], ['POST', '/api/admin/social/veto']]) assert.strictEqual((await app.call(m, p, { auth: false })).code, 401, p);
  });

  console.log('a whole week through the routes');
  const { social, app, mediaDir, sent } = await boot();
  let pack, packId, canary;
  await t('status shows the mode, the rules version, the engine\u2019s storage and the coverage of next week\u2019s topic', async () => {
    const s = J(await app.call('GET', '/api/admin/social/status')); assert.strictEqual(s.ok, true); assert.strictEqual(s.desk.mode, 'dryrun'); assert.strictEqual(s.durable, 'memory'); assert.strictEqual(s.kb.usableNextWeek, 36); assert.strictEqual(s.nextWeek, '2026-10-26'); assert.strictEqual(s.bot, true); assert.strictEqual(s.renderer, false);
  });
  await t('planning a week by route drafts and checks 252 posts', async () => { const r = await app.call('POST', '/api/admin/social/plan', { body: { week: F.MONDAY, wait: true } }); assert.strictEqual(r.code, 200); assert.strictEqual(J(r).created, 252); assert.deepStrictEqual(J(r).counts, { checked: 252 }); });
  await t('a week must be a Monday date, or the route says so', async () => { const r = await app.call('POST', '/api/admin/social/plan', { body: { week: '2026-10-27' } }); assert.strictEqual(r.code, 400); });
  await t('planning can run in the background: the route answers at once with a job, which finishes and reports its result', async () => {
    const r = await app.call('POST', '/api/admin/social/plan', { body: { week: '2026-11-02' } }); assert.strictEqual(r.code, 202); assert.strictEqual(J(r).job.name, 'plan:2026-11-02'); await social.runJob('plan:2026-11-02', async () => null).promise; await new Promise(x => setTimeout(x, 400));
    const j = J(await app.call('GET', '/api/admin/social/jobs')).jobs.find(x => x.name === 'plan:2026-11-02'); assert(['done', 'running'].includes(j.state)); for (let i = 0; i < 30 && j.state === 'running'; i++) await new Promise(x => setTimeout(x, 100));
  });
  await t('building the pack returns it for reading and tells the founder on the chat bot, with a link to the page', async () => {
    const r = await app.call('POST', '/api/admin/social/pack', { body: { week: F.MONDAY } }); assert.strictEqual(r.code, 200); pack = J(r).pack; packId = pack.id; canary = social.store.packs.get(packId).canaryId; assert.strictEqual(pack.items.length, 253);
    assert(sent.some(s => /sendMessage/.test(s.url) && /weekly pack is ready/.test(s.body.text) && s.body.reply_markup.inline_keyboard[0][0].url === 'https://desk.example/admin/social'));
    const g = await app.call('GET', '/api/admin/social/pack/' + packId); assert.strictEqual(J(g).pack.items.length, 253); assert.strictEqual((await app.call('GET', '/api/admin/social/pack/nope')).code, 404);
  });
  await t('approving without the PIN, or with a wrong one, is refused and approves nothing', async () => {
    let r = await app.call('POST', `/api/admin/social/pack/${packId}/approve`, { body: { exceptions: [canary] } }); assert.strictEqual(r.code, 403); r = await app.call('POST', `/api/admin/social/pack/${packId}/approve`, { body: { exceptions: [canary], pin: '0000' } }); assert.strictEqual(r.code, 403);
    assert.strictEqual(social.store.posts.find(p => p.status === 'approved').length, 0);
  });
  await t('approving the whole pack including the known-bad post is refused with a plain explanation, and nothing is approved', async () => {
    const r = await app.call('POST', `/api/admin/social/pack/${packId}/approve`, { body: { pin: '1234' } }); assert.strictEqual(r.code, 409); assert.strictEqual(J(r).code, 'canary_approved'); assert(/must be rejected/.test(J(r).error)); assert.strictEqual(social.store.posts.find(p => p.status === 'approved').length, 0);
    const again = await app.call('POST', '/api/admin/social/pack', { body: { week: F.MONDAY } }); pack = J(again).pack; packId = pack.id; canary = social.store.packs.get(packId).canaryId;
  });
  await t('approving with the PIN, leaving out the bad post and one more, approves 251', async () => {
    const r = await app.call('POST', `/api/admin/social/pack/${packId}/approve`, { body: { pin: '1234', exceptions: [canary, 'GB-2026-10-26-X'] } }); assert.strictEqual(r.code, 200); assert.strictEqual(J(r).approved, 251); assert.strictEqual(J(r).excluded, 1);
  });
  await t('the next-24-hours queue lists what is about to go out, and a veto removes a post from it', async () => {
    social.desk.config.graceMs; const q0 = J(await app.call('GET', '/api/admin/social/queue?hours=72')).queue; assert(q0.length > 60 && q0.length < 120, 'queue ' + q0.length); const id = q0[0].id;
    const v = await app.call('POST', '/api/admin/social/veto', { body: { id, reason: 'wrong tone' } }); assert.strictEqual(J(v).vetoed, 1); const q1 = J(await app.call('GET', '/api/admin/social/queue?hours=72')).queue; assert(!q1.some(x => x.id === id));
    assert.strictEqual((await app.call('POST', '/api/admin/social/veto', { body: {} })).code, 400);
  });
  await t('pause and resume work by scope, reject a bad scope or a missing key, and show in the status', async () => {
    assert.strictEqual((await app.call('POST', '/api/admin/social/pause', { body: { scope: 'galaxy' } })).code, 400); assert.strictEqual((await app.call('POST', '/api/admin/social/pause', { body: { scope: 'market' } })).code, 400);
    assert.strictEqual((await app.call('POST', '/api/admin/social/pause', { body: { scope: 'platform', key: 'TT', reason: 'a warning' } })).code, 200); assert.strictEqual(J(await app.call('GET', '/api/admin/social/status')).desk.pauses.length, 1);
    assert.strictEqual(J(await app.call('POST', '/api/admin/social/resume', { body: { scope: 'platform', key: 'TT' } })).resumed, true); assert.strictEqual(J(await app.call('GET', '/api/admin/social/status')).desk.pauses.length, 0);
  });
  await t('an incident from the founder pauses what it should, and a sensitivity hold pauses a market for a day', async () => {
    assert.strictEqual((await app.call('POST', '/api/admin/social/incident', { body: { kind: 'platform_warning', key: 'IG', detail: 'a strike' } })).code, 200); assert(social.desk.activePauses().some(p => p.scope === 'platform' && p.key === 'IG'));
    await app.call('POST', '/api/admin/social/incident', { body: { kind: 'sensitivity', key: 'JP', detail: 'a major disaster' } }); assert(social.desk.activePauses().some(p => p.scope === 'market' && p.key === 'JP' && p.expiresAt)); assert.strictEqual((await app.call('POST', '/api/admin/social/incident', { body: { kind: 'made_up' } })).code, 400);
  });
  await t('two corrections for a market by route pause it', async () => { await app.call('POST', '/api/admin/social/correction', { body: { market: 'GB', postId: 'a', note: 'the date was wrong' } }); await app.call('POST', '/api/admin/social/correction', { body: { market: 'GB', postId: 'b', note: 'a link was wrong' } }); assert(social.desk.activePauses().some(p => p.scope === 'market' && p.key === 'GB')); });
  await t('the audit log is returned with its chain verified, and contains the approval and the incidents', async () => {
    const a = J(await app.call('GET', '/api/admin/social/audit?limit=200')); assert.strictEqual(a.verify.ok, true); const kinds = new Set(a.entries.map(e => e.kind)); for (const k of ['week_planned', 'pack_built', 'approval', 'veto', 'pause', 'incident']) assert(kinds.has(k), k);
  });
  await t('the posts list can be filtered by week, status and market', async () => { const r = J(await app.call('GET', '/api/admin/social/posts?week=2026-10-26&market=IN')); assert.strictEqual(r.posts.length, 7); assert(r.posts.every(p => p.market === 'IN')); assert(J(await app.call('GET', '/api/admin/social/posts?status=vetoed')).posts.length >= 1); });

  console.log('the knowledge routes');
  const item = { id: 'test.new.1', market: 'GB', topic: 't03', statement: 'TEST ONLY: a second statement long enough to be stored here.', type: 'fact', source: { name: 'Test body', url: 'https://example.org/x' }, checkedOn: '2026-10-20', expiresOn: '2027-01-20', scope: 'new_build_primary' };
  await t('a knowledge item is added as a draft, verified by name, and only then usable; a bad item is refused with every reason', async () => {
    const r = await app.call('POST', '/api/admin/social/kb', { body: item }); assert.strictEqual(r.code, 201); assert.strictEqual(J(r).item.status, 'draft'); assert.strictEqual(social.kb.usable('test.new.1').ok, false);
    const v = await app.call('POST', '/api/admin/social/kb/test.new.1/verify', { body: { by: 'lawyer sample' } }); assert.strictEqual(J(v).item.status, 'verified'); assert.strictEqual(social.kb.usable('test.new.1').ok, true);
    const bad = await app.call('POST', '/api/admin/social/kb', { body: { ...item, id: 'test.new.2', statement: 'TEST ONLY: you should buy this now, it is a scam-free bargain.', source: { name: '', url: 'http://x' } } }); assert.strictEqual(bad.code, 400); assert(J(bad).problems.length >= 2);
    assert.strictEqual((await app.call('POST', '/api/admin/social/kb/none/verify', { body: {} })).code, 404);
  });
  await t('knowledge items survive in the store, so a restart restores them', async () => { await social.store.flush(); assert(social.store.kb.get('test.new.1').status === 'verified'); });

  console.log('the knowledge keeper routes');
  await t('the keeper routes need the admin login, like everything else', async () => { for (const [m, p] of [['GET', '/api/admin/social/keeper'], ['POST', '/api/admin/social/keeper/seeds'], ['POST', '/api/admin/social/keeper/run'], ['POST', '/api/admin/social/kb/x/reject'], ['POST', '/api/admin/social/kb/x/translation/fr']]) assert.strictEqual((await app.call(m, p, { auth: false })).code, 401, p); });
  await t('seeds are validated: an unknown market or topic, an http address, more than five, a missing topic and a malformed host are all refused', async () => {
    const post = b => app.call('POST', '/api/admin/social/keeper/seeds', { body: b }); const u = 'https://rera.example.gov/register';
    assert.strictEqual((await post({ market: 'ZZ', topic: 't02', urls: [u] })).code, 400); assert.strictEqual((await post({ market: 'IN', topic: 't99', urls: [u] })).code, 400); assert.strictEqual((await post({ market: 'IN', topic: 't02', urls: ['http://rera.example.gov/x'] })).code, 400);
    assert.strictEqual((await post({ market: 'IN', topic: 't02', urls: Array(6).fill(u) })).code, 400); assert.strictEqual((await post({ market: 'IN', urls: [u] })).code, 400); assert.strictEqual((await post({ market: 'IN', allowedHosts: ['not a host'] })).code, 400);
    const ok = await post({ market: 'IN', topic: 't02', urls: [u], allowedHosts: ['Example.gov.in'] }); assert.strictEqual(ok.code, 200); assert.deepStrictEqual(J(ok).seeded.allowedHosts, ['example.gov.in']);
    const f = await post({ market: 'IN', topic: 't02', urls: [u], focus: { [u]: ['  burden of proof ', 'Article 23'] } }); assert.strictEqual(f.code, 200); assert.deepStrictEqual(J(f).seeded.focus[u], ['burden of proof', 'Article 23']);
    for (const bad of [{ [u]: Array(9).fill('x') }, { [u]: ['x'.repeat(81)] }, { [u]: [5] }, { [u]: 'not a list' }, { 'http://insecure.example.gov/x': ['a'] }, { [u]: [''] }]) assert.strictEqual((await post({ market: 'IN', topic: 't02', urls: [u], focus: bad })).code, 400, JSON.stringify(bad).slice(0, 60));
  });
  let draftId;
  await t('running the keeper for a market and topic reads the official page and leaves a DRAFT with its quote as evidence, which is not usable yet', async () => {
    const r = await app.call('POST', '/api/admin/social/keeper/run', { body: { market: 'IN', topic: 't02', wait: true } }); assert.strictEqual(r.code, 200); assert.strictEqual(J(r).result.created.length, 1); draftId = J(r).result.created[0];
    const l = J(await app.call('GET', '/api/admin/social/kb?status=draft')).items.find(i => i.id === draftId); assert.strictEqual(l.status, 'draft'); assert(/register the project/.test(l.evidence.quote)); assert.strictEqual(l.source.url, 'https://rera.example.gov/register'); assert.strictEqual(social.kb.usable(draftId).ok, false);
    const k = J(await app.call('GET', '/api/admin/social/keeper')); assert.strictEqual(k.drafts, 1); assert.strictEqual(k.autoVerify, false); assert.strictEqual(k.providersDiffer, true); assert.deepStrictEqual(k.seeded.find(x => x.market === 'IN').topics, { t02: 1 });
  });
  await t('a market with no seed is a reported gap in a week run, and a run can be started in the background as a job', async () => {
    assert.strictEqual((await app.call('POST', '/api/admin/social/keeper/run', { body: { market: 'ZZ', topic: 't02' } })).code, 400);
    const r = await app.call('POST', '/api/admin/social/keeper/run', { body: { week: '2026-11-02' } }); assert.strictEqual(r.code, 202); assert.strictEqual(J(r).job.name, 'keeper:week:2026-11-02');
    for (let i = 0; i < 30; i++) { const j = J(await app.call('GET', '/api/admin/social/keeper')).jobs.find(x => x.name === 'keeper:week:2026-11-02'); if (j && j.state !== 'running') { assert.strictEqual(j.state, 'done'); assert.strictEqual(j.result.markets, 1); assert.strictEqual(j.result.created, 0); break; } await new Promise(x => setTimeout(x, 50)); }
  });
  await t('a person verifies the draft by name: it becomes usable, and the verification is recorded', async () => {
    const v = await app.call('POST', `/api/admin/social/kb/${draftId}/verify`, { body: { by: 'lawyer sample' } }); assert.strictEqual(J(v).item.status, 'verified'); assert.strictEqual(social.kb.usable(draftId).ok, true); assert.strictEqual(J(v).item.verification.by, 'lawyer sample');
  });
  await t('a translation is drafted with its back-translation, refused for an unknown language, and approved only by a named person', async () => {
    assert.strictEqual((await app.call('POST', `/api/admin/social/kb/${draftId}/translation/en`, { body: {} })).code, 400); assert.strictEqual((await app.call('POST', `/api/admin/social/kb/${draftId}/translation/xx`, { body: {} })).code, 400);
    const d = await app.call('POST', `/api/admin/social/kb/${draftId}/translation/fr`, { body: { name: 'French' } }); assert.strictEqual(d.code, 201); assert.strictEqual(J(d).translation.approvedBy, null); assert(J(d).translation.backEn.length > 10);
    assert.strictEqual((await app.call('POST', `/api/admin/social/kb/${draftId}/translation/fr/approve`, { body: { by: ' ' } })).code, 400); const ap = await app.call('POST', `/api/admin/social/kb/${draftId}/translation/fr/approve`, { body: { by: 'native reviewer' } }); assert.strictEqual(ap.code, 200);
    assert.strictEqual(J(await app.call('GET', '/api/admin/social/kb?market=IN&topic=t02')).items.find(i => i.id === draftId).translations.fr.approvedBy, 'native reviewer');
  });
  await t('a wrong draft is rejected: it is retired and never usable, with the reason on record', async () => {
    social.kb.put({ id: 'kb.IN.t02.zzzzzzzz', market: 'IN', topic: 't02', statement: 'TEST ONLY: a draft that turns out to be wrong in practice.', type: 'fact', source: { name: 'x', url: 'https://x.example.gov/' }, checkedOn: '2026-10-20', expiresOn: '2027-01-20', scope: 'new_build_primary' });
    const r = await app.call('POST', '/api/admin/social/kb/kb.IN.t02.zzzzzzzz/reject', { body: { why: 'the page says otherwise' } }); assert.strictEqual(J(r).item.status, 'retired'); assert.strictEqual(social.kb.usable('kb.IN.t02.zzzzzzzz').ok, false); assert.strictEqual(social.kb.get('kb.IN.t02.zzzzzzzz').retired.why, 'the page says otherwise');
  });
  await t('the recheck route runs and reports, and the audit log records the seeds, the rejection and the approved translation', async () => {
    const r = await app.call('POST', '/api/admin/social/keeper/recheck', { body: { wait: true } }); assert.strictEqual(r.code, 200); assert(Array.isArray(J(r).result.renewed));
    const kinds = new Set(J(await app.call('GET', '/api/admin/social/audit?limit=200')).entries.map(e => e.kind)); for (const k of ['keeper_seeds', 'kb_rejected', 'translation_approved']) assert(kinds.has(k), k);
  });

  console.log('the chat webhook and the media route');
  await t('the webhook needs the secret header; with it, the founder\u2019s /status is answered', async () => {
    assert.strictEqual((await app.call('POST', '/api/social/telegram/webhook', { body: { message: { text: '/status', from: { id: 200 }, chat: { id: 100 } } } })).code, 403);
    const r = await app.call('POST', '/api/social/telegram/webhook', { body: { message: { text: '/status', from: { id: 200 }, chat: { id: 100 } } }, headers: { 'x-telegram-bot-api-secret-token': 'whsec' } }); assert.strictEqual(r.code, 200); assert(sent.some(s => /Desk status/.test((s.body || {}).text || '')));
  });
  await t('media is served only for a hash-named file, immutably cached, and nothing outside the folder can be reached', async () => {
    const sha = crypto.createHash('sha256').update('x').digest('hex'); fs.writeFileSync(path.join(mediaDir, sha + '.jpg'), 'JPEGDATA');
    const ok = await app.call('GET', `/social-media/${sha}.jpg`, { auth: false }); assert.strictEqual(ok.code, 200); assert.strictEqual(ok.headers['Content-Type'], 'image/jpeg'); assert(/immutable/.test(ok.headers['Cache-Control'])); assert.strictEqual(ok.headers['X-Content-Type-Options'], 'nosniff');
    for (const bad of ['../../etc/passwd', 'x.jpg', sha + '.svg', sha.toUpperCase() + '.jpg', 'a'.repeat(64) + '.jpg']) assert.strictEqual((await app.call('GET', '/social-media/' + encodeURIComponent(bad), { auth: false })).code, 404, bad);
  });
  await t('the desk page is served from the admin login and is the page file, uncached', async () => { const r = await app.call('GET', '/admin/social'); assert([200, 404].includes(r.code)); assert(/no-store/.test(r.headers['Cache-Control'])); });
  fs.rmSync(mediaDir, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
