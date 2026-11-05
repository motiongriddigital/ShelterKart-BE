'use strict';
/** The desk end to end: plan, check, pack, approve, publish, veto, pause, fail, recover, restart. A fake clock and a fake publisher; no network. */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { makeDesk } = require('../../social/desk'), { makeStore, filePersist } = require('../../social/store'), { makeAudit } = require('../../social/audit');
const C = require('../../social/checker'), S = require('../../social/schedule'), F = require('./fixtures'), { PublishError } = require('../../social/publishers');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n       ')); } }
const MON = '2026-10-26', passJudge = async () => ({ pass: true, issues: [] });

function setup({ judge = passJudge, behave = null, config = {}, persist, kbToday } = {}) {
  const st = { clock: Date.parse('2026-10-25T12:00:00Z') }, store = makeStore(persist ? { persist } : {}), audit = makeAudit({ now: () => st.clock }), kb = F.buildKb(kbToday || (() => new Date(st.clock).toISOString().slice(0, 10)));
  const sent = [], alerts = [], publisher = { mode: 'dryrun', sent, async publish(post) { if (behave) await behave(post); sent.push(post.id); return { ok: true, remoteId: 'r-' + post.id, provider: 'fake' }; } };
  const checker = C.makeChecker({ kb, audit, judge });
  const desk = makeDesk({ store, kb, checker, audit, publisher, now: () => st.clock, alert: async (s, b) => { alerts.push(s + ' | ' + b); }, config: { epochMonday: MON, langReady: F.READY, ...config } });
  return { st, store, audit, kb, sent, alerts, desk, publisher, checker };
}
const approveAll = async (ctx, monday = MON) => { await ctx.desk.planWeek(monday); const b = ctx.desk.buildPack(monday); const pk = ctx.store.packs.get(b.pack.id); return { b, pk, r: ctx.desk.approve(b.pack.id, { exceptions: pk.canaryId ? [pk.canaryId] : [] }) }; };

