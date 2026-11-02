'use strict';
/** The marketing dashboard: the seven weekly numbers, the baseline lock, the repeat-change-stop list, the Phase 1 gate, the channel calls, pause-everything, the budget rule, the ranking, and the routes. */
const assert = require('assert');
const D = require('../../marketing/dashboard'), MK = require('../../marketing'), { makeStore } = require('../../social/store');
let passed = 0, failed = 0; const t = async (n, f) => { try { await f(); passed++; console.log('  ok   ' + n); } catch (e) { failed++; console.log('  FAIL ' + n + '\n       ' + (e && e.stack || e).toString().split('\n').slice(0, 3).join('\n       ')); } };
const ev = (event, day, o = {}) => ({ event, day, at: day + 'T10:00:00Z', visitor: o.visitor || 'v1', market: o.market || 'IN', channel: o.channel || 'direct', utm_source: o.src || '', utm_medium: o.medium || '', utm_campaign: o.camp || '', value: o.value, currency: o.currency || '' });
const W = '2026-11-02';   // a Monday
const visits = (n, day, o = {}) => Array.from({ length: n }, (_, i) => ev('page_view', day, { ...o, visitor: (o.prefix || 'v') + i }));

(async () => {
  console.log('the seven weekly numbers');
  await t('visits are unique visitor-days by channel; previews, shares and check requests are per 100 visits; paid and revenue by currency; organic when nothing was spent', () => {
    const rows = [...visits(3, '2026-11-03', { channel: 'instagram' }), ev('page_view', '2026-11-03', { visitor: 'v0', channel: 'instagram' }), ...visits(1, '2026-11-04', { channel: 'google', prefix: 'g' }),
      ev('report_open', '2026-11-03', { visitor: 'v0' }), ev('report_open', '2026-11-03', { visitor: 'v1' }), ev('share_whatsapp', '2026-11-03', { visitor: 'v0' }), ev('document_check', '2026-11-04', { visitor: 'g0' }),
      ev('purchase_paid', '2026-11-05', { visitor: 'server', value: 3100, currency: 'INR' }), ev('purchase_paid', '2026-11-05', { visitor: 'server', value: 49, currency: 'USD' }), ev('page_view', '2026-11-12', { visitor: 'later' })];
    const m = D.measures(rows, { from: W, to: D.addDays(W, 7), market: 'IN' });
    assert.strictEqual(m.visits, 4); assert.deepStrictEqual(m.visitsByChannel, { instagram: 3, google: 1 }); assert.strictEqual(m.previewsPer100, 50); assert.strictEqual(m.sharesPer100, 25); assert.strictEqual(m.checkRequests, 1);
    assert.strictEqual(m.paid, 2); assert.deepStrictEqual(m.revenue, { INR: 3100, USD: 49 }); assert.strictEqual(m.organic, true); assert.strictEqual(m.audienceQuality, 50);
    const s = D.measures(rows, { from: W, to: D.addDays(W, 7), market: 'IN', spend: [{ market: 'IN', week: W, amount: 1000, currency: 'INR' }] }); assert.strictEqual(s.organic, false); assert.deepStrictEqual(s.costPerPaid, { INR: 500 });
    assert.strictEqual(D.measures(rows, { from: W, to: D.addDays(W, 7), market: 'AE' }).visits, 0);
  });
  await t('targets stay blank until two weeks of baseline: no data, then collecting with a day count, then ready with weekly figures', () => {
    assert.strictEqual(D.baseline([], 'IN').status, 'no_data');
    const few = [...visits(2, '2026-10-01'), ...visits(2, '2026-10-05')]; const c = D.baseline(few, 'IN'); assert.strictEqual(c.status, 'collecting'); assert.strictEqual(c.days, 5);
    const full = [...visits(10, '2026-10-01'), ...visits(10, '2026-10-14', { prefix: 'w' }), ...visits(4, '2026-10-20', { prefix: 'z' })]; const r = D.baseline(full, 'IN');
    assert.strictEqual(r.status, 'ready'); assert.strictEqual(r.perWeek.visits, 10, 'twenty visits in the first fourteen days is ten a week');
  });

  console.log('repeat, change, stop');
  await t('each social topic is judged on the previews its visitors opened, attributed by visitor-day, and only after 30 visits', () => {
    const a = visits(40, '2026-11-03', { src: 'instagram', medium: 'social', camp: 'in-t07', prefix: 'a' }), b = visits(40, '2026-11-03', { src: 'x', medium: 'social', camp: 'in-t02', prefix: 'b' }), c = visits(40, '2026-11-03', { src: 'facebook', medium: 'social', camp: 'in-t11', prefix: 'c' }), e = visits(10, '2026-11-03', { src: 'linkedin', medium: 'social', camp: 'in-t03', prefix: 'e' });
    const prev = (p, k) => Array.from({ length: k }, (_, i) => ev('report_open', '2026-11-03', { visitor: p + i }));
    const list = D.repeatChangeStop([...a, ...b, ...c, ...e, ...prev('a', 20), ...prev('b', 2)], { from: W, to: D.addDays(W, 7) }), call = s => list.find(x => x.platform === s).call;
    assert.strictEqual(call('instagram'), 'repeat'); assert.strictEqual(call('x'), 'change'); assert.strictEqual(call('facebook'), 'stop'); assert.strictEqual(call('linkedin'), 'too_early');
  });

  console.log('the Phase 1 gate');
  const now = Date.parse('2026-12-15T00:00:00Z');
  const sales = (month, market, n) => Array.from({ length: n }, (_, i) => ev('purchase_paid', `${month}-${String(1 + (i % 27)).padStart(2, '0')}`, { visitor: 'server', market, value: 3100, currency: 'INR' }));
  const good = [...sales('2026-10', 'IN', 60), ...sales('2026-10', 'AE', 50), ...sales('2026-11', 'IN', 70), ...sales('2026-11', 'AE', 40)];
  await t('the gate opens only when all five conditions hold, and each failing condition says what is missing', () => {
    const shut = D.gate({ rows: [], now, settings: {} }); assert.strictEqual(shut.open, false); assert.deepStrictEqual(shut.conditions.map(c => c.status), ['not_met', 'unknown', 'unknown', 'not_met', 'not_met']);
    const settings = { aiCostMeasuredUsd: 6.9, paidMarkets: ['IN', 'AE'], counselHousingAd: { IN: { decided: true }, AE: { decided: true } } };
    const open = D.gate({ rows: good, now, settings, refundCount: 5, responses: [] }); assert.strictEqual(open.open, true, JSON.stringify(open.conditions));
    assert.strictEqual(D.gate({ rows: good, now, settings: { ...settings, aiCostMeasuredUsd: 9 }, refundCount: 5, responses: [] }).conditions[1].status, 'not_met', 'an AI cost above the Base case fails');
    assert.strictEqual(D.gate({ rows: good, now, settings, refundCount: 5, responses: [{ kind: 'legal', status: 'in_review' }] }).conditions[2].status, 'not_met', 'an open legal complaint fails');
    assert.strictEqual(D.gate({ rows: good, now, settings, refundCount: 40, responses: [] }).conditions[2].status, 'not_met', 'a refund rate above the model\'s 3% fails');
    assert.strictEqual(D.gate({ rows: good, now, settings: { ...settings, counselHousingAd: { IN: { decided: true } } }, refundCount: 5, responses: [] }).conditions[4].status, 'not_met');
  });

  console.log('channel calls, pause, phase 2, budget, ranking');
  await t('scale, hold and stop follow the ceiling; with no ceiling the call is unknown', () => {
    const weeks = Array.from({ length: 6 }, (_, i) => D.addDays(W, -7 * (5 - i)));
    const sp = (mk, amt) => weeks.map(w => ({ market: mk, week: w, amount: amt, currency: 'INR' }));
    const paidEach = mk => weeks.map(w => ev('purchase_paid', D.addDays(w, 1), { visitor: 'server', market: mk }));
    const calls = D.channelDecisions({ rows: [...paidEach('IN'), ...paidEach('SG')], spend: [...sp('IN', 500), ...sp('AE', 800), ...sp('SG', 900), ...sp('GB', 100)], ceilings: { IN: { amount: 700, currency: 'INR' }, AE: { amount: 700, currency: 'INR' }, SG: { amount: 700, currency: 'INR' } }, weeks });
    const c = m => calls.find(x => x.market === m).call;
    assert.strictEqual(c('IN'), 'scale'); assert.strictEqual(c('AE'), 'stop', 'twice the ceiling spent with no sale'); assert.strictEqual(c('SG'), 'hold'); assert.strictEqual(c('GB'), 'unknown');
  });
  await t('pause everything on an open legal notice, a platform strike or an uncorrected factual error, and not on closed ones', () => {
    assert.strictEqual(D.pauseCheck({}).triggered, false);
    assert.strictEqual(D.pauseCheck({ settings: { legalNotices: [{ note: 'x', closed: true }] } }).triggered, false);
    const p = D.pauseCheck({ settings: { legalNotices: [{ note: 'letter', closed: false }] }, incidents: [{ type: 'platform_warning', platform: 'IG' }], responses: [{ kind: 'error', status: 'in_review', report_ref: 'R1' }, { kind: 'error', status: 'corrected', report_ref: 'R2' }] });
    assert.strictEqual(p.triggered, true); assert.strictEqual(p.reasons.length, 3);
  });
  await t('Phase 2 reports the organic share of previews, and payback is unknown with no channel spend', () => {
    const rows = [...visits(3, '2026-11-03', { medium: 'cpc', prefix: 'p' }), ...visits(3, '2026-11-03', { prefix: 'o' }), ev('report_open', '2026-11-03', { visitor: 'p0' }), ev('report_open', '2026-11-03', { visitor: 'o0' }), ev('report_open', '2026-11-03', { visitor: 'o1' })];
    const r = D.phase2({ rows, from: W, to: D.addDays(W, 7) }); assert.strictEqual(r.organicShareOfPreviews, 66.7); assert.strictEqual(r.organicHalf, 'met'); assert.strictEqual(r.payback, 'unknown', 'no spend recorded against a channel');
  });
  await t('the budget rule needs exchange rates, then sets 30% of contribution split 70, 20 and 10', () => {
    const rows = [ev('purchase_paid', '2026-11-03', { visitor: 'server', value: 3100, currency: 'INR' }), ev('purchase_paid', '2026-11-04', { visitor: 'server', value: 49, currency: 'USD' })];
    assert.strictEqual(D.budget({ rows, month: '2026-11', fx: {} }).contribution, null);
    const b = D.budget({ rows, month: '2026-11', fx: { USD: 90 }, aiCostUsd: 7.35 }), rev = 3100 + 49 * 90, contrib = Math.round(rev * 0.95 - 2 * (7.35 * 90 + 3));
    assert.strictEqual(b.contribution, contrib); assert.strictEqual(b.budget, Math.round(contrib * 0.3)); assert.strictEqual(b.split.best, Math.round(b.budget * 0.7));
  });
  await t('markets are ranked by paid reports per hour, and a market without hours is listed but not ranked', () => {
    const rows = [...Array(6).fill(0).map((_, i) => ev('purchase_paid', '2026-11-0' + (i + 1), { market: 'IN', visitor: 'server' })), ...Array(2).fill(0).map((_, i) => ev('purchase_paid', '2026-11-0' + (i + 1), { market: 'SG', visitor: 'server' })), ev('purchase_paid', '2026-11-03', { market: 'AE', visitor: 'server' })];
    const r = D.rankByEffort({ rows, month: '2026-11', effort: { IN: 12, SG: 2 } }); assert.deepStrictEqual(r.map(x => x.market), ['SG', 'IN', 'AE']); assert.strictEqual(r[2].perHour, null);
  });

  console.log('paid reports traced to their channel');
  await t('the source a browser reports at checkout is cleaned: tags clipped, only a web address kept as the referrer, nothing when nothing was sent', () => {
    const A = require('../../engine/analytics');
    assert.strictEqual(A.sourceOf(null), null); assert.strictEqual(A.sourceOf('x'), null);
    const s = A.sourceOf({ utm: { source: 'instagram', medium: 'social', campaign: 'c'.repeat(300) }, referrer: 'javascript:alert(1)' });
    assert.strictEqual(s.captured, true); assert.strictEqual(s.utm.campaign.length, 100); assert.strictEqual(s.referrer, '');
    assert.strictEqual(A.sourceOf({ referrer: 'https://l.instagram.com/' }).referrer, 'https://l.instagram.com/');
  });
  const paidVia = (day, mk, ch, o = {}) => ({ ...ev('purchase_paid', day, { visitor: 'server', market: mk, channel: ch, value: o.value || 3100, currency: o.currency || 'INR' }), detail: 'razorpay' + (o.unattributed ? '' : ':src') });
  await t('paid reports with a known source are counted per channel; ones without count for their market only', () => {
    const rows = [paidVia('2026-11-03', 'IN', 'instagram'), paidVia('2026-11-03', 'IN', 'instagram'), paidVia('2026-11-04', 'IN', 'google'), paidVia('2026-11-04', 'IN', 'direct', { unattributed: true })];
    const m = D.measures(rows, { from: W, to: D.addDays(W, 7), market: 'IN' }); assert.strictEqual(m.paid, 4); assert.strictEqual(m.attributedPaid, 3); assert.deepStrictEqual(m.paidByChannel, { instagram: 2, google: 1 });
  });
  await t('scale, hold and stop are decided per channel when the spend names one, and per market when it does not', () => {
    const weeks = Array.from({ length: 4 }, (_, i) => D.addDays(W, -7 * (3 - i)));
    const spend = [...weeks.map(w => ({ market: 'IN', week: w, channel: 'instagram', amount: 600, currency: 'INR' })), ...weeks.map(w => ({ market: 'IN', week: w, channel: 'youtube', amount: 1500, currency: 'INR' })), ...weeks.map(w => ({ market: 'IN', week: w, channel: 'Whole market', amount: 300, currency: 'INR' }))];
    const rows = weeks.flatMap(w => [paidVia(D.addDays(w, 1), 'IN', 'instagram'), paidVia(D.addDays(w, 2), 'IN', 'direct', { unattributed: true })]);
    const calls = D.channelDecisions({ rows, spend, ceilings: { IN: { amount: 700, currency: 'INR' } }, weeks }), c = sc => calls.find(x => x.scope === sc);
    assert.strictEqual(c('instagram').call, 'scale', 'Rs 600 per paid report, under the Rs 700 ceiling, four weeks running'); assert.strictEqual(c('youtube').call, 'stop', 'spent twice the ceiling with no sale traced to it');
    assert.strictEqual(c('whole market (all spend over all paid reports)').call, 'stop', 'the whole market: Rs 2,400 a week of spend over 2 paid reports is Rs 1,200 each, above 1.5 times the ceiling');
  });
  await t('Phase 2 payback: a channel pays back when the contribution of its traced paid reports covers its spend inside 45 days; two channels are needed', () => {
    const spend = [{ market: 'IN', week: D.addDays(W, -14), channel: 'instagram', amount: 2000, currency: 'INR' }, { market: 'IN', week: D.addDays(W, -14), channel: 'google', amount: 1000, currency: 'INR' }, { market: 'IN', week: D.addDays(W, -14), channel: 'youtube', amount: 9000, currency: 'INR' }];
    const rows = [paidVia('2026-10-22', 'IN', 'instagram'), paidVia('2026-10-23', 'IN', 'instagram'), paidVia('2026-10-24', 'IN', 'google'), paidVia('2026-10-25', 'IN', 'youtube')];
    assert.strictEqual(D.phase2({ rows, from: W, to: D.addDays(W, 7), spend, fx: {} }).payback, 'unknown', 'needs the USD rate for the AI cost');
    const r = D.phase2({ rows, from: W, to: D.addDays(W, 7), spend, fx: { USD: 90 }, aiCostUsd: 7.35 });
    assert.strictEqual(r.payback, 'met', JSON.stringify(r.channels)); assert.strictEqual(r.channels.find(c => c.channel === 'youtube').paysBack, false);
  });

  console.log('routes');
  const serve = async ({ rows = [], social = null }) => {
    const routes = [], calls = []; const add = m => (p, ...h) => routes.push({ m, p, h }); const app = { get: add('GET'), post: add('POST') };
    const adminAuth = (req, res, next) => { calls.push(req.path); return next(); };
    MK.mount(app, { adminAuth, ah: f => async (q, r, n) => { try { await f(q, r, n); } catch (e) { r.status(500).json({ ok: false, error: String(e && e.message) }); } }, jsonParser: (q, r, n) => n(), loadRows: async () => rows, social, now: () => Date.parse('2026-11-05T12:00:00Z') });
    const req = async (m, url, body) => {
      const [pathname, qs] = url.split('?'), query = Object.fromEntries(new URLSearchParams(qs || ''));
      const r = routes.find(x => x.m === m && x.p === pathname); if (!r) throw new Error('no route ' + m + ' ' + pathname);
      const res = { code: 200, body: undefined, done: false, set() { return this; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; this.done = true; return this; }, send(t) { this.body = t; this.done = true; return this; } };
      const rq = { method: m, path: pathname, query, body: body || {}, headers: {} }; let i = 0; const next = async () => { const h = r.h[i++]; if (h && !res.done) await h(rq, res, next); }; await next();
      return { code: res.code, j: typeof res.body === 'object' ? res.body : null, txt: typeof res.body === 'string' ? res.body : JSON.stringify(res.body) };
    };
    return { req, calls, close() {} };
  };
  await t('the dashboard answers for a week with four anchor markets, all 36 markets, the calls, and the honest gaps', async () => {
    const s = await serve({ rows: visits(5, '2026-11-03') }); try {
      const r = await s.req('GET', '/api/admin/marketing/dashboard?week=' + W); assert.strictEqual(r.code, 200); const j = r.j;
      assert.strictEqual(j.week, W); assert.deepStrictEqual(j.anchorMarkets.map(a => a.market), ['IN', 'AE', 'GB', 'SG']); assert.strictEqual(j.allMarkets.length, 36); assert.strictEqual(j.total.thisWeek.visits, 5);
      assert.strictEqual(j.connected.refunds, false); assert.strictEqual(j.durable, false); assert.strictEqual(j.decisions.gate.open, false);
      const page = await s.req('GET', '/admin/marketing'); assert.strictEqual(page.code, 200); assert(/This week's calls/.test(page.txt)); assert(s.calls.includes('/admin/marketing'), 'the page is behind admin login');
    } finally { s.close(); }
  });
  await t('inputs are validated, and a bad market, week, amount or currency is refused with a plain message', async () => {
    const s = await serve({}); try {
      for (const b of [{ market: 'XX', week: W, amount: 1, currency: 'INR' }, { market: 'IN', week: '2026-11-03', amount: 1, currency: 'INR' }, { market: 'IN', week: W, amount: -5, currency: 'INR' }, { market: 'IN', week: W, amount: 1, currency: 'rupees' }]) assert.strictEqual((await s.req('POST', '/api/admin/marketing/spend', b)).code, 400, JSON.stringify(b));
      assert.strictEqual((await s.req('POST', '/api/admin/marketing/settings', { phase: 3 })).code, 400); assert.strictEqual((await s.req('POST', '/api/admin/marketing/citation', { month: '2026-13', query: 'x', engine: 'y' })).code, 400);
      assert.strictEqual((await s.req('POST', '/api/admin/marketing/spend', { market: 'IN', week: W, amount: 1400, currency: 'INR', channel: 'Instagram' })).code, 200);
      const d = (await s.req('GET', '/api/admin/marketing/dashboard?week=' + W)).j; assert.strictEqual(d.anchorMarkets[0].thisWeek.organic, false); assert.strictEqual(d.decisions.channels[0].market, 'IN');
    } finally { s.close(); }
  });
  await t('targets are refused until two weeks of baseline exist, then accepted', async () => {
    let s = await serve({ rows: visits(3, '2026-11-01') }); try { const r = await s.req('POST', '/api/admin/marketing/targets', { market: 'IN', targets: { visits: 100 } }); assert.strictEqual(r.code, 409); assert(/two weeks of baseline/.test(r.j.error)); } finally { s.close(); }
    s = await serve({ rows: [...visits(3, '2026-10-01'), ...visits(3, '2026-10-20', { prefix: 'w' })] }); try { const r = await s.req('POST', '/api/admin/marketing/targets', { market: 'IN', targets: { visits: 100 } }); assert.strictEqual(r.code, 200); } finally { s.close(); }
  });
  await t('with the marketing desk running, inputs are kept in its durable store', async () => {
    const store = makeStore(); const s = await serve({ social: { store } }); try {
      assert.strictEqual((await s.req('POST', '/api/admin/marketing/settings', { legalNotice: { note: 'A letter about report R1', market: 'IN' } })).code, 200);
      const doc = store.meta.get('marketing'); assert(doc && doc.settings.legalNotices.length === 1); const d = (await s.req('GET', '/api/admin/marketing/dashboard')).j; assert.strictEqual(d.durable, true); assert.strictEqual(d.decisions.pause.triggered, true);
    } finally { s.close(); }
  });

  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
