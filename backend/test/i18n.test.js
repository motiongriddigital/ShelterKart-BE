// The interface dictionaries: complete, consistent, and actually built into the page.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const B = require(path.join(ROOT, 'tools', 'build_i18n.js')), L = require('../engine/languages');
let fails = 0; const ok = (l, c) => { if (!c) fails++; console.log((c ? '  ok   ' : '  FAIL ') + l); };
const html = fs.readFileSync(path.join(ROOT, 'shelterkart-frontend.html'), 'utf8');
const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', 'en.json'), 'utf8'));
const dict = lang => JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', lang + '.json'), 'utf8'));
const quiet = console.error; console.error = () => {};
const check = B.run({ check: true }); console.error = quiet;

ok('every string the page can show is listed in i18n/en.json, and nothing stale is listed (a forgotten string would silently stay English)', check.ok && check.problems.length === 0);
ok('en.json is sorted and has no duplicates', en.length === new Set(en).size && JSON.stringify(en) === JSON.stringify([...en].sort((a, b) => a.localeCompare(b, 'en'))));
for (const code of L.enabled().filter(c => c !== 'en')) {
  const d = dict(code);
  const plural = k => /\|(zero|one|two|few|many|other)$/.test(k) && en.includes(k.replace(/\|\w+$/, '')) && k.includes('{n}');
  ok(`${code}: every one of the ${en.length} strings is translated, none is empty, none is extra (plural forms aside)`, en.every(k => typeof d[k] === 'string' && d[k].trim()) && Object.keys(d).every(k => en.includes(k) || plural(k)));
  ok(`${code}: every {placeholder} survives translation unchanged (a broken one would print "{n}" to a buyer)`, en.every(k => B.placeholders(k) === B.placeholders(d[k])));
  ok(`${code}: protected names stay in Latin script wherever the English has them (ShelterKart, RERA, PDF, Razorpay, MahaRERA; product names such as WhatsApp may follow each script\u2019s convention)`,
    en.every(k => ['ShelterKart', 'RERA', 'PDF', 'Razorpay', 'MahaRERA'].every(n => !new RegExp('(^|[^A-Za-z])' + n + '(?![A-Za-z])').test(k) || d[k].includes(n))));
  ok(`${code}: nothing was translated into the wrong language by accident (script check)`, (() => {
    const script = { hi: /[\u0900-\u097F]/, ar: /[\u0600-\u06FF]/, fr: /[A-Za-zÀ-ÿ]/, pl: /[A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż]/, 'zh-Hant': /[\u4E00-\u9FFF]/, ja: /[\u3040-\u30FF\u4E00-\u9FFF]/, es: /[A-Za-zÁÉÍÓÚÑáéíóúñü]/, de: /[A-Za-zÄÖÜäöüß]/ }[code];
    const names = new Set(['ShelterKart', 'RERA', 'PDF', 'WhatsApp', 'crore', 'lakh']);
    return en.filter(k => /[A-Za-z]{4}/.test(k) && !names.has(k)).every(k => script.test(d[k]));
  })());
}
const m = html.match(/\/\*I18N_START\*\/const I18N_LANGS = (\[.*?\]); const I18N_MARKETS = (\{.*?\}); const I18N_DICT = (\{.*\});\/\*I18N_END\*\//s);
ok('the page carries the language block, between its markers', Boolean(m));
const built = m ? JSON.parse(m[3].replace(/\\u003c/g, '<')) : {};
ok('the page\u2019s dictionaries are exactly the files, plural forms included (run tools/build_i18n.js after editing one)', L.enabled().filter(c => c !== 'en').every(c => { const d = dict(c); const pl = Object.keys(d).filter(k => /\|(zero|one|two|few|many|other)$/.test(k)).sort(); return JSON.stringify(built[c]) === JSON.stringify(Object.fromEntries([...en.map(k => [k, d[k]]), ...pl.map(k => [k, d[k]])])); }));
ok('Polish and Arabic carry the plural forms their grammar needs (Polish: few; Arabic: two, many)', Object.keys(dict('pl')).filter(k => k.endsWith('|few')).length >= 8 && ['|two', '|many'].every(c => Object.keys(dict('ar')).filter(k => k.endsWith(c)).length >= 7));
ok('the page\u2019s language list is the registry\u2019s: English, Hindi, Arabic (right to left), French, Polish, Traditional Chinese, Spanish, German, Japanese', m && JSON.parse(m[1]).map(l => l.code).join() === 'en,hi,ar,fr,pl,zh-Hant,es,de,ja' && JSON.parse(m[1]).find(l => l.code === 'ar').dir === 'rtl');
ok('the review status is truthful: every enabled language is AI-checked (recorded in i18n/REVIEW.md), and none claims a native-speaker review', L.enabled().filter(c => c !== 'en').every(c => L.LANGUAGES[c].review === 'ai') && fs.existsSync(path.join(ROOT, 'i18n', 'REVIEW.md')));
ok('each market in the page maps to languages the registry knows', m && Object.values(JSON.parse(m[2])).every(ls => ls.every(c => L.LANGUAGES[c])));
ok('the legal pop-ups say they are English only, until a lawyer has reviewed a translation', ['principlesModal', 'tncModal', 'privacyModal', 'methodModal'].every(id => { const i = html.indexOf('id="' + id + '"'); const j = html.indexOf('<div class="tnc-body">', i); return html.slice(j, j + 140).includes('lang-en-only'); }));
ok('the language picker, notice and suggestion are on the page, and the picker is labelled', /id="langSelect"/.test(html) && /for="langSelect"/.test(html) && /id="langNote"[^>]*role="status"/.test(html) && /id="langSuggest"/.test(html));
ok('Arabic gets right-to-left layout rules, and the score scale stays a left-to-right number line', /\[dir="rtl"\] \.lb-scale[^}]*direction:ltr/.test(html) && /\[dir="rtl"\] \.lb ul/.test(html));
ok('every one of the 36 markets has its languages listed, and the markets whose language we offer show a choice (India, Japan, the US, Canada, Saudi Arabia, Germany)',
  (() => { const Mk = require('../engine/markets').MARKETS; return Object.keys(Mk).every(k => L.MARKET_LANGUAGES[k]) && [['in', 'hi'], ['jp', 'ja'], ['us', 'es'], ['ca', 'fr'], ['sa', 'ar'], ['de', 'de']].every(([mk, c]) => L.languagesForMarket(mk).includes(c) && L.isEnabled(c)); })());
ok('the language row is on the page: it offers every language of the market, English included, and marks the current one', /function suggestLanguageFor\(market\)[\s\S]{0,400}'en'\]/.test(html) && /lang-chip/.test(html) && /aria-pressed/.test(html));
ok('market names, their button labels and the market count follow the reader\u2019s language, and are redrawn when it changes', /function localiseMarketNames\(\)/.test(html) && /localiseMarketNames\(\);\n\}/.test(html) && /capN\.textContent = xlate[\s\S]{0,120}localiseMarketNames\(\)/.test(html));
ok('an English report shown inside the page stays left to right and marked English, even on an Arabic page', /host\.setAttribute\('dir', 'ltr'\); host\.setAttribute\('lang', 'en'\)/.test(html) && /\.sk-dossier-host\{[^}]*direction:ltr/.test(html));
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passing'); process.exitCode = fails ? 1 : 0;
