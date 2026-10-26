// Usage: node tools/build_samples.js   (then: cd backend && npm test)
// Every sample report goes through the REAL engine functions: marks from
// markFinding, sources from siteOf/hostOf, a real ref from briefRef, the
// free preview from previewOf. Nothing on the demo is typed by hand.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const E = path.join(ROOT, 'backend', 'engine');
const G = require(path.join(E, 'grounding.js'));
const { briefRef, previewOf } = require(path.join(E, 'access.js'));
const PRICING = require(path.join(ROOT, 'backend', 'pricing'));
// The demo prices every sample with the REAL quote engine and the shipped price book, for every country a buyer can
// choose. Payment in the demo is simulated, so it shows every country as on sale (the tax gate is a production rule:
// a live country opens only when its tax profile is complete -- see LAUNCH.md). Tax is still charged only where the
// shipped profiles say ShelterKart collects it.
const DEMO_ENV = { NODE_ENV: 'demo', TAX_GATE: 'off', GSTIN: 'DEMO', RAZORPAY_INTERNATIONAL: 'true', ACCESS_TOKEN_SECRET: 'demo' };
const PD = PRICING.load(DEMO_ENV);
const DEMO_COUNTRIES = [...PD.countries.values()].filter(c => !c.blocked && c.selectable !== false).map(c => c.iso);
function quotesFor(brief) {
  const out = {};
  for (const iso of DEMO_COUNTRIES) {
    const f = PRICING.previewFee(PD, brief, PRICING.resolveBuyer(PD, { selected: iso }));
    out[iso] = { currency: f.currency, net: f.net, tax: f.tax, gross: f.price, taxName: f.taxName, taxRateBps: f.taxRateBps, taxInclusive: f.taxInclusive, fallback: f.buyer.fallback };
  }
  return out;
}
const { protectionsFor } = require(path.join(E, 'protections.js'));
const TR = require(path.join(E, 'translate.js'));
const hostOf = G.hostOf;
const src = u => ({ url: u, site: G.siteOf(u), host: hostOf(u) });

