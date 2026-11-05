'use strict';
/**
 * The lexicon matcher. One list per category and language (data/lexicons.json); the matcher looks for a term in the text as written
 * and in three folded forms, so the usual tricks do not hide it: spaced or dotted letters ("s c a m", "s.c.a.m"), look-alike
 * Cyrillic and Greek letters, accents, zero-width characters, full-width letters, and leetspeak ("fr4ud").
 * Scripts written without spaces (Japanese, Chinese, Thai) match as substrings; everything else matches whole words only,
 * so "scampi" is not "scam". Hindi and Arabic marks count as part of a word.
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const FILE = path.join(__dirname, 'data', 'lexicons.json'), BYTES = fs.readFileSync(FILE);
const CATS = JSON.parse(BYTES.toString('utf8')).categories;
const VERSION = crypto.createHash('sha256').update(BYTES).digest('hex').slice(0, 12);
const ZW = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/g;
const NOSPACE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\u0e00-\u0e7f]/;
const HOMO = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ɡ': 'g', 'α': 'a', 'ο': 'o', 'ε': 'e', 'ρ': 'p', 'ν': 'v', 'τ': 't', 'ι': 'i', 'κ': 'k' };
const LEET = { '@': 'a', '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '$': 's', '!': 'i', '|': 'i' };
const QUOTES = /[\u2018\u2019\u02BC\u0060\u00B4]/g;   // curly and look-alike apostrophes become a plain one, so "don\u2019t" is "don't"
const base = text => String(text == null ? '' : text).normalize('NFKC').replace(ZW, '').replace(QUOTES, "'").toLowerCase();
const latin = text => { let out = ''; for (const ch of base(text)) out += HOMO[ch] || ch; return out.normalize('NFD').replace(/\p{M}+/gu, ''); };
const leet = text => { let out = ''; for (const ch of latin(text)) out += LEET[ch] || ch; return out; };
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LB = '(?<![\\p{L}\\p{M}\\p{N}])', RB = '(?![\\p{L}\\p{M}\\p{N}])';

// Endings a listed word may carry, by language: English takes plurals and verb endings only (so "scampi" is not "scam"); the Romance and
// Germanic languages up to two more letters; the Slavic, Baltic and Finnic languages, which inflect heavily, up to four; Hindi adds marks.
const TAIL = { en: "(?:s|es|ed|d|ing|er|ers|'s|s')?", fr: '\\p{L}{0,2}', es: '\\p{L}{0,2}', pt: '\\p{L}{0,2}', it: '\\p{L}{0,2}', de: '\\p{L}{0,2}', nl: '\\p{L}{0,2}', sv: '\\p{L}{0,2}', da: '\\p{L}{0,2}', no: '\\p{L}{0,2}',
  pl: '\\p{L}{0,4}', cs: '\\p{L}{0,4}', et: '\\p{L}{0,4}', lv: '\\p{L}{0,4}', lt: '\\p{L}{0,4}', fi: '\\p{L}{0,4}', hi: '[\\p{L}\\p{M}]{0,2}', ar: '\\p{L}{0,2}' };
const AR_PREFIX = '(?:\u0627\u0644|\u0648|\u0628|\u0644|\u0641|\u0643)?';
function compile(term, lang) {
  const t = base(term), letters = (t.match(/\p{L}/gu) || []).length;
  const out = { term, plain: null, spaced: null, latinOnly: false, needle: t.split(/\s+/).reduce((a, w) => (w.length > a.length ? w : a), ''), chars: '' };   // needle: a cheap substring every match must contain, tried before the regex
  if (!letters || NOSPACE.test(t)) out.plain = new RegExp(esc(t), 'u');                                       // punctuation terms and spaceless scripts: substring
  else out.plain = new RegExp(LB + (lang === 'ar' ? AR_PREFIX : '') + t.split(/\s+/).map(esc).join('[^\\p{L}\\p{N}]+') + (TAIL[lang] || '') + RB, 'u');
  const lat = latin(term), chars = lat.replace(/[^a-z0-9]/g, '');
  out.chars = chars;
  const spacedRe = () => new RegExp(LB + chars.split('').map(esc).join('[^\\p{L}\\p{N}]{0,2}') + RB, 'u');
  if (/^[a-z][a-z'\-]*$/.test(lat) && chars.length >= 4) { out.latinOnly = true; out.spaced = spacedRe(); }              // one Latin word: also catch it with separators between its letters
  else if (/^[a-z0-9][a-z0-9' \-]*$/.test(lat) && /[a-z]/.test(lat)) { out.latinOnly = true; if (chars.length >= 5) out.spaced = spacedRe(); }   // a Latin phrase: the same, once it is long enough not to match by accident
  return out;
}
const COMPILED = {};
for (const [cat, langs] of Object.entries(CATS)) COMPILED[cat] = Object.entries(langs).flatMap(([lang, terms]) => terms.map(term => ({ ...compile(term, lang), lang })));

const squeeze = x => x.replace(/[^\p{L}\p{N}]+/gu, '');
/** Every lexicon term found in the text: [{ category, term, lang, via }]. `only` limits the categories. */
function scan(text, only) {
  const b = base(text); if (!b) return [];
  let lat = null, lee = null, sqB = null, sqL = null, sqE = null; const found = [], seen = new Set();
  for (const [cat, list] of Object.entries(COMPILED)) {
    if (only && !only.includes(cat)) continue;
    for (const c of list) {
      let via = null;
      if (b.includes(c.needle) && c.plain.test(b)) via = 'text';
      else if (c.latinOnly) {
        lat = lat == null ? latin(text) : lat; lee = lee == null ? leet(text) : lee;
        if (lat.includes(c.needle) && c.plain.test(lat)) via = 'folded'; else if (lee.includes(c.needle) && c.plain.test(lee)) via = 'leet';
        else if (c.spaced) {
          sqB = sqB == null ? squeeze(b) : sqB; sqL = sqL == null ? squeeze(lat) : sqL; sqE = sqE == null ? squeeze(lee) : sqE;
          if ((sqB.includes(c.chars) || sqL.includes(c.chars) || sqE.includes(c.chars)) && (c.spaced.test(lat) || c.spaced.test(lee) || c.spaced.test(b))) via = 'spaced';
        }
      }
      if (via) { const k = cat + '|' + c.term; if (!seen.has(k)) { seen.add(k); found.push({ category: cat, term: c.term, lang: c.lang, via }); } }
    }
  }
  return found;
}
module.exports = { scan, base, latin, leet, VERSION, CATEGORIES: Object.keys(CATS), TERMS: Object.fromEntries(Object.entries(COMPILED).map(([c, l]) => [c, l.length])) };