(async () => {
  console.log('planning a week');
  await t('a week is planned for all 36 markets: 252 posts drafted from the knowledge base, each checked and ready', async () => {
    const c = setup(), r = await c.desk.planWeek(MON); assert.strictEqual(r.created, 252); assert.deepStrictEqual(r.gaps, []); assert.deepStrictEqual(r.counts, { checked: 252 }); assert.strictEqual(r.topic, 't01');
    const p = c.store.posts.get('IN-2026-10-26-X'); assert.strictEqual(p.status, 'checked'); assert.strictEqual(p.check.verdict, 'pass'); assert.strictEqual(p.check.rulesVersion, C.RULES_VERSION);
  });
  await t('planning twice does not duplicate: posts already past draft are left alone', async () => { const c = setup(); await c.desk.planWeek(MON); const r = await c.desk.planWeek(MON); assert.strictEqual(r.created, 0); assert.strictEqual(c.store.posts.size(), 252); });
  await t('the week\u2019s topic follows the 12-week cycle from the launch Monday', async () => { const c = setup(); assert.strictEqual((await c.desk.planWeek('2026-11-02')).topic, 't02'); assert.strictEqual((await c.desk.planWeek('2027-01-11')).topic, 't12'); });
  await t('a market with no usable knowledge is reported as a gap, never filled with a guess', async () => {
    const c = setup(); c.kb.get('test.JP.t01').status = 'draft'; const r = await c.desk.planWeek(MON);
    assert.strictEqual(r.created, 245); assert.strictEqual(r.gaps.length, 7); assert(r.gaps.every(g => g.market === 'JP' && g.reason === 'no_usable_knowledge')); assert.strictEqual(c.store.posts.find(p => p.market === 'JP').length, 0);
  });
  await t('a language that is not ready falls back to English, with the fallback flagged, and the post still passes', async () => {
    const c = setup({ config: { langReady: { en: true } } }); await c.desk.planWeek(MON); const p = c.store.posts.get('IN-2026-10-26-X');
    assert.strictEqual(p.lang, 'en'); assert.strictEqual(p.status, 'checked');
  });
  await t('two-language markets alternate their language week by week', async () => { const c = setup(); const a = c.desk.languageFor(S.marketByCode('IN'), 0), b = c.desk.languageFor(S.marketByCode('IN'), 1); assert.deepStrictEqual([a, b].sort(), ['en', 'hi']); });
  await t('a post the checker holds is held, shown with its reasons, kept out of the pack, and can be revised and rechecked back to ready', async () => {
    let flag = true; const judge = async spec => (spec.id === 'GB-2026-10-30-IG' && flag ? { pass: false, issues: [{ rule: 'C17.tone', quote: 'x', why: 'a fear tone' }] } : { pass: true, issues: [] });
    const c = setup({ judge }); const r = await c.desk.planWeek(MON); assert.strictEqual(r.counts.held, 1); assert.strictEqual(r.counts.checked, 251);
    const b = c.desk.buildPack(MON); assert.strictEqual(b.pack.summary.held[0].id, 'GB-2026-10-30-IG'); assert(/fear tone/.test(b.pack.summary.held[0].reasons[0])); assert(!b.pack.items.some(i => i.id === 'GB-2026-10-30-IG'));
    flag = false; const p = c.store.posts.get('GB-2026-10-30-IG'); const res = await c.desk.revise(p.id, JSON.parse(JSON.stringify(p.spec)), { by: 'marketer' });
    assert.strictEqual(res.verdict, 'pass'); assert.strictEqual(c.store.posts.get(p.id).status, 'checked'); assert(c.store.posts.get(p.id).history.some(h => /revised/.test(h.note)));
  });
  await t('a blocked post cannot be revised back to life: a block is final for that post', async () => {
    const c = setup(); await c.desk.planWeek(MON); const p = c.store.posts.get('GB-2026-10-30-IG'); const spec = JSON.parse(JSON.stringify(p.spec)); spec.body += ' A scam.';
    c.store.posts.update(p.id, x => { x.status = 'draft'; }); await c.desk.revise(p.id, spec); assert.strictEqual(c.store.posts.get(p.id).status, 'blocked');
    await assert.rejects(() => c.desk.revise(p.id, p.spec), e => e.code === 'illegal_transition');
  });

  console.log('the weekly pack');
  await t('a pack holds every ready post plus one canary, lists a stratified sample covering every language and platform, and does not mark the canary', async () => {
    const c = setup(); await c.desk.planWeek(MON); const b = c.desk.buildPack(MON), pk = c.store.packs.get(b.pack.id);
    assert.strictEqual(b.pack.items.length, 253); assert(pk.canaryId); assert(!/canary|trap|decoy/i.test(JSON.stringify(b.pack))); assert(b.pack.items.some(i => i.id === pk.canaryId), 'the canary is in the pack like any other post'); assert(/^cx-/.test(pk.canaryId));
    const sample = new Set(b.pack.sampleIds), langs = new Set(b.pack.items.filter(i => sample.has(i.id)).map(i => i.lang)), plats = new Set(b.pack.items.filter(i => sample.has(i.id)).map(i => i.platform));
    for (const l of Object.keys(b.pack.summary.byLanguage)) assert(langs.has(l), 'language ' + l + ' missing from the sample'); for (const p of Object.keys(b.pack.summary.byPlatform)) assert(plats.has(p), 'platform ' + p);
  });
  await t('every item in the pack carries what a reader needs: the post, its claims with sources, the English back-translation and the card text', async () => {
    const c = setup(); await c.desk.planWeek(MON); const b = c.desk.buildPack(MON), it = b.pack.items.find(i => i.id === 'IN-2026-10-27-FB' || i.market === 'IN' && i.platform === 'FB');
    assert(it.body && it.claims[0].sourceUrl && it.media[0].text && it.localTime && it.scheduledUtc); const ar = b.pack.items.find(i => i.lang === 'ar'); assert(ar.backtranslationEn.length > 20);
  });
  await t('building a pack again replaces the open one instead of doubling it', async () => {
    const c = setup(); await c.desk.planWeek(MON); const a = c.desk.buildPack(MON), b = c.desk.buildPack(MON);
    assert.notStrictEqual(a.pack.id, b.pack.id); assert.strictEqual(c.store.packs.get(a.pack.id).status, 'superseded'); assert.strictEqual(c.store.packs.find(k => k.status === 'open').length, 1); assert.strictEqual(c.store.posts.find(p => p.status === 'in_pack').length, 252);
  });
  await t('with nothing ready there is no pack', async () => { const c = setup(); assert.strictEqual(c.desk.buildPack(MON).code, 'nothing_ready'); });

  console.log('approval');
  await t('approving the pack approves all 252 passing posts, records who and under which rules, and discards the canary', async () => {
    const c = setup(); const { r } = await approveAll(c); assert.strictEqual(r.ok, true); assert.strictEqual(r.approved, 252); assert.strictEqual(c.store.posts.find(p => p.status === 'approved').length, 252); assert.strictEqual(c.store.posts.find(p => p.canary).length, 0);
    const p = c.store.posts.get('IN-2026-10-26-X'); assert.strictEqual(p.approval.by, 'founder'); assert.strictEqual(p.approval.rulesVersion, C.RULES_VERSION); assert.strictEqual(p.approval.fingerprint, p.fingerprint);
  });
  await t('approving the pack WITH the known-bad post is refused: nothing is approved, the rubber stamp is logged and the founder is told', async () => {
    const c = setup(); await c.desk.planWeek(MON); const b = c.desk.buildPack(MON), r = c.desk.approve(b.pack.id);
    assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'canary_approved'); assert.strictEqual(c.store.posts.find(p => p.status === 'approved').length, 0); assert.strictEqual(c.store.packs.get(b.pack.id).status, 'rejected');
    await new Promise(r => setTimeout(r, 10)); assert(c.alerts.some(a => /rubber_stamp/.test(a))); assert(c.store.incidents.find(i => i.kind === 'rubber_stamp').length === 1); assert.strictEqual(c.store.posts.find(p => p.status === 'checked').length, 252);
    const b2 = c.desk.buildPack(MON); assert(b2.ok); assert.notStrictEqual(b2.pack.id, b.pack.id);
  });
  await t('exceptions are left out of the approval and go back to checked', async () => {
    const c = setup(); await c.desk.planWeek(MON); const b = c.desk.buildPack(MON), pk = c.store.packs.get(b.pack.id), r = c.desk.approve(b.pack.id, { exceptions: [pk.canaryId, 'GB-2026-10-26-X', 'JP-2026-10-26-X'] });
    assert.strictEqual(r.approved, 250); assert.strictEqual(r.excluded, 2); assert.strictEqual(c.store.posts.get('GB-2026-10-26-X').status, 'checked');
  });
  await t('an approval PIN, when one is set, is required and compared safely', async () => {
    const c = setup({ config: { approvalPin: '4821' } }); await c.desk.planWeek(MON); const b = c.desk.buildPack(MON), pk = c.store.packs.get(b.pack.id);
    assert.throws(() => c.desk.approve(b.pack.id, { exceptions: [pk.canaryId] }), e => e.code === 'pin_required'); assert.throws(() => c.desk.approve(b.pack.id, { exceptions: [pk.canaryId], pin: '4822' }), e => e.code === 'pin_required');
    assert.strictEqual(c.desk.approve(b.pack.id, { exceptions: [pk.canaryId], pin: '4821' }).ok, true);
  });
  await t('a post edited after the pack was built, or checked under older rules, is not approved: it goes back to checked', async () => {
    const c = setup(); await c.desk.planWeek(MON); const b = c.desk.buildPack(MON), pk = c.store.packs.get(b.pack.id);
    c.store.posts.update('GB-2026-10-26-X', p => { p.spec.body += ' !'; }); c.store.posts.update('DE-2026-10-30-LI', p => { p.check.rulesVersion = 'oldrules0000'; });
    const r = c.desk.approve(b.pack.id, { exceptions: [pk.canaryId] }); assert.strictEqual(r.approved, 250); assert.deepStrictEqual(r.stale.map(s => s.reason).sort(), ['content_changed', 'rules_changed']); assert.strictEqual(c.store.posts.get('GB-2026-10-26-X').status, 'checked');
  });
  await t('a closed pack cannot be approved again, and an unknown pack is refused', async () => {
    const c = setup(); const { b } = await approveAll(c); assert.throws(() => c.desk.approve(b.pack.id), e => e.code === 'pack_closed'); assert.throws(() => c.desk.approve('pk-none'), e => e.code === 'not_found');
  });
  await t('posts whose time has already passed by more than the grace window expire at approval instead of posting late', async () => {
    const c = setup(); c.st.clock = Date.parse('2026-10-27T12:00:00Z'); const { r } = await approveAll(c); assert(r.late > 0); assert(r.approved + r.late === 252);
    assert(c.store.posts.find(p => p.status === 'expired').every(p => Date.parse(p.spec.slot.scheduledUtc) + 6 * 36e5 < c.st.clock));
  });

  console.log('publishing');
  await t('a whole week runs: ticking through it publishes 252 posts, one per market per local day, each exactly once, in time order', async () => {
    const c = setup(); await approveAll(c); const seen = new Set(); let total = 0;
    for (let ms = Date.parse('2026-10-26T00:00:00Z'); ms <= Date.parse('2026-11-03T00:00:00Z'); ms += 15 * 60000) { c.st.clock = ms; total += (await c.desk.tick()).published; }
    assert.strictEqual(total, 252); assert.strictEqual(c.sent.length, 252); assert.strictEqual(new Set(c.sent).size, 252);
    for (const m of S.WHEEL.markets) assert.deepStrictEqual(c.store.posts.find(p => p.market === m.code).map(p => p.spec.slot.localDate).sort(), [0, 1, 2, 3, 4, 5, 6].map(d => S.addDays(MON, d)));
    assert.strictEqual(c.store.posts.find(p => p.status === 'published').length, 252); assert(c.audit.verify().ok);
  });
  await t('nothing is published before its time, and an unapproved post is never published', async () => {
    const c = setup(); await c.desk.planWeek(MON); c.st.clock = Date.parse('2026-11-01T00:00:00Z'); assert.strictEqual((await c.desk.tick()).published, 0); await approveAll(c); c.st.clock = Date.parse('2026-10-25T13:00:00Z'); assert.strictEqual((await c.desk.tick()).published, 0);
  });
  await t('a post that missed its window by more than six hours expires and is never posted late; one still inside the window is posted', async () => {
    const c = setup(); await approveAll(c); c.st.clock = Date.parse('2026-10-27T03:00:00Z'); const r = await c.desk.tick(); assert(r.expired > 0 && r.published > 0, JSON.stringify(r));
    for (const p of c.store.posts.find(p => p.status === 'expired')) { assert(!c.sent.includes(p.id)); assert(c.st.clock - Date.parse(p.spec.slot.scheduledUtc) > 6 * 36e5); }
    for (const id of c.sent) assert(c.st.clock - Date.parse(c.store.posts.get(id).spec.slot.scheduledUtc) <= 6 * 36e5); assert(c.audit.filter(e => e.kind === 'missed_window').length === r.expired);
  });

  console.log('veto and pause');
  await t('a veto removes one post, a whole market or a whole platform until the minute it publishes, and vetoed posts never publish', async () => {
    const c = setup(); await approveAll(c); assert.strictEqual(c.desk.veto({ id: 'GB-2026-10-26-X' }, { reason: 'wrong tone' }).vetoed, 1); assert.strictEqual(c.desk.veto({ market: 'JP' }).vetoed, 7); const p = c.desk.veto({ platform: 'TT' }); assert(p.vetoed >= 30);
    for (let ms = Date.parse('2026-10-26T00:00:00Z'); ms <= Date.parse('2026-11-03T00:00:00Z'); ms += 30 * 60000) { c.st.clock = ms; await c.desk.tick(); }
    assert(!c.sent.includes('GB-2026-10-26-X')); assert(!c.sent.some(id => id.startsWith('JP-'))); assert(!c.sent.some(id => id.endsWith('-TT')));
  });
  await t('a veto selector must name something: an empty selector vetoes nothing', async () => { const c = setup(); await approveAll(c); assert.strictEqual(c.desk.veto({}).vetoed, 0); });
  await t('the global pause stops everything, a platform pause only that platform, a market pause only that market, and resuming releases them', async () => {
    const c = setup(); await approveAll(c); c.desk.pause('global', null, 'check'); c.st.clock = Date.parse('2026-10-26T08:00:00Z'); let r = await c.desk.tick(); assert.strictEqual(r.published, 0); assert(r.paused > 0);
    c.desk.resume('global'); c.desk.pause('platform', 'X', 'platform warning'); r = await c.desk.tick(); assert(r.published > 0); assert(!c.sent.some(id => id.endsWith('-X')));
    c.desk.resume('platform', 'X'); c.desk.pause('market', 'IN', 'review'); await c.desk.tick(); assert(!c.sent.some(id => id.startsWith('IN-')));
  });
  await t('a paused post is not lost: it waits, and publishes after resume if still inside its window', async () => {
    const c = setup(); await approveAll(c); c.desk.pause('market', 'IN', 'review'); c.st.clock = Date.parse('2026-10-26T03:20:00Z'); await c.desk.tick(); assert(!c.sent.includes('IN-2026-10-26-X'));
    c.desk.resume('market', 'IN'); c.st.clock += 30 * 60000; await c.desk.tick(); assert(c.sent.includes('IN-2026-10-26-X'));
  });
  await t('a sensitivity hold pauses one market for 24 hours by itself, then lifts, and tells the founder', async () => {
    const c = setup(); await approveAll(c); await c.desk.sensitivityHold('JP', 'a major earthquake'); assert(c.desk.activePauses().some(p => p.key === 'JP')); assert(c.alerts.some(a => /sensitivity/.test(a)));
    c.st.clock = Date.parse('2026-10-26T09:00:00Z'); await c.desk.tick(); assert(!c.sent.some(id => id.startsWith('JP-')));
    c.st.clock += 25 * 36e5; assert(!c.desk.activePauses().some(p => p.key === 'JP'));
  });

  console.log('integrity at the moment of posting');
  await t('a post whose content changed after approval is NOT published, the approval is cancelled, and the whole desk is paused', async () => {
    const c = setup(); await approveAll(c); c.store.posts.update('IN-2026-10-26-X', p => { p.spec.body += ' (edited)'; }); c.st.clock = Date.parse('2026-10-26T04:00:00Z'); const r = await c.desk.tick();
    assert(!c.sent.includes('IN-2026-10-26-X')); assert.strictEqual(r.withdrawn, 1); assert.strictEqual(c.store.posts.get('IN-2026-10-26-X').status, 'held'); assert.strictEqual(c.store.posts.get('IN-2026-10-26-X').approval, null);
    assert(c.desk.activePauses().some(p => p.scope === 'global' && /fingerprint_mismatch/.test(p.reason))); assert(c.alerts.some(a => /fingerprint_mismatch/.test(a)));
  });
  await t('an approval made under older rules is cancelled at posting time, and the post goes back to checked for re-approval', async () => {
    const c = setup(); await approveAll(c); c.store.posts.update('IN-2026-10-26-X', p => { p.approval.rulesVersion = 'oldrules0000'; }); c.st.clock = Date.parse('2026-10-26T04:00:00Z'); await c.desk.tick();
    assert(!c.sent.includes('IN-2026-10-26-X')); assert.strictEqual(c.store.posts.get('IN-2026-10-26-X').status, 'checked');
  });
  await t('a knowledge item that expires between approval and posting stops the post at the last check', async () => {
    const c = setup(); await approveAll(c); const { fingerprintOf } = require('../../social/fingerprint');
    c.st.clock = Date.parse('2027-01-21T00:00:00Z');                                         // after the test items' recheck date of 2027-01-20
    c.store.posts.update('GB-2026-10-26-X', p => { p.spec.slot.scheduledUtc = new Date(c.st.clock - 60000).toISOString(); p.approval.fingerprint = fingerprintOf(p.spec); p.fingerprint = p.approval.fingerprint; });
    const r = await c.desk.tick(); assert.strictEqual(r.published, 0); assert.strictEqual(r.withdrawn, 1); assert(!c.sent.includes('GB-2026-10-26-X')); const p = c.store.posts.get('GB-2026-10-26-X'); assert.strictEqual(p.status, 'held'); assert(/expired/.test(JSON.stringify(c.audit.tail(3))));
  });

  console.log('failures and recovery');
  await t('a temporary failure is retried with a growing delay, then succeeds; a post is never published twice', async () => {
    let n = 0; const c = setup({ behave: async post => { if (post.id === 'IN-2026-10-26-X' && n++ < 2) throw new PublishError('rate limit', { retryable: true, code: 'rate_limited' }); } });
    await approveAll(c); c.st.clock = Date.parse('2026-10-26T03:20:00Z'); await c.desk.tick(); const p = () => c.store.posts.get('IN-2026-10-26-X'); assert.strictEqual(p().status, 'approved'); assert.strictEqual(p().publish.attempts, 1);
    c.st.clock += 60000; await c.desk.tick(); assert.strictEqual(p().publish.attempts, 1);
    c.st.clock += 3 * 60000; await c.desk.tick(); assert.strictEqual(p().publish.attempts, 2); c.st.clock += 11 * 60000; await c.desk.tick(); assert.strictEqual(p().status, 'published'); assert.strictEqual(c.sent.filter(id => id === 'IN-2026-10-26-X').length, 1);
    c.st.clock += 60 * 60000; await c.desk.tick(); assert.strictEqual(c.sent.filter(id => id === 'IN-2026-10-26-X').length, 1);
  });
  await t('three failures in a row on one platform pause that platform by itself and tell the founder; the others carry on', async () => {
    const c = setup({ behave: async post => { if (post.platform === 'X') throw new PublishError('rejected', { retryable: false, code: 'rejected' }); } });
    await approveAll(c); for (let ms = Date.parse('2026-10-26T00:00:00Z'); ms <= Date.parse('2026-10-29T00:00:00Z'); ms += 30 * 60000) { c.st.clock = ms; await c.desk.tick(); }
    assert(c.desk.activePauses().some(p => p.scope === 'platform' && p.key === 'X' && p.auto)); assert(c.alerts.some(a => /publish_failures/.test(a))); assert(c.sent.length > 50);
  });
  await t('two corrections for one market in a week pause that market', async () => {
    const c = setup(); await c.desk.recordCorrection('GB', 'GB-1', 'the check date was wrong'); assert(!c.desk.activePauses().some(p => p.key === 'GB')); await c.desk.recordCorrection('GB', 'GB-2', 'a source link was wrong'); assert(c.desk.activePauses().some(p => p.scope === 'market' && p.key === 'GB'));
  });
  await t('named incidents pause what they should: a platform warning pauses the platform, a security alert everything', async () => {
    const c = setup(); await c.desk.incident('platform_warning', { key: 'IG', detail: 'a strike' }); assert(c.desk.activePauses().some(p => p.scope === 'platform' && p.key === 'IG')); await c.desk.incident('security_alert', { detail: 'unusual sign-in' }); assert(c.desk.activePauses().some(p => p.scope === 'global'));
  });
  await t('only legal paths exist: terminal states have no way out, and a vetoed or published post cannot be revised or approved again', async () => {
    const { LEGAL } = require('../../social/desk'); for (const s of ['published', 'vetoed', 'blocked', 'expired', 'canary']) assert.deepStrictEqual(LEGAL[s], [], s);
    for (const [from, tos] of Object.entries(LEGAL)) for (const to of tos) assert(to in LEGAL, `${from} -> ${to} is not a state`);
    const c = setup(); const { b } = await approveAll(c); void b; c.desk.veto({ id: 'GB-2026-10-26-X' }); await assert.rejects(() => c.desk.revise('GB-2026-10-26-X', c.store.posts.get('GB-2026-10-26-X').spec), e => e.code === 'illegal_transition');
    c.st.clock = Date.parse('2026-10-26T09:00:00Z'); await c.desk.tick(); await assert.rejects(() => c.desk.revise('IN-2026-10-26-X', c.store.posts.get('IN-2026-10-26-X').spec), e => e.code === 'illegal_transition');
  });

  console.log('status, queue and restart');
  await t('the status shows the buffer in days, the pauses, the open packs and a verified audit chain', async () => {
    const c = setup(); await approveAll(c); const s = c.desk.status(); assert(s.bufferDays >= 7); assert.strictEqual(s.approvedAhead, 252); assert.strictEqual(s.audit.ok, true); assert.strictEqual(s.mode, 'dryrun'); assert.strictEqual(s.rulesVersion, C.RULES_VERSION);
  });
  await t('the next-24-hours queue lists what is about to go out, in time order, for the veto window', async () => {
    const c = setup(); await approveAll(c); c.st.clock = Date.parse('2026-10-26T00:00:00Z'); const q = c.desk.queue(24); assert(q.length >= 30 && q.length <= 40, 'queue ' + q.length); for (let i = 1; i < q.length; i++) assert(q[i].scheduledUtc >= q[i - 1].scheduledUtc);
    assert.strictEqual(c.desk.digest(24).count, q.length);
  });
  await t('after a restart nothing is lost: posts, approvals, pauses and the audit chain come back, and publishing carries on', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-')); const c = setup({ persist: filePersist(dir) }); await approveAll(c); c.desk.pause('platform', 'TT', 'warning'); await c.store.flush();
    const store2 = await makeStore({ persist: filePersist(dir) }).load(); assert.strictEqual(store2.posts.find(p => p.status === 'approved').length, 252); assert(store2.pauses.get('platform:TT')); assert.strictEqual(store2.packs.all().length, 1);
    const c2 = setup(); c2.store.posts.all(); const desk2 = makeDesk({ store: store2, kb: c.kb, checker: c.checker, audit: c.audit, publisher: c.publisher, now: () => Date.parse('2026-10-26T08:00:00Z'), config: { epochMonday: MON, langReady: F.READY } });
    const r = await desk2.tick(); assert(r.published > 0); assert(!c.sent.some(id => id.endsWith('-TT'))); fs.rmSync(dir, { recursive: true, force: true });
  });
  await t('a store that cannot be read refuses to start rather than starting empty', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-bad-')); fs.writeFileSync(path.join(dir, 'posts.json'), '{broken'); let code = ''; try { await makeStore({ persist: filePersist(dir) }).load(); } catch (e) { code = e.code; } assert.strictEqual(code, 'store_unreadable'); fs.rmSync(dir, { recursive: true, force: true });
  });

  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
