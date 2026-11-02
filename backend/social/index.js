'use strict';
/**
 * Wires the marketing desk into the server: builds it from the environment, mounts its routes, runs its minute loop.
 * SAFE BY DEFAULT: nothing runs unless SOCIAL_ENGINE=on, nothing posts for real unless SOCIAL_PUBLISH=live, the engine refuses to start
 * without durable storage (a database or SOCIAL_DATA_DIR) unless SOCIAL_ALLOW_MEMORY=true, and every admin route needs the admin login.
 */
const fs = require('fs'), path = require('path'), os = require('os');
const SCHED = require('./schedule'), M = require('./marketer'), C = require('./checker'), K = require('./kb');
const { makeStore, filePersist, pgPersist, memoryPersist } = require('./store'), { makeAudit } = require('./audit'), { makeDesk } = require('./desk');
const { makePublisher } = require('./publishers'), { makeBot } = require('./telegram'), { makeRenderer } = require('./render'), { makeKeeper } = require('./keeper');
const DAY = 864e5, WEEK_RE = /^\d{4}-\d{2}-\d{2}$/, FILE_RE = /^[a-f0-9]{64}\.(jpg|png)$/;
const isoDay = ms => new Date(ms).toISOString().slice(0, 10), list = s => String(s || '').split(/[,;]/).map(x => x.trim()).filter(Boolean);
const STATUS = { not_found: 404, pin_required: 403, pack_closed: 409, illegal_transition: 409, kb_invalid: 400 };

