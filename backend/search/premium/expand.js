'use strict';
/**
 * Premium search: the names to search under. Code only, no model: the original words, the names the index already knows for the
 * project (former names, the developer's legal companies, registration numbers), the corporate suffix both ways, joined and split
 * words, and alternative spellings of the sounds that Indian English and transliterated names vary on.
 */
const { fold } = require('../normalize');
const { GENERIC } = require('../index');

const SWAPS = [[/ee/, 'i'], [/i$/, 'ee'], [/oo/, 'u'], [/ph/, 'f'], [/f/, 'ph'], [/w/, 'v'], [/v/, 'w'], [/sh/, 's'], [/aa/, 'a'], [/ck/, 'k'], [/z/, 'j'], [/y$/, 'i']];
const COMMON = new Set([...GENERIC, 'phase', 'pvt', 'ltd', 'limited', 'private', 'tower', 'towers', 'heights', 'residency', 'realty', 'builders', 'developers']);
const SUFFIX = [[/\bpvt\.?\s+ltd\.?\b/i, 'Private Limited'], [/\bprivate\s+limited\b/i, 'Pvt Ltd'], [/\bltd\.?\b/i, 'Limited'], [/\blimited\b/i, 'Ltd']];
const ROMAN = [[/\bphase\s+(\d)\b/i, (m, n) => 'Phase ' + ['', 'I', 'II', 'III', 'IV', 'V'][Number(n)]], [/\bphase\s+(I{1,3}|IV|V)\b/i, (m, r) => 'Phase ' + ({ I: 1, II: 2, III: 3, IV: 4, V: 5 })[r.toUpperCase()]]];
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

function spellings(text) {
  const words = clean(text).split(' '), out = [];
  words.forEach((w, i) => {
    if (w.length < 4 || /\d/.test(w) || COMMON.has(w.toLowerCase())) return;
    let n = 0;
    for (const [re, b] of SWAPS) {
      const m = re.exec(w.toLowerCase());
      if (!m || n >= 2) continue;
      const alt = w.slice(0, m.index) + b + w.slice(m.index + m[0].length);
      out.push(words.map((x, j) => (j === i ? (w[0] === w[0].toUpperCase() ? alt[0].toUpperCase() + alt.slice(1) : alt) : x)).join(' ')); n++;
    }
  });
  return out;
}

/**
 * @param known names the project index holds for this project: [{ text, kind }] (kind: alias, developer, registration)
 * @returns [{ text, kind }] without duplicates, the original first, at most `max`
 */
function expandNames({ query, location = '' }, { known = [], max = 6 } = {}) {
  const base = clean(query), seen = new Set(), out = [];
  const add = (text, kind) => { const t = clean(text), k = t.toLowerCase(); if (t.length < 2 || t.length > 120 || !fold(t) || seen.has(k)) return; seen.add(k); out.push({ text: t, kind }); };
  add(base, 'original');
  for (const k of known) add(k.text, k.kind || 'alias');
  const suffix = SUFFIX.find(([re]) => re.test(base)); if (suffix) add(base.replace(suffix[0], suffix[1]), 'suffix');
  for (const [re, fn] of ROMAN) if (re.test(base)) add(base.replace(re, fn), 'numeral');
  if (/&/.test(base)) add(base.replace(/&/g, 'and'), 'and'); else if (/\band\b/i.test(base)) add(base.replace(/\band\b/gi, '&'), 'and');
  const ws = base.split(' ');
  if (ws.length === 2 && ws.every(w => w.length >= 3)) add(ws.join(''), 'joined');
  const camel = base.replace(/([a-z])([A-Z])/g, '$1 $2'); if (camel !== base) add(camel, 'split');
  for (const s of spellings(base)) add(s, 'spelling');
  return out.slice(0, Math.max(1, max));
}

module.exports = { expandNames, spellings };
