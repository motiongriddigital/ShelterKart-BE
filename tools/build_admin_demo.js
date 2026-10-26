'use strict';
/**
 * Builds the admin demo's data and writes it into admin.html.
 * Usage: node tools/build_admin_demo.js
 *
 *   - Visitor traffic is SIMULATED (a seeded, repeatable generator), then
 *     run through the real analytics code (engine/analytics.js aggregate),
 *     so every number on the demo dashboard is computed exactly as live.
 *   - The Reports panel lists the five REAL sample reports, with their
 *     real prices and PDFs.
 *   - Register health, disputes and replies are illustrative, and the
 *     dashboard says so.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const A = require(path.join(ROOT, 'backend', 'engine', 'analytics.js'));
const { MARKETS } = require(path.join(ROOT, 'backend', 'engine', 'markets.js'));
const PRICING = require(path.join(ROOT, 'backend', 'pricing'));
const PD = PRICING.load({ ACCESS_TOKEN_SECRET: 'demo', TAX_GATE: 'off', NODE_ENV: 'demo' });
// A simulated purchase is priced like a real one: the price book, in the BUYER's currency, for a typical property at a random depth.
const simulatedPrice = (iso, depth) => { const cur = PRICING.quoteCurrency(PD, iso).currency, r = PRICING.feeFor(PD, { propertyUsd: null, depth }).rung; return { amount: PD.book.ladders[cur][r], currency: cur }; };

// the five real samples, straight from the site
const site = fs.readFileSync(path.join(ROOT, 'shelterkart-frontend.html'), 'utf8');
const a = site.indexOf('const SAMPLE_REPORTS = ') + 'const SAMPLE_REPORTS = '.length, b = site.indexOf(';\n\nfunction findSample', a);
const SAMPLES = JSON.parse(site.slice(a, b).replace(/<\\\//g, '</'));

// a small seeded generator, so the demo is the same every time it is built
let seed = 20260930;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = weighted => { let r = rnd() * weighted.reduce((s, [, w]) => s + w, 0); for (const [v, w] of weighted) { if ((r -= w) <= 0) return v; } return weighted[0][0]; };

const NOW = new Date('2026-09-30T12:00:00Z'), DAYS = 120;
const CHANNELS = [[{ channel: 'instagram', utm_source: 'instagram', utm_campaign: 'launch' }, 22], [{ channel: 'instagram', utm_source: 'instagram', utm_campaign: 'reels-hubtown' }, 12],
  [{ channel: 'instagram', utm_source: 'instagram', utm_campaign: 'reels-dubai' }, 6], [{ channel: 'whatsapp', utm_source: 'whatsapp', utm_medium: 'share' }, 22],
  [{ channel: 'google', referrer: 'google.com' }, 18], [{ channel: 'direct' }, 12], [{ channel: 'youtube', referrer: 'youtube.com' }, 5], [{ channel: 'other sites', referrer: 'propertybutler.in' }, 3]];
const COUNTRIES = [['IN', 70], ['AE', 14], ['GB', 8], ['SG', 5], ['US', 3]];
const BY_MARKET = { IN: 'in', AE: 'ae', GB: 'uk', SG: 'sg', US: 'in' };
const QUERIES = { in: [['hubtown celeste', 30], ['casagrand casamia', 18], ['hubtown 25 south', 8], ['p51900008925', 4]], ae: [['creek bay tower b', 20], ['creek beach', 6]],
  uk: [['sutton garden square', 12]], sg: [['river modern', 10], ['lentor mansion', 4]] };
// A search belongs to a sample report when the report's title contains it ("sutton garden square"
// is "The Kensington, Sutton Garden Square"), or when it is the project's registration number.
const refFor = q => { const s = SAMPLES.find(x => x.title.toLowerCase().includes(q) || x.full.project.ids.some(id => id.toLowerCase() === q)); return s ? s.full.ref : ''; };

const rows = []; let v = 0;
for (let d = DAYS - 1; d >= 0; d--) {
  const date = new Date(NOW.getTime() - d * 86400000), day = date.toISOString().slice(0, 10);
  const visitors = Math.round((25 + (DAYS - d) * 1.6) * (0.75 + rnd() * 0.5) * ([0, 6].includes(date.getUTCDay()) ? 1.25 : 1));
  for (let i = 0; i < visitors; i++) {
    const visitor = 'demo' + (v++), at = day + 'T' + String(6 + Math.floor(rnd() * 16)).padStart(2, '0') + ':00:00.000Z';
    const country = pick(COUNTRIES), market = BY_MARKET[country], src = pick(CHANNELS);
    // the language each simulated visitor reads in: SIMULATED, like the rest of the traffic; conversion is the same in every language here, so the panel shows structure, not a finding
    const lang = country === 'IN' ? pick([['en', 70], ['hi', 30]]) : country === 'AE' ? pick([['en', 80], ['ar', 20]]) : 'en';
    const base = { at, day, visitor, lang, country, device: rnd() < 0.78 ? 'mobile' : 'desktop', path: '/', referrer: '', utm_source: '', utm_medium: '', utm_campaign: '', market: '', ref: '', query: '', value: null, currency: '', detail: '' };
    const ev = (event, extra) => rows.push({ ...base, event, ...extra });
    ev('page_view', { ...src, channel: src.channel });
    for (let pv = 1; pv < 1 + Math.floor(rnd() * 2.2); pv++) ev('page_view', { channel: 'direct' });
    if (rnd() > 0.38) continue;                                              // 38% search
    const q = pick(QUERIES[market]), ref = refFor(q);
    ev('search', { market, query: q, ref, detail: pick([['fresh', 55], ['cached', 30], ['matched', 12], ['unavailable', 3]]) });
    if (src.channel === 'whatsapp' && rnd() < 0.6) ev('report_open', { ref, market });
    if (rnd() > 0.24) continue;                                              // 24% of searchers click unlock
    ev('unlock_click', { ref });
    if (rnd() > 0.62) continue;                                              // 62% of those start checkout
    ev('checkout_started', { ref });
    if (rnd() > 0.82) continue;                                              // 82% of checkouts pay
    const p = simulatedPrice(country, pick([['gold', 30], ['heavy', 50], ['thin', 20]]));
    ev('purchase_paid', { ref, value: p.amount, currency: p.currency, detail: 'razorpay' });
    if (rnd() < 0.7) ev('save_pdf', { ref });
    if (rnd() < 0.3) ev('share_whatsapp', { ref });
    if (rnd() < 0.2) ev('document_check', { ref, market });
  }
}
// Tax exposure for the demo: the simulated paid sales go through the REAL ledger, against the shipped profiles. The demo
// assumes India's GSTIN and Razorpay's international payments are in place; the UK, the EU and the unverified countries stay off.
const TAX_ENV = { ACCESS_TOKEN_SECRET: 'demo', GSTIN: 'DEMO', RAZORPAY_INTERNATIONAL: 'true' }, TD = PRICING.load(TAX_ENV), taxStore = PRICING.makeStore();
const taxDemo = (async () => {
  for (const r of rows.filter(r => r.event === 'purchase_paid' && r.at >= new Date(NOW.getTime() - 365 * 864e5).toISOString())) {
    const m = Math.pow(10, (TD.currencies[r.currency] || { minor: 2 }).minor);
    await PRICING.ledger.recordSale({ data: TD, store: taxStore, country: r.country || 'IN', grossMinor: Math.round(r.value * m), taxMinor: 0, currency: r.currency, now: new Date(r.at) });
  }
  const progress = await PRICING.ledger.progress({ data: TD, store: taxStore, now: NOW });
  const countries = [...TD.countries.values()].filter(c => !c.blocked).map(c => ({ iso: c.iso, name: c.name, ...PRICING.saleStatus(TD, c.iso) }));
  return { ok: true, priceBookVersion: TD.book.version, progress, onSale: countries.filter(c => c.onSale).map(c => c.iso), off: countries.filter(c => !c.onSale) };
})();
const analytics = {};
for (const days of [1, 7, 30, 90, 365]) analytics[days] = { ok: true, ...A.aggregate(rows, { days, now: NOW }), stored: true };

const paid = rows.filter(r => r.event === 'purchase_paid'), started = rows.filter(r => r.event === 'checkout_started');
const iso = (daysAgo, h = 9) => new Date(NOW.getTime() - daysAgo * 86400000 + h * 3600000).toISOString();
const health = { ok: true, markets: Object.entries(MARKETS).filter(([, m]) => m.registry).map(([code, m]) => {
  const st = { uk: 'healthy', fr: 'healthy', no: 'healthy', sg: 'healthy', fi: 'healthy', cz: 'healthy', ie: 'unconfirmed', au: 'skipped', tw: 'skipped', in: 'skipped' }[code] || 'healthy';
  const detail = { healthy: 'the canary company was found, and robots.txt allows the path used', unconfirmed: 'the canary company was not found; check the canary and the connector',
    skipped: code === 'in' ? 'no canary defined for this market' : 'not configured on this server (API key not set)' }[st];
  return { market: code, label: m.label, state: st, detail, consecutiveFailures: st === 'unconfirmed' ? 3 : 0, lastOkAt: st === 'healthy' ? iso(0, 2) : null, checkedAt: iso(0, 2) };
}) };
const hub = SAMPLES.find(x => x.id === 'hubtown-celeste'), casa = SAMPLES.find(x => x.id === 'casagrand-casamia');
const disputes = [
  { id: '0b6a1f3e-0000-4000-8000-000000000001', report_ref: hub.full.ref, contact: 'buyer (demo)', note: 'My agreement says possession is December 2027. Can the report say which listing sites give July 2029?', submitted_at: iso(1, 11) },
  { id: '0b6a1f3e-0000-4000-8000-000000000002', report_ref: casa.full.ref, contact: 'buyer (demo)', note: 'The TNRERA certificate shows a different possession date from two of the listings.', submitted_at: iso(3, 15) }];
const responses = [
  { id: '0b6a1f3e-0000-4000-8000-000000000003', report_ref: hub.full.ref, contact_email: 'developer (demo)', finding_text: 'Possession date: sources disagree.',
    response_text: 'The date registered with MahaRERA governs. We will share the current quarterly progress report on request.', submitted_at: iso(2, 10) }];
const reports = SAMPLES.map(x => ({
  ref: x.full.ref, title: x.title, place: x.place, market: MARKETS[x.full.market] ? MARKETS[x.full.market].label : x.full.market, developer: x.developer,
  checkedAt: x.checkedAt, price: x.price, pdf: x.pdf, findings: x.full.findings.length, disputes: x.full.conflicts.length,
  paid: paid.filter(r => r.ref === x.full.ref).length, paidSince: rows[0].day }));
const DEMO = { note: 'Demo data: visitor traffic is simulated (and computed by the real analytics code); the five reports are real research.', builtFor: NOW.toISOString(),
  analytics, stats: { paidPurchases: paid.length, pendingCheckouts: started.length - paid.length, openDisputes: disputes.length, pendingResponses: responses.length },
  health, disputes, responses, reports };

taxDemo.then(tax => { DEMO.tax = tax;
// AI engines in the demo: the real default configuration (Claude for every agent) and zero usage, because the demo makes no live calls.
DEMO.engines = { ok: true, ...require(path.join(ROOT, 'backend', 'engines')).status({ ANTHROPIC_API_KEY: 'demo' }) };
const ADMIN = path.join(ROOT, 'admin.html');
let html = fs.readFileSync(ADMIN, 'utf8');
const S = '/*DEMO_DATA_START*/', E = '/*DEMO_DATA_END*/';
if (!html.includes(S)) throw new Error('admin.html has no DEMO_DATA markers');
html = html.slice(0, html.indexOf(S) + S.length) + 'const DEMO_DATA = ' + JSON.stringify(DEMO).replace(/<\//g, '<\\/') + ';' + html.slice(html.indexOf(E));
fs.writeFileSync(ADMIN, html);
const t = analytics[30].totals;
console.log(`admin demo data written: 30 days = ${t.visitors} visitors, ${t.searches} searches, ${t.purchases} paid, revenue ${t.revenue.map(r => r.currency + ' ' + r.amount).join(', ')}; ${reports.length} reports`);
}).catch(e => { console.error(e); process.exit(1); });
