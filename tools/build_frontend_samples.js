#!/usr/bin/env node
'use strict';
/**
 * ShelterKart -- build the reference reports into the website, so the demo shows the real product with no server.
 *
 *   node tools/build_frontend_samples.js           write the block into shelterkart-frontend.html
 *   node tools/build_frontend_samples.js --check   change nothing; exit 1 if the page is out of date
 *
 * Each report (backend/data/sample-reports/<id>.json, built by tools/build_dossier.js) is rendered by the PRODUCT's own
 * renderer (backend/engine/dossierHtml.js), which escapes every piece of text that came from the web, as the full
 * report and as the free preview. The page mounts them in a shadow root, so their styles stay their own. The block
 * sits between DOSSIER_SAMPLES markers as non-executed JSON; a test holds it to exactly this output.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'shelterkart-frontend.html');
const H = require(path.join(ROOT, 'backend', 'engine', 'dossierHtml.js'));
const B = require(path.join(ROOT, 'backend', 'engine', 'dossierBrief.js'));
const SAMPLES = [
  { id: 'celeste', place: 'Mumbai, India', flag: 'in', home: 'IN' },
  { id: 'london', place: 'London, United Kingdom', flag: 'uk', home: 'GB' },
  { id: 'dubai', place: 'Dubai, United Arab Emirates', flag: 'ae', home: 'AE' },
];
// Prices for the demo checkout: the REAL quote engine and the shipped price book, for every country a buyer can choose,
// with exactly the demo settings tools/build_samples.js uses (payment simulated; tax only where ShelterKart collects it).
// Each report is priced through the same adapter the server uses to sell it (engine/dossierBrief.js), so the demo shows
// the price the live site charges.
const PRICING = require(path.join(ROOT, 'backend', 'pricing'));
const DEMO_ENV = { NODE_ENV: 'demo', TAX_GATE: 'off', GSTIN: 'DEMO', RAZORPAY_INTERNATIONAL: 'true', ACCESS_TOKEN_SECRET: 'demo' };
const log = console.log; console.log = () => {}; const PD = PRICING.load(DEMO_ENV); console.log = log;
const DEMO_COUNTRIES = [...PD.countries.values()].filter(c => !c.blocked && c.selectable !== false).map(c => c.iso);
function quotesFor(brief) {
  const out = {};
  for (const iso of DEMO_COUNTRIES) {
    const f = PRICING.previewFee(PD, brief, PRICING.resolveBuyer(PD, { selected: iso }));
    out[iso] = { currency: f.currency, net: f.net, tax: f.tax, gross: f.price, taxName: f.taxName, taxRateBps: f.taxRateBps, taxInclusive: f.taxInclusive, fallback: f.buyer.fallback };
  }
  return out;
}
const START = '<!--DOSSIER_SAMPLES_START-->', END = '<!--DOSSIER_SAMPLES_END-->';

/** A rendered page made fit for a shadow root: its style (with :root and body moved onto the wrapper) and its <main>. */
function forShadow(html) {
  const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
  const main = (html.match(/<main>[\s\S]*<\/main>/) || [''])[0];
  const scoped = css.replace(/:root\{/g, ':host{').replace(/(^|[}\s])html\{/g, '$1.skdoc{').replace(/(^|[}\s])body\{/g, '$1.skdoc{');
  // Inside the site's card on a phone, the report's own side padding would stack with the card's: tighten it.
  return `<style>${scoped}.skdoc{display:block;overflow-wrap:break-word}.cover dd,.where,.toc a,td{overflow-wrap:anywhere}@media (max-width:40rem){main{padding:0 .85rem 2rem}.cover{padding-top:1.6rem}.cover-main{margin:2.2rem 0}}</style><div class="skdoc">${main}</div>`;
}

function build() {
  return SAMPLES.map(s => {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend', 'data', 'sample-reports', s.id + '.json'), 'utf8'));
    const name = (d.project && d.project.name) || d.query;
    const pdf = 'ShelterKart-Report-' + name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.pdf';
    const brief = B.briefOf({ ref: 'SK-DEMO' + String(SAMPLES.indexOf(s)).padStart(8, '0'), query: name, location: d.location, country: s.home, dossier: d, phase: 'complete' });
    const depth = PRICING.depthOf(brief);
    const pricing = { depth, depthLabel: PRICING.DEPTH_LABEL[depth], basis: PRICING.previewFee(PD, brief, PRICING.resolveBuyer(PD, { selected: s.home })).basis, priceBookVersion: PD.book.version };
    const quotes = quotesFor(brief), hq = quotes[s.home];
    // the preview's price is the checkout's home-country quote, so the two can never differ
    const price = hq ? { display: hq.currency === 'INR' ? '₹' + Number(hq.gross).toLocaleString('en-IN') : new Intl.NumberFormat('en-GB', { style: 'currency', currency: hq.currency, maximumFractionDigits: 0 }).format(hq.gross), line: (d.price && d.price.line) || '' } : d.price || null;
    return { id: s.id, place: s.place, flag: s.flag, home: s.home, title: name, ids: (d.project && d.project.ids) || [], pdf, price, pricing, quotes,
      preview: forShadow(H.renderPreview(B.previewDossier(d), { price })), full: forShadow(H.renderDossier(d)) };
  });
}
const block = () => `${START}<script type="application/json" id="sk-dossier-samples">${JSON.stringify(build()).replace(/<\//g, '<\\/')}</script>${END}`;

const page = fs.readFileSync(PAGE, 'utf8');
const a = page.indexOf(START), b = page.indexOf(END);
const want = block();
const current = a >= 0 && b > a ? page.slice(a, b + END.length) : null;
const mainAt = page.indexOf('\n<script>\n');
const placedRight = current && a < mainAt;
if (process.argv.includes('--check')) {
  if (current === want && placedRight) { console.log('reference reports in the page are up to date'); process.exit(0); }
  console.error(current ? 'the reference reports in the page are out of date: run node tools/build_frontend_samples.js' : 'the page has no reference-report block');
  process.exit(1);
}
// The block sits just before the page's main script: data may live anywhere, and keeping it ahead of the script means
// nothing that reads "the page's script" (tests, tools) can run into it.
const without = current ? page.replace(current + '\n', '').replace(current, '') : page;
const at = without.indexOf('\n<script>\n');
if (at < 0) { console.error('the page has no main <script> to place the reports before'); process.exit(1); }
const next = without.slice(0, at + 1) + want + '\n' + without.slice(at + 1);
fs.writeFileSync(PAGE, next);
console.log(`wrote ${SAMPLES.length} reference reports into the page (${Math.round(want.length / 1024)} KB)`);
