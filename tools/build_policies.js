'use strict';
/**
 * Builds the standalone policy pages Razorpay checks before issuing live
 * keys: About, Contact, Pricing, Refunds & Cancellation, Delivery, Terms,
 * Privacy. Usage: node tools/build_policies.js
 *
 *   - Business details come ONLY from tools/business.json. Nothing is
 *     invented: a blank required field puts a red "Draft -- not ready to
 *     publish" banner on every page and makes this script exit 1.
 *   - Prices come from the active price book through backend/pricing (the checkout's own engine), markets from markets.js.
 *   - Terms and Privacy are copied from the site's own pop-ups, so each
 *     text has exactly one source.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const B = JSON.parse(fs.readFileSync(process.env.BUSINESS_JSON || path.join(__dirname, 'business.json'), 'utf8'));   // BUSINESS_JSON: tests only
const PRICING = require(path.join(ROOT, 'backend', 'pricing'));
const { MARKETS } = require(path.join(ROOT, 'backend', 'engine', 'markets.js'));
const SITE = fs.readFileSync(path.join(ROOT, 'shelterkart-frontend.html'), 'utf8');

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const REQUIRED = [['legalName', 'registered legal name'], ['registeredAddress', 'registered address'], ['phone', 'phone number'],
  ['supportEmail', 'support email'], ['grievanceOfficer.name', "grievance officer's name"], ['grievanceOfficer.email', "grievance officer's email"]];
const get = k => k.split('.').reduce((o, p) => (o || {})[p], B);
const missing = REQUIRED.filter(([k]) => !String(get(k) || '').trim()).map(([, label]) => label);
const show = (k, label) => String(get(k) || '').trim() ? esc(get(k)) : `<mark class="todo">[${esc(label)} &mdash; to be filled in]</mark>`;

/** The inner body of one of the site's pop-ups, by its id. */
function modalBody(id) {
  const i = SITE.indexOf(`id="${id}"`);
  if (i < 0) throw new Error('pop-up not found on the site: ' + id);
  const start = SITE.indexOf('<div class="tnc-body">', i);
  if (start < 0) throw new Error('no body in pop-up ' + id);
  let depth = 0, j = start;
  for (;;) {
    const open = SITE.indexOf('<div', j + 1), close = SITE.indexOf('</div>', j + 1);
    if (close < 0) throw new Error('unbalanced pop-up ' + id);
    if (open >= 0 && open < close) { depth++; j = open; continue; }
    if (depth === 0) return SITE.slice(start + '<div class="tnc-body">'.length, close);
    depth--; j = close;
  }
}

const REGISTERS = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'backend', 'data', 'registers.json'), 'utf8')).registers;
const PAGES = [['about', 'About'], ['methodology', 'How a report is built'], ['evidence', 'How we grade evidence'], ['corrections', 'Corrections'],
               ['independence', 'Independence'], ['pricing', 'Pricing'], ['refunds', 'Refunds & Cancellation'], ['delivery', 'Delivery'],
               ['contact', 'Contact'], ['terms', 'Terms & Conditions'], ['privacy', 'Privacy Policy']];
