// The interface dictionaries: complete, consistent, and in step with the backend's language registry.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const L = require('../engine/languages');
let fails = 0; const ok = (l, c) => { if (!c) fails++; console.log((c ? '  ok   ' : '  FAIL ') + l); };
const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', 'en.json'), 'utf8'));
const dict = lang => JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', lang + '.json'), 'utf8'));
const placeholders = s => (String(s).match(/\{\w+\}/g) || []).sort().join(',');

ok('en.json is sorted and has no duplicates', en.length === new Set(en).size && JSON.stringify(en) === JSON.stringify([...en].sort((a, b) => a.localeCompare(b, 'en'))));
for (const code of L.enabled().filter(c => c !== 'en')) {
  const d = dict(code);
  const plural = k => /\|(zero|one|two|few|many|other)$/.test(k) && en.includes(k.replace(/\|\w+$/, '')) && k.includes('{n}');
  ok(`${code}: every one of the ${en.length} strings is translated, none is empty, none is extra (plural forms aside)`, en.every(k => typeof d[k] === 'string' && d[k].trim()) && Object.keys(d).every(k => en.includes(k) || plural(k)));
  ok(`${code}: every {placeholder} survives translation unchanged (a broken one would print "{n}" to a buyer)`, en.every(k => placeholders(k) === placeholders(d[k])));
  ok(`${code}: protected names stay in Latin script wherever the English has them (ShelterKart, RERA, PDF, Razorpay, MahaRERA; product names such as WhatsApp may follow each script’s convention)`,
    en.every(k => ['ShelterKart', 'RERA', 'PDF', 'Razorpay', 'MahaRERA'].every(n => !new RegExp('(^|[^A-Za-z])' + n + '(?![A-Za-z])').test(k) || d[k].includes(n))));
  ok(`${code}: nothing was translated into the wrong language by accident (script check)`, (() => {
    const script = { hi: /[ऀ-ॿ]/, ar: /[؀-ۿ]/, fr: /[A-Za-zÀ-ÿ]/, pl: /[A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż]/, 'zh-Hant': /[一-鿿]/, ja: /[぀-ヿ一-鿿]/, es: /[A-Za-zÁÉÍÓÚÑáéíóúñü]/, de: /[A-Za-zÄÖÜäöüß]/ }[code];
    const names = new Set(['ShelterKart', 'RERA', 'PDF', 'WhatsApp', 'crore', 'lakh']);
    return en.filter(k => /[A-Za-z]{4}/.test(k) && !names.has(k)).every(k => script.test(d[k]));
  })());
}
ok('Polish and Arabic carry the plural forms their grammar needs (Polish: few; Arabic: two, many)', Object.keys(dict('pl')).filter(k => k.endsWith('|few')).length >= 8 && ['|two', '|many'].every(c => Object.keys(dict('ar')).filter(k => k.endsWith(c)).length >= 7));
ok('the review status is truthful: every enabled language is AI-checked (recorded in i18n/REVIEW.md), and none claims a native-speaker review', L.enabled().filter(c => c !== 'en').every(c => L.LANGUAGES[c].review === 'ai') && fs.existsSync(path.join(ROOT, 'i18n', 'REVIEW.md')));
ok('every one of the 36 markets has its languages listed, and the markets whose language we offer show a choice (India, Japan, the US, Canada, Saudi Arabia, Germany)',
  (() => { const Mk = require('../engine/markets').MARKETS; return Object.keys(Mk).every(k => L.MARKET_LANGUAGES[k]) && [['in', 'hi'], ['jp', 'ja'], ['us', 'es'], ['ca', 'fr'], ['sa', 'ar'], ['de', 'de']].every(([mk, c]) => L.languagesForMarket(mk).includes(c) && L.isEnabled(c)); })());
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passing'); process.exitCode = fails ? 1 : 0;
