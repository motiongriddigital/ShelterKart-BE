// Layer 1 of the translation scrutiny: mechanical checks that catch the errors that matter most.
const fs = require('fs'), path = require('path');
const ROOT = require('path').join(__dirname, '..', '..'), T = require(ROOT + '/backend/engine/translate'), L = require(ROOT + '/backend/engine/languages');
const en = JSON.parse(fs.readFileSync(ROOT + '/i18n/en.json', 'utf8'));
const NEG_EN = /\b(not|never|no|nothing|none|without|cannot|isn’t|isn't|couldn’t|couldn't|doesn’t|don’t|won’t|aren’t|wasn’t|n’t|nor)\b/i;
const NEG = { hi: /नहीं|न |कभी|बिना|कोई नहीं|न तो|मत /, ar: /لا|لم|لن|ليس|غير|دون|بدون|ما /, fr: /\bne\b|\bn’|\bpas\b|jamais|aucun|sans|\bnon\b|\bni\b|rien/i,
  pl: /\bnie\b|nigdy|żadn|\bbez\b|brak|niczego|\bani\b|nic\b/i, 'zh-Hant': /不|未|無|沒|絕不|非|勿|別/, es: /\bno\b|nunca|ningún|ninguna|\bsin\b|nada|\bni\b/i, de: /\bnicht\b|\bnie\b|\bkein|\bohne\b|nichts|\bweder\b/i };
NEG.ja = /ない|ません|なかった|なし|ず[、。に]|未|不|無|非|一切/;
const NONLATIN = new Set(['hi', 'ar', 'zh-Hant', 'ja']);
const ALLOWED_LATIN = /^(ShelterKart|RERA|MahaRERA|TNRERA|PDF|UPI|Razorpay|WhatsApp|YouTube|SK|MB|AI|DLD|IBBI|CIN|BSE|NSE|GST|SGX|ACRA|Oqood|crore|lakh|SBI|OC|CRM|REST|Pulse|Dubai|Emaar|Properties|Creek|Harbour|Bay|Tower|Haven|Downtown|Hubtown|Limited|Celeste|South|West|Casagrand|Casamia|Premier|Builder|Private|Bloom|Crescendo|Zenith|Divinity|Utopia|Grande|Smart|Values|Homes|Casa|Beach|Canopy|Moor|Holding|Monitor|Property|Trustpilot|Ackruti|City|Prabhadevi|Worli|FY27|BHK|L\.L\.C|LLC|Building|TN|Q2|EPC|HMRC|Act|Section|India|Code|official|Legislative|Department|robots\.txt|tnreginet\.gov\.in|rera\.tn\.gov\.in|casagrand\.co\.in|hubtown\.co\.in|hubtown-celeste\.in|hubtownceleste\.com|L45200MH1989PLC050688|U70101TN2003PTC051989|U70101TN2003PLC051989|Siddharth|Nagar|of|the|and|on|in|District)$/;
const issues = []; const add = (lang, where, kind, en, tr) => issues.push({ lang, where, kind, en, tr });
function scrutinise(lang, where, src, tr, names = []) {
  const c = T.checkTranslation(src, tr, { names }); if (!c.ok) add(lang, where, 'facts: ' + c.problems.join('; '), src, tr);
  if ((src.match(/\{\w+\}/g) || []).sort().join() !== (tr.match(/\{\w+\}/g) || []).sort().join()) add(lang, where, 'placeholders', src, tr);
  if (NEG_EN.test(src) && NEG[lang] && !NEG[lang].test(tr)) add(lang, where, 'negation may be lost', src, tr);
  if (/\?\s*$/.test(src) && !/[?？؟]\s*$/.test(tr)) add(lang, where, 'question mark lost', src, tr);
  if (NONLATIN.has(lang)) { const left = (tr.replace(/https?:\/\/\S+/g, '').match(/[A-Za-z][A-Za-z.\-]{2,}/g) || []).filter(w => !ALLOWED_LATIN.test(w) && !src.includes(w + ' ') === false ? false : !ALLOWED_LATIN.test(w) && !names.some(n => n.includes(w)) && !src.includes(w));
    if (left.length) add(lang, where, 'English words left: ' + [...new Set(left)].join(', '), src, tr); }
  else if (tr === src && /[a-z]{4}/.test(src) && src.split(' ').length > 1) add(lang, where, 'identical to English', src, tr);
  const r = tr.length / Math.max(1, src.length);
  if (src.length > 25 && (r < 0.35 || r > 2.6) && !((lang === 'zh-Hant' || lang === 'ja') && r >= 0.2)) add(lang, where, `length ratio ${r.toFixed(2)}`, src, tr);
}
for (const lang of L.enabled().filter(c => c !== 'en')) {
  const d = JSON.parse(fs.readFileSync(`${ROOT}/i18n/${lang}.json`, 'utf8'));
  for (const k of en) scrutinise(lang, 'interface', k, d[k]);
  const seen = new Map(); for (const k of en) { const v = d[k]; if (v.length > 12 && seen.has(v) && seen.get(v) !== k) add(lang, 'interface', 'same translation for two different English strings', k + '  ||  ' + seen.get(v), v); seen.set(v, k); }
}
for (const f of fs.readdirSync(ROOT + '/tools/samples/translations')) {
  const [id, lang] = f.replace(/\.json$/, '').split(/\.(?=[^.]+$)/);
  const m = JSON.parse(fs.readFileSync(ROOT + '/tools/samples/translations/' + f, 'utf8'));
  const names = id === 'hubtown-celeste' ? ['Hubtown Celeste', 'Hubtown Limited'] : id === 'creek-bay-tower-b' ? ['Creek Bay Tower B', 'Emaar Properties'] : ['Casagrand Premier Builder Limited'];
  for (const [src, tr] of Object.entries(m)) scrutinise(lang, id, src, tr, names);
}
const by = {}; for (const i of issues) (by[i.lang + ' ' + i.where] = by[i.lang + ' ' + i.where] || []).push(i);
console.log('checked: ' + L.enabled().filter(c => c !== 'en').length + ' dictionaries x ' + en.length + ' strings, plus 3 sample translations');
for (const [k, v] of Object.entries(by)) { console.log(`\n== ${k}: ${v.length}`); for (const i of v) console.log(`  [${i.kind}]\n    EN: ${i.en.slice(0, 150)}\n    TR: ${i.tr.slice(0, 150)}`); }
console.log('\ntotal flags:', issues.length);
fs.writeFileSync(require('path').join(__dirname, 'flags.json'), JSON.stringify(issues, null, 1));
