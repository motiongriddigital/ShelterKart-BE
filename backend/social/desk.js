'use strict';
/**
 * The Marketing Desk: the one place where a week of posts is planned, checked, packed, approved, vetoed, paused and published.
 * The marketer drafts, the checker judges, the founder approves once a week, and only a post that is approved, unchanged since,
 * checked under the current rules and not paused is handed to the publisher. Every step leaves a hash-chained audit entry.
 */
const crypto = require('crypto');
const SCHED = require('./schedule'), M = require('./marketer'), C = require('./checker'), { fingerprintOf } = require('./fingerprint');
const DAY = 864e5, HOUR = 36e5, LANGCODE = { English: 'en', Hindi: 'hi', Arabic: 'ar', French: 'fr', Polish: 'pl', 'Traditional Chinese': 'zh-Hant', Spanish: 'es', German: 'de', Japanese: 'ja', Portuguese: 'pt', Italian: 'it', Dutch: 'nl', Thai: 'th', Swedish: 'sv', Danish: 'da', Norwegian: 'no', Finnish: 'fi', Czech: 'cs', Estonian: 'et', Latvian: 'lv', Lithuanian: 'lt' };
// Which statuses may move to which: the only legal paths a post can take.
const LEGAL = { draft: ['held', 'blocked', 'checked'], held: ['draft', 'blocked', 'vetoed'], blocked: [], checked: ['in_pack', 'draft', 'held', 'blocked', 'vetoed'], in_pack: ['approved', 'checked', 'vetoed', 'draft'],
  approved: ['published', 'failed', 'vetoed', 'expired', 'checked', 'held'], failed: ['approved', 'vetoed'], published: [], vetoed: [], expired: [], canary: [] };
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
async function mapPool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }
// What an incident pauses by itself. A pause only stops what is affected.
const POLICY = { platform_warning: 'platform', publish_failures: 'platform', legal_notice: 'market', negative_comments: 'market', security_alert: 'global', fingerprint_mismatch: 'global', checker_incident: 'market', sensitivity: 'market' };