const SAMPLES = [
  { id: 'hubtown-celeste', file: 'hubtown.json', flag: 'in', place: 'Worli, Mumbai', pdf: 'ShelterKart-Sample-India-Hubtown-Celeste.pdf' },
  { id: 'casagrand-casamia', file: 'in.json', flag: 'in', place: 'Pallavaram, Chennai', pdf: 'ShelterKart-Sample-India-Casagrand-Casamia.pdf' },
  { id: 'sutton-garden-square', file: 'uk.json', flag: 'uk', place: 'Sutton, London', pdf: 'ShelterKart-Sample-UK-Sutton-Garden-Square.pdf' },
  { id: 'river-modern', file: 'sg.json', flag: 'sg', place: 'River Valley, Singapore', pdf: 'ShelterKart-Sample-Singapore-River-Modern.pdf' },
  { id: 'creek-bay-tower-b', file: 'ae.json', flag: 'ae', place: 'Dubai Creek Harbour', pdf: 'ShelterKart-Sample-Dubai-Creek-Bay-Tower-B.pdf' },
];
const out = [], changes = [];
for (const s of SAMPLES) {
  const b = JSON.parse(fs.readFileSync(path.join(__dirname, 'samples', s.file), 'utf8'));
  const counts = { confirmed: 0, reported: 0, single: 0, developer: 0, disputed: (b.conflicts || []).length };
  const findings = b.findings.map((f, i) => {
    const urls = f.sources.map(x => x.url);
    const kind = f.kind || (f.mark === 'developer' ? 'developer_claim' : 'fact');
    const m = G.markFinding({ urls, kind, claim: f.claim }, b.query, b.project.developer);
    if (m.mark !== f.mark) changes.push(`${s.id}: "${f.claim.slice(0, 60)}..." ${f.mark} -> ${m.mark}${m.note ? ' (' + m.note + ')' : ''}`);
    counts[m.mark]++;
    // A finding read from the official register (every source is the register's own page) is registry-lane, as in a live report.
    const regUrl = b.registry && b.registry.url;
    const lane = regUrl && urls.length && urls.every(u => u === regUrl || G.isOfficial(u) && new URL(u).hostname === new URL(regUrl).hostname) ? 'registry' : 'search';
    return { id: 'f' + (i + 1), topic: f.topic || 'other', stance: ['positive', 'negative', 'neutral'].includes(f.stance) ? f.stance : 'neutral',
             claim: f.claim, mark: m.mark, sites: m.sites, note: m.note || '', lane, sources: urls.map(src) };
  });
  const cited = new Set([...findings.flatMap(f => f.sources.map(x => x.url)), ...(b.conflicts || []).flatMap(c => c.versions.map(v => v.url))]);
  const full = {
    // Credits for the official registers this sample's data came from, computed exactly as for a live report.
    credits: require(path.join(E, 'credits.js')).creditsFor(b),
    version: 1, ref: briefRef('sample|' + b.market + '|' + b.query.toLowerCase()), query: b.query, location: b.location, market: b.market,
    marketLabel: b.marketLabel, depth: b.depth, checkedAt: b.checkedAt, registry: b.registry || null,
    // The developer's own site is accepted only if the live engine's own check passes: retrieved, and carrying the developer's name.
    project: { ...b.project, developer_site: G.verifiedDeveloperSite(b.project.developer_site, b.project.developer,
      new Map(b.pages.map(p => [p.url, { url: p.url }]))) },
    notes: b.notes || [], counts, removed: b.removed || 0, findings,
    conflicts: (b.conflicts || []).map(c => ({ topic: c.topic, versions: c.versions.map(v => ({ value: v.value, ...src(v.url) })) })),
    reading: b.reading || [], gaps: b.gaps || [], questions: b.questions || [], searches: b.searches || 0,
    pages: b.pages.map(p => ({ url: p.url, title: p.title, site: G.siteOf(p.url), cited: cited.has(p.url) })),
    pipeline_status: { search: 'ok', registry: b.registry ? 'matched' : 'unavailable', degraded: false },
    responsible: b.responsible, disclaimer: b.disclaimer,
  };
  full.protections = protectionsFor(b.market, [b.project.location, b.location].filter(Boolean).join(' '));   // as every live report
  const missing = [...cited].filter(u => !full.pages.some(p => p.url === u));
  if (missing.length) throw new Error(`${s.id}: cited URLs missing from "every page checked": ${missing.join(', ')}`);
  // Translations of this sample: tools/samples/translations/<id>.<lang>.json maps each English sentence to its
  // translation. Every one is held to the SAME fact checks the live engine applies (numbers, ids, names), and a
  // translated sample must cover every sentence of its report -- the build fails otherwise, never ships a half-translation.
  const tr = {}, tdir = path.join(__dirname, 'samples', 'translations');
  for (const f of fs.existsSync(tdir) ? fs.readdirSync(tdir).filter(n => n.startsWith(s.id + '.') && n.endsWith('.json')) : []) {
    const lang = f.slice(s.id.length + 1, -5), map = JSON.parse(fs.readFileSync(path.join(tdir, f), 'utf8'));
    const names = [b.project.name, b.project.developer].filter(Boolean);
    const bad = Object.entries(map).map(([en, t]) => [en, TR.checkTranslation(en, t, { names })]).filter(([, r]) => !r.ok);
    if (bad.length) throw new Error(`${s.id} (${lang}): ${bad.length} translation(s) change a fact:\n  ` + bad.slice(0, 6).map(([en, r]) => `"${en.slice(0, 60)}" -> ${r.problems.join('; ')}`).join('\n  '));
    const need = [...new Set(TR.collectTexts(full).map(x => x.text))].filter(t => map[t] == null);
    if (need.length) throw new Error(`${s.id} (${lang}): ${need.length} sentence(s) of the report are not translated:\n  ` + need.slice(0, 6).map(t => '"' + t.slice(0, 70) + '"').join('\n  '));
    // A translation for a sentence the report no longer contains (for example, a sentence that belonged to a removed part) is
    // dropped from the file and reported. Every sentence the report does contain must still be translated: that check is above.
    const stale = Object.keys(map).filter(en => !TR.collectTexts(full).some(x => x.text === en));
    if (stale.length) { stale.forEach(en => delete map[en]); fs.writeFileSync(path.join(tdir, f), JSON.stringify(map, null, 2) + '\n'); console.log(`${s.id} (${lang}): removed ${stale.length} translation(s) for sentences the report no longer contains`); }
    tr[lang] = map;
  }
  out.push({ id: s.id, flag: s.flag, place: s.place, pdf: s.pdf, title: b.project.name, developer: b.project.developer,
             checkedAt: b.checkedAt, pricing: { depth: PRICING.depthOf(full), depthLabel: PRICING.DEPTH_LABEL[PRICING.depthOf(full)], basis: PRICING.previewFee(PD, full, PRICING.resolveBuyer(PD, { selected: 'IN' })).basis, priceBookVersion: PD.book.version }, quotes: quotesFor(full), full, preview: previewOf(full), ...(Object.keys(tr).length ? { tr } : {}) });   // the same price the server charges
}
// Rewrite the website's SAMPLE_REPORTS block in place -- the only way sample data gets into the page.
const SITE = path.join(ROOT, 'shelterkart-frontend.html');
const html = fs.readFileSync(SITE, 'utf8');
const A = 'const SAMPLE_REPORTS = ', a = html.indexOf(A), b = html.indexOf(';\n\nfunction findSample', a);
if (a < 0 || b < 0) throw new Error('SAMPLE_REPORTS block not found in shelterkart-frontend.html');
let next = html.slice(0, a + A.length) + JSON.stringify(out).replace(/<\//g, '<\\/') + html.slice(b);
// The countries a demo buyer can choose, with their currency (the live page asks /api/pricing/countries instead).
const countries = DEMO_COUNTRIES.map(iso => { const c = PD.countries.get(iso), q = PRICING.quoteCurrency(PD, iso); return { iso, name: c.name, currency: q.currency, onSale: true, reason: '' }; });
next = next.replace(/\/\*PRICING_DEMO_START\*\/[\s\S]*?\/\*PRICING_DEMO_END\*\//, () => `/*PRICING_DEMO_START*/const PRICING_DEMO = ${JSON.stringify({ countries, priceBookVersion: PD.book.version })};/*PRICING_DEMO_END*/`);
fs.writeFileSync(SITE, next);
console.log('rewrote SAMPLE_REPORTS in shelterkart-frontend.html');
console.log(changes.length ? 'engine overruled a hand mark:\n  ' + changes.join('\n  ') : 'engine agreed with every hand mark');
for (const o of out) console.log(`  ${o.id.padEnd(22)} ${o.full.ref}  counts ${JSON.stringify(o.full.counts)}  preview findings ${o.preview.findings.length}/${o.full.findings.length}` + (o.tr ? `  translated: ${Object.entries(o.tr).map(([l, m]) => l + ' ' + Object.keys(m).length).join(', ')}` : ''));
