#!/usr/bin/env node
'use strict';
/**
 * ShelterKart -- build the interface languages into the page.
 *
 *   node tools/build_i18n.js           write the dictionaries into shelterkart-frontend.html
 *   node tools/build_i18n.js --check   change nothing; exit 1 if anything is missing, extra or broken
 *
 * The English text IS the key. i18n/en.json lists every English string the page can show;
 * i18n/<code>.json maps each of them to its translation. This tool:
 *   1. finds every translatable string in the page (xlate/tx/txn/lbEl calls, the label tables,
 *      data-i18n elements) and fails if one is missing from en.json -- a forgotten string would
 *      silently stay English;
 *   2. fails if a language is missing a string, has one that en.json lacks, or has a different set
 *      of {placeholders} from its English source -- a broken placeholder prints "{n}" to a buyer;
 *   3. writes the enabled languages' dictionaries, the language list and each market's languages
 *      (from backend/engine/languages.js) between the I18N_START / I18N_END markers.
 *
 * Adding a language: add it to backend/engine/languages.js, write i18n/<code>.json, run this,
 * set `enabled: true`. Native-speaker sign-off flips `reviewed`; until then the page says the
 * translation is AI-assisted.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'shelterkart-frontend.html');
const DIR = path.join(ROOT, 'i18n');
const LANGS = require(path.join(ROOT, 'backend', 'engine', 'languages.js'));

/* ---------- finding the strings ---------- */
function unescape(lit) {                       // the text of a JS string literal, escapes resolved
  try { return Function('"use strict"; return ' + lit)(); } catch { return null; }
}
/** String literals inside source[from, to), skipping comments. */
function literalsIn(src, from, to, includeValues = false) {
  const out = [];
  for (let i = from; i < to; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < to && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1; while (j < to && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      const before = src.slice(Math.max(from, i - 6), i).trimEnd();
      const asValue = /[{,]\s*[A-Za-z_$][\w$]*\s*:\s*$/.test(src.slice(Math.max(from, i - 60), i));      // an option's value, like { month: 'long' }; a ternary branch is not
      const v = unescape(src.slice(i, j + 1)); if (v != null && !/[!=]==?$/.test(before) && (includeValues || !asValue)) out.push(v);       // not a comparison operand ('ai' in x === 'ai'), not an option value
      i = j;
    } else if (c === '`') { let j = i + 1; while (j < to && src[j] !== '`') { if (src[j] === '\\') j++; j++; } i = j; }
  }
  return out;
}
/** The end of the call whose '(' is at `open`, respecting strings. */
function callEnd(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '(') depth++; else if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return src.length;
}
/** The source text of each top-level argument of a call body. */
function topArgs(body) {
  const args = []; let depth = 0, start = 0;
  for (let i = 0; i <= body.length; i++) {
    const c = body[i];
    if (c === "'" || c === '"' || c === '`') { const q = c; i++; while (i < body.length && body[i] !== q) { if (body[i] === '\\') i++; i++; } continue; }
    if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--;
    else if ((c === ',' && depth === 0) || i === body.length) { args.push(body.slice(start, i)); start = i + 1; }
  }
  return args;
}
const NOT_WORDS = new Set(['AbortError']);
const wordy = s => typeof s === 'string' && /[A-Za-z]{2}/.test(s) && !NOT_WORDS.has(s) && !/^(lb-|m-|sk_|\/|https?:)/.test(s) && !/^[a-z]+(-[a-z]+)+$/.test(s);

