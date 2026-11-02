'use strict';
/** The weekly wheel and its scheduler: every rule of the plan, as a test. */
const assert = require('assert');
const S = require('../../social/schedule');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
const MON = '2026-10-26';

(async () => {
  console.log('the wheel');
  await t('the wheel is sound: 36 markets, 36 posts every day, no platform twice in a row, LinkedIn only in the local work week', () => assert.deepStrictEqual(S.validateWheel(), []));
  await t('India follows the founder\u2019s example: X on Monday, Facebook on Tuesday, and no TikTok (banned there)', () => {
    const india = S.marketByCode('IN'); assert.strictEqual(india.week[0], 'X'); assert.strictEqual(india.week[1], 'FB'); assert(!india.week.includes('TT'));
  });
  await t('the load per platform per day is the plan\u2019s table: Facebook 41 a week, Instagram 37, X 37, YouTube 36, TikTok 35, LinkedIn 32 (none at weekends), Threads 26', () => {
    const l = S.platformLoad(), sum = a => a.reduce((x, y) => x + y, 0);
    assert.deepStrictEqual([sum(l.FB), sum(l.IG), sum(l.X), sum(l.YT), sum(l.TT), sum(l.LI), sum(l.TH)], [41, 37, 37, 36, 35, 32, 26]);
    assert.deepStrictEqual(l.LI.slice(5), [0, 0]);
  });
  await t('a broken wheel is caught: a repeated platform, a weekend LinkedIn post, a missing day, a banned TikTok in India', () => {
    const w = JSON.parse(JSON.stringify(S.WHEEL));
    w.markets[1].week[1] = w.markets[1].week[0]; w.markets[2].week[5] = 'LI'; w.markets[3].week.pop(); w.markets[0].week[2] = 'TT';
    const p = S.validateWheel(w).join(' | ');
    assert(/consecutive/.test(p) && /work week/.test(p) && /the week has 6 days/.test(p) && /TikTok is banned/.test(p), p);
  });

  console.log('one week of slots');
  const plan = S.weekPlan(MON);
  await t('a week has 252 slots, one per market per local day, with unique ids', () => {
    assert.strictEqual(plan.length, 252); assert.strictEqual(new Set(plan.map(s => s.id)).size, 252);
    for (const m of S.WHEEL.markets) assert.deepStrictEqual(plan.filter(s => s.market === m.code).map(s => s.localDate), [0, 1, 2, 3, 4, 5, 6].map(d => S.addDays(MON, d)), m.code);
  });
  await t('every slot reads back as its own market\u2019s local date and time, and never falls in the night (23:00 to 06:00)', () => {
    for (const s of plan) { const lp = S.localParts(s.zone, Date.parse(s.scheduledUtc)); assert.strictEqual(lp.date, s.localDate, s.id); assert.strictEqual(lp.time, s.localTime, s.id); assert(lp.minutes >= 360 && lp.minutes < 1380, s.id + ' ' + lp.time); }
  });
  await t('each slot sits within 15 minutes of its platform\u2019s slot, plus at most the stagger', () => {
    for (const s of plan) { const base = S.PLATFORMS[s.platform].slot.split(':').reduce((h, m) => h * 60 + +m), lp = S.localParts(s.zone, Date.parse(s.scheduledUtc)); const diff = lp.minutes - base; assert(diff >= -S.JITTER && diff <= S.JITTER + 70, s.id + ' diff ' + diff); }
  });
  await t('two posts on one platform are never within 10 minutes of each other, in a winter, a summer and a clock-change week', () => {
    for (const monday of ['2026-10-26', '2026-11-02', '2026-07-06', '2027-03-29']) {
      const by = {}; for (const s of S.weekPlan(monday)) (by[s.platform] = by[s.platform] || []).push(Date.parse(s.scheduledUtc));
      for (const [p, l] of Object.entries(by)) { l.sort((a, b) => a - b); for (let i = 1; i < l.length; i++) assert(l[i] - l[i - 1] >= S.MIN_GAP * 6e4, `${monday} ${p}`); }
    }
  });
  await t('the same week always produces the same slots: jitter is a hash, not a dice roll, and it does vary between posts', () => {
    assert.deepStrictEqual(S.weekPlan(MON), plan);
    const j = new Set(plan.map(s => S.jitterMinutes(s.id))); assert(j.size > 15 && Math.min(...j) >= -15 && Math.max(...j) <= 15);
  });
  await t('LinkedIn lands only on days the market works: Saudi Arabia works Sunday to Thursday, the rest Monday to Friday', () => {
    for (const s of plan.filter(x => x.platform === 'LI')) assert(S.workweek(s.market).includes(S.localParts(s.zone, Date.parse(s.scheduledUtc)).weekday), s.id);
    assert.deepStrictEqual(S.workweek('SA'), [0, 1, 2, 3, 4]);
  });
  await t('a sensitivity hold keeps the slot but flags it, for that market only', () => {
    const held = S.weekPlan(MON, { holds: { JP: true } }); assert(held.filter(s => s.held).every(s => s.market === 'JP')); assert.strictEqual(held.filter(s => s.held).length, 7); assert.strictEqual(held.length, 252);
  });
  await t('a week must start on a Monday', () => { assert.throws(() => S.weekPlan('2026-10-27'), /Monday/); assert.strictEqual(S.mondayOf('2026-10-31'), '2026-10-26'); assert.strictEqual(S.mondayOf('2026-11-01'), '2026-10-26'); });

  console.log('time zones and clock changes');
  await t('Europe changes its clocks on 25 October 2026: London is on summer time the week before and winter time the week after', () => {
    const at = d => S.offsetMinutes('Europe/London', Date.parse(d + 'T12:00:00Z'));
    assert.strictEqual(at('2026-10-19'), 60); assert.strictEqual(at('2026-10-26'), 0);
    const x = w => S.weekPlan(w).find(s => s.market === 'GB' && s.platform === 'X'), a = x('2026-10-19'), b = x('2026-10-26');
    assert.strictEqual(S.localParts('Europe/London', Date.parse(a.scheduledUtc)).time, a.localTime); assert.strictEqual(S.localParts('Europe/London', Date.parse(b.scheduledUtc)).time, b.localTime);
  });
  await t('the US changes on 1 November, Australia and New Zealand are on summer time in October, Mexico never changes, India and Japan are fixed', () => {
    const at = (z, d) => S.offsetMinutes(z, Date.parse(d + 'T12:00:00Z'));
    assert.strictEqual(at('America/New_York', '2026-10-26'), -240); assert.strictEqual(at('America/New_York', '2026-11-02'), -300);
    assert.strictEqual(at('Australia/Sydney', '2026-10-26'), 660); assert.strictEqual(at('Pacific/Auckland', '2026-10-26'), 780);
    assert.strictEqual(at('America/Mexico_City', '2026-07-06'), -360); assert.strictEqual(at('America/Mexico_City', '2026-11-02'), -360);
    assert.strictEqual(at('Asia/Kolkata', '2026-10-26'), 330); assert.strictEqual(at('Asia/Tokyo', '2026-10-26'), 540);
  });
  await t('a local time converts to the right UTC instant on both sides of a clock change', () => {
    assert.strictEqual(new Date(S.localToUtcMs('2026-10-24', '08:30', 'Europe/London')).toISOString(), '2026-10-24T07:30:00.000Z');
    assert.strictEqual(new Date(S.localToUtcMs('2026-10-26', '08:30', 'Europe/London')).toISOString(), '2026-10-26T08:30:00.000Z');
    assert.strictEqual(new Date(S.localToUtcMs('2026-10-26', '08:30', 'Asia/Kolkata')).toISOString(), '2026-10-26T03:00:00.000Z');
    assert.strictEqual(new Date(S.localToUtcMs('2026-11-02', '19:30', 'America/New_York')).toISOString(), '2026-11-03T00:30:00.000Z');
  });
  await t('a week that contains a clock change still gives every market exactly one post per local day', () => {
    for (const monday of ['2027-03-22', '2027-03-29', '2026-10-26', '2026-11-02']) { const p = S.weekPlan(monday); for (const m of S.WHEEL.markets) assert.strictEqual(new Set(p.filter(s => s.market === m.code).map(s => s.localDate)).size, 7, monday + ' ' + m.code); }
  });

  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
