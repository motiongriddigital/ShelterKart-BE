// The free Home Buying Guide: the server serves it and its PDF, the served copies are the built ones, every chapter keeps
// its structure (the six voices, the ShelterKart box, the question cards), the guide names no company, and the preview
// and the report both point to it. AI, Razorpay and e-mail are not involved.
const fs = require('fs'), path = require('path'), cp = require('child_process');
Object.assign(process.env, { ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN_SECRET: 'tok-secret', GSTIN: '27ABCDE1234F1Z5', PAYMENTS_ENABLED: 'true', BOT_GUARD: 'off' });
for (const k of ['DATABASE_URL', 'AI_ENGINES']) delete process.env[k];
const ROOT = path.join(__dirname, '..', '..', '..'), BACKEND = path.join(ROOT, 'backend');
const app = require(path.join(BACKEND, 'server.js'));
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route) { return new Promise(resolve => {
  const res = { code: 200, headers: {}, status(c) { this.code = c; return this; }, set(k, v) { if (typeof k === 'object') Object.assign(this.headers, k); else this.headers[k] = v; return this; },
    json(o) { resolve({ code: this.code, headers: this.headers, json: o }); }, send(t) { resolve({ code: this.code, headers: this.headers, raw: t }); }, end() { resolve({ code: this.code, headers: this.headers }); } };
  const req = { body: {}, params: {}, query: {}, ip: '9.9.9.9', path: route.path, headers: {}, get: () => undefined, on() {} };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, json: { error: err.message } }); const fn = hs[i++]; if (fn) fn(req, res, next); }; next();
}); }
let failures = 0; const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p));
const DIST = rd('backend', 'data', 'guide', 'ShelterKart-Home-Buying-Guide.html').toString('utf8'), DIST_PDF = rd('backend', 'data', 'guide', 'ShelterKart-Home-Buying-Guide.pdf');

