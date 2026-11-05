'use strict';
/**
 * ShelterKart search: reading what a buyer typed, however they typed it.
 *
 * fold()      case, accents, punctuation and '&' -> plain lower-case words
 * translit()  Devanagari (Hindi, Marathi) and Arabic script -> Latin letters, so "लोढा" and "Lodha" can meet
 * tokens()    words, with number words and phase numerals turned into digits ("phase two", "Phase II" -> "phase 2")
 * phon()      a phonetic key tuned for Indian English and transliterated names: "Shreeji"/"Shriji", "Bhakti"/"Bakti",
 *             "Realty"/"Reality", "Vasant"/"Wasant" share a key
 * sim()       how close two words are (0..1): exact, same phonetic key, or a small edit (typos, a missing letter)
 */
const DEV_V = { 'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ii', 'उ': 'u', 'ऊ': 'uu', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o' };
const DEV_M = { 'ा': 'aa', 'ि': 'i', 'ी': 'ii', 'ु': 'u', 'ू': 'uu', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e' };
const DEV_C = { 'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n', 'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n', 'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh',
  'स': 's', 'ह': 'h', 'ळ': 'l', 'क़': 'k', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'd', 'ढ़': 'dh', 'फ़': 'f' };
const DEV_X = { 'ं': 'n', 'ँ': 'n', 'ः': 'h', '्': '', '़': '', '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9', '।': ' ' };
const AR = { 'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh',
  'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': '', 'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'و': 'w', 'ي': 'y', 'ى': 'a', 'ة': 'a',
  'ء': '', 'ؤ': 'w', 'ئ': 'y', 'ـ': '', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

/** Devanagari and Arabic script to Latin letters; other text unchanged. */
function translit(s) {
  const t = String(s || '');
  if (!/[\u0900-\u097F\u0600-\u06FF]/.test(t)) return t;
  let out = '';
  const ch = [...t.normalize('NFC')];
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i], nx = ch[i + 1];
    if (DEV_C[c]) {                                   // a consonant carries an 'a' unless a vowel sign or a virama follows, or it ends the word
      out += DEV_C[c];
      if (nx && (DEV_M[nx] || nx === '्' || nx === '़')) continue;
      if (!nx || /[\s,.\-।]/.test(nx)) continue;     // the final 'a' is not spoken (schwa deletion)
      out += 'a';
    } else if (DEV_M[c]) out += DEV_M[c];
    else if (DEV_V[c]) out += DEV_V[c];
    else if (c in DEV_X) out += DEV_X[c];
    else if (c in AR) out += AR[c];
    else if (/[\u064B-\u0652]/.test(c)) continue;     // Arabic short-vowel marks
    else out += c;
  }
  return out;
}

const fold = s => translit(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[’'`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
const PART = new Set(['phase', 'ph', 'tower', 'twr', 'wing', 'block', 'building', 'bldg', 'plot', 'sector', 'stage', 'parcel', 'cluster']);
const ALIAS = { ph: 'phase', twr: 'tower', bldg: 'building', blk: 'block', apts: 'apartments', apt: 'apartment', rd: 'road', nr: 'near', opp: 'opposite', mkt: 'market', stn: 'station', sq: 'square' };

/* English property words as buyers write them in Devanagari ("हाइट्स", "टॉवर", "ग्रीन्स"), after transliteration, keyed by sound(). */
const LOAN = { haits: 'heights', haiits: 'heights', haiyts: 'heights', tavar: 'tower', tovar: 'tower', tavars: 'towers', tovars: 'towers', park: 'park', grins: 'greens',
  grin: 'green', rejidensi: 'residency', residensi: 'residency', rejidensij: 'residences', siti: 'city', plaja: 'plaza', bilding: 'building', bildings: 'buildings',
  fej: 'phase', fes: 'phase', vila: 'villa', vilaj: 'villas', enklev: 'enclave', gardan: 'garden', gardans: 'gardens', skai: 'sky', skailain: 'skyline', marina: 'marina',
  apartmants: 'apartments', apartmants2: 'apartments', hoims: 'homes', homs: 'homes', istet: 'estate', estet: 'estate', vyu: 'view', viu: 'view', si: 'sea' };
/** Words, with abbreviations expanded and number words and phase numerals as digits. */
function tokens(s) {
  const dev = /[\u0900-\u097F]/.test(String(s || ''));
  const raw = fold(s).split(/\s+/).filter(Boolean).map(w => ALIAS[w] || (dev && LOAN[sound(w)]) || w);
  return raw.map((w, i) => (NUM[w] != null && (i === 0 || PART.has(raw[i - 1]) || NUM[w] <= 12) ? String(NUM[w])
    : ROMAN[w] != null && i > 0 && PART.has(raw[i - 1]) ? String(ROMAN[w]) : w));
}

/** Phonetic spelling of one word, tuned for Indian English and transliterated names (vowels kept, sounds merged). */
function sound(w) {
  let s = String(w || '').toLowerCase();
  if (/^\d+$/.test(s)) return s;
  return s.replace(/chh/g, 'c').replace(/ch/g, 'c').replace(/ph/g, 'f').replace(/bh/g, 'b').replace(/dh/g, 'd').replace(/th/g, 't').replace(/kh/g, 'k').replace(/gh/g, 'g')
    .replace(/jh/g, 'j').replace(/sh/g, 's').replace(/ck/g, 'k').replace(/q/g, 'k').replace(/x/g, 'ks').replace(/w/g, 'v').replace(/z/g, 'j')
    .replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
    .replace(/ee|ii|ie|ea/g, 'i').replace(/oo|uu|ou/g, 'u').replace(/aa/g, 'a').replace(/ey$/g, 'i').replace(/y$/g, 'i')
    .replace(/([a-z])\1+/g, '$1');
}
/** Phonetic key: the first letter, then the consonant skeleton (vowels and a medial y dropped). */
function phon(w) {
  const s = sound(w); if (/^\d+$/.test(s)) return s;
  return (s[0] || '') + s.slice(1).replace(/[aeiouy]/g, '').replace(/([a-z])\1+/g, '$1');
}
/** Damerau-Levenshtein distance, capped. */
function dist(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

/** How close two words are, 0..1. Numbers match exactly or not at all. Short words need the same sound with their vowels;
 *  longer words may share only the consonant skeleton; any word may forgive a small typo. `skeleton` (for Arabic-script queries,
 *  which carry no short vowels) compares skeletons at any length. */
function sim(a, b, { skeleton = false } = {}) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return 0;
  const n = Math.min(a.length, b.length);
  if (n >= 3 && sound(a) === sound(b)) return 0.94;
  if ((n >= 6 || (skeleton && n >= 3)) && phon(a) === phon(b)) return 0.9;
  if (n < 4) return 0;
  const d = dist(a, b, 2), allow = n >= 8 ? 2 : n >= 5 ? 1 : 0;   // four-letter words get no typo allowance: "park" is not "pork"
  if (d <= allow) return d === 1 ? 0.86 : 0.78;
  if ((a.startsWith(b) || b.startsWith(a)) && n >= 5) return 0.8;   // "tropic" for "tropicana"
  return 0;
}

module.exports = { fold, translit, tokens, sound, phon, sim, dist, PART };
