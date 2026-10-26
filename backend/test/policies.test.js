// The Razorpay policy pages: never publishable with invented or missing details.
const { spawnSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), BUILD = path.join(ROOT, 'tools', 'build_policies.js');
let fails = 0; const ok = (l, c) => { if (!c) fails++; console.log((c ? '  ok   ' : '  FAIL ') + l); };
const build = cfg => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pol-')); fs.writeFileSync(path.join(dir, 'business.json'), JSON.stringify(cfg));
  const r = spawnSync(process.execPath, [BUILD], { env: { ...process.env, BUSINESS_JSON: path.join(dir, 'business.json'), POLICY_OUT_DIR: dir }, encoding: 'utf8' });
  const pages = {}; for (const f of fs.readdirSync(dir)) if (f.endsWith('.html')) pages[f] = fs.readFileSync(path.join(dir, f), 'utf8'); return { code: r.status, err: r.stderr, pages }; };
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'business.json'), 'utf8'));
const blank = build({ ...base, legalName: '', registeredAddress: '', phone: '', supportEmail: '', grievanceOfficer: { name: '', email: '' } });
ok('with details missing, the build fails and names every missing detail', blank.code === 1 && /registered legal name/.test(blank.err) && /grievance officer's email/.test(blank.err));
ok('...and every page carries the red draft banner', Object.values(blank.pages).length === 11 && Object.values(blank.pages).every(h => h.includes('Draft &mdash; not ready to publish')));
const full = build({ ...base, legalName: 'Test Co Pvt Ltd', registeredAddress: '1 Test Road', phone: '+91 0', supportEmail: 's@test.example', grievanceOfficer: { name: 'A Person', designation: 'Grievance Officer', email: 'g@test.example' } });
ok('with every detail filled, the build succeeds with no banner and no placeholder', full.code === 0 && Object.values(full.pages).every(h => !h.includes('Draft &mdash;') && !h.includes('to be filled in')));
ok('all seven pages Razorpay checks exist', ['about', 'pricing', 'refunds', 'delivery', 'contact', 'terms', 'privacy'].every(s => full.pages[s + '.html']));
const P = require(path.join(ROOT, 'backend', 'pricing')), PD = P.load({ ACCESS_TOKEN_SECRET: 'x' }), book = PD.book, pg = full.pages['pricing.html'];
const refRung = P.feeFor(PD, { propertyUsd: book.params.refPropertyUsd, depth: 'gold' }).rung;
ok('the pricing page explains the model: the property and the evidence set the price, the same for every buyer; the country sets only currency, tax and payment', /the same for every buyer/.test(pg) && /Your country decides only the currency you pay in, the tax, and how you can pay/.test(pg) && /never depends on whether the findings favor the developer/.test(pg) && /locked for 30 minutes/.test(pg));
ok('the pricing page\u2019s prices are the active price book\u2019s: the typical report in rupees, pounds and dirhams, and the book version', pg.includes('\u20b9' + book.ladders.INR[refRung].toLocaleString('en-IN')) && pg.includes(String(book.ladders.GBP[refRung])) && pg.includes(String(book.ladders.AED[refRung])) && pg.includes('Price list ' + book.version));
ok('every currency in the price book is listed on the page, and nothing from the retired per-market model remains', Object.keys(book.ladders).every(c => pg.includes('(' + c + ')')) && !/Standard prices|provisional|market\u2019s standard price|income per person/.test(pg));
ok('the page says how tax works: included where collected, otherwise none, always shown as its own line', /Prices include tax where ShelterKart collects it/.test(pg) && /no tax is charged, and the checkout says so/.test(pg));
ok('the refund policy states concrete timelines, as Razorpay requires', /within 7 days of paying/.test(full.pages['refunds.html']) && /within 7 business days of approval/.test(full.pages['refunds.html']));
ok('contact shows the grievance officer', full.pages['contact.html'].includes('A Person') && full.pages['contact.html'].includes('g@test.example'));
const site = fs.readFileSync(path.join(ROOT, 'shelterkart-frontend.html'), 'utf8');
ok('terms and privacy are copied from the site itself, so each text has one source', full.pages['privacy.html'].includes('Visit statistics') && site.includes('Visit statistics'));
ok('the site footer links to pricing, refunds, contact and about', ['pricing', 'refunds', 'contact', 'about'].every(s => site.includes(`href="${s}.html"`)));
// Trust pages: present, linked, and consistent with the product itself
ok('the four trust pages exist: methodology, evidence, corrections, independence', ['methodology', 'evidence', 'corrections', 'independence'].every(p => full.pages[p + '.html']));
{
  const mi = site.indexOf('id="methodModal"'), ms = site.indexOf('<div class="tnc-body">', mi), me = site.indexOf('</div></div></div>', ms);
  const modalText = site.slice(ms + '<div class="tnc-body">'.length, me).trim();
  ok('the methodology page is the site\u2019s own methodology, word for word', full.pages['methodology.html'].includes(modalText.slice(0, 400)) && full.pages['methodology.html'].includes('How a report is built'));
  const labels = Object.values(require('vm').runInNewContext('(' + site.match(/const LB_LABEL = (\{[\s\S]*?\});/)[1] + ')'));
  const ev = full.pages['evidence.html'].replace(/\u2019/g, "'");          // compare apostrophes alike
  ok('the evidence page explains every grade the reports use', labels.length === 5 && labels.every(l => ev.includes('<strong>' + l)));
  ok('the corrections page gives the real contact and reply time', full.pages['corrections.html'].includes(base.correctionsEmail) && full.pages['corrections.html'].includes(`within ${base.replyWithinBusinessDays} business days`));
  ok('independence restates the existing principle: no developer can pay', /No developer can pay to add, change, or remove any finding, question, or part of a report/.test(full.pages['independence.html']));
  ok('the site footer links to all four trust pages', ['methodology', 'evidence', 'corrections', 'independence'].every(p => site.includes(`href="${p}.html"`)));
}
console.log(fails ? `\n${fails} FAILED` : '\nall passing'); process.exitCode = fails ? 1 : 0;
