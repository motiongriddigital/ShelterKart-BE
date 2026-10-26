'use strict';
/**
 * ShelterKart — first-party analytics.
 *
 * Answers what the founder needs to run the business -- how many people
 * came, from where, how many searched, opened, paid, downloaded -- without
 * tracking anyone.
 *
 *   - No cookies. Nothing is stored on the visitor's device for analytics.
 *   - Unique visitors are counted with a hash of (daily salt + IP + browser).
 *     The salt is random, rotates every UTC day and is then discarded, so a
 *     visitor can be counted once today but can never be followed from one
 *     day to the next -- not even by us.
 *   - Server-side events (searches, report opens, checkouts, payments) are
 *     recorded by the server itself, so ad blockers cannot skew revenue.
 *   - Bots and link previews (WhatsApp, Instagram, Slack...) are dropped:
 *     a preview card is not a visitor.
 *   - IP addresses and user-agent strings are never stored.
 */
const crypto = require('crypto');

/* Events a browser may send. Everything else is server-side only, so a
   script cannot inflate searches, purchases or revenue. */
const CLIENT_EVENTS = new Set(['page_view', 'unlock_click', 'save_pdf', 'share_whatsapp', 'guide_open', 'guide_download', 'guide_share']);   // the last two: the free Home Buying Guide (detail = the chapter or place it was opened from)
const SERVER_EVENTS = new Set(['search', 'report_open', 'checkout_started', 'purchase_paid', 'document_check', 'access_recovered']);

const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|slack|discord|linkedinbot|embedly|pinterest|headless|lighthouse|monitor|curl|wget|python-requests|axios|node-fetch|go-http|java\//i;
const isBot = ua => !ua || BOT_RE.test(String(ua));

function deviceOf(ua) {
  const s = String(ua || '');
  if (/ipad|tablet|(android(?!.*mobile))/i.test(s)) return 'tablet';
  if (/mobi|iphone|android/i.test(s)) return 'mobile';
  return 'desktop';
}

const clip = (v, n) => (v == null ? '' : String(v)).replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\.|^m\.|^l\.|^lm\./, ''); } catch { return ''; }
}

/* Where a visit came from, in the terms a founder thinks in. utm_source
   wins over the referrer: Instagram's in-app browser and WhatsApp usually
   send no referrer at all, so a tagged link is the only reliable signal. */
const CHANNELS = [
  ['instagram', /instagram/], ['whatsapp', /whatsapp|wa\.me/], ['facebook', /facebook|fb\.com|fb\.me/],
  ['google', /google\./], ['bing', /bing\.com/], ['x', /^(x|twitter|t)\.(com|co)$/], ['linkedin', /linkedin|lnkd\.in/],
  ['youtube', /youtube|youtu\.be/], ['reddit', /reddit/], ['telegram', /telegram|t\.me/], ['email', /mail\./],
];
function channelOf({ utmSource, referrerHost, ownHost }) {
  const src = clip(utmSource, 40).toLowerCase();
  if (src) {
    for (const [name, re] of CHANNELS) if (re.test(src)) return name;
    return src;
  }
  if (!referrerHost || (ownHost && referrerHost === ownHost)) return 'direct';
  for (const [name, re] of CHANNELS) if (re.test(referrerHost)) return name;
  return 'other sites';
}

/* ------------------------------------------------------------------ */
/* the rotating salt                                                   */
/* ------------------------------------------------------------------ */
const salts = new Map();                          // 'YYYY-MM-DD' -> hex
let onNewSalt = null;                             // (day, salt): persist today's salt so a restart doesn't double-count
const today = (now = new Date()) => now.toISOString().slice(0, 10);
function saltFor(day) {
  if (!salts.has(day)) {
    salts.set(day, crypto.randomBytes(32).toString('hex'));
    // keep today's only: yesterday's salt is thrown away, which is what
    // makes cross-day linking impossible
    for (const d of salts.keys()) if (d !== day) salts.delete(d);
    if (onNewSalt) { const v = salts.get(day); Promise.resolve().then(() => onNewSalt(day, v)).catch(e => console.error('[analytics] salt save failed:', e && e.message)); }
  }
  return salts.get(day);
}
/** Restore today's salt from storage after a restart, so a mid-day deploy
 *  does not count every visitor twice. Only today's is ever kept. */
