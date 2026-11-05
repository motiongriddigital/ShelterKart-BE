'use strict';
/**
 * The weekly wheel as code: every market posts once every local day, on a different platform each weekday.
 * Everything here is pure: given a Monday and the wheel it returns the same 252 slots every time (jitter is a hash, not a dice roll).
 * Times are local to each market's anchor zone and converted with the platform's own time zone data (Intl), so clock changes
 * in the UK, Europe, the US, Canada, Australia and New Zealand are handled without a table of offsets.
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const load = f => JSON.parse(fs.readFileSync(path.join(__dirname, 'data', f), 'utf8'));
const WHEEL = load('wheel.json'), PLATFORMS = load('platforms.json').platforms;
const DAY_MS = 864e5, NIGHT_FROM = 23 * 60, NIGHT_TO = 6 * 60, JITTER = 15;
// Saudi Arabia works Sunday to Thursday; everywhere else in the wheel works Monday to Friday. 0 = Sunday (the JavaScript day number).
const WORKWEEK = { SA: [0, 1, 2, 3, 4] }, DEFAULT_WORKWEEK = [1, 2, 3, 4, 5];

/** Minutes the zone is ahead of UTC at this instant. */
function offsetMinutes(zone, utcMs) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000) / 60000);
}
/** The UTC instant at which the clocks in `zone` read `date` `hhmm`. Two passes settle the clock-change edges. */
function localToUtcMs(date, hhmm, zone) {
  const [y, m, d] = date.split('-').map(Number), [H, M] = hhmm.split(':').map(Number), naive = Date.UTC(y, m - 1, d, H, M);
  let t = naive - offsetMinutes(zone, naive) * 60000; t = naive - offsetMinutes(zone, t) * 60000; return t;
}
/** The local date, time and weekday (0 = Sunday) in `zone` at this instant. */
function localParts(zone, utcMs) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, minutes: +p.hour * 60 + +p.minute, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
const addDays = (iso, n) => new Date(Date.UTC(...iso.split('-').map((x, i) => (i === 1 ? +x - 1 : +x))) + n * DAY_MS).toISOString().slice(0, 10);
const isMonday = iso => new Date(iso + 'T00:00:00Z').getUTCDay() === 1;
const mondayOf = iso => { const dow = new Date(iso + 'T00:00:00Z').getUTCDay(); return addDays(iso, -((dow + 6) % 7)); };
/** A repeatable offset of -15 to +15 minutes, so the account never posts at identical minutes, and a test can predict it. */
const jitterMinutes = seed => (parseInt(crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 8), 16) % (2 * JITTER + 1)) - JITTER;
const workweek = code => WORKWEEK[code] || DEFAULT_WORKWEEK;
const marketByCode = code => WHEEL.markets.find(m => m.code === code);

const MIN_GAP = 10;      // minutes between two posts on the same platform account: the account never posts in a burst
/** The 252 slots of one week. `holds` = { MARKET_CODE: true } for a market on a sensitivity hold (the slot is kept but flagged). */
function weekPlan(monday, { holds = {} } = {}) {
  if (!isMonday(monday)) throw new Error('A week starts on a Monday: ' + monday);
  const raw = [];
  for (const m of WHEEL.markets) for (let d = 0; d < 7; d++) {
    const date = addDays(monday, d), platform = m.week[d], cfg = PLATFORMS[platform];
    raw.push({ m, d, date, platform, cfg, utc: localToUtcMs(date, cfg.slot, m.zone) + jitterMinutes(`${m.code}|${date}|${platform}`) * 60000 });
  }
  // Stagger: European markets share local times, so several posts on one platform could land in the same minutes.
  // Sorted by time, each post on a platform waits until MIN_GAP minutes after the one before it (deterministic, forward only).
  const byPlatform = {};
  for (const r of raw) (byPlatform[r.platform] = byPlatform[r.platform] || []).push(r);
  for (const list of Object.values(byPlatform)) {
    list.sort((a, b) => a.utc - b.utc || (a.m.code < b.m.code ? -1 : 1));
    for (let i = 1; i < list.length; i++) if (list[i].utc < list[i - 1].utc + MIN_GAP * 60000) list[i].utc = list[i - 1].utc + MIN_GAP * 60000;
  }
  const slots = [];
  for (const r of raw) {
    let { utc } = r, lp = localParts(r.m.zone, utc);
    if (lp.date !== r.date || lp.minutes >= NIGHT_FROM || lp.minutes < NIGHT_TO) utc = localToUtcMs(r.date, '08:00', r.m.zone), lp = localParts(r.m.zone, utc);   // never a night post, never the wrong local day
    slots.push({ id: `${r.m.code}-${r.date}-${r.platform}`, market: r.m.code, marketName: r.m.name, wave: r.m.wave, languages: r.m.languages, platform: r.platform, day: r.d,
      localDate: lp.date, localTime: lp.time, zone: r.m.zone, scheduledUtc: new Date(utc).toISOString(), held: Boolean(holds[r.m.code]) });
  }
  return slots.sort((a, b) => a.market < b.market ? -1 : a.market > b.market ? 1 : a.day - b.day);
}

/** Every rule of the wheel, as problems found (empty = sound). */
function validateWheel(wheel = WHEEL) {
  const problems = [], perDay = Array(7).fill(0);
  if (wheel.markets.length !== 36) problems.push(`expected 36 markets, found ${wheel.markets.length}`);
  for (const m of wheel.markets) {
    if (m.week.length !== 7) { problems.push(`${m.code}: the week has ${m.week.length} days`); continue; }
    m.week.forEach((p, d) => {
      if (!PLATFORMS[p]) problems.push(`${m.code}: unknown platform ${p}`);
      perDay[d]++;
      if (p === m.week[(d + 1) % 7]) problems.push(`${m.code}: ${p} on two consecutive days (day ${d + 1} and ${(d + 1) % 7 + 1})`);
      if (PLATFORMS[p] && PLATFORMS[p].weekdaysOnly && !workweek(m.code).includes((d + 1) % 7)) problems.push(`${m.code}: ${p} falls outside its work week (day ${d + 1})`);
    });
    try { Intl.DateTimeFormat('en', { timeZone: m.zone }); } catch { problems.push(`${m.code}: unknown time zone ${m.zone}`); }
    if (m.code === 'IN' && (m.week[0] !== 'X' || m.week[1] !== 'FB')) problems.push('IN: must follow the founder\'s example, X on Monday and Facebook on Tuesday');
    if (m.code === 'IN' && m.week.includes('TT')) problems.push('IN: TikTok is banned in India');
  }
  perDay.forEach((n, d) => { if (n !== wheel.markets.length) problems.push(`day ${d + 1} has ${n} posts, expected ${wheel.markets.length}`); });
  return problems;
}
/** The load per platform per weekday: what the plan's table shows. */
function platformLoad(wheel = WHEEL) {
  const out = {};
  for (const m of wheel.markets) m.week.forEach((p, d) => { (out[p] = out[p] || Array(7).fill(0))[d]++; });
  return out;
}

module.exports = { WHEEL, PLATFORMS, weekPlan, validateWheel, platformLoad, localToUtcMs, offsetMinutes, localParts, addDays, mondayOf, isMonday, jitterMinutes, workweek, marketByCode, JITTER, MIN_GAP };
