// The pricing system, layer 1: price book, buyer country, quote engine, tax, ledger, release guardrails.
// Test IDs (Q1, B6, M5, T3, X2...) refer to the approved plan in "V1 Pricing and Payments Architecture".
const assert = require('assert');
const P = require('../pricing');
const clone = o => JSON.parse(JSON.stringify(o));
let fails = 0; const results = [];
const t = async (id, label, fn) => { try { await fn(); results.push(['ok', id, label]); } catch (e) { fails++; results.push(['FAIL', id, label + '\n       ' + String(e.message).split('\n')[0]]); } };

const ENV = { ACCESS_TOKEN_SECRET: 'unit-secret', GSTIN: '29ABCDE1234F1Z5', RAZORPAY_INTERNATIONAL: 'true', UK_VAT_NO: 'GB123456789' };
const mk = (env = ENV) => P.load(env);
const brief = (over = {}) => ({ ref: 'SK-TEST00000001', market: 'ae', project: { name: 'Creek Bay Tower B', price_from: 1800000, price_to: 1900000, price_currency: 'AED' },
  findings: [{ topic: 'price', claim: 'Listed from AED 1.8 million' }], counts: { confirmed: 0, reported: 5 }, ...over });
const buyerOf = (d, country, extra = {}) => P.resolveBuyer(d, { selected: country, ...extra });
const quote = async (d, country, over = {}, store = P.makeStore()) => P.issueQuote({ data: d, store, brief: over.brief || brief(), buyer: buyerOf(d, country), session: over.session || 's1', now: over.now || new Date('2026-10-06T10:00:00Z') });
const SOON = new Date('2026-10-06T10:01:00Z');            // a minute after the fixed issue time: verification never depends on the real clock
const ladderUsd = (d, q) => (q.taxInclusive ? q.gross : q.net) / d.book.fx.perUsd[q.currency];