function loadSalt(day, salt) { if (day === today()) { salts.clear(); salts.set(day, salt); } }
function visitorId(ip, ua, now = new Date()) {
  return crypto.createHash('sha256').update(saltFor(today(now)) + '|' + (ip || '') + '|' + (ua || '')).digest('hex').slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* recording                                                           */
/* ------------------------------------------------------------------ */
const MEMORY_CAP = 50000;                         // ring buffer when no database is configured
const memory = [];
let store = null;
function attachStore(s) { store = s; onNewSalt = s && s.saveSalt ? (day, salt) => s.saveSalt(day, salt) : null; }

/**
 * Build a stored event from request context. Returns null for bots and
 * unknown event names. Never throws.
 */
function makeEvent(event, { ip, ua, headers = {}, body = {}, ownHost = '', now = new Date() } = {}) {
  if (!CLIENT_EVENTS.has(event) && !SERVER_EVENTS.has(event)) return null;
  const serverSide = ua === 'server';             // e.g. a payment confirmed by Razorpay's webhook
  if (!serverSide && isBot(ua)) return null;
  const referrerHost = hostOf(body.referrer);
  const utm = body.utm && typeof body.utm === 'object' ? body.utm : {};
  // Country comes from a header set by the hosting edge (Cloudflare,
  // Vercel, CloudFront, Fly); without one it is honestly "unknown".
  const country = clip(headers['cf-ipcountry'] || headers['x-vercel-ip-country'] || headers['cloudfront-viewer-country'] || headers['fly-client-country'] || '', 2).toUpperCase();
  return {
    at: now.toISOString(), day: today(now), event,
    visitor: serverSide ? 'server' : visitorId(ip, ua, now),
    path: clip(body.path, 200) || '/',
    channel: channelOf({ utmSource: utm.source, referrerHost, ownHost }),
    referrer: referrerHost && referrerHost !== ownHost ? clip(referrerHost, 100) : '',
    utm_source: clip(utm.source, 60), utm_medium: clip(utm.medium, 60), utm_campaign: clip(utm.campaign, 100),
    country: /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : '',
    device: deviceOf(ua),
    market: clip(body.market, 4), ref: clip(body.ref, 20), query: clip(body.query, 120),
    value: Number.isFinite(Number(body.value)) ? Number(body.value) : null, currency: clip(body.currency, 3).toUpperCase(),
    detail: clip(body.detail, 40),
    lang: /^[a-z]{2,3}(-[A-Za-z]{4})?$/.test(String(body.lang || '')) ? String(body.lang) : '',
  };
}

/** Record in the background. Analytics must never slow down or break a request. */
function record(ev) {
  if (!ev) return;
  memory.push(ev);
  if (memory.length > MEMORY_CAP) memory.splice(0, memory.length - MEMORY_CAP);
  if (store) Promise.resolve().then(() => store.saveEvent(ev)).catch(e => console.error('[analytics] save failed:', e && e.message));
}

/** Rows for the dashboard: from storage when present, else from memory. */
async function loadRows(sinceIso, limit = 250000) {
  if (store) return store.loadEvents(sinceIso, limit);
  return memory.filter(e => e.at >= sinceIso).slice(-limit);
}

/* ------------------------------------------------------------------ */
/* aggregation                                                         */
/* ------------------------------------------------------------------ */
function top(map, n = 10) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n).map(([key, count]) => ({ key, count }));
}
const bump = (m, k, by = 1) => { if (k === '' || k == null) return; m.set(k, (m.get(k) || 0) + by); };

/**
 * Everything the dashboard shows, from raw rows. Pure: no clock except
 * `now`, no I/O, so every number on the dashboard is testable.
 */