function makeDesk({ store, kb, checker, audit, publisher, renderer = null, now = () => Date.now(), alert = async () => {}, config = {} } = {}) {
  const cfg = { epochMonday: config.epochMonday || SCHED.mondayOf(isoDay(now())), langReady: config.langReady || { en: true }, allowedDomains: config.allowedDomains || ['shelterkart.com'], approvalPin: config.approvalPin || '',
    graceMs: (config.graceMinutes == null ? 360 : config.graceMinutes) * 60000, maxAttempts: config.maxAttempts || 3, backoffMin: config.backoffMin || [2, 10, 30], canary: config.canary !== false, protectedNames: config.protectedNames || [],
    judgeConcurrency: config.judgeConcurrency || 6, requireRendered: Boolean(config.requireRendered), sensitivityHoldHours: config.sensitivityHoldHours || 24, correctionLimit: config.correctionLimit || 2, failureLimit: config.failureLimit || 3 };
  const nowIso = () => new Date(now()).toISOString(), weekIndex = monday => Math.round((Date.parse(monday) - Date.parse(cfg.epochMonday)) / (7 * DAY));
  const log = (kind, data) => audit.append(kind, data);

  /* ---------- pauses, holds and incidents ---------- */
  const pauseId = (scope, key) => `${scope}:${key || '*'}`;
  const activePauses = () => store.pauses.all().filter(p => !p.expiresAt || Date.parse(p.expiresAt) > now());
  const isPaused = post => activePauses().find(p => p.scope === 'global' || (p.scope === 'market' && p.key === post.market) || (p.scope === 'platform' && p.key === post.platform)) || null;
  const holds = () => Object.fromEntries(activePauses().filter(p => p.scope === 'market' && p.reason === 'sensitivity hold').map(p => [p.key, true]));
  function pause(scope, key, reason, { by = 'system', auto = false, hours = null } = {}) {
    const doc = { id: pauseId(scope, key), scope, key: key || null, reason, by, auto, at: nowIso(), expiresAt: hours ? new Date(now() + hours * HOUR).toISOString() : null };
    store.pauses.put(doc.id, doc); log('pause', { scope, key: doc.key, reason, by, auto, expiresAt: doc.expiresAt }); return doc;
  }
  function resume(scope, key, { by = 'founder' } = {}) { const id = pauseId(scope, key), was = store.pauses.get(id); if (!was) return false; store.pauses.delete(id); log('resume', { scope, key: key || null, by }); return true; }
  async function incident(kind, { scope, key = null, detail = '' } = {}) {
    const target = scope || POLICY[kind], doc = { id: `inc-${now()}-${store.incidents.size()}`, kind, scope: target || null, key, detail: String(detail).slice(0, 500), at: nowIso() };
    store.incidents.put(doc.id, doc); log('incident', { kind, scope: target, key, detail: doc.detail });
    if (target) pause(target, target === 'global' ? null : key, `${kind}: ${doc.detail}`.slice(0, 200), { auto: true, hours: kind === 'sensitivity' ? cfg.sensitivityHoldHours : null });
    try { await alert(`ShelterKart social desk: ${kind}`, `${kind}${target ? ' paused ' + target + (key ? ' ' + key : '') : ''}. ${doc.detail}`); } catch {}
    return doc;
  }
  /** A correction was published for a market. Two in a week pause the market. */
  async function recordCorrection(market, postId, note) {
    const inc = await incident('correction', { scope: null, key: market, detail: `${postId}: ${note}` });
    const week = store.incidents.find(i => i.kind === 'correction' && i.key === market && now() - Date.parse(i.at) < 7 * DAY).length;
    if (week >= cfg.correctionLimit) await incident('checker_incident', { scope: 'market', key: market, detail: `${week} corrections for ${market} in a week` });
    return inc;
  }
  /** A national tragedy, disaster or major event: hold the market's posts for 24 hours until a person releases it. */
  const sensitivityHold = (market, reason) => incident('sensitivity', { scope: 'market', key: market, detail: reason });

  /* ---------- posts ---------- */
  function transition(post, to, note = '') {
    if (!(LEGAL[post.status] || []).includes(to)) throw Object.assign(new Error(`A post cannot go from ${post.status} to ${to}`), { code: 'illegal_transition' });
    post.history.push({ at: nowIso(), from: post.status, to, note: String(note).slice(0, 200) }); post.status = to; post.updatedAt = nowIso();
  }
  const mutate = (id, fn) => store.posts.update(id, fn);
  function languageFor(market, wi) {
    const cands = market.languages.map(l => LANGCODE[l]).filter(Boolean), pick = cands.length ? cands[((wi % cands.length) + cands.length) % cands.length] : 'en';
    return pick === 'en' || (cfg.langReady[pick] && M.PH[pick]) ? pick : 'en';
  }
  async function prepareMedia(spec) {
    for (const m of spec.media) {
      if (!renderer || !m.template) { m.rendered = false; continue; }
      try { const r = await renderer.render({ template: m.template, kind: m.kind, text: m.text, alt: m.alt, lang: spec.lang, market: spec.market, platform: spec.platform }); Object.assign(m, { sha256: r.sha256, url: r.url, mime: r.mime, rendered: true }); delete m.renderError; }
      catch (e) { m.rendered = false; m.renderError = String((e && e.code) || (e && e.message) || e).slice(0, 80); }      // the post waits, unrendered; it never goes out without its image
    }
  }
  const ctxFor = post => ({ kb, today: isoDay(now()), holds: holds(), langReady: cfg.langReady, allowedDomains: cfg.allowedDomains, protectedNames: cfg.protectedNames,
    recent: store.posts.find(p => p.week === post.week && p.id !== post.id && p.status !== 'canary').map(p => ({ id: p.id, market: p.market, body: p.spec.body })) });
  /** Run the checker on a post and move it to its verdict. */
  async function checkPost(id) {
    const post = store.posts.get(id); if (!post) throw Object.assign(new Error('No such post'), { code: 'not_found' });
    const res = await checker.check(post.spec, ctxFor(post));
    mutate(id, p => { p.check = { verdict: res.verdict, findings: res.findings, rulesVersion: res.rulesVersion, at: nowIso() }; p.fingerprint = res.fingerprint; if (p.status === 'held' || p.status === 'checked') transition(p, 'draft', 'rechecked'); transition(p, res.verdict === 'pass' ? 'checked' : res.verdict === 'hold' ? 'held' : 'blocked', res.findings.map(f => f.rule).join(',')); });
    return res;
  }
  /** Plan one week: draft a post for every market slot from the knowledge base, then check each. Gaps are reported, never filled with a guess. */
  async function planWeek(monday) {
    const wi = weekIndex(monday), { topic } = M.topicForWeek(wi), slots = SCHED.weekPlan(monday, { holds: holds() }), made = [], gaps = [];
    for (const g of store.gaps.find(g => g.week === monday)) store.gaps.delete(g.id);
    for (const slot of slots) {
      const existing = store.posts.get(slot.id); if (existing && !['draft', 'held'].includes(existing.status)) continue;
      const market = SCHED.marketByCode(slot.market), item = kb.forPost(slot.market, topic).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
      const gap = reason => { const g = { id: 'gap-' + slot.id, week: monday, slot: slot.id, market: slot.market, platform: slot.platform, topic, reason }; store.gaps.put(g.id, g); gaps.push(g); };
      if (!item) { gap('no_usable_knowledge'); continue; }
      let lang = languageFor(market, wi), r = M.draft({ slot, item, lang, topic });
      if (!r.ok && lang !== 'en') { r = M.draft({ slot, item, lang: 'en', topic }); if (r.ok) r.spec.fellBackToEnglish = true; }
      if (!r.ok) { gap(r.reason); continue; }
      await prepareMedia(r.spec);
      store.posts.put(slot.id, { id: slot.id, week: monday, market: slot.market, platform: slot.platform, lang: r.spec.lang, topic, status: 'draft', spec: r.spec, fingerprint: fingerprintOf(r.spec), check: null, pack: null, approval: null,
        publish: { attempts: 0, lastError: '', nextAttemptUtc: null, remoteId: '', provider: '' }, history: [{ at: nowIso(), from: null, to: 'draft', note: 'drafted' }], canary: false, createdAt: nowIso(), updatedAt: nowIso() });
      made.push(slot.id);
    }
    await mapPool(made, cfg.judgeConcurrency, id => checkPost(id));
    log('week_planned', { week: monday, topic, created: made.length, gaps: gaps.length, rulesVersion: C.RULES_VERSION });
    return { week: monday, topic, created: made.length, gaps, counts: countsFor(monday) };
  }
  /** A marketer revision of a held post: replace its content and check it again. */
  async function revise(id, newSpec, { by = 'marketer' } = {}) {
    const post = store.posts.get(id); if (!post) throw Object.assign(new Error('No such post'), { code: 'not_found' });
    if (!['held', 'checked', 'draft'].includes(post.status)) throw Object.assign(new Error('Only a held, checked or draft post can be revised'), { code: 'illegal_transition' });
    await prepareMedia(newSpec);
    mutate(id, p => { p.spec = newSpec; p.fingerprint = fingerprintOf(newSpec); p.approval = null; p.pack = null; p.history.push({ at: nowIso(), from: p.status, to: p.status, note: 'revised by ' + by }); if (p.status !== 'draft') transition(p, 'draft', 'revised'); });
    return checkPost(id);
  }
  const countsFor = monday => { const c = {}; for (const p of store.posts.find(p => p.week === monday && !p.canary)) c[p.status] = (c[p.status] || 0) + 1; return c; };
  const needsRender = p => cfg.requireRendered && p.spec.media.some(m => !m.rendered);

  /* ---------- the weekly pack ---------- */
  function buildPack(monday) {
    for (const old of store.packs.find(k => k.week === monday && k.status === 'open')) {          // an open pack is replaced, never doubled
      for (const id of old.postIds) mutate(id, p => { if (p.status === 'in_pack') { transition(p, 'checked', 'pack replaced'); p.pack = null; } });
      if (old.canaryId) store.posts.delete(old.canaryId); store.packs.update(old.id, k => { k.status = 'superseded'; });
    }
    const posts = store.posts.find(p => p.week === monday && !p.canary), ready = posts.filter(p => p.status === 'checked' && !needsRender(p)).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (!ready.length) return { ok: false, code: 'nothing_ready', counts: countsFor(monday) };
    const packId = `pk-${monday}-${store.packs.find(k => k.week === monday).length + 1}`;
    for (const p of ready) mutate(p.id, x => { transition(x, 'in_pack', packId); x.pack = packId; });
    const sampleIds = new Set(); const byLang = {}, byPlat = {};
    for (const p of [...ready].sort((a, b) => (sha(a.id) < sha(b.id) ? -1 : 1))) { const l = (byLang[p.lang] = byLang[p.lang] || []), q = (byPlat[p.platform] = byPlat[p.platform] || []); if (l.length < 2) { l.push(p.id); sampleIds.add(p.id); } if (q.length < 1) { q.push(p.id); sampleIds.add(p.id); } }
    let canaryId = null;
    if (cfg.canary && ready.length >= 5) {                                                          // a post with one known flaw that must be rejected: a check that approvals are still being read
      const src = [...ready].sort((a, b) => (sha(packId + a.id) < sha(packId + b.id) ? -1 : 1))[0], spec = JSON.parse(JSON.stringify(src.spec));
      spec.body += '\n\nThis developer is a scam.'; spec.id = canaryId = 'cx-' + sha(packId).slice(0, 12);      // an opaque id: nothing in the pack may reveal which post is the trap
      store.posts.put(canaryId, { ...JSON.parse(JSON.stringify(src)), id: canaryId, status: 'canary', canary: true, spec, fingerprint: fingerprintOf(spec), pack: packId, approval: null, history: [], publish: { attempts: 0 } });
      sampleIds.add(canaryId);
    }
    const ids = [...ready.map(p => p.id), ...(canaryId ? [canaryId] : [])].sort((a, b) => (sha(packId + a) < sha(packId + b) ? -1 : 1)), fp = Object.fromEntries(ready.map(p => [p.id, p.fingerprint]));
    const summary = packSummary(monday, ready), pack = { id: packId, week: monday, status: 'open', createdAt: nowIso(), postIds: ids, fingerprints: fp, canaryId, sampleIds: [...sampleIds], rulesVersion: C.RULES_VERSION, summary, packFingerprint: sha(Object.keys(fp).sort().map(k => k + ':' + fp[k]).join('|') + C.RULES_VERSION) };
    store.packs.put(packId, pack); log('pack_built', { pack: packId, week: monday, posts: ready.length, canary: Boolean(canaryId), packFingerprint: pack.packFingerprint, rulesVersion: C.RULES_VERSION });
    return { ok: true, pack: view(pack) };
  }
  function packSummary(monday, ready) {
    const posts = store.posts.find(p => p.week === monday && !p.canary), by = key => posts.reduce((o, p) => { o[p[key]] = (o[p[key]] || 0) + 1; return o; }, {});
    const reasons = p => (p.check ? p.check.findings.map(f => `${f.rule}: ${f.detail}`) : []);
    return { total: posts.length, approvable: ready.length, byStatus: by('status'), byLanguage: by('lang'), byPlatform: by('platform'),
      held: posts.filter(p => p.status === 'held').map(p => ({ id: p.id, market: p.market, platform: p.platform, reasons: reasons(p).slice(0, 4) })),
      blocked: posts.filter(p => p.status === 'blocked').map(p => ({ id: p.id, market: p.market, platform: p.platform, reasons: reasons(p).slice(0, 4) })),
      waitingForMedia: posts.filter(p => p.status === 'checked' && needsRender(p)).map(p => p.id), gaps: store.gaps.find(g => g.week === monday).map(g => ({ market: g.market, platform: g.platform, reason: g.reason })) };
  }
  const item = p => ({ id: p.id, market: p.market, marketName: (SCHED.marketByCode(p.market) || {}).name, platform: p.platform, lang: p.lang, localDate: p.spec.slot.localDate, localTime: p.spec.slot.localTime, scheduledUtc: p.spec.slot.scheduledUtc,
    title: p.spec.title, body: p.spec.body, hashtags: p.spec.hashtags, claims: p.spec.claims.map(c => ({ text: c.text, type: c.type, sourceUrl: c.sourceUrl, checkedOn: c.checkedOn })), backtranslationEn: p.spec.backtranslationEn,
    media: p.spec.media.map(m => ({ kind: m.kind, alt: m.alt, text: m.text, url: m.url || '' })), verdict: p.check && p.check.verdict, fellBackToEnglish: Boolean(p.spec.fellBackToEnglish) });
  /** What the approval screen shows. The canary is not marked: it must be read like any other post. */
  function view(pack) { return { id: pack.id, week: pack.week, status: pack.status, createdAt: pack.createdAt, summary: pack.summary, rulesVersion: pack.rulesVersion, packFingerprint: pack.packFingerprint, sampleIds: pack.sampleIds, items: pack.postIds.map(id => item(store.posts.get(id))) }; }

  /* ---------- approval and veto ---------- */
  function approve(packId, { by = 'founder', exceptions = [], pin = '' } = {}) {
    if (cfg.approvalPin && !same(pin, cfg.approvalPin)) throw Object.assign(new Error('The approval PIN is required and was not correct'), { code: 'pin_required' });
    const pack = store.packs.get(packId); if (!pack) throw Object.assign(new Error('No such pack'), { code: 'not_found' });
    if (pack.status !== 'open') throw Object.assign(new Error(`The pack is ${pack.status}, not open`), { code: 'pack_closed' });
    const skip = new Set(exceptions), rv = C.RULES_VERSION;
    if (pack.canaryId && !skip.has(pack.canaryId)) {                                                  // the flawed post was approved: nobody read the pack
      store.packs.update(packId, k => { k.status = 'rejected'; k.rejectedFor = 'canary'; });
      for (const id of pack.postIds) if (id !== pack.canaryId) mutate(id, p => { if (p.status === 'in_pack') { transition(p, 'checked', 'pack rejected'); p.pack = null; } });
      store.posts.delete(pack.canaryId); incident('rubber_stamp', { detail: `pack ${packId} was approved with its known-bad post included` }).catch(() => {});
      return { ok: false, code: 'canary_approved', message: 'This pack contained a post that must be rejected, and it was approved. Nothing was approved. Read the pack again, remove what is wrong, and approve a new pack.' };
    }
    const out = { approved: 0, excluded: 0, stale: [], late: 0 };
    for (const id of pack.postIds) {
      if (id === pack.canaryId) { store.posts.delete(id); continue; }
      const p = store.posts.get(id);
      if (skip.has(id)) { mutate(id, x => { transition(x, 'checked', 'excluded by founder'); x.pack = null; }); out.excluded++; continue; }
      const reason = p.status !== 'in_pack' ? 'status_changed' : fingerprintOf(p.spec) !== pack.fingerprints[id] ? 'content_changed' : !p.check || p.check.verdict !== 'pass' ? 'not_passed' : p.check.rulesVersion !== rv ? 'rules_changed' : null;
      if (reason) { out.stale.push({ id, reason }); if (p.status === 'in_pack') mutate(id, x => { transition(x, 'checked', reason); x.pack = null; }); continue; }
      if (now() > Date.parse(p.spec.slot.scheduledUtc) + cfg.graceMs) { mutate(id, x => { transition(x, 'approved', 'late'); transition(x, 'expired', 'window passed before approval'); }); out.late++; continue; }
      mutate(id, x => { transition(x, 'approved', 'pack ' + packId); x.approval = { by, at: nowIso(), fingerprint: pack.fingerprints[id], rulesVersion: rv, packId }; });
      out.approved++;
    }
    store.packs.update(packId, k => { k.status = 'approved'; k.approvedAt = nowIso(); k.approvedBy = by; k.result = out; });
    log('approval', { pack: packId, by, packFingerprint: pack.packFingerprint, rulesVersion: rv, ...out, stale: out.stale.length });
    return { ok: true, ...out };
  }
  function veto(sel = {}, { by = 'founder', reason = '' } = {}) {
    const hit = store.posts.find(p => !p.canary && ['held', 'checked', 'in_pack', 'approved'].includes(p.status) && (!sel.id || p.id === sel.id) && (!sel.market || p.market === sel.market) && (!sel.platform || p.platform === sel.platform) && (!sel.week || p.week === sel.week) && (sel.id || sel.market || sel.platform || sel.week));
    for (const p of hit) mutate(p.id, x => { transition(x, 'vetoed', reason || 'vetoed'); x.approval = null; });
    log('veto', { selector: sel, by, reason: String(reason).slice(0, 200), count: hit.length }); return { vetoed: hit.length, ids: hit.map(p => p.id) };
  }

  /* ---------- publishing ---------- */
  async function tick(at = now()) {
    const out = { published: 0, failed: 0, retrying: 0, paused: 0, expired: 0, withdrawn: 0 };
    const due = store.posts.find(p => p.status === 'approved' && Date.parse(p.spec.slot.scheduledUtc) <= at).sort((a, b) => (a.spec.slot.scheduledUtc < b.spec.slot.scheduledUtc ? -1 : 1));
    for (const post of due) {
      const sched = Date.parse(post.spec.slot.scheduledUtc);
      if (at - sched > cfg.graceMs) { mutate(post.id, p => transition(p, 'expired', 'the window passed')); log('missed_window', { post: post.id }); out.expired++; continue; }
      if (post.publish.nextAttemptUtc && at < Date.parse(post.publish.nextAttemptUtc)) continue;
      if (isPaused(post)) { out.paused++; continue; }
      // integrity: exactly what was approved, under the rules it was approved under
      if (fingerprintOf(post.spec) !== post.approval.fingerprint) { mutate(post.id, p => { transition(p, 'held', 'fingerprint mismatch'); p.approval = null; }); await incident('fingerprint_mismatch', { scope: 'global', detail: `${post.id} differs from what was approved` }); out.withdrawn++; continue; }
      if (post.approval.rulesVersion !== C.RULES_VERSION) { mutate(post.id, p => { transition(p, 'checked', 'the rules changed after approval'); p.approval = null; }); log('withdrawn', { post: post.id, why: 'rules_changed' }); out.withdrawn++; continue; }
      const last = checker.evaluate(post.spec, ctxFor(post));                                          // the mechanical rules once more, against today's knowledge base
      if (last.verdict !== 'pass') { const why = last.findings.map(f => f.detail).join('; ').slice(0, 300); mutate(post.id, p => { transition(p, 'held', 'failed the last check: ' + why.slice(0, 120)); p.approval = null; }); log('withdrawn', { post: post.id, why: last.findings.map(f => f.rule), detail: why }); out.withdrawn++; continue; }
      try {
        const r = await publisher.publish(post);
        mutate(post.id, p => { transition(p, 'published', r.provider || ''); Object.assign(p.publish, { attempts: p.publish.attempts + 1, remoteId: r.remoteId || '', provider: r.provider || '', url: r.url || '', at: nowIso(), lastError: '' }); });
        store.meta.put('failStreak:' + post.platform, { n: 0 }); log('publish', { post: post.id, platform: post.platform, market: post.market, provider: r.provider, remoteId: r.remoteId, fingerprint: post.approval.fingerprint }); out.published++;
      } catch (e) {
        const attempts = post.publish.attempts + 1, retry = Boolean(e && e.retryable) && attempts < cfg.maxAttempts;
        mutate(post.id, p => { p.publish.attempts = attempts; p.publish.lastError = String((e && e.message) || e).slice(0, 200); if (retry) p.publish.nextAttemptUtc = new Date(at + (cfg.backoffMin[attempts - 1] || 30) * 60000).toISOString(); else transition(p, 'failed', p.publish.lastError); });
        log('publish_error', { post: post.id, platform: post.platform, attempts, retryable: Boolean(e && e.retryable), code: e && e.code, error: String((e && e.message) || e).slice(0, 200) });
        if (retry) out.retrying++; else { out.failed++; const streak = ((store.meta.get('failStreak:' + post.platform) || { n: 0 }).n) + 1; store.meta.put('failStreak:' + post.platform, { n: streak }); if (streak >= cfg.failureLimit) { store.meta.put('failStreak:' + post.platform, { n: 0 }); await incident('publish_failures', { scope: 'platform', key: post.platform, detail: `${streak} posts in a row failed to publish on ${post.platform}` }); } }
      }
    }
    return out;
  }

  /* ---------- what the screens and the chat bot show ---------- */
  function queue(hours = 24, from = now()) { return store.posts.find(p => p.status === 'approved' && Date.parse(p.spec.slot.scheduledUtc) >= from - cfg.graceMs && Date.parse(p.spec.slot.scheduledUtc) <= from + hours * HOUR).sort((a, b) => (a.spec.slot.scheduledUtc < b.spec.slot.scheduledUtc ? -1 : 1)).map(item); }
  function status() {
    const posts = store.posts.find(p => !p.canary), by = posts.reduce((o, p) => { o[p.status] = (o[p.status] || 0) + 1; return o; }, {});
    const future = posts.filter(p => p.status === 'approved' && Date.parse(p.spec.slot.scheduledUtc) > now()), last = future.reduce((m, p) => Math.max(m, Date.parse(p.spec.slot.scheduledUtc)), 0);
    return { now: nowIso(), mode: publisher.mode, rulesVersion: C.RULES_VERSION, byStatus: by, bufferDays: last ? Math.max(0, Math.ceil((last - now()) / DAY)) : 0, approvedAhead: future.length, pauses: activePauses(), openPacks: store.packs.find(k => k.status === 'open').map(k => ({ id: k.id, week: k.week })), audit: audit.verify(), kbItems: kb.size() };
  }
  function digest(hours = 24, from = now()) { const q = queue(hours, from); return { count: q.length, byPlatform: q.reduce((o, p) => { o[p.platform] = (o[p.platform] || 0) + 1; return o; }, {}), items: q }; }

  return { planWeek, checkPost, revise, buildPack, packView: id => { const k = store.packs.get(id); return k ? view(k) : null; }, approve, veto, pause, resume, incident, recordCorrection, sensitivityHold, tick, queue, status, digest, isPaused, activePauses, countsFor, languageFor, config: cfg, LEGAL };
}
module.exports = { makeDesk, LEGAL, POLICY };