(async () => {
  const d = mk();
  await t('data', 'the shipped data is internally consistent (every country has a currency, an exchange rate, a tax profile and a ladder)', async () => assert.deepStrictEqual(P.validate(d), []));

  // ---------------- quote engine ----------------
  await t('Q1', 'the same inputs on the same book give an identical quote', async () => {
    const a = await quote(d, 'GB', {}, P.makeStore()), b = await quote(d, 'GB', {}, P.makeStore());
    assert.deepStrictEqual([a.grossMinor, a.taxMinor, a.rung, a.targetUsd, a.currency], [b.grossMinor, b.taxMinor, b.rung, b.targetUsd, b.currency]);
  });
  await t('Q2', 'the same property and depth cost the same dollar value (within 5%) for a buyer in EVERY country on sale', async () => {
    const on = [...d.countries.keys()].filter(c => P.saleStatus(d, c).onSale); assert(on.length >= 10, 'countries on sale: ' + on.length);
    const vals = []; for (const c of on) { const q = await quote(d, c); vals.push(ladderUsd(d, q)); }
    assert(Math.max(...vals) / Math.min(...vals) <= 1.10, 'spread ' + (Math.max(...vals) / Math.min(...vals)).toFixed(3));
  });
  await t('Q3', 'the fee never falls below the floor rung or rises above the cap rung', async () => {
    const tiny = await quote(d, 'IN', { brief: brief({ project: { price_from: 20000, price_to: 20000, price_currency: 'USD' }, counts: { confirmed: 0, reported: 1 } }) });
    const huge = await quote(d, 'IN', { brief: brief({ project: { price_from: 5e7, price_to: 5e7, price_currency: 'USD' }, counts: { confirmed: 3, reported: 0 } }) });
    assert.strictEqual(tiny.rung, 0); assert.strictEqual(huge.rung, d.book.rungsUsd.length - 1);
    assert(tiny.targetUsd >= d.book.params.floorUsd * 0.6 - 0.01 && huge.targetUsd <= d.book.params.capUsd);
  });
  await t('Q4', 'Gold costs more than Heavy, and Heavy more than Thin, for the same property', async () => {
    const mid = { project: { price_from: 2e6, price_to: 2e6, price_currency: 'AED' } };
    const g = await quote(d, 'GB', { brief: brief({ ...mid, counts: { confirmed: 3, reported: 0 } }) }), h = await quote(d, 'GB', { brief: brief({ ...mid, counts: { confirmed: 0, reported: 5 } }) }), th = await quote(d, 'GB', { brief: brief({ ...mid, counts: { confirmed: 0, reported: 1 } }) });
    assert(g.grossMinor > h.grossMinor && h.grossMinor > th.grossMinor, [g.gross, h.gross, th.gross].join(' > '));
  });
  await t('Q5', 'a property with no listed price is priced as the reference purchase', async () => {
    const q = await quote(d, 'IN', { brief: brief({ project: { name: 'x' }, counts: { confirmed: 3, reported: 0 } }) });
    assert.strictEqual(q.basis, 'reference'); assert(Math.abs(d.book.rungsUsd[q.rung] - d.book.params.refUsd) < 0.2, 'the reference purchase is the book\'s reference price');
    const noFinding = await quote(d, 'IN', { brief: brief({ findings: [] }) }); assert.strictEqual(noFinding.basis, 'reference', 'a price with no surviving price finding is not used');
  });
  await t('Q6', "a property price in another currency is converted at the BOOK'S frozen rate, never a live one", async () => {
    const d2 = mk(); d2.book = clone(d.book); d2.book.fx.perUsd.AED = 1.0;                      // an absurd rate: AED 1.85 M becomes $1.85 M
    const a = await quote(d, 'GB'), b = await quote(d2, 'GB');
    assert(b.rung > a.rung, 'a different frozen rate must change the result: ' + a.rung + ' vs ' + b.rung);
    const src = require('fs').readFileSync(require.resolve('../pricing/quote.js'), 'utf8'); assert(!/fetch\(|https?:\/\//.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'the quote engine makes no network call');
  });
  await t('Q7', 'a tampered quote is rejected', async () => {
    const q = await quote(d, 'GB'); assert(P.verifyQuote(q, ENV, SOON).ok);
    for (const k of ['grossMinor', 'taxMinor', 'currency']) { const x = clone(q); x[k] = k === 'currency' ? 'USD' : x[k] - 1; assert.strictEqual(P.verifyQuote(x, ENV, SOON).reason, 'signature', k); }
    const y = clone(q); y.buyer.country = 'IN'; assert.strictEqual(P.verifyQuote(y, ENV, SOON).reason, 'signature', 'country');
    assert.strictEqual(P.verifyQuote(q, { ...ENV, ACCESS_TOKEN_SECRET: 'other' }, SOON).reason, 'signature', 'another secret');
  });
  await t('Q8', 'a quote expires after 30 minutes and cannot be paid afterwards', async () => {
    const q = await quote(d, 'GB', { now: new Date('2026-10-06T10:00:00Z') });
    assert(P.verifyQuote(q, ENV, new Date('2026-10-06T10:29:59Z')).ok); assert.strictEqual(P.verifyQuote(q, ENV, new Date('2026-10-06T10:30:01Z')).reason, 'expired');
  });
  await t('Q9', 'a new quote for the same report and session supersedes the old one', async () => {
    const store = P.makeStore(), a = await quote(d, 'GB', {}, store), b = await quote(d, 'IN', {}, store);
    assert.strictEqual((await store.getQuote(a.id)).status, 'superseded'); assert.strictEqual((await store.getQuote(b.id)).status, 'open');
    assert.strictEqual(P.verifyQuote(await store.getQuote(a.id), ENV, SOON).reason, 'superseded');
    const other = await quote(d, 'GB', { session: 's2' }, store); assert.strictEqual((await store.getQuote(b.id)).status, 'open', "another buyer's quote does not supersede");
  });
  await t('Q10', 'a retired price book still reproduces every quote issued under it, and an open quote survives a new book (X1)', async () => {
    const store = P.makeStore(), q = await quote(d, 'GB', {}, store);
    const d2 = mk(); d2.book = clone(d.book); d2.book.version = '2026-11.1'; d2.book.fx.perUsd.GBP *= 1.05; d2.book.ladders.GBP = d2.book.ladders.GBP.map(x => x + 5);
    assert(P.verifyQuote(await store.getQuote(q.id), ENV, SOON).ok, 'the old quote is still payable'); assert.strictEqual((await store.getQuote(q.id)).priceBookVersion, d.book.version);
    const f = P.feeFor(d, { propertyUsd: P.propertyValueOf(d, brief()).usd, depth: 'heavy' }); assert.strictEqual(d.book.ladders.GBP[f.rung] * 100, q.grossMinor, 'the retired book reproduces the quote');
    const q2 = await quote(d2, 'GB'); assert.strictEqual(q2.priceBookVersion, '2026-11.1'); assert(q2.grossMinor > q.grossMinor);
  });

  // ---------------- buyer country ----------------
  await t('B1', 'billing beats selected, which beats the network country, which beats nothing', async () => {
    const r = (o) => P.resolveBuyer(d, o);
    assert.strictEqual(r({ billing: 'GB', selected: 'IN', network: 'AE' }).country, 'GB'); assert.strictEqual(r({ selected: 'IN', network: 'AE' }).country, 'IN');
    assert.strictEqual(r({ network: 'AE' }).country, 'AE'); const none = r({}); assert.strictEqual(none.country, ''); assert.strictEqual(none.reason, 'country_required'); assert.strictEqual(none.onSale, false);
    assert.strictEqual(r({ selected: 'ZZ', network: 'IN' }).country, 'IN', 'an unknown selection falls through to the next signal');
  });
  await t('B2', 'the network country is read from each supported hosting header, case-insensitively', async () => {
    for (const h of P.HEADERS) assert.strictEqual(P.networkCountry({ [h.toUpperCase()]: 'gb' }), 'GB', h);
    assert.strictEqual(P.networkCountry({ 'cf-ipcountry': 'XX', 'x-vercel-ip-country': 'AE' }), 'AE', 'the first USABLE header wins');
  });
  await t('B3', 'blank, "XX", "T1" and malformed codes are ignored', async () => {
    for (const bad of ['', 'XX', 'T1', 'USA', 'U', '12', null, undefined, '<script>', ' ']) assert.strictEqual(P.cleanCode(bad), '', String(bad));
    assert.strictEqual(P.cleanCode(' in '), 'IN');
  });
  await t('B4', 'a blocked country gets no sale and a clear reason', async () => {
    const b = buyerOf(d, 'RU'); assert.strictEqual(b.onSale, false); assert.strictEqual(b.reason, 'blocked');
    await assert.rejects(() => quote(d, 'RU'), e => e.code === 'not_on_sale' && e.reason === 'blocked');
    await assert.rejects(() => P.issueQuote({ data: d, store: P.makeStore(), brief: brief(), buyer: P.resolveBuyer(d, {}) }), e => e.code === 'country_required');
  });
  await t('B6', 'VPN: the network says Singapore, the buyer selects India: the quote is in INR and equals the Singapore quote in dollars', async () => {
    const vpn = P.resolveBuyer(d, { network: 'SG', selected: 'IN' }); assert.strictEqual(vpn.country, 'IN'); assert.strictEqual(vpn.source, 'selected');
    const a = await P.issueQuote({ data: d, store: P.makeStore(), brief: brief(), buyer: vpn }), b = await quote(d, 'SG');
    assert.strictEqual(a.currency, 'INR'); assert(Math.abs(ladderUsd(d, a) / ladderUsd(d, b) - 1) <= 0.1, 'same dollar value, so nothing to gain from lying about the country');
  });
  await t('B7', 'travelling: a billing country that differs from the selection wins, and the source says so', async () => {
    const b = P.resolveBuyer(d, { selected: 'IN', billing: 'GB', network: 'AE' }); assert.deepStrictEqual([b.country, b.source], ['GB', 'billing']);
  });

  // ---------------- money ----------------
  await t('M2', 'a currency the provider does not accept falls back to USD, flagged, never refused', async () => {
    const d2 = mk({ ...ENV, RAZORPAY_CURRENCIES: 'INR,USD,GBP' }), b = buyerOf(d2, 'CH');
    assert.deepStrictEqual([b.currency, b.fallback, b.wanted, b.onSale], ['USD', true, 'CHF', true]); const q = await P.issueQuote({ data: d2, store: P.makeStore(), brief: brief(), buyer: b }); assert.strictEqual(q.currency, 'USD');
  });
  await t('M3', 'routing comes from data: India to its INR route; foreign currencies only once international payments are confirmed', async () => {
    assert.strictEqual(P.routeFor(d, 'IN', 'INR').id, 'india-inr'); assert.strictEqual(P.routeFor(d, 'CH', 'CHF').id, 'razorpay-international');
    const off = mk({ ACCESS_TOKEN_SECRET: 'x', GSTIN: 'g' }); assert.strictEqual(P.routeFor(off, 'CH', 'CHF'), null); assert.strictEqual(P.saleStatus(off, 'CH').reason, 'no_payment_route'); assert.strictEqual(P.saleStatus(off, 'IN').onSale, true);
    // The merchant route is ON in the data but serves nothing until it is configured (both keys) and the currency has a product.
    assert(d.routes.find(r => r.provider === 'mor').enabled, 'the Merchant of Record route is on in the data');
    assert.strictEqual(P.routeFor(d, 'CH', 'CHF').id, 'razorpay-international', 'with no merchant keys it serves nothing');
    const keysOnly = mk({ ACCESS_TOKEN_SECRET: 'x', DODO_API_KEY: 'k', DODO_WEBHOOK_KEY: 'whsec_QUJD' }); keysOnly.morProducts = {};
    assert.strictEqual(P.routeFor(keysOnly, 'CH', 'USD'), null, 'keys but no product: it serves nothing');
    const ready = mk({ ACCESS_TOKEN_SECRET: 'x', DODO_API_KEY: 'k', DODO_WEBHOOK_KEY: 'whsec_QUJD' }); ready.morProducts = { USD: 'pdt_usd' };
    assert.strictEqual(P.routeFor(ready, 'CH', 'USD').provider, 'mor'); assert.notStrictEqual((P.routeFor(ready, 'IN', 'INR') || {}).provider, 'mor', 'India is never the merchant\u2019s');
  });
  await t('M4', 'rounding keeps every currency within 5% of its dollar target, in every rung', async () => {
    const r = P.release.checkGuardrails(d.book, { guardrails: d.params.guardrails, maxTaxRate: 0.255 }); assert(r.ok, JSON.stringify(r.failures)); assert(r.report.drift.max <= 0.05);
  });
  await t('M5', 'net plus tax equals gross to the smallest unit, in every country and rung, tax-inclusive and tax-exclusive', async () => {
    let n = 0;
    for (const [iso, c] of d.countries) { if (c.blocked) continue; const prof = P.taxFor(d, iso);
      for (const profile of [prof, { ...prof, mode: 'we_collect', inclusive: !prof.inclusive, rate: prof.rate || 0.2 }]) for (let r = 0; r < d.book.rungsUsd.length; r++) {
        const x = P.splitTax(d, d.book.ladders[c.currency][r], c.currency, profile); assert.strictEqual(x.netMinor + x.taxMinor, x.grossMinor, `${iso} rung ${r}`); assert(x.taxMinor >= 0 && x.netMinor > 0); n++; } }
    assert(n > 800, 'cases: ' + n);
    const inc = P.splitTax(d, 3600, 'INR', { mode: 'we_collect', rate: 0.18, inclusive: true }); assert.deepStrictEqual([inc.netMinor, inc.taxMinor, inc.grossMinor], [305085, 54915, 360000], 'the Dubai-flat example: Rs 3,050.85 + GST Rs 549.15 = Rs 3,600');
    const exc = P.splitTax(d, 100, 'CAD', { mode: 'we_collect', rate: 0.05, inclusive: false }); assert.deepStrictEqual([exc.netMinor, exc.taxMinor, exc.grossMinor], [10000, 500, 10500]);
    const bhd = P.splitTax(d, 6, 'BHD', { mode: 'we_collect', rate: 0.1, inclusive: true }); assert.strictEqual(bhd.netMinor + bhd.taxMinor, 6000, 'three-decimal currencies');
  });

  // ---------------- tax ----------------
  await t('T1', 'a new tax rate applies only to quotes issued after its start date; the old quote keeps its rate', async () => {
    const d2 = mk(); d2.tax.GB = { ...d2.tax.GB, versions: [{ validFrom: '2026-12-01', rateBps: 2500 }] };
    const before = await quote(d2, 'GB', { now: new Date('2026-11-30T10:00:00Z') }), after = await quote(d2, 'GB', { now: new Date('2026-12-02T10:00:00Z') });
    assert.strictEqual(before.taxRateBps, 2000); assert.strictEqual(after.taxRateBps, 2500); assert.strictEqual(before.grossMinor, after.grossMinor, 'a tax-inclusive price does not move; net revenue does'); assert(after.taxMinor > before.taxMinor);
  });
  await t('T0', 'tax is charged only where ShelterKart collects it: never below a threshold, never unregistered', async () => {
    const ch = await quote(d, 'CH'), ca = await quote(d, 'CA'), us = await quote(d, 'US'), gb = await quote(d, 'GB'), inn = await quote(d, 'IN');
    for (const q of [ch, ca, us]) assert.deepStrictEqual([q.taxMinor, q.taxRateBps, q.taxName], [0, 0, ''], q.buyer.country + ' charges no tax below its threshold');
    assert.strictEqual(gb.taxRateBps, 2000, 'the UK, with its VAT number configured, charges VAT'); assert.strictEqual(inn.taxRateBps, 1800);
    const unreg = await quote(mk({ ...ENV, UK_VAT_NO: '', TAX_GATE: 'off' }), 'GB'); assert.strictEqual(unreg.taxMinor, 0, 'even with the gate off (development), an unregistered country is never charged VAT');
    const caReg = await quote(mk({ ...ENV, CA_GST_NO: '123' }), 'CA'); assert.strictEqual(caReg.taxRateBps, 500); assert.strictEqual(caReg.grossMinor, caReg.netMinor + caReg.taxMinor); assert(caReg.grossMinor > ca.grossMinor, 'Canada shows prices before tax, so a registered sale adds GST on top');
  });
  await t('T2', 'a country cannot be put on sale without a complete tax profile', async () => {
    const d2 = mk(); const c = d2.countries.get('CH'); d2.countries.set('CH', { ...c, tax: 'NOPE' }); assert.strictEqual(P.saleStatus(d2, 'CH').reason, 'no_tax_profile'); assert(P.validate(d2).some(x => /CH: no tax profile/.test(x)));
    assert.strictEqual(P.saleStatus(mk({ ...ENV, UK_VAT_NO: '' }), 'GB').reason, 'registration_required'); assert.strictEqual(P.saleStatus(d, 'GB').onSale, true, 'a configured UK VAT number turns the UK on');
    assert.strictEqual(P.saleStatus(mk({ ...ENV, GSTIN: '' }), 'IN').reason, 'registration_missing'); assert.strictEqual(P.saleStatus(d, 'AE').reason, 'unverified');
    assert.strictEqual(P.saleStatus(mk({ ...ENV, TAX_PROFILES: JSON.stringify({ AE: { mode: 'not_required_yet', thresholds: [{ amount: 375000, currency: 'AED', basis: 'country' }], thresholdMode: 'any' } }) }), 'AE').onSale, true, 'the tax adviser confirming a profile turns the country on');
    assert.strictEqual(P.saleStatus(mk({ NODE_ENV: 'production', TAX_GATE: 'off', RAZORPAY_INTERNATIONAL: 'true' }), 'GB').onSale, false, 'the tax gate cannot be turned off in production');
  });
  await t('T3', 'the ledger sums twelve months per country, alerts once each at 70% and 90%, and stops selling at 100% until registered', async () => {
    const store = P.makeStore(), now = new Date('2026-10-06T10:00:00Z'), sale = cad => P.ledger.recordSale({ data: d, store, country: 'CA', grossMinor: cad * 100, taxMinor: 0, currency: 'CAD', now });
    const notes = []; const check = () => P.ledger.checkThresholds({ data: d, store, now, notify: async a => notes.push(a.level) });
    await sale(5000); assert.deepStrictEqual(await check(), [], '50%: nothing yet');
    await sale(2200); assert.deepStrictEqual((await check()).map(a => a.level), ['watch']); await sale(100); assert.deepStrictEqual(await check(), [], 'the same level is not repeated');
    await sale(1800); assert.deepStrictEqual((await check()).map(a => a.level), ['alert']);
    assert.strictEqual(await P.ledger.thresholdReached({ data: d, store, country: 'CA', now }), false);
    await sale(1500); assert.deepStrictEqual((await check()).map(a => a.level), ['reached']); assert.strictEqual(await P.ledger.thresholdReached({ data: d, store, country: 'CA', now }), true);
    const reg = mk({ ...ENV, CA_GST_NO: '123456789RT0001' }); assert.strictEqual(await P.ledger.thresholdReached({ data: reg, store, country: 'CA', now }), false, 'registered: it sells again, charging tax');
    assert.strictEqual(P.taxFor(reg, 'CA').mode, 'we_collect'); assert.deepStrictEqual(notes, ['watch', 'alert', 'reached']);
    const later = new Date('2027-11-15T10:00:00Z'); assert.strictEqual((await P.ledger.progress({ data: d, store, now: later })).find(p => p.country === 'CA').pct, 0, 'sales older than twelve months drop out');
  });
  await t('T3b', "a worldwide threshold (Switzerland) counts every country's sales, not only Switzerland's; Singapore needs BOTH its thresholds", async () => {
    const store = P.makeStore(), now = new Date('2026-10-06T10:00:00Z');
    await P.ledger.recordSale({ data: d, store, country: 'IN', grossMinor: 8_000_000 * 100, taxMinor: 0, currency: 'INR', now });                       // about CHF 68,500, all of it in India
    const p = await P.ledger.progress({ data: d, store, now }); const ch = p.find(x => x.country === 'CH'), sg = p.find(x => x.country === 'SG');
    assert(ch.pct > 0.6 && ch.pct < 0.8, 'CH ' + ch.pct); assert.strictEqual(sg.pct, 0, 'Singapore needs sales to Singapore customers as well, so progress stays at zero (the smaller of its two)');
  });
  await t('T4', 'invoice numbers run in sequence per series and financial year, with no gaps', async () => {
    const store = P.makeStore(), q = await quote(d, 'IN', {}, store), nums = [];
    for (let i = 0; i < 5; i++) nums.push((await P.invoice.issueInvoice({ data: d, store, purchase: { id: 'p' + i }, quote: q, now: new Date('2026-10-06T10:00:00Z'), env: ENV })).number);
    assert.deepStrictEqual(nums, ['SK/2026-27/000001', 'SK/2026-27/000002', 'SK/2026-27/000003', 'SK/2026-27/000004', 'SK/2026-27/000005']);
    const mar = await P.invoice.issueInvoice({ data: d, store, purchase: { id: 'p9' }, quote: q, now: new Date('2027-03-31T10:00:00Z'), env: ENV }), apr = await P.invoice.issueInvoice({ data: d, store, purchase: { id: 'p10' }, quote: q, now: new Date('2027-04-01T10:00:00Z'), env: ENV });
    assert.strictEqual(mar.number, 'SK/2026-27/000006'); assert.strictEqual(apr.number, 'SK/2027-28/000001', 'a new financial year restarts the series');
    const uk = await quote(d, 'GB', {}, store), exp = await P.invoice.issueInvoice({ data: d, store, purchase: { id: 'p11' }, quote: uk, now: new Date('2026-10-06T10:00:00Z'), env: ENV }); assert.strictEqual(exp.kind, 'export'); assert(/^SK\/EXP\//.test(exp.number));
    const par = await Promise.all([1, 2, 3, 4, 5, 6].map(i => P.invoice.issueInvoice({ data: d, store, purchase: { id: 'c' + i }, quote: q, now: new Date('2026-10-07T10:00:00Z'), env: ENV }))); assert.strictEqual(new Set(par.map(x => x.number)).size, 6, 'concurrent issues never collide');
  });
  await t('T5', 'a zero-rated export is recorded as such: the invoice says export, charges no Indian GST, and carries the LUT number', async () => {
    const q = await quote(d, 'GB'), inv = await P.invoice.issueInvoice({ data: d, store: P.makeStore(), purchase: { id: 'x' }, quote: q, env: { ...ENV, LUT_NO: 'AD2910250000001' } });
    assert.strictEqual(inv.kind, 'export'); assert(/zero-rated/i.test(inv.gstTreatment)); assert.strictEqual(inv.lut, 'AD2910250000001');
    const dom = await P.invoice.issueInvoice({ data: d, store: P.makeStore(), purchase: { id: 'y' }, quote: await quote(d, 'IN'), env: ENV }); assert.strictEqual(dom.kind, 'gst'); assert(/GST 18%/.test(dom.gstTreatment));
  });

  // ---------------- release guardrails ----------------
  const ctx = (extra = {}) => ({ guardrails: d.params.guardrails, maxTaxRate: 0.255, ...extra });
  await t('X2', 'a book that breaks the margin floor or the corridor is blocked, and says why', async () => {
    const r1 = P.release.checkGuardrails(d.book, ctx({ guardrails: { ...d.params.guardrails, marginTarget: 0.9 } })); assert(!r1.ok && r1.failures.every(f => f.rule === 'margin'));
    const b = clone(d.book); b.ladders.CHF[5] = Math.round(b.ladders.CHF[5] * 1.4); const r2 = P.release.checkGuardrails(b, ctx()); assert(r2.failures.some(f => f.rule === 'corridor' && /rung 6/.test(f.detail)));
  });
  await t('X3', 'a book that breaks the drift band or the step size is blocked; an active book that has drifted at new rates is flagged', async () => {
    const fx = clone(d.book.fx.perUsd); fx.INR *= 1.12; const r1 = P.release.checkGuardrails(d.book, ctx({ currentFx: fx })); assert(!r1.ok && r1.report.drift.drifted.includes('INR') && !r1.report.drift.drifted.includes('GBP'));
    const same = P.release.checkGuardrails(d.book, ctx({ currentFx: clone(d.book.fx.perUsd) })); assert(same.ok);
    const next = clone(d.book); next.version = '2026-11.1'; next.ladders.AED[3] = next.ladders.AED[3] * 2; const r2 = P.release.checkGuardrails(next, ctx({ previous: d.book })); assert(r2.failures.some(f => f.rule === 'step' && /AED rung 4/.test(f.detail)));
    assert(P.release.checkGuardrails(d.book, ctx({ previous: d.book })).ok, 'an unchanged book passes the step rule');
  });
  await t('X5', 'the generator is deterministic and reproduces the shipped book', async () => {
    const g = P.release.generateBook({ params: d.params, fx: require('../data/fx-snapshot.json'), currencies: d.currencies, version: d.book.version, now: new Date(d.book.createdAt) });
    assert.deepStrictEqual(g.ladders, d.book.ladders); assert.deepStrictEqual(g.rungsUsd, d.book.rungsUsd);
  });

  for (const [s, id, l] of results) console.log(`  ${s === 'ok' ? 'ok  ' : 'FAIL'} ${id.padEnd(4)} ${l}`);
  console.log(fails ? `\n${fails} FAILED` : '\nall passing'); process.exitCode = fails ? 1 : 0;
})();