async function createSocial({ env = process.env, pool = null, fetchImpl = globalThis.fetch, now = () => Date.now(), judge, renderer, publisher, keeperEngines, keeperFetch, log = console } = {}) {
  const on = env.SOCIAL_ENGINE === 'on';
  const durable = pool && env.DATABASE_URL ? 'postgres' : env.SOCIAL_DATA_DIR ? 'files' : 'memory';
  if (on && durable === 'memory' && env.SOCIAL_ALLOW_MEMORY !== 'true') throw Object.assign(new Error('The marketing desk needs a database or SOCIAL_DATA_DIR: approved posts must survive a restart. Set SOCIAL_ALLOW_MEMORY=true only for a demo.'), { code: 'no_durable_store' });
  const persist = durable === 'postgres' ? pgPersist((sql, p) => pool.query(sql, p)) : durable === 'files' ? filePersist(env.SOCIAL_DATA_DIR) : memoryPersist();
  const store = makeStore({ persist, onError: e => log.error('[social] a store write failed: ' + e.message) }); await store.load();
  let audit;
  if (durable === 'postgres') {
    const rows = (await pool.query('SELECT seq, at, kind, data, prev, hash FROM social_audit ORDER BY seq')).rows.map(r => ({ seq: r.seq, at: new Date(r.at).toISOString(), kind: r.kind, data: r.data, prev: r.prev, hash: r.hash }));
    audit = makeAudit({ now, preload: rows, sink: e => pool.query('INSERT INTO social_audit (seq, at, kind, data, prev, hash) VALUES ($1,$2,$3,$4,$5,$6)', [e.seq, e.at, e.kind, JSON.stringify(e.data), e.prev, e.hash]) });
  } else audit = makeAudit({ now, file: env.SOCIAL_AUDIT_FILE || (env.SOCIAL_DATA_DIR ? path.join(env.SOCIAL_DATA_DIR, 'audit.jsonl') : null) });
  const topics = M.CURRICULUM.topics.map(t => t.id), markets = SCHED.WHEEL.markets.map(m => m.code);
  const kb = K.makeKb({ markets, topics, today: () => isoDay(now()), onChange: it => store.kb.put(it.id, it) }); kb.restore(store.kb.all());
  let engines = null; try { engines = require('../engines'); } catch {}
  const theJudge = judge !== undefined ? judge : (engines && engines.available('verify', env) ? C.makeLlmJudge({ engines, env, fetchImpl }) : null);
  const checker = C.makeChecker({ kb, audit, judge: theJudge });
  const pub = publisher || makePublisher({ env, fetchImpl });
  const mediaDir = env.SOCIAL_MEDIA_DIR || (env.SOCIAL_DATA_DIR ? path.join(env.SOCIAL_DATA_DIR, 'media') : path.join(os.tmpdir(), 'shelterkart-social-media'));
  const rend = renderer !== undefined ? renderer : makeRenderer({ dir: mediaDir, baseUrl: env.PUBLIC_BASE_URL || '' });
  const nextMonday = () => SCHED.mondayOf(isoDay(now() + 7 * DAY));
  const stored = store.meta.get('epoch'), epoch = (stored && stored.monday) || env.SOCIAL_EPOCH_MONDAY || nextMonday();
  if (!stored) store.meta.put('epoch', { monday: epoch });
  const baseHost = (() => { try { return new URL(env.PUBLIC_BASE_URL).hostname; } catch { return ''; } })();
  const botRef = { bot: null };
  const alert = async (subject, text) => { try { if (botRef.bot) await botRef.bot.notifyAlert(subject, text); } catch {} try { await require('../engine/delivery').alertOperator(env, subject, text); } catch {} };
  const desk = makeDesk({ store, kb, checker, audit, publisher: pub, renderer: rend, now, alert, config: {
    epochMonday: epoch, langReady: Object.fromEntries(['en', ...list(env.SOCIAL_LANG_READY)].map(l => [l, true])), allowedDomains: ['shelterkart.com', ...(baseHost ? [baseHost] : [])],
    approvalPin: env.SOCIAL_APPROVAL_PIN || '', protectedNames: [...list(env.SOCIAL_PROTECTED_NAMES), ...(((store.meta.get('protectedNames') || {}).names) || [])], requireRendered: pub.mode === 'live', canary: env.SOCIAL_CANARY !== 'off' } });
  const bot = makeBot({ desk, env, fetchImpl }); botRef.bot = bot;
  const keeper = makeKeeper({ kb, store, engines: keeperEngines || engines, fetchImpl: keeperFetch || fetchImpl, env, now, markets: SCHED.WHEEL.markets.map(m => ({ code: m.code, name: m.name })), topics: M.CURRICULUM.topics, log: () => {} });
  const jobs = new Map();
  function runJob(name, fn) {
    const j = jobs.get(name); if (j && j.state === 'running') return j;
    const rec = { name, state: 'running', startedAt: new Date(now()).toISOString(), result: null, error: null }; jobs.set(name, rec);
    rec.promise = fn().then(r => { rec.state = 'done'; rec.result = r; }, e => { rec.state = 'failed'; rec.error = String(e && e.message || e).slice(0, 300); log.error('[social] job ' + name + ' failed: ' + rec.error); }); return rec;
  }
  const jobView = j => ({ name: j.name, state: j.state, startedAt: j.startedAt, result: j.result, error: j.error });

  /* ---------- the minute loop ---------- */
  let timer = null, running = false;
  async function daily() {
    const day = isoDay(now()), last = store.meta.get('daily');
    if (last && last.day === day) return; store.meta.put('daily', { day });
    if (env.SOCIAL_KEEPER_RECHECK === 'on') { try { const r = await keeper.recheck(); if (r.renewed.length || r.expired.length) audit.append('kb_rechecked', { renewed: r.renewed.length, expired: r.expired.length, unreachable: r.unreachable.length }); } catch (e) { log.error('[social] recheck failed: ' + (e && e.message)); } }
    const swept = kb.sweep(); if (swept.length) audit.append('kb_swept', { items: swept.length });
    if (env.SOCIAL_AUTOPLAN === 'on') { const m1 = SCHED.mondayOf(isoDay(now() + 7 * DAY)); for (const w of [m1, SCHED.addDays(m1, 7)]) if (w >= epoch) await desk.planWeek(w); }
    const packDay = Number(env.SOCIAL_PACK_WEEKDAY == null ? 4 : env.SOCIAL_PACK_WEEKDAY);          // 4 = Thursday
    if (env.SOCIAL_AUTOPLAN === 'on' && new Date(now()).getUTCDay() === packDay) { const w = SCHED.mondayOf(isoDay(now() + 7 * DAY)); if (w >= epoch && !store.packs.find(k => k.week === w && ['open', 'approved'].includes(k.status)).length) { const b = desk.buildPack(w); if (b.ok) await bot.notifyPack(b.pack); } }
    if (bot.configured()) await bot.notifyDigest(24);
  }
  async function loop() { if (running) return; running = true; try { await desk.tick(); await daily(); await store.flush(); } catch (e) { log.error('[social] loop error: ' + (e && e.message)); } finally { running = false; } }
  const start = () => { if (!on || timer) return false; timer = setInterval(loop, Number(env.SOCIAL_TICK_MS) || 60000); if (timer.unref) timer.unref(); log.log(`[social] marketing desk on: ${durable} storage, ${pub.mode} publishing, week 0 is ${epoch}`); return true; };
  const stop = () => { if (timer) clearInterval(timer); timer = null; };

  /* ---------- routes ---------- */
  function mount(app, { adminAuth, ah, jsonParser, pageFile = path.join(__dirname, '..', '..', 'admin-social.html') }) {
    const gate = (req, res, next) => on ? next() : res.status(503).json({ ok: false, error: 'The marketing desk is switched off. Set SOCIAL_ENGINE=on to use it.' });
    const reply = (res, data, code = 200) => { res.set('Cache-Control', 'no-store'); res.status(code).json({ ok: true, ...data }); };
    const wrap = fn => ah(async (req, res) => { try { await fn(req, res); } catch (e) { const code = STATUS[e && e.code]; if (code) return res.status(code).json({ ok: false, error: e.message, code: e.code, ...(e.problems ? { problems: e.problems } : {}) }); log.error('[social] ' + req.path + ': ' + (e && e.stack || e)); res.status(500).json({ ok: false, error: 'The desk could not do that. See the server log.' }); } });
    const week = req => { const w = String((req.body && req.body.week) || (req.query && req.query.week) || nextMonday()); if (!WEEK_RE.test(w) || !SCHED.isMonday(w)) throw Object.assign(new Error('A week is the date of its Monday, like 2026-11-02.'), { code: 'kb_invalid' }); return w; };
    const A = [adminAuth, gate];
    app.get('/admin/social', adminAuth, (req, res) => { res.set({ 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' }); try { res.send(fs.readFileSync(pageFile, 'utf8')); } catch { res.status(404).send('The desk page is missing.'); } });
    app.get('/api/admin/social/status', ...A, wrap(async (req, res) => { const next = week({ query: {}, body: {} }); reply(res, { desk: desk.status(), marketList: SCHED.WHEEL.markets.map(m => ({ code: m.code, name: m.name })), topicList: M.CURRICULUM.topics.map(t => ({ id: t.id, title: t.title })), publisher: pub.status(), bot: bot.configured(), renderer: Boolean(rend && rend.available), durable, nextWeek: next, epoch, kb: { items: kb.size(), usableNextWeek: kb.coverage(markets, [M.topicForWeek(Math.round((Date.parse(next) - Date.parse(epoch)) / (7 * DAY))).topic]).filter(r => r.usable).length, markets: markets.length }, jobs: [...jobs.values()].map(jobView) }); }));
    app.post('/api/admin/social/plan', ...A, jsonParser, wrap(async (req, res) => { const w = week(req); const rec = runJob('plan:' + w, () => desk.planWeek(w)); if (req.body && req.body.wait) { await rec.promise; if (rec.state === 'failed') return res.status(500).json({ ok: false, error: rec.error }); return reply(res, { week: w, ...rec.result }); } reply(res, { week: w, job: jobView(rec) }, 202); }));
    app.get('/api/admin/social/jobs', ...A, wrap(async (req, res) => reply(res, { jobs: [...jobs.values()].map(jobView) })));
    app.post('/api/admin/social/pack', ...A, jsonParser, wrap(async (req, res) => { const w = week(req), r = desk.buildPack(w); if (!r.ok) return res.status(409).json({ ok: false, error: 'Nothing is ready for a pack. Plan the week first, or look at the held posts.', code: r.code, counts: r.counts }); try { await bot.notifyPack(r.pack); } catch {} reply(res, { pack: r.pack }); }));
    app.get('/api/admin/social/pack/:id', ...A, wrap(async (req, res) => { const v = desk.packView(String(req.params.id)); if (!v) return res.status(404).json({ ok: false, error: 'No such pack.' }); reply(res, { pack: v }); }));
    app.post('/api/admin/social/pack/:id/approve', ...A, jsonParser, wrap(async (req, res) => {
      const b = req.body || {}, r = desk.approve(String(req.params.id), { by: 'founder', exceptions: Array.isArray(b.exceptions) ? b.exceptions.map(String) : [], pin: String(b.pin || req.headers['x-approval-pin'] || '') }); await store.flush();
      if (!r.ok) return res.status(409).json({ ok: false, error: r.message, code: r.code }); reply(res, r);
    }));
    app.post('/api/admin/social/veto', ...A, jsonParser, wrap(async (req, res) => { const b = req.body || {}; const sel = { id: b.id, market: b.market, platform: b.platform, week: b.week }; if (!sel.id && !sel.market && !sel.platform && !sel.week) return res.status(400).json({ ok: false, error: 'Say what to veto: a post id, a market, a platform or a week.' }); const r = desk.veto(sel, { by: 'founder', reason: String(b.reason || '').slice(0, 200) }); await store.flush(); reply(res, r); }));
    app.post('/api/admin/social/pause', ...A, jsonParser, wrap(async (req, res) => { const b = req.body || {}; if (!['global', 'market', 'platform'].includes(b.scope)) return res.status(400).json({ ok: false, error: 'scope must be global, market or platform' }); if (b.scope !== 'global' && !b.key) return res.status(400).json({ ok: false, error: 'Say which ' + b.scope + '.' }); const p = desk.pause(b.scope, b.scope === 'global' ? null : String(b.key), String(b.reason || 'paused by the founder').slice(0, 200), { by: 'founder', hours: b.hours ? Number(b.hours) : null }); await store.flush(); reply(res, { pause: p }); }));
    app.post('/api/admin/social/resume', ...A, jsonParser, wrap(async (req, res) => { const b = req.body || {}; const ok = desk.resume(b.scope, b.scope === 'global' ? null : String(b.key || ''), { by: 'founder' }); await store.flush(); reply(res, { resumed: ok }); }));
    app.post('/api/admin/social/incident', ...A, jsonParser, wrap(async (req, res) => { const b = req.body || {}, kinds = ['platform_warning', 'legal_notice', 'negative_comments', 'security_alert', 'sensitivity']; if (!kinds.includes(b.kind)) return res.status(400).json({ ok: false, error: 'kind must be one of ' + kinds.join(', ') }); const i = b.kind === 'sensitivity' ? await desk.sensitivityHold(String(b.key || ''), String(b.detail || '')) : await desk.incident(b.kind, { key: b.key ? String(b.key) : null, detail: String(b.detail || '') }); await store.flush(); reply(res, { incident: i }); }));
    app.post('/api/admin/social/correction', ...A, jsonParser, wrap(async (req, res) => { const b = req.body || {}; if (!b.market || !b.note) return res.status(400).json({ ok: false, error: 'market and note are needed' }); const i = await desk.recordCorrection(String(b.market), String(b.postId || ''), String(b.note)); await store.flush(); reply(res, { incident: i }); }));
    app.get('/api/admin/social/queue', ...A, wrap(async (req, res) => reply(res, { queue: desk.queue(Math.min(72, Number(req.query.hours) || 24)) })));
    app.get('/api/admin/social/posts', ...A, wrap(async (req, res) => { const q = req.query, rows = store.posts.find(p => !p.canary && (!q.week || p.week === q.week) && (!q.status || p.status === q.status) && (!q.market || p.market === q.market)).slice(0, 400).map(p => ({ id: p.id, market: p.market, platform: p.platform, lang: p.lang, status: p.status, when: p.spec.slot.scheduledUtc, verdict: p.check && p.check.verdict, reasons: p.check ? p.check.findings.map(f => f.rule) : [] })); reply(res, { posts: rows }); }));
    app.get('/api/admin/social/audit', ...A, wrap(async (req, res) => reply(res, { verify: audit.verify(), entries: audit.tail(Math.min(200, Number(req.query.limit) || 50)) })));
    app.get('/api/admin/social/kb', ...A, wrap(async (req, res) => { const q = req.query; reply(res, { items: kb.list({ market: q.market, topic: q.topic, status: q.status }).slice(0, 300).map(i => ({ id: i.id, market: i.market, topic: i.topic, status: i.status, statement: i.statement, source: i.source, checkedOn: i.checkedOn, expiresOn: i.expiresOn, evidence: i.evidence ? { quote: i.evidence.quote, fetchedAt: i.evidence.fetchedAt } : null, verification: i.verification || null, translations: Object.fromEntries(Object.entries(i.translations || {}).map(([l, t]) => [l, { text: t.text, backEn: t.backEn, approvedBy: t.approvedBy }])) })), size: kb.size() }); }));
    const seedsDoc = () => store.meta.get('seeds') || { markets: {} };
    app.get('/api/admin/social/keeper', ...A, wrap(async (req, res) => { const sd = seedsDoc(), same = keeper.sameProvider(); reply(res, { autoVerify: env.SOCIAL_KEEPER_AUTOVERIFY === 'on', providersDiffer: same === null ? null : !same, recheck: env.SOCIAL_KEEPER_RECHECK === 'on', seeded: Object.entries(sd.markets).map(([m, v]) => ({ market: m, allowedHosts: v.allowedHosts || [], topics: Object.fromEntries(Object.entries(v.topics || {}).map(([t, u]) => [t, u.length])) })), drafts: kb.list({ status: 'draft' }).length, verified: kb.list({ status: 'verified' }).length, jobs: [...jobs.values()].filter(j => /^keeper/.test(j.name)).map(jobView) }); }));
    app.post('/api/admin/social/keeper/seeds', ...A, jsonParser, wrap(async (req, res) => {
      const b = req.body || {}, code = String(b.market || ''), topic = String(b.topic || ''), urls = (Array.isArray(b.urls) ? b.urls : []).map(String), hosts = (Array.isArray(b.allowedHosts) ? b.allowedHosts : []).map(h => String(h).toLowerCase().trim()).filter(Boolean);
      if (!markets.includes(code)) return res.status(400).json({ ok: false, error: 'Unknown market.' }); if (topic && !topics.includes(topic)) return res.status(400).json({ ok: false, error: 'Unknown topic.' });
      if (urls.length > 5 || urls.some(u => !/^https:\/\/[^\s/]+\.[^\s/]+/.test(u))) return res.status(400).json({ ok: false, error: 'Give up to 5 addresses, each starting with https://.' }); if (urls.length && !topic) return res.status(400).json({ ok: false, error: 'Say which topic the addresses are for.' });
      if (hosts.some(h => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h))) return res.status(400).json({ ok: false, error: 'An allowed host looks like example.gov.uk.' });
      const focus = b.focus && typeof b.focus === 'object' && !Array.isArray(b.focus) ? b.focus : {}; for (const [u, terms] of Object.entries(focus)) if (!/^https:\/\/[^\s/]+\.[^\s/]+/.test(u) || !Array.isArray(terms) || terms.length > 8 || terms.some(t => typeof t !== 'string' || !t.trim() || t.length > 80)) return res.status(400).json({ ok: false, error: 'Focus is an object of https addresses, each with up to 8 words or phrases of at most 80 characters.' });
      const doc = JSON.parse(JSON.stringify(seedsDoc())), m = (doc.markets[code] = doc.markets[code] || { allowedHosts: [], topics: {} }); if (hosts.length) m.allowedHosts = [...new Set([...(m.allowedHosts || []), ...hosts])]; if (urls.length) m.topics[topic] = [...new Set([...(m.topics[topic] || []), ...urls])].slice(0, 5); if (Object.keys(focus).length) m.focus = { ...(m.focus || {}), ...Object.fromEntries(Object.entries(focus).map(([u, t]) => [u, t.map(x => x.trim())])) };
      store.meta.put('seeds', doc); audit.append('keeper_seeds', { market: code, topic, urls: urls.length, allowedHosts: hosts }); await store.flush(); reply(res, { seeded: m });
    }));
    app.post('/api/admin/social/keeper/run', ...A, jsonParser, wrap(async (req, res) => {
      const b = req.body || {}; let name, fn;
      if (b.market) { if (!markets.includes(b.market) || !topics.includes(b.topic)) return res.status(400).json({ ok: false, error: 'Give a market and a topic.' }); name = `keeper:${b.market}:${b.topic}`; fn = () => keeper.run({ market: b.market, topic: b.topic }); }
      else { const w = week(req), tp = M.topicForWeek(Math.round((Date.parse(w) - Date.parse(epoch)) / (7 * DAY))).topic; name = `keeper:week:${w}`; fn = async () => { const reports = []; const todo = markets.filter(m => (((seedsDoc().markets[m] || {}).topics || {})[tp] || []).length); let i = 0; await Promise.all(Array.from({ length: 3 }, async () => { while (i < todo.length) reports.push(await keeper.run({ market: todo[i++], topic: tp })); })); return { topic: tp, markets: todo.length, created: reports.reduce((n, r) => n + r.created.length, 0), gaps: reports.filter(r => r.gap).map(r => ({ market: r.market, gap: r.gap })) }; }; }
      const rec = runJob(name, fn); if (b.wait) { await rec.promise; await store.flush(); if (rec.state === 'failed') return res.status(500).json({ ok: false, error: rec.error }); return reply(res, { result: rec.result }); } reply(res, { job: jobView(rec) }, 202);
    }));
    app.post('/api/admin/social/keeper/recheck', ...A, jsonParser, wrap(async (req, res) => { const rec = runJob('keeper:recheck', () => keeper.recheck()); if (req.body && req.body.wait) { await rec.promise; await store.flush(); return reply(res, { result: rec.result }); } reply(res, { job: jobView(rec) }, 202); }));
    app.post('/api/admin/social/kb/:id/reject', ...A, jsonParser, wrap(async (req, res) => { const it = kb.retire(String(req.params.id), 'founder', String((req.body && req.body.why) || 'rejected from the desk')); audit.append('kb_rejected', { id: it.id }); await store.flush(); reply(res, { item: { id: it.id, status: it.status } }); }));
    app.post('/api/admin/social/kb/:id/translation/:lang', ...A, jsonParser, wrap(async (req, res) => { const lang = String(req.params.lang); if (!C.LANGS.includes(lang) || lang === 'en') return res.status(400).json({ ok: false, error: 'Unknown language.' }); const r = await keeper.draftTranslation(String(req.params.id), lang, String((req.body && req.body.name) || lang)); await store.flush(); if (!r.ok) return res.status(422).json({ ok: false, error: 'The translation was refused: ' + r.reason.replace(/_/g, ' ') }); reply(res, { translation: { text: r.text, backEn: r.backEn, approvedBy: null } }, 201); }));
    app.post('/api/admin/social/kb/:id/translation/:lang/approve', ...A, jsonParser, wrap(async (req, res) => { const it = kb.approveTranslation(String(req.params.id), String(req.params.lang), String((req.body && req.body.by) || '')); audit.append('translation_approved', { id: it.id, lang: req.params.lang, by: String(req.body.by).slice(0, 80) }); await store.flush(); reply(res, { approved: true }); }));

    app.post('/api/admin/social/kb', ...A, jsonParser, wrap(async (req, res) => { const it = kb.put(req.body || {}); await store.flush(); reply(res, { item: it }, 201); }));
    app.post('/api/admin/social/kb/:id/verify', ...A, jsonParser, wrap(async (req, res) => { const it = kb.verify(String(req.params.id), String((req.body && req.body.by) || 'agent')); await store.flush(); reply(res, { item: it }); }));
    app.post('/api/social/telegram/webhook', jsonParser, ah(async (req, res) => { if (!on) return res.status(404).end(); const r = await bot.handleUpdate(req.body, { 'x-telegram-bot-api-secret-token': req.headers['x-telegram-bot-api-secret-token'] }); res.status(r.code === 'forbidden' ? 403 : 200).json({ ok: r.ok !== false }); }));
    app.get('/social-media/:file', (req, res) => { const f = String(req.params.file); if (!FILE_RE.test(f)) return res.status(404).end(); const file = path.join(mediaDir, f); if (!fs.existsSync(file)) return res.status(404).end(); res.set({ 'Content-Type': f.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' }); res.send(fs.readFileSync(file)); });
  }
  return { on, durable, desk, store, kb, keeper, audit, bot, publisher: pub, renderer: rend, checker, mount, start, stop, loop, daily, runJob, config: desk.config, epoch };
}
module.exports = { createSocial };