function page(slug, title, body) {
  const nav = PAGES.map(([s, t]) => s === slug ? `<strong>${esc(t)}</strong>` : `<a href="${s}.html">${esc(t)}</a>`).join(' &middot; ');
  const draft = missing.length ? `<div class="draft"><strong>Draft &mdash; not ready to publish.</strong> Missing from tools/business.json: ${esc(missing.join(', '))}.</div>` : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ${esc(B.tradingName)}</title>
<style>
  body{ margin:0; font-family:'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif; background:#FAF8F5; color:#0A1C33; line-height:1.6; font-size:16px; }
  header{ background:#061428; border-bottom:2px solid #D3A245; padding:16px 20px; }
  header a{ font-family:'Fraunces', Georgia, serif; font-weight:600; font-size:21px; color:#F5E6C2; text-decoration:none; } header a span{ color:#BC6055; }
  main{ max-width:760px; margin:0 auto; padding:28px 20px 40px; }
  h1, h2, h3, h4{ font-family:'Fraunces', Georgia, serif; font-weight:600; line-height:1.25; } h1{ font-size:30px; margin:0 0 16px; }
  h2{ font-size:21px; margin-top:28px; } h4{ font-size:17px; margin:22px 0 6px; }
  a{ color:#163C64; } nav{ font-size:14px; color:#52657F; margin-bottom:22px; }
  table{ width:100%; border-collapse:collapse; margin:12px 0; } th, td{ text-align:left; padding:8px 6px; border-bottom:1px solid #E4DDD1; }
  th{ font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:#52657F; } td.num{ font-variant-numeric:tabular-nums; white-space:nowrap; }
  .draft{ background:#F7E3DF; color:#A32B1C; border:1px solid #A32B1C; border-radius:8px; padding:12px 14px; margin-bottom:20px; }
  mark.todo{ background:#F7E3DF; color:#A32B1C; padding:0 3px; }
  footer{ max-width:760px; margin:0 auto; padding:0 20px 40px; font-size:13px; color:#52657F; }
</style></head><body>
<header><a href="shelterkart-frontend.html">Shelter<span>Kart</span></a></header>
<main>${draft}<nav>${nav}</nav><h1>${esc(title)}</h1>
${body}</main>
<footer>${show('legalName', 'registered legal name')} &middot; ${esc(B.tradingName)}${B.gstin ? ' &middot; GSTIN ' + esc(B.gstin) : ''}</footer>
</body></html>`;
}

const fmt = p => {
  let f; try { f = new Intl.NumberFormat('en-GB', { style: 'currency', currency: p.currency, maximumFractionDigits: 0 }).format(p.amount); } catch { return p.currency + ' ' + p.amount; }
  return f.includes(p.currency) ? f : f + ' (' + p.currency + ')';   // "£39 (GBP)", but "AED 149", not "AED 149 (AED)"
};
const RD = B.refundWithinBusinessDays, YD = B.replyWithinBusinessDays;

const bodies = {
  about: `<p>${esc(B.tradingName)} checks new and off-plan homes against the public record before you commit your savings. Search any project or developer and ShelterKart reads regulators, company registers, exchange filings and the wider web, then shows every claim with where it came from and how well it is supported &mdash; confirmed at an official source, reported by several independent sites, or resting on a single source.</p>
<p>Where sources disagree, both versions are shown side by side. Where the record is silent, you get the exact question to ask the sales, legal or CRM team. ${esc(B.tradingName)} never tells you to buy or not to buy, and no developer can pay to change what it shows.</p>
<h2>Who we are</h2><p>${esc(B.tradingName)} is run by ${show('legalName', 'registered legal name')}, ${show('registeredAddress', 'registered address')}. See <a href="contact.html">Contact</a>.</p>`,

  pricing: (() => {
    // Everything on this page is read from the active price book (backend/data/price-book.json) and computed by the
    // same quote engine the checkout uses, so the page and the price a buyer pays cannot disagree.
    const D = PRICING.load({ ACCESS_TOKEN_SECRET: 'page', GSTIN: 'page', RAZORPAY_INTERNATIONAL: 'true' }), book = D.book;
    const usd = n => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US');
    const rung = (vUsd, depth) => PRICING.feeFor(D, { propertyUsd: vUsd, depth }).rung;
    const values = [50000, 100000, 161000, 300000, 600000, 1200000, 3000000];
    const byValue = values.map(v => `<tr><td>${usd(v)} <span style="color:#52657F">(about \u20b9${(v * book.fx.perUsd.INR / 1e7).toFixed(2)} crore)</span></td>${['gold', 'heavy', 'thin'].map(dp => { const r = rung(v, dp); return `<td class="num">${esc(fmt({ amount: book.ladders.USD[r], currency: 'USD' }))} \u00b7 \u20b9${book.ladders.INR[r].toLocaleString('en-IN')}</td>`; }).join('')}</tr>`).join('');
    const ref = rung(book.params.refPropertyUsd, 'gold');
    const names = { INR: 'Indian rupee', USD: 'US dollar', EUR: 'Euro', GBP: 'Pound sterling', AED: 'UAE dirham', SAR: 'Saudi riyal', QAR: 'Qatari riyal', BHD: 'Bahraini dinar', OMR: 'Omani rial', SGD: 'Singapore dollar', CHF: 'Swiss franc', CAD: 'Canadian dollar', AUD: 'Australian dollar', NZD: 'New Zealand dollar', HKD: 'Hong Kong dollar', TWD: 'New Taiwan dollar', SEK: 'Swedish krona', NOK: 'Norwegian krone', DKK: 'Danish krone', PLN: 'Polish zloty', CZK: 'Czech koruna' };
    const byCurrency = Object.keys(book.ladders).sort((x, y) => (names[x] || x).localeCompare(names[y] || y)).map(c => { const l = book.ladders[c];
      return `<tr><td>${esc(names[c] || c)} (${c})</td><td class="num">${esc(fmt({ amount: l[ref], currency: c }))}</td><td class="num">${esc(fmt({ amount: l[0], currency: c }))} \u2013 ${esc(fmt({ amount: l[l.length - 1], currency: c }))}</td></tr>`; }).join('');
    return `<p>Searching is free, and every search shows a free preview: the project, the first findings, the topics sources disagree on, and what could not be found.</p>
<p>The <strong>full report</strong> adds every finding with its sources, what each disagreement actually says, the questions to ask and who to ask, the buyer\u2019s protections, every page checked, and a check of your own documents against the report.</p>
<h2>How the price of a report is set</h2>
<p>Each report has <strong>one price</strong>, set by code from two things, and it is <strong>the same for every buyer</strong>, wherever they are:</p>
<ul><li><strong>The value of the property.</strong> The price follows the midpoint of the project\u2019s own listed prices: a report on a more expensive home costs more, but less as a share of the home\u2019s price. Where no listed price is found, the report is priced as a typical purchase (about ${usd(book.params.refPropertyUsd)}).</li>
<li><strong>The depth of the evidence:</strong> Gold standard (high confidence, including an official source) 100%; Heavy (much of the evidence corroborated) 80%; Thin (a thin public record) 60%. ShelterKart decides this from the evidence; the buyer never chooses it.</li></ul>
<p><strong>Your country decides only the currency you pay in, the tax, and how you can pay.</strong> The price is read from a published list of round prices for your currency, so it does not move with daily exchange rates. When you unlock a report, your price is locked for ${book.params.quoteMinutes} minutes. If your billing country turns out to be different, you see the new total and confirm it before anything is charged.</p>
<p><strong>The price never depends on whether the findings favor the developer.</strong></p>
<h2>By the value of the property</h2>
<p>The price of a report in US dollars and Indian rupees (every other currency follows the same list):</p>
<table><thead><tr><th>Property value</th><th>Gold standard</th><th>Heavy</th><th>Thin</th></tr></thead><tbody>${byValue}</tbody></table>
<h2>The same report in each currency</h2>
<p>A Gold-standard report on a typical purchase, and the lowest and highest price of any report, in each currency:</p>
<table><thead><tr><th>Currency</th><th>Typical report</th><th>Lowest \u2013 highest</th></tr></thead><tbody>${byCurrency}</tbody></table>
<h2>Tax</h2>
<p>Prices include tax where ShelterKart collects it: in India, GST. Where ShelterKart is not registered for a country\u2019s tax, no tax is charged, and the checkout says so. The checkout always shows the report fee, the tax and the total as separate lines.</p>
<p style="color:#52657F">Price list ${esc(book.version)}, set from the exchange rates of ${esc(book.fx.asOf)}. A new list is published at most once a month, and never changes a price already quoted to you.</p>`;
  })(),

  refunds: `<h2>When you get a full refund</h2><p>Write to us within 7 days of paying, with your payment ID (it starts with <code>pay_</code> and is in Razorpay's receipt email), and we refund the full amount if:</p>
<ul><li>you were charged more than once for the same report;</li>
<li>the report would not open, and we could not fix it within 2 business days;</li>
<li>the report is about a different project from the one you searched for; or</li>
<li>a finding in your report is shown to be wrong against the very source it cites, and we have not corrected it within 7 days.</li></ul>
<h2>When a refund is not available</h2><p>The full report is delivered instantly and in full, so a report that opened correctly and is about the project you searched for is not refundable because you changed your mind, or because the public record contained less than you hoped. The free preview is there so you can see what the record holds before you pay.</p>
<h2>Cancellation</h2><p>Nothing is charged until a payment completes. You can close the payment window at any time before that. If a payment fails but money has left your account, your bank normally returns it automatically; if it has not appeared within 7 days, write to us with the payment ID.</p>
<h2>How refunds are paid</h2><p>We reply to every refund request within ${esc(YD)} business days. An approved refund is sent to the original payment method within ${esc(RD)} business days of approval; your bank may take a few more days to show it.</p>
<p>Write to ${show('supportEmail', 'support email')}.</p>`,

  delivery: `<p>${esc(B.tradingName)} sells digital research reports. Nothing is shipped.</p>
<p>The full report appears on screen immediately after payment, in the browser where you paid. It stays available from its link for 30 days, and you can save it as a PDF at any time from the report itself. On another device, or after clearing your browser, use <em>Restore a purchase</em> on the site with the payment ID from your Razorpay receipt.</p>
<p>If a report does not appear within a few minutes of a successful payment, write to ${show('supportEmail', 'support email')} with your payment ID; see our <a href="refunds.html">Refunds &amp; Cancellation</a> policy.</p>`,

  contact: `<table><tbody>
<tr><th>Business</th><td>${show('legalName', 'registered legal name')} (trading as ${esc(B.tradingName)})</td></tr>
<tr><th>Registered address</th><td>${show('registeredAddress', 'registered address')}</td></tr>
<tr><th>Phone</th><td>${show('phone', 'phone number')}</td></tr>
<tr><th>Support and refunds</th><td>${show('supportEmail', 'support email')}</td></tr>
<tr><th>Corrections to a report</th><td>${esc(B.correctionsEmail)}</td></tr>
</tbody></table>
<h2>Grievance Officer</h2><p>${show('grievanceOfficer.name', "grievance officer's name")}, ${esc(B.grievanceOfficer.designation || 'Grievance Officer')}<br>${show('grievanceOfficer.email', "grievance officer's email")}</p>
<p>We reply to every message within ${esc(YD)} business days.</p>`,

  // Trust pages. Methodology and Independence are the site's own text, so each exists in one place.
  methodology: modalBody('methodModal'),
  independence: modalBody('principlesModal') + `<p>${esc(B.tradingName)} is paid by buyers, for reports. A report\u2019s price depends on the project\u2019s listed price and the depth of the evidence; your country decides only the currency and the tax \u2014 never on whether the findings favor the developer.</p>`,
  evidence: `<p>Every claim in a report is graded by how well it is supported, and shown with the pages it came from. The grade is decided by code, from the sources themselves, never by the AI that read them.</p>
<h2>The grades</h2>
<p><strong>Confirmed at source.</strong> Found on an official source: a regulator, a company or insolvency register, a court, or a stock-exchange filing.</p>
<p><strong>Reported by several sites.</strong> Said by two or more independent websites. Several pages on the same website count once.</p>
<p><strong>Single source.</strong> Found on one website only. Shown to you, and marked as single-sourced until a second independent source agrees.</p>
<p><strong>Developer\u2019s own claim.</strong> From the developer\u2019s own website, brochure or social accounts, or marketing repeated by agents. Shown to you as the developer\u2019s claim; it never raises a finding or a question.</p>
<p><strong>Sources disagree.</strong> Where sources give different answers \u2014 two possession dates, three prices \u2014 every version is shown side by side, with where each came from, instead of choosing one.</p>
<h2>What is checked, and what is removed</h2>
<p>A claim is kept only if a page the research actually retrieved supports it; anything else is removed before you see the report, and the report says how many were removed, if any. Websites named after a project are often run by estate agents rather than the developer, and are treated that way. Posts on social media and forums are individual views, and are labelled as such.</p>
<p>When something could not be found, the report says so in plain words and tells you who to ask, rather than filling the gap with a guess. See also <a href="methodology.html">how a report is built</a>.</p><h2>Official registers and their licences</h2><p>Where a register confirms a developer company at source, the report names it, and the foot of every report credits the registers whose data it contains. Some of these licences make that credit a condition of reuse.</p><table><thead><tr><th>Register</th><th>Country</th><th>Licence or terms</th></tr></thead><tbody>${REGISTERS.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.country)}</td><td>${r.licenceUrl ? `<a href=\"${esc(r.licenceUrl)}\">${esc(r.licence)}</a>` : esc(r.licence)}</td></tr>`).join('')}</tbody></table>`,
  corrections: `<p>If something in a report is wrong, tell us. Every correction request is checked against the original source the finding cites.</p>
<h2>How to report an error</h2>
<p>Use <em>Report an inaccuracy</em> on any report, or write to ${esc(B.correctionsEmail)} with the report\u2019s reference (it starts with SK-) and what is wrong.</p>
<h2>What happens next</h2>
<p>We reply within ${esc(B.replyWithinBusinessDays)} business days. If the source does not say what the report says, the finding is corrected or removed; if sources genuinely disagree, both versions are shown. Submitting a request does not by itself change a finding: the source decides. A paid finding that is shown to be wrong against its own source, and is not corrected within 7 days, is refunded under our <a href="refunds.html">refund policy</a>.</p>
<h2>Developers\u2019 right of reply</h2>
<p>Any developer can reply to a finding about it, free and unconditionally. Replies are reviewed and published alongside the finding they respond to, never in place of it. A reply cannot change a finding; a correction to the underlying source can.</p>`,
  terms: modalBody('tncModal'),
  privacy: modalBody('privacyModal'),
};

const OUT = process.env.POLICY_OUT_DIR || ROOT;   // POLICY_OUT_DIR: tests only
for (const [slug, title] of PAGES) fs.writeFileSync(path.join(OUT, slug + '.html'), page(slug, title, bodies[slug]));
console.log(`wrote ${PAGES.length} pages: ${PAGES.map(([s]) => s + '.html').join(', ')}`);
if (missing.length) { console.error('NOT READY TO PUBLISH. Fill in tools/business.json: ' + missing.join(', ')); process.exitCode = 1; }
else console.log('ready to publish');
