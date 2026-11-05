'use strict';
/**
 * Numbers written as words, turned into digits, so a statement that says "5 years" can be traced to a source that says "cinco años", "fünf Jahre" or "五年".
 * Languages: English, Spanish, French, German, Polish, Italian, Portuguese, Dutch, and Chinese/Japanese numerals. Compound forms are read (thirty-five, treinta y cinco,
 * trente-cinq, quatre-vingt-dix, fünfunddreißig, trzydzieści pięć, vijfendertig, 二十五). The one-forms that are also articles (one, un, une, ein, een, um) are NOT read,
 * so an article never lends a "1" to a statement. This only ever widens what a quote is allowed to support; it never narrows the digit check.
 */
const { numbers } = require('./checker');
const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/ł/g, 'l');
const mk = (str, base = {}) => { const m = { ...base }; for (const part of str.trim().split(/\s+/)) { const i = part.lastIndexOf(':'); m[part.slice(0, i)] = +part.slice(i + 1); } return m; };
const UNITS = mk(`zero:0 null:0 cero:0 two:2 three:3 four:4 five:5 six:6 seven:7 eight:8 nine:9 uno:1 dos:2 tres:3 cuatro:4 cinco:5 seis:6 siete:7 ocho:8 nueve:9 deux:2 trois:3 quatre:4 cinq:5 sept:7 huit:8 neuf:9
 eins:1 zwei:2 drei:3 vier:4 funf:5 sechs:6 sieben:7 acht:8 neun:9 jeden:1 jedna:1 jedno:1 dwa:2 dwie:2 trzy:3 cztery:4 piec:5 szesc:6 siedem:7 osiem:8 dziewiec:9 due:2 quattro:4 cinque:5 sei:6 sette:7 otto:8 nove:9
 dois:2 duas:2 quatro:4 sete:7 oito:8 twee:2 drie:3 vijf:5 zes:6 zeven:7 negen:9`);
const TEENS = mk(`ten:10 eleven:11 twelve:12 thirteen:13 fourteen:14 fifteen:15 sixteen:16 seventeen:17 eighteen:18 nineteen:19 diez:10 once:11 doce:12 trece:13 catorce:14 quince:15 dieciseis:16 diecisiete:17 dieciocho:18 diecinueve:19
 onze:11 douze:12 treize:13 quatorze:14 quinze:15 seize:16 zehn:10 elf:11 zwolf:12 dreizehn:13 vierzehn:14 funfzehn:15 sechzehn:16 siebzehn:17 achtzehn:18 neunzehn:19 dziesiec:10 jedenascie:11 dwanascie:12 trzynascie:13 czternascie:14 pietnascie:15 szesnascie:16 siedemnascie:17 osiemnascie:18 dziewietnascie:19
 dieci:10 undici:11 dodici:12 tredici:13 quattordici:14 quindici:15 sedici:16 diciassette:17 diciotto:18 diciannove:19 dez:10 onze:11 treze:13 catorze:14 quinze:15 dezesseis:16 dezessete:17 dezoito:18 dezenove:19 tien:10 twaalf:12 dertien:13 veertien:14 vijftien:15 zestien:16 zeventien:17 achttien:18 negentien:19`);
const TENS = mk(`twenty:20 thirty:30 forty:40 fifty:50 sixty:60 seventy:70 eighty:80 ninety:90 veinte:20 treinta:30 cuarenta:40 cincuenta:50 sesenta:60 setenta:70 ochenta:80 noventa:90 vingt:20 vingts:20 trente:30 quarante:40 cinquante:50 soixante:60
 zwanzig:20 dreissig:30 vierzig:40 funfzig:50 sechzig:60 siebzig:70 achtzig:80 neunzig:90 dwadziescia:20 trzydziesci:30 czterdziesci:40 piecdziesiat:50 szescdziesiat:60 siedemdziesiat:70 osiemdziesiat:80 dziewiecdziesiat:90
 venti:20 trenta:30 quaranta:40 cinquanta:50 sessanta:60 settanta:70 ottanta:80 novanta:90 vinte:20 trinta:30 quarenta:40 cinquenta:50 sessenta:60 setenta:70 oitenta:80 noventa:90 twintig:20 dertig:30 veertig:40 vijftig:50 zestig:60 zeventig:70 tachtig:80 negentig:90`);