function aggregate(rows, { days = 30, now = new Date(), truncated = false } = {}) {
  const dayList = [];
  for (let i = days - 1; i >= 0; i--) dayList.push(new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10));
  const inRange = new Set(dayList);
  const byDay = new Map(dayList.map(d => [d, { day: d, visitors: new Set(), page_views: 0, searches: 0, report_opens: 0, purchases: 0 }]));
  const count = {}; for (const e of [...CLIENT_EVENTS, ...SERVER_EVENTS]) count[e] = 0;
  const channels = new Map(), referrers = new Map(), campaigns = new Map(), countries = new Map(), devices = new Map(),
        markets = new Map(), queries = new Map(), revenue = new Map(), outcomes = new Map();
  const stage = { visited: new Set(), searched: new Set(), opened: new Set(), unlock: new Set(), checkout: new Set(), paid: new Set() };
  const allVisitors = new Set();
  const langs = new Map();       // language -> visitor-day sets per funnel step
  const langOf = l => { if (!langs.has(l)) langs.set(l, { visited: new Set(), searched: new Set(), unlock: new Set(), checkout: new Set() }); return langs.get(l); };
  // The same funnel by the visitor's country. Checkouts are counted when they START: a payment confirmation arrives from the
  // provider's servers, so its network country is not the buyer's. Paid sales per country live in the tax ledger.
  const ctry = new Map();
  const ctryOf = c => { if (!ctry.has(c)) ctry.set(c, { visited: new Set(), searched: new Set(), unlock: new Set(), checkout: new Set() }); return ctry.get(c); };
  // A visitor id is only unique within a day, so funnel and totals count
  // visitor-days: the honest unit when ids cannot be linked across days.
  const vd = e => e.day + ':' + e.visitor;

  for (const e of rows) {
    if (!inRange.has(e.day)) continue;
    const d = byDay.get(e.day);
    count[e.event] = (count[e.event] || 0) + 1;
    if (e.visitor !== 'server') { allVisitors.add(vd(e)); d.visitors.add(e.visitor); }
    if (e.lang && e.visitor !== 'server') { const L = langOf(e.lang); if (e.event === 'page_view') L.visited.add(vd(e)); else if (e.event === 'search') L.searched.add(vd(e)); else if (e.event === 'unlock_click') L.unlock.add(vd(e)); }
    if (e.lang && e.event === 'checkout_started') langOf(e.lang).checkout.add(e.visitor === 'server' ? 'c:' + e.at + ':' + e.ref : vd(e));
    if (e.country && e.visitor !== 'server') { const C = ctryOf(e.country); if (e.event === 'page_view') C.visited.add(vd(e)); else if (e.event === 'search') C.searched.add(vd(e)); else if (e.event === 'unlock_click') C.unlock.add(vd(e)); }
    if (e.country && e.event === 'checkout_started') ctryOf(e.country).checkout.add(e.visitor === 'server' ? 'c:' + e.at + ':' + e.ref : vd(e));
    switch (e.event) {
      case 'page_view':
        d.page_views++; stage.visited.add(vd(e));
        bump(channels, e.channel || 'direct'); bump(referrers, e.referrer); bump(countries, e.country || 'unknown'); bump(devices, e.device);
        if (e.utm_campaign) bump(campaigns, (e.utm_source || '?') + ' / ' + e.utm_campaign);
        break;
      case 'search':
        d.searches++; stage.searched.add(vd(e)); bump(markets, e.market); if (e.query) bump(queries, e.query.toLowerCase());
        bump(outcomes, e.detail || 'ok');
        break;
      case 'report_open': d.report_opens++; stage.opened.add(vd(e)); break;
      case 'unlock_click': stage.unlock.add(vd(e)); break;
      case 'checkout_started': stage.checkout.add(vd(e)); break;
      case 'purchase_paid':
        d.purchases++;
        // a webhook-confirmed payment has no visitor: count the purchase itself
        stage.paid.add(e.visitor === 'server' ? 'p:' + e.at + ':' + e.ref : vd(e));
        if (e.value != null && e.currency) bump(revenue, e.currency, e.value);
        break;
    }
  }
  // A search counts as having seen a report: the report is on screen.
  for (const v of stage.searched) stage.opened.add(v);

  const funnel = [
    ['Visited', stage.visited], ['Searched', stage.searched], ['Saw a report', stage.opened],
    ['Clicked unlock', stage.unlock], ['Started checkout', stage.checkout], ['Paid', stage.paid],
  ].map(([label, set], i, arr) => ({ label, count: set.size, ofPrevious: i === 0 || arr[i - 1][1].size === 0 ? null : Math.round(1000 * set.size / arr[i - 1][1].size) / 10 }));

  return {
    days, from: dayList[0], to: dayList[dayList.length - 1], truncated,
    totals: {
      visitors: allVisitors.size, page_views: count.page_view, searches: count.search, report_opens: count.report_open,
      unlock_clicks: count.unlock_click, checkouts_started: count.checkout_started, purchases: count.purchase_paid,
      pdf_saves: count.save_pdf, whatsapp_shares: count.share_whatsapp, guide_opens: count.guide_open, guide_downloads: count.guide_download, guide_shares: count.guide_share, document_checks: count.document_check,
      access_recovered: count.access_recovered,
      revenue: [...revenue.entries()].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 })),
    },
    funnel,
    daily: dayList.map(d => { const x = byDay.get(d); return { day: d, visitors: x.visitors.size, page_views: x.page_views, searches: x.searches, report_opens: x.report_opens, purchases: x.purchases }; }),
    channels: top(channels), referrers: top(referrers), campaigns: top(campaigns), countries: top(countries),
    devices: top(devices), markets: top(markets, 25), top_searches: top(queries, 15), search_outcomes: top(outcomes),
    // Conversion by reading language, up to the start of checkout. Payment is language-independent once checkout starts.
    country_funnel: [...ctry.entries()].map(([country, s]) => ({ country, visitors: s.visited.size, searches: s.searched.size, unlock_clicks: s.unlock.size, checkouts: s.checkout.size }))
      .sort((a, b) => b.visitors - a.visitors).slice(0, 25),
    languages: [...langs.entries()].map(([lang, s]) => ({ lang, visitors: s.visited.size, searches: s.searched.size, unlock_clicks: s.unlock.size, checkouts: s.checkout.size }))
      .sort((a, b) => b.visitors - a.visitors),
  };
}

module.exports = {
  CLIENT_EVENTS, SERVER_EVENTS, isBot, deviceOf, channelOf, hostOf, visitorId, saltFor, loadSalt, today,
  makeEvent, record, loadRows, aggregate, attachStore, _memory: memory, _salts: salts,
};