function pageStrings(html) {
  const js = (html.match(/<script>([\s\S]*)<\/script>/) || [])[1] || '';
  const keys = new Set(), add = s => { if (wordy(s)) keys.add(s); };
  // the data blobs are not interface text
  const code = js.replace(/const SAMPLE_REPORTS = [\s\S]*?;\n\nfunction findSample/, 'function findSample').replace(/\/\*I18N_START\*\/[\s\S]*?\/\*I18N_END\*\//, '');
  // calls: xlate(...) tx(...) -> every literal in the argument; txn(n, one, other) -> the two forms; lbEl(tag, cls, TEXT) -> TEXT
  for (const m of code.matchAll(/\b(xlate|tx|txn|lbEl)\(/g)) {
    const open = m.index + m[0].length - 1, end = callEnd(code, open);
    const body = code.slice(open + 1, end);
    if (m[1] === 'lbEl') {
      const lits = []; let depth = 0, argStart = 0, argIdx = 0;
      for (let i = 0; i <= body.length; i++) {
        const c = body[i];
        if (c === "'" || c === '"') { const q = c; i++; while (i < body.length && body[i] !== q) { if (body[i] === '\\') i++; i++; } continue; }
        if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--;
        else if ((c === ',' && depth === 0) || i === body.length) {
          // the text argument: every literal in it counts, even inside a conditional
          if (argIdx === 2) { const arg = body.slice(argStart, i).trim(); lits.push(...literalsIn(arg, 0, arg.length)); }
          argIdx++; argStart = i + 1;
        }
      }
      lits.forEach(add);
    } else if (m[1] === 'txn') {
      const a = topArgs(body); [a[1], a[2]].filter(Boolean).forEach(x => literalsIn(x, 0, x.length).forEach(add));
    } else { const a = topArgs(body)[0] || ''; literalsIn(a, 0, a.length).forEach(add); }
  }
  // the label tables
  const table = (name, only) => {
    const i = code.indexOf('const ' + name + ' = '); if (i < 0) return;
    const j = code.indexOf(';\n', i);
    const seg = code.slice(i, j < 0 ? i + 800 : j);
    if (only) for (const m of seg.matchAll(new RegExp(only + "\\s*:\\s*('(?:[^'\\\\]|\\\\.)*'|\"(?:[^\"\\\\]|\\\\.)*\")", 'g'))) add(unescape(m[1]));
    else literalsIn(seg, name.length + 8, seg.length, true).forEach(add);        // a label table: its values ARE the text
  };
  table('LB_LABEL'); table('SAMPLE_DOSSIERS', 'city'); table('SAMPLE_DOSSIERS', 'country'); table('SCORE_BANDS', 'label'); table('RESEARCH_STEPS', 'label'); table('LB_WHEN'); table('DEPTH_MEANS'); table('LB_DOC');
  const kind = code.match(/const KIND = \{([^}]*)\}/); if (kind) literalsIn(kind[1], 0, kind[1].length, true).forEach(add);
  // static page text
  const body = html.slice(html.indexOf('<body'));
  for (const m of body.matchAll(/<([a-z0-9]+)\b[^>]*\bdata-i18n(?![-\w])[^>]*>([\s\S]*?)<\/\1>/g)) add(decode(m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()));
  for (const m of body.matchAll(/data-i18n-(?:ph|aria)="([^"]*)"/g)) add(decode(m[1]));
  return keys;
}
const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Vocabulary the SERVER sends in English and the page shows: depth words, market names. */
function serverVocabulary() {
  const out = new Set();
  const grab = (file, re) => { const t = fs.readFileSync(path.join(ROOT, 'backend', 'engine', file), 'utf8'); for (const m of t.matchAll(re)) { const v = unescape(m[1]); if (v) out.add(v); } };
  for (const w of ['High', 'Medium', 'Low', 'Research', 'Developer confirmed at source', 'registration number', 'name', 'this market', 'Gold standard', 'Heavy', 'Thin']) out.add(w);
  const { MARKETS } = require(path.join(ROOT, 'backend', 'engine', 'markets.js'));
  for (const m of Object.values(MARKETS)) { out.add(m.label); if (m.depth) out.add(m.depth); }
  out.add('India \u2014 Maharashtra'); out.add('India \u2014 Tamil Nadu');
  return out;
}
// Strings the page needs that no call site spells out as a plain literal.
const EXTRA = [', ', 'Language', 'Show English', 'Sales team', 'Translated with AI and reviewed by a native speaker. The English original governs.', 'Strong public record', 'Mixed public record \u2014 verify key points', 'Weak public record', 'Serious concerns in the public record'];

function sourceKeys(html) { const k = new Set([...pageStrings(html), ...serverVocabulary(), ...EXTRA]); return [...k].filter(Boolean).sort((a, b) => a.localeCompare(b, 'en')); }
const placeholders = s => (String(s).match(/\{\w+\}/g) || []).sort().join(',');

/* ---------- checking and writing ---------- */
function run({ check = false } = {}) {
  const html = fs.readFileSync(PAGE, 'utf8');
  const problems = [];
  const keys = sourceKeys(html);
  const enFile = path.join(DIR, 'en.json');
  const listed = fs.existsSync(enFile) ? JSON.parse(fs.readFileSync(enFile, 'utf8')) : [];
  const missingFromEn = keys.filter(k => !listed.includes(k)), staleInEn = listed.filter(k => !keys.includes(k));
  if (missingFromEn.length) problems.push(`en.json is missing ${missingFromEn.length} string(s) the page can show:\n    ` + missingFromEn.map(s => JSON.stringify(s)).join('\n    '));
  if (staleInEn.length) problems.push(`en.json lists ${staleInEn.length} string(s) the page no longer uses:\n    ` + staleInEn.map(s => JSON.stringify(s)).join('\n    '));
  const dict = {}, enabled = LANGS.enabled();
  for (const code of enabled.filter(c => c !== 'en')) {
    const f = path.join(DIR, code + '.json');
    if (!fs.existsSync(f)) { problems.push(`${code}: i18n/${code}.json does not exist but the language is enabled`); continue; }
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    const CATS = ['zero', 'one', 'two', 'few', 'many', 'other'];
    const isPlural = k => { const i = k.lastIndexOf('|'); return i > 0 && CATS.includes(k.slice(i + 1)) && listed.includes(k.slice(0, i)) && k.slice(0, i).includes('{n}'); };
    const lack = listed.filter(k => d[k] == null || String(d[k]).trim() === ''), extra = Object.keys(d).filter(k => !listed.includes(k) && !isPlural(k));
    // a plural form keeps its base's placeholders; the 'one' and 'two' forms may drop {n} (Arabic says "two pages" as one word)
    for (const k of Object.keys(d).filter(isPlural)) { const base = k.slice(0, k.lastIndexOf('|')), cat = k.slice(k.lastIndexOf('|') + 1);
      const want = placeholders(base), got = placeholders(d[k]);
      if (got !== want && !(['one', 'two'].includes(cat) && got === placeholders(base.replace('{n}', '')))) problems.push(`${code}: plural form ${JSON.stringify(k)} has placeholders ${got || '(none)'}, expected ${want}`); }
    if (lack.length) problems.push(`${code}: ${lack.length} untranslated string(s):\n    ` + lack.slice(0, 12).map(s => JSON.stringify(s)).join('\n    ') + (lack.length > 12 ? `\n    ...and ${lack.length - 12} more` : ''));
    if (extra.length) problems.push(`${code}: ${extra.length} string(s) that en.json does not have:\n    ` + extra.slice(0, 8).map(s => JSON.stringify(s)).join('\n    '));
    for (const k of listed) if (d[k] != null && placeholders(k) !== placeholders(d[k])) problems.push(`${code}: placeholders differ for ${JSON.stringify(k)} -> ${JSON.stringify(d[k])}`);
    dict[code] = Object.fromEntries([...listed.filter(k => d[k] != null).map(k => [k, d[k]]), ...Object.keys(d).filter(isPlural).sort().map(k => [k, d[k]])]);
  }
  if (problems.length) { console.error(problems.join('\n\n')); if (check) return { ok: false, problems, keys }; }
  if (check) return { ok: problems.length === 0, problems, keys };
  const langs = LANGS.publicList();
  const markets = Object.fromEntries(Object.keys(LANGS.MARKET_LANGUAGES).map(m => [m, LANGS.languagesForMarket(m)]));
  const block = `/*I18N_START*/const I18N_LANGS = ${JSON.stringify(langs)}; const I18N_MARKETS = ${JSON.stringify(markets)}; const I18N_DICT = ${JSON.stringify(dict).replace(/</g, '\\u003c')};/*I18N_END*/`;
  const next = html.replace(/\/\*I18N_START\*\/[\s\S]*?\/\*I18N_END\*\//, () => block);
  fs.writeFileSync(PAGE, next);
  console.log(`wrote ${Object.keys(dict).length} language dictionar${Object.keys(dict).length === 1 ? 'y' : 'ies'} (${listed.length} strings each) and ${langs.length} languages into the page`);
  return { ok: problems.length === 0, problems, keys };
}

if (require.main === module) {
  const arg = process.argv.slice(2);
  if (arg.includes('--init')) {            // (re)write i18n/en.json from the page: for developers adding strings
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'en.json'), JSON.stringify(sourceKeys(fs.readFileSync(PAGE, 'utf8')), null, 1) + '\n');
    console.log('i18n/en.json rewritten from the page');
  } else {
    const r = run({ check: arg.includes('--check') });
    if (!r.ok) process.exit(1);
  }
}
module.exports = { sourceKeys, pageStrings, serverVocabulary, run, placeholders };