const HUNDRED = new Set(['hundred', 'hundert', 'cien', 'ciento', 'cent', 'sto', 'cento', 'cem', 'honderd']);
const PERCENT_LEAD = new Set(['por', 'pour', 'per', 'pro', 'par']);
const CONNECT = new Set(['y', 'et', 'e', 'und', 'en']);
const VEINTI = mk(`veintiuno:21 veintidos:22 veintitres:23 veinticuatro:24 veinticinco:25 veintiseis:26 veintisiete:27 veintiocho:28 veintinueve:29 veintiun:21`);
const KANJI = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };

function kanjiNumbers(text) {
  const out = new Set();
  for (const m of String(text || '').match(/[〇零一二三四五六七八九十百]+/g) || []) {
    if (!/[十百]/.test(m)) { if (m.length > 1) out.add(String(parseInt([...m].map(c => KANJI[c]).join(''), 10))); else out.add(String(KANJI[m])); continue; }
    let n = 0, cur = 0; for (const c of m) { if (c in KANJI) cur = KANJI[c]; else if (c === '十') { n += (cur || 1) * 10; cur = 0; } else if (c === '百') { n += (cur || 1) * 100; cur = 0; } } out.add(String(n + cur));
  }
  return out;
}

/** The numbers a text spells out in words, as a set of digit strings. */
function wordNumbers(text) {
  const out = kanjiNumbers(text), toks = fold(text).split(/[^a-z]+/).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i], n1 = toks[i + 1], n2 = toks[i + 2];
    if (VEINTI[t]) { out.add(String(VEINTI[t])); continue; }
    // German and Dutch put the unit first: fünfundzwanzig / fünf und zwanzig / vijfentwintig
    const gm = /^(funf|zwei|drei|vier|sechs|sieben|acht|neun|vijf|zes|zeven|negen|twee|drie|een|ein)(?:und|en)(dreissig|zwanzig|vierzig|funfzig|sechzig|siebzig|achtzig|neunzig|twintig|dertig|veertig|vijftig|zestig|zeventig|tachtig|negentig)$/.exec(t);
    if (gm) { const u = gm[1] === 'ein' || gm[1] === 'een' ? 1 : UNITS[gm[1]]; out.add(String(TENS[gm[2]] + u)); continue; }
    if (t === 'quatre' && (n1 === 'vingt' || n1 === 'vingts')) { let v = 80, used = 1; const x = n1 === 'vingts' ? n2 : n2 === 'et' ? toks[i + 3] : n2; if (x === 'dix') { v = 90; used = 2; } else if (TEENS[x] && TEENS[x] > 10) { v = 80 + TEENS[x]; used = 2; } else if (UNITS[x] && UNITS[x] < 10) { v = 80 + UNITS[x]; used = 2; } out.add(String(v)); i += used; continue; }
    if (t === 'soixante' && (n1 === 'dix' || (TEENS[n1] && TEENS[n1] > 10))) { out.add(String(60 + (n1 === 'dix' ? 10 : TEENS[n1]))); i += 1; continue; }
    if (t === 'dix' && ['sept', 'huit', 'neuf'].includes(n1)) { out.add(String(10 + UNITS[n1])); i += 1; continue; }
    if (TENS[t]) { let v = TENS[t], k = i + 1; if (CONNECT.has(toks[k]) && UNITS[toks[k + 1]] && UNITS[toks[k + 1]] < 10) k++; if (UNITS[toks[k]] && UNITS[toks[k]] > 0 && UNITS[toks[k]] < 10) { v += UNITS[toks[k]]; i = k; } out.add(String(v)); continue; }
    if (TEENS[t]) { out.add(String(TEENS[t])); continue; }
    if (UNITS[t] !== undefined) { out.add(String(UNITS[t])); continue; }
    if (HUNDRED.has(t) && !PERCENT_LEAD.has(toks[i - 1])) out.add('100');   // "por ciento", "pour cent", "per cent" mean percent, not a hundred
  }
  return out;
}

/** Digits plus spelled-out numbers: what a quote may be traced against. */
const numbersLoose = s => new Set([...numbers(s), ...wordNumbers(s)]);

module.exports = { wordNumbers, numbersLoose };
