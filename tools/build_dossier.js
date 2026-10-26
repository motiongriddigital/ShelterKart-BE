// Build a ShelterKart report from research gathered in the investigator's own format, through the product code
// (ingest -> build -> render), then print the PDFs a customer receives:
//   - the full paid report (cover, contents with page numbers, glance, questions, tracker, sources)
//   - the free preview a buyer sees before paying, with the real price from the price book
//   node tools/build_dossier.js celeste
const fs = require('fs'), path = require('path'), cp = require('child_process');
const INV = require('../backend/engine/investigator');
const H = require('../backend/engine/dossierHtml');
const D = require('../backend/engine/dossier');
const name = process.argv[2] || 'celeste';
const dir = path.join(__dirname, 'dossier'), out = path.join(__dirname, 'samples');
const read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const research = read(`${name}.research.json`), qs = read(`${name}.questions.json`);
const extra = fs.existsSync(path.join(dir, `${name}.inferences.json`)) ? read(`${name}.inferences.json`) : { inferences: [] };
const meta = research.meta || {};

const state = { project: { ids: [] }, raw: [], entities: [], units: [], sanctioned: [], filed: [], marketed: [], listings: [], botLeads: [], questions: [], unreachable: [],
  retrieved: new Set(), leads: new Map(), used: new Set(), failed: [], round: 0 };
INV.ingest(state, research, 'analyst', 0);
// Every page cited here came from a search result or an opened page during the research, so it counts as retrieved.
for (const f of research.facts || []) for (const u of f.sources || []) state.retrieved.add(u);
INV.ingest(state, qs, 'analyst', 0);
const d = INV.build(state, { query: research.project.name, location: research.project.location, market: meta.market || '', ratePct: meta.ratePct || 0, asOf: meta.asOf });
if (d.checks.delay && meta.rateBasis) d.checks.delay.basis = meta.rateBasis;
for (const i of extra.inferences) d.inferences.push({ ...i, steps: i.steps.map(s => ({ text: s.text, sources: (s.sources || []).map(url => ({ url })) })) });
d.counts.inferences = d.inferences.length;
d.panel = { engines: [], failed: [], rounds: 0 };
fs.writeFileSync(path.join(out, `dossier-${name}.json`), JSON.stringify(d, null, 1));
fs.writeFileSync(path.join(__dirname, '..', 'backend', 'data', 'sample-reports', `${name}.json`), JSON.stringify(d, null, 1));   // served at /samples/<name>

// The real price for this property, from the price book: by the property's value and the depth of the research.
let price = null;
// The price the live site charges: the dossier wrapped by the same adapter the server sells it with, priced by the real
// quote engine for a buyer in the project's own country. One path, so preview, checkout and PDF always agree.
{
  const log = console.log; console.log = () => {};
  const P = require('../backend/pricing'); const data = P.load(process.env); console.log = log;
  const B = require('../backend/engine/dossierBrief');
  const country = meta.country || 'IN';
  const brief = B.briefOf({ ref: 'SK-BUILD0000000', query: research.project.name, location: d.location, country, dossier: d, phase: 'complete' });
  const f = P.previewFee(data, brief, P.resolveBuyer(data, { selected: country }));
  const money = (n, c) => (c === 'INR' ? '₹' + Number(n).toLocaleString('en-IN') : new Intl.NumberFormat('en-GB', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n));
  const pr = brief.project, mid = pr.price_from ? (pr.price_from + pr.price_to) / 2 : 0;
  const value = !mid ? '' : pr.price_currency === 'INR' ? ` (about ₹${(Math.round(mid / 1e5) / 100).toFixed(2)} crore)` : ` (about ${money(Math.round(mid / 1000) * 1000, pr.price_currency)})`;
  price = { display: money(f.price, f.currency), line: `Set by the property's value${value} and the depth of the research. The amount you pay is confirmed at checkout.`, gross: f.price, currency: f.currency, bookVersion: data.book.version };
  console.log(`price: ${price.display} (price book ${price.bookVersion})`);
}

const printPdf = (html, pdf, footer) => cp.execFileSync('python3', [path.join(__dirname, 'print_pdf.py'), html, pdf, footer], { stdio: 'inherit' });
const pageText = (pdf, n) => cp.execFileSync('pdftotext', ['-f', String(n), '-l', String(n), '-layout', pdf, '-'], { encoding: 'utf8' });
const pageCount = pdf => Number(/Pages:\s+(\d+)/.exec(cp.execFileSync('pdfinfo', [pdf], { encoding: 'utf8' }))[1]);

// Full paid report: render, find the page of each section, render again with the contents filled in.
const fileName = research.project.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fullHtml = path.join(out, `report-${name}.html`), fullPdf = path.join(out, `ShelterKart-Report-${fileName}.pdf`);
const footer = `ShelterKart report: ${research.project.name}. ${d.ref}. Research, not advice.`;
let pages = {};
fs.writeFileSync(fullHtml, H.renderDossier(d, { pages })); printPdf(fullHtml, fullPdf, footer);
const total = pageCount(fullPdf);
for (const [id, title] of H.SECTIONS.map(s => [s[0], s[1]])) for (let n = 3; n <= total; n++) if (pageText(fullPdf, n).split('\n').some(l => l.trim() === title)) { pages[id] = n; break; }
fs.writeFileSync(fullHtml, H.renderDossier(d, { pages })); printPdf(fullHtml, fullPdf, footer);
console.log(`full report: ${pageCount(fullPdf)} pages; contents pages: ${JSON.stringify(pages)}`);

// Free preview
const prevHtml = path.join(out, `preview-${name}.html`), prevPdf = path.join(out, `ShelterKart-Preview-${fileName}.pdf`);
fs.writeFileSync(prevHtml, H.renderPreview(d, { price })); printPdf(prevHtml, prevPdf, `ShelterKart free preview: ${research.project.name}. Research, not advice.`);
console.log(`preview: ${pageCount(prevPdf)} pages`);
console.log(`${name}: ${d.counts.facts} findings, ${d.counts.sources} sources, ${d.counts.conflicts} conflicts, ${d.counts.inferences} inferences, ${d.counts.questions} questions; verdict-free: ${!D.hasVerdict(H.renderDossier(d)) && !D.hasVerdict(H.renderPreview(d))}`);