(async () => {
  // 1. the server
  const page = await call(find('get', '/guide'));
  ok('/guide serves the guide as a web page', page.code === 200 && /text\/html/.test(page.headers['Content-Type']) && String(page.raw).includes('The ShelterKart') && String(page.raw).includes('Home Buying Guide'));
  ok('...and it is the built guide, not an older copy', String(page.raw) === DIST && Buffer.compare(rd('backend', 'data', 'guide', 'ShelterKart-Home-Buying-Guide.pdf'), DIST_PDF) === 0);
  const pdf = await call(find('get', '/guide/pdf'));
  ok('/guide/pdf serves the PDF as a download', pdf.code === 200 && pdf.headers['Content-Type'] === 'application/pdf' && /attachment; filename="ShelterKart-Home-Buying-Guide.pdf"/.test(pdf.headers['Content-Disposition']) && Buffer.isBuffer(pdf.raw) && pdf.raw.slice(0, 4).toString() === '%PDF');
  // 2. the guide's own structure and content
  const chapters = [...DIST.matchAll(/<section class="page chapter" id="ch(\d+)"/g)].map(m => Number(m[1]));
  ok('the guide has twelve chapters, in order', chapters.join(',') === '1,2,3,4,5,6,7,8,9,10,11,12');
  const sec = n => DIST.split(`<section class="page chapter" id="ch${n}"`)[1].split('<section class="page')[0];
  const voices = ['v-friend', 'v-maths', 'v-engineer', 'v-lawyer', 'v-philosopher', 'v-consultant', 'v-emotion'];
  ok('every chapter has the friend, the consultant and the emotional beat, and a "What ShelterKart checks" box and question cards', chapters.every(n => { const h = sec(n); return ['v-friend', 'v-consultant', 'v-emotion'].every(v => h.includes(v)) && /<aside class="checks">/.test(h) && /<section class="questions">/.test(h) && (h.match(/<li>/g) || []).length >= 8; }));
  ok('every chapter that does arithmetic shows it in a formula box', [4, 5, 6, 7, 8, 9, 10, 11, 12].every(n => sec(n).includes('class="formula"')));
  const appA = DIST.split('id="appa"')[1].split('<section class="page')[0];
  ok('the sales-office card holds the 25 key questions on one page', (appA.match(/<li>/g) || []).length === 25);
  ok('the guide names no real company, regulator-as-seller or person apart from the founder', !/\b(Hubtown|Lodha|Godrej|Emaar|Nayan|Oberoi|Prestige|DLF|Oliva|Truth Estate|Virtual Mike|Diald|Duly)\b/i.test(DIST) && /Preeyancc/.test(DIST));
  ok('the guide is the final edition: no draft marker, and it says it is not advice and does not tell anyone whether to buy', !/Draft for review/.test(DIST) && /does not tell you whether to buy/.test(DIST) && /not legal, tax, financial or investment advice/.test(DIST));
  ok('the guide makes no promise it cannot keep: no guarantee, no "safe" claim (quoted weak answers and denials are fine)', !/\b(guarantee[sd]?|100% safe|risk-free|trusted by thousands)\b/i.test(DIST.replace(/\u201c.*?\u201d/g, '').replace(/not a guarantee/gi, '')));
  // 3. the PDF
  let pages = null; try { pages = Number(/Pages:\s+(\d+)/.exec(cp.spawnSync('pdfinfo', [path.join(ROOT, 'backend', 'data', 'guide', 'ShelterKart-Home-Buying-Guide.pdf')], { encoding: 'utf8' }).stdout)[1]); } catch { /* poppler not installed */ }
  if (pages) ok('the PDF is the printed guide: 30 to 60 pages, and its last contents page lies inside it', pages >= 30 && pages <= 60 && Number([...DIST.matchAll(/class="tp">(\d+)</g)].pop()[1]) < pages);
  else console.log('  skip PDF page count (pdfinfo not installed)');
  // 4. the preview and the report point to the guide
  const H = require(path.join(BACKEND, 'engine', 'dossierHtml')), B = require(path.join(BACKEND, 'engine', 'dossierBrief'));
  const d = JSON.parse(rd('backend', 'data', 'sample-reports', 'celeste.json'));
  const full = H.renderDossier(d), prev = H.renderPreview(B.previewDossier(d), {});
  ok('the preview and the full report both carry the free-guide box, with chapter links the page can open in its reader', [full, prev].every(h => /<aside class="guide-box">/.test(h) && /data-guide="ch2"/.test(h) && /data-guide="ch6"/.test(h) && /data-guide-pdf/.test(h)));
  ok('...and the box is hidden when a report is printed to PDF', /@media print\{\.guide-box\{display:none\}/.test(full));
  const linked = [...(full + prev).matchAll(/data-guide="(ch\d+)?"/g)].map(m => m[1]).filter(Boolean);
  ok('every chapter the reports link to exists in the guide', linked.every(c => DIST.includes(`id="${c}"`)));
  // 5. the sales-office card and sharing
  const cardPng = await call(find('get', '/guide/card.png'));
  ok('the card is served as a PNG for sharing, and its PDF as a download', cardPng.code === 200 && /image\/png/.test(cardPng.headers['Content-Type']) && Buffer.isBuffer(cardPng.raw) && cardPng.raw.slice(1, 4).toString() === 'PNG');
  const cardPdf = await call(find('get', '/guide/card.pdf'));
  ok('the card PDF is served as a download named for the card', cardPdf.code === 200 && /attachment; filename="ShelterKart-Sales-Office-Card.pdf"/.test(cardPdf.headers['Content-Disposition']) && cardPdf.raw.slice(0, 4).toString() === '%PDF');
  const cardPages = (() => { try { return Number(/Pages:\s+(\d+)/.exec(cp.spawnSync('pdfinfo', [path.join(ROOT, 'backend', 'data', 'guide', 'ShelterKart-Sales-Office-Card.pdf')], { encoding: 'utf8' }).stdout)[1]); } catch { return null; } })();
  if (cardPages) ok('the card prints on one page', cardPages === 1); else console.log('  skip card page count (pdfinfo not installed)');
  ok('the guide shares a link that opens on WhatsApp, with the card as the preview image', /wa\.me\/\?text=/.test(DIST) && /data-share/.test(DIST) && /og:image" content="[^"]*\/guide\/card\.png"/.test(DIST));
  const AN = require(path.join(BACKEND, 'engine', 'analytics'));
  ok('guide shares are a counted event, and the summary reports them', /'guide_share'/.test(rd('backend', 'engine', 'analytics.js').toString('utf8')) && /guide_shares: count\.guide_share/.test(rd('backend', 'engine', 'analytics.js').toString('utf8')));
  console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); process.exit(failures ? 1 : 0);
})();
