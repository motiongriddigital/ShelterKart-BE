'use strict';
/** The publishers, the store backends and the chat bot, with a fake network. */
const assert = require('assert');
const P = require('../../social/publishers'), { makeStore, pgPersist } = require('../../social/store'), { makeBot } = require('../../social/telegram');
const { makeDesk } = require('../../social/desk'), { makeAudit } = require('../../social/audit'), C = require('../../social/checker'), S = require('../../social/schedule'), F = require('./fixtures');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n       ')); } }
const kb = F.buildKb(), plan = S.weekPlan(F.MONDAY), post = (m, p) => { const slot = plan.find(s => s.market === m && s.platform === p), spec = F.goodPost(kb, slot); for (const x of spec.media) { x.url = 'https://shelterkart.com/social-media/abc.jpg'; x.rendered = true; } return { id: slot.id, spec, platform: p, market: m }; };
function net(handler) { const calls = []; const f = async (url, init) => { const body = init && init.body ? JSON.parse(init.body) : null; calls.push({ url, init, body }); const r = await handler(url, body, init, calls.length); return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json }; }; f.calls = calls; return f; }
const live = extra => ({ SOCIAL_PUBLISH: 'live', ...extra });

(async () => {
  console.log('safe by default');
  await t('unless SOCIAL_PUBLISH=live nothing touches the network, even with every key set', async () => {
    const f = net(async () => ({ status: 200, json: {} })); const pub = P.makePublisher({ env: { AYRSHARE_API_KEY: 'k', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHANNEL_ID: 'c', LINE_CHANNEL_TOKEN: 'l' }, fetchImpl: f });
    const r = await pub.publish(post('GB', 'FB')); assert.strictEqual(pub.mode, 'dryrun'); assert.strictEqual(r.provider, 'dryrun'); assert.strictEqual(f.calls.length, 0); assert.strictEqual(pub.dry.sent.length, 1);
  });
  await t('in live mode a missing key is a clear, permanent error, not a silent skip', async () => {
    const pub = P.makePublisher({ env: live({}), fetchImpl: net(async () => ({ status: 200, json: {} })) }); await assert.rejects(() => pub.publish(post('GB', 'FB')), e => e instanceof P.PublishError && e.code === 'not_configured' && !e.retryable);
  });
  await t('the status lists what is set up and never a key', async () => {
    const s = P.makePublisher({ env: live({ AYRSHARE_API_KEY: 'sk-super-secret', TELEGRAM_BOT_TOKEN: '123:abc' }) }).status(); assert.strictEqual(s.mode, 'live'); assert.strictEqual(s.routes.X.configured, true); assert.strictEqual(s.routes.TG.configured, false); assert(!/sk-super-secret|123:abc/.test(JSON.stringify(s)));
  });

  console.log('the publishing service');
  const svc = (handler, extra = {}) => { const f = net(handler); return { f, pub: P.makePublisher({ env: live({ AYRSHARE_API_KEY: 'KEY123', ...extra }), fetchImpl: f }) }; };
  await t('a post goes out in one request with the right address, bearer key, network name, text with hashtags and media', async () => {
    const { f, pub } = svc(async () => ({ status: 200, json: { status: 'success', id: 'a1', postIds: [{ platform: 'instagram', id: 'ig9', postUrl: 'https://instagram.com/p/x' }] } }));
    const p = post('GB', 'IG'), r = await pub.publish(p); const c = f.calls[0]; assert.strictEqual(c.url, 'https://api.ayrshare.com/api/post'); assert.strictEqual(c.init.headers.Authorization, 'Bearer KEY123');
    assert.deepStrictEqual(c.body.platforms, ['instagram']); assert(c.body.post.startsWith(p.spec.body)); assert(c.body.post.endsWith(p.spec.hashtags.join(' '))); assert.deepStrictEqual(c.body.mediaUrls, ['https://shelterkart.com/social-media/abc.jpg']); assert.strictEqual(c.body.shortenLinks, false);
    assert.deepStrictEqual([r.ok, r.remoteId, r.provider], [true, 'ig9', 'ayrshare']);
  });
  await t('X is "twitter" to the service; a YouTube Short is a video with a public Shorts title; an AI-made post says so', async () => {
    let s = svc(async () => ({ status: 200, json: { status: 'success', id: 'x1' } })); await s.pub.publish(post('GB', 'X')); assert.deepStrictEqual(s.f.calls[0].body.platforms, ['twitter']);
    s = svc(async () => ({ status: 200, json: { status: 'success', id: 'y1' } })); const yt = post('GB', 'YT'); yt.spec.disclosure = { aiGenerated: true, aiLabel: true }; await s.pub.publish(yt);
    const b = s.f.calls[0].body; assert.strictEqual(b.isVideo, true); assert.strictEqual(b.youTubeOptions.visibility, 'public'); assert.strictEqual(b.youTubeOptions.shorts, true); assert(b.youTubeOptions.title.length > 0); assert.strictEqual(b.aiGenerated, true);
  });
  await t('a rate limit and a server error are retryable; a rejected post is not; a dropped connection is', async () => {
    const run = async (status, json) => { const { pub } = svc(async () => ({ status, json })); try { await pub.publish(post('GB', 'FB')); return null; } catch (e) { return e; } };
    const a = await run(429, { message: 'too many' }), b = await run(503, {}), c = await run(400, { status: 'error', errors: [{ message: 'image too small' }] });
    assert(a.retryable && a.code === 'rate_limited'); assert(b.retryable); assert(!c.retryable && /image too small/.test(c.message));
    const f = net(async () => { throw new Error('ECONNRESET'); }); const e = await P.makePublisher({ env: live({ AYRSHARE_API_KEY: 'KEY123' }), fetchImpl: f }).publish(post('GB', 'FB')).catch(x => x); assert(e.retryable && e.code === 'network');
  });
  await t('a post that needs its image but has no public address fails at once without a request', async () => {
    const { f, pub } = svc(async () => ({ status: 200, json: {} })); const p = post('GB', 'IG'); p.spec.media[0].url = ''; await assert.rejects(() => pub.publish(p), e => e.code === 'media_not_available' && !e.retryable); assert.strictEqual(f.calls.length, 0);
  });
  await t('no error message ever contains a key, even when the service echoes it back: it is redacted before it can reach the audit log', async () => {
    const { pub } = svc(async () => ({ status: 401, json: { message: 'invalid key KEY123 for profile PK456' } }), { AYRSHARE_PROFILE_KEY: 'PK456' }); const e = await pub.publish(post('GB', 'FB')).catch(x => x);
    assert(e instanceof P.PublishError); assert(!/KEY123|PK456/.test(e.message), e.message); assert(/redacted/.test(e.message)); assert(!JSON.stringify(e).includes('Bearer'));
    const f = net(async () => ({ status: 400, json: { ok: false, description: 'bad token 1:tok' } })); const e2 = await P.makePublisher({ env: live({ TELEGRAM_BOT_TOKEN: '1:tok', TELEGRAM_CHANNEL_ID: '@x' }), fetchImpl: f }).publish(post('IT', 'TG')).catch(x => x); assert(!/1:tok/.test(e2.message), e2.message);
  });

  console.log('Telegram and LINE direct');
  await t('a Telegram post is a photo with a caption cut to 1024 characters, sent to the channel by the bot', async () => {
    const f = net(async () => ({ status: 200, json: { ok: true, result: { message_id: 77 } } })); const pub = P.makePublisher({ env: live({ TELEGRAM_BOT_TOKEN: '1:tok', TELEGRAM_CHANNEL_ID: '@sk' }), fetchImpl: f });
    const p = post('IT', 'TG'); p.spec.body = 'x'.repeat(2000); const r = await pub.publish(p); const c = f.calls[0]; assert(c.url.endsWith('/bot1:tok/sendPhoto')); assert.strictEqual(c.body.chat_id, '@sk'); assert.strictEqual(c.body.caption.length, 1024); assert.strictEqual(r.remoteId, '77');
  });
  await t('a Telegram failure reports the platform\u2019s reason and whether to retry', async () => {
    const f = net(async () => ({ status: 400, json: { ok: false, description: 'Bad Request: chat not found' } })); const e = await P.makePublisher({ env: live({ TELEGRAM_BOT_TOKEN: '1:tok', TELEGRAM_CHANNEL_ID: '@x' }), fetchImpl: f }).publish(post('IT', 'TG')).catch(x => x); assert(/chat not found/.test(e.message) && !e.retryable);
  });
  await t('a LINE post is an image message then a text message, broadcast with the channel token', async () => {
    const f = net(async () => ({ status: 200, json: {} })); const pub = P.makePublisher({ env: live({ LINE_CHANNEL_TOKEN: 'LT' }), fetchImpl: f }); await pub.publish(post('JP', 'LN')); const c = f.calls[0];
    assert.strictEqual(c.url, 'https://api.line.me/v2/bot/message/broadcast'); assert.strictEqual(c.init.headers.Authorization, 'Bearer LT'); assert.deepStrictEqual(c.body.messages.map(m => m.type), ['image', 'text']);
  });

  console.log('the Postgres backend');
  await t('documents are written as upserts, deleted rows are removed, writes are coalesced, and load restores them', async () => {
    const stmts = []; const rows = [{ kind: 'posts', id: 'p1', data: { id: 'p1', status: 'checked' } }]; const query = async (sql, params) => { stmts.push([sql.replace(/\s+/g, ' ').slice(0, 40), params]); return sql.startsWith('SELECT') ? { rows } : { rows: [] }; };
    const store = makeStore({ persist: pgPersist(query), delayMs: 5 }); await store.load(); assert.strictEqual(store.posts.get('p1').status, 'checked');
    store.posts.put('p2', { id: 'p2' }); store.posts.update('p2', d => { d.x = 1; }); store.posts.update('p2', d => { d.y = 2; }); store.posts.delete('p1'); await store.flush();
    const w = stmts.filter(s => !s[0].startsWith('SELECT')); assert.strictEqual(w.filter(s => /^INSERT/.test(s[0])).length, 1); assert.deepStrictEqual(JSON.parse(w.find(s => /^INSERT/.test(s[0]))[1][2]), { id: 'p2', x: 1, y: 2 }); assert.strictEqual(w.filter(s => /^DELETE/.test(s[0])).length, 1);
  });
  await t('a database that fails does not crash the desk: the error is reported and memory stays correct', async () => {
    const errs = []; const store = makeStore({ persist: { async load() { return {}; }, async write() { throw new Error('db down'); } }, delayMs: 1, onError: e => errs.push(e.message) }); store.posts.put('a', { id: 'a' }); await store.flush(); assert.deepStrictEqual(errs, ['db down']); assert(store.posts.get('a'));
  });

  console.log('the chat bot');
  const botEnv = { TELEGRAM_BOT_TOKEN: '9:bot', TELEGRAM_APPROVER_CHAT_ID: '100', TELEGRAM_APPROVER_USER_ID: '200', TELEGRAM_WEBHOOK_SECRET: 'whsec', PUBLIC_BASE_URL: 'https://desk.example' };
  async function botSetup() {
    const st = { clock: Date.parse('2026-10-25T12:00:00Z') }, store = makeStore(), audit = makeAudit(), k = F.buildKb(() => '2026-10-25'), checker = C.makeChecker({ kb: k, audit, judge: async () => ({ pass: true, issues: [] }) });
    const desk = makeDesk({ store, kb: k, checker, audit, publisher: { mode: 'dryrun', async publish() { return { ok: true }; } }, now: () => st.clock, config: { epochMonday: F.MONDAY, langReady: F.READY } });
    await desk.planWeek(F.MONDAY); const b = desk.buildPack(F.MONDAY), pk = store.packs.get(b.pack.id); desk.approve(b.pack.id, { exceptions: [pk.canaryId] });
    const sent = [], f = net(async (url, body) => { sent.push({ url, body }); return { status: 200, json: { ok: true } }; }); return { desk, bot: makeBot({ desk, env: botEnv, fetchImpl: f }), sent, store };
  }
  const upd = (text, extra = {}) => ({ message: { text, from: { id: 200 }, chat: { id: 100 } }, ...extra }), H = { 'x-telegram-bot-api-secret-token': 'whsec' };
  await t('a webhook without the secret, or the wrong one, is refused', async () => { const { bot } = await botSetup(); assert.strictEqual((await bot.handleUpdate(upd('/status'), {})).code, 'forbidden'); assert.strictEqual((await bot.handleUpdate(upd('/status'), { 'x-telegram-bot-api-secret-token': 'nope' })).code, 'forbidden'); });
  await t('anyone but the founder gets silence: no reply, no action', async () => {
    const { bot, sent, desk } = await botSetup(); await bot.handleUpdate({ message: { text: '/pause', from: { id: 999 }, chat: { id: 100 } } }, H); await bot.handleUpdate({ message: { text: '/pause', from: { id: 200 }, chat: { id: 555 } } }, H);
    assert.strictEqual(sent.length, 0); assert.strictEqual(desk.activePauses().length, 0);
  });
  await t('/status, /queue, /pause, /resume and /veto work for the founder, and /pause really pauses', async () => {
    const { bot, sent, desk } = await botSetup(); assert.strictEqual((await bot.handleUpdate(upd('/status'), H)).action, 'status'); assert(/Desk status/.test(sent.at(-1).body.text));
    assert.strictEqual((await bot.handleUpdate(upd('/pause'), H)).action, 'pause'); assert(desk.activePauses().some(p => p.scope === 'global')); assert.strictEqual((await bot.handleUpdate(upd('/resume'), H)).action, 'resume'); assert.strictEqual(desk.activePauses().length, 0);
    const r = await bot.handleUpdate(upd('/veto GB-2026-10-26-X too soon'), H); assert.strictEqual(r.vetoed, 1); assert(/Vetoed/.test(sent.at(-1).body.text)); assert.strictEqual((await bot.handleUpdate(upd('/veto'), H)).action, 'help');
  });
  await t('there is deliberately no approve command: approval needs the page, where the pack is read', async () => {
    const { bot, sent } = await botSetup(); const r = await bot.handleUpdate(upd('/approve pk-2026-10-26-1'), H); assert.strictEqual(r.action, 'ignored'); assert.strictEqual(sent.length, 0);
  });
  await t('the pause button on an alert pauses everything and answers the tap', async () => {
    const { bot, sent, desk } = await botSetup(); const r = await bot.handleUpdate({ callback_query: { id: 'cq1', data: 'pg', from: { id: 200 }, message: { chat: { id: 100 } } } }, H); assert.strictEqual(r.action, 'pause'); assert(desk.activePauses().some(p => p.scope === 'global')); assert(sent.some(s => /answerCallbackQuery/.test(s.url)));
  });
  await t('the digest lists the next 24 hours with post ids to veto; the pack and alert messages link to the desk page and escape markup', async () => {
    const { bot, sent, desk } = await botSetup(); desk.config.graceMs; await bot.notifyDigest(48); const m = sent.at(-1).body; assert(/Next 48 hours/.test(m.text)); assert(/\/veto/.test(m.text)); assert.strictEqual(m.reply_markup.inline_keyboard[0][0].url, 'https://desk.example/admin/social');
    await bot.notifyAlert('A <b>bad</b> & thing', 'detail <i>x</i>'); assert(!/<b>bad<\/b>/.test(sent.at(-1).body.text) && /&lt;b&gt;bad/.test(sent.at(-1).body.text));
  });
  await t('an unconfigured bot does nothing and says so', async () => { const { desk } = await botSetup(); const bot = makeBot({ desk, env: {}, fetchImpl: net(async () => ({ status: 200, json: { ok: true } })) }); assert.strictEqual(bot.configured(), false); assert.strictEqual((await bot.handleUpdate(upd('/status'), H)).code, 'forbidden'); });

  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
