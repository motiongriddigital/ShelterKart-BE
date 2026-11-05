'use strict';
/**
 * The card templates: one SVG per post image, drawn from the brand tokens (paper, ink, gold; Fraunces for the statement, Instrument Sans
 * and the Noto fallbacks for every script). Text is wrapped with the platform's own word segmenter, so Japanese, Chinese and Thai break
 * at word boundaries; Arabic is laid out right to left. Text that cannot fit at the smallest size is REFUSED, never clipped: a card
 * must always show the whole statement, source and disclaimer.
 */
const T = { paper: '#FAF8F5', ink: '#0A1C33', soft: '#2F4460', slate: '#52657F', rule: '#E4DDD1', gold: '#D3A245', goldDark: '#8A6321', tint: '#FBF3DE' };
const FONT_TEXT = "'Instrument Sans','Noto Sans','Noto Sans Devanagari','Noto Sans Arabic','Noto Sans JP','Noto Sans TC','Noto Sans Thai',sans-serif";
const FONT_DISPLAY = "'Fraunces',Georgia,'Noto Serif','Noto Serif Devanagari','Noto Naskh Arabic','Noto Serif JP','Noto Serif TC',serif";
const RTL = new Set(['ar', 'he', 'fa', 'ur']), SIZES = { portrait: [1080, 1350], square: [1080, 1080], landscape: [1200, 630] };
const sizeFor = platform => ({ IG: 'portrait', FB: 'square', TG: 'square', LN: 'square' }[platform] || 'square');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// An estimate of how wide a character draws, as a fraction of the font size. Slightly generous so a line never overflows.
const CJK = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/, COMPLEX = /[\u0900-\u097f\u0600-\u06ff\u0e00-\u0e7f]/;
const cw = ch => (CJK.test(ch) ? 1.02 : COMPLEX.test(ch) ? 0.62 : ch === ' ' ? 0.3 : /[A-ZÀ-ÖØ-Þ]/.test(ch) ? 0.7 : /[0-9]/.test(ch) ? 0.6 : /[.,;:!?'’"“”()\-–—·]/.test(ch) ? 0.34 : /[mwMW]/.test(ch) ? 0.88 : 0.58);
const widthOf = (s, size) => [...s].reduce((a, ch) => a + cw(ch), 0) * size;

const OPEN = /[(\[{«“‘（［｛「『【〈《]$/, CLOSE = /^[)\]}»”’）］｝」』】〉》、。，．：；！？,.:;!?…%)]/;
/** Wrap text into lines no wider than maxW at this size. Words come from Intl.Segmenter, so spaceless scripts break properly;
 *  an opening bracket is never left at the end of a line and a closing mark or full stop never starts one (kinsoku). */
function wrap(text, size, maxW, lang) {
  let seg; try { seg = [...new Intl.Segmenter(lang || 'en', { granularity: 'word' }).segment(String(text))].map(s => s.segment); } catch { seg = String(text).split(/(\s+)/); }
  const glued = [];
  for (const w of seg) {
    const last = glued[glued.length - 1];
    if (last !== undefined && CLOSE.test(w) && /^[ \u00a0\u202f]+$/.test(last) && glued.length >= 2) { glued.pop(); glued[glued.length - 1] += last + w; }     // French writes a space before a colon: it still stays with its word
    else if (last !== undefined && !/^\s+$/.test(w) && !/\n/.test(w) && (OPEN.test(last) || CLOSE.test(w))) glued[glued.length - 1] = last + w; else glued.push(w);
  }
  const lines = []; let cur = '';
  const push = () => { if (cur.trim()) lines.push(cur.replace(/\s+$/, '')); cur = ''; };
  for (const w of glued) {
    if (/^\n+$/.test(w)) { push(); continue; }
    if (widthOf(cur + w, size) <= maxW) { cur += w; continue; }
    push(); if (/^\s+$/.test(w)) continue;
    if (widthOf(w, size) <= maxW) { cur = w; continue; }
    for (const g of new Intl.Segmenter(lang || 'en', { granularity: 'grapheme' }).segment(w)) { if (widthOf(cur + g.segment, size) > maxW) push(); cur += g.segment; }   // one word wider than the line: break by letter
  }
  push(); return lines;
}
/** The largest size from `sizes` at which the text fits in maxLines, with its lines; fits is false when even the smallest overflows. */
function fit(text, sizes, maxW, maxLines, lang) {
  for (const size of sizes) { const lines = wrap(text, size, maxW, lang); if (lines.length <= maxLines) return { size, lines, fits: true }; }
  const size = sizes[sizes.length - 1]; return { size, lines: wrap(text, size, maxW, lang), fits: false };
}
/** Split the media text the marketer writes ("hook\nclaim\nsource\ndisclaimer") back into its four parts. */
function parseCardText(text) { const p = String(text || '').split('\n'); return { hook: p[0] || '', claim: p[1] || '', source: p[2] || '', disclaimer: p.slice(3).join(' ') || '' }; }

/** card_v1: market chip, hook, the statement, then source, disclaimer and wordmark pinned to the foot so every card lines up. */
function cardSvg({ lang = 'en', market = '', hook = '', claim = '', source = '', disclaimer = '', platform = 'IG', alt = '' } = {}) {
  const [W, H] = SIZES[sizeFor(platform)], rtl = RTL.has(lang), M = 84, maxW = W - 2 * M, x = rtl ? W - M : M, dir = rtl ? 'rtl' : 'ltr';
  // In SVG the anchor follows the text direction: "start" is the RIGHT edge of right-to-left text.
  const anchor = 'start', fitSmall = (txt, sizes, lines) => fit(txt, sizes, maxW, lines, lang);
  const hookF = fitSmall(hook, [42, 38, 34], 2), srcF = fitSmall(source, [36, 33, 30], 2), disF = fitSmall(disclaimer, [32, 30, 28], 3);
  const top = 150, hookH = hookF.lines.length * hookF.size * 1.3, srcH = srcF.lines.length * srcF.size * 1.35, disH = disF.lines.length * disF.size * 1.35;
  const wmH = 110, footH = 30 + srcH + 12 + disH + wmH, footTop = H - footH, claimTop = top + 30 + hookH + 30, claimMaxH = footTop - claimTop - 30;
  let claimF = null; for (const sz of [68, 62, 56, 50, 46, 42, 38, 35, 32]) { const lines = wrap(claim, sz, maxW, lang); if (lines.length * sz * 1.28 <= claimMaxH) { claimF = { size: sz, lines, fits: true }; break; } }
  if (!claimF) claimF = { size: 32, lines: wrap(claim, 32, maxW, lang), fits: false };
  const nudge = claimF.fits ? Math.round(Math.max(0, claimMaxH - claimF.lines.length * claimF.size * 1.28) * 0.3) : 0;      // a short statement sits a little lower, not glued to the top
  const fits = claimF.fits && hookF.fits && srcF.fits && disF.fits && [hook, claim, source, disclaimer].every(Boolean);
  const lines = (f, y0, lh) => f.lines.map((l, i) => `<text x="${x}" y="${Math.round(y0 + i * lh)}" text-anchor="${anchor}" direction="${dir}" unicode-bidi="plaintext">${esc(l)}</text>`).join('');
  const ruleY = Math.round(footTop + 10), srcY = ruleY + 18 + srcF.size, disY = srcY + srcF.lines.length * srcF.size * 1.35 + 4 + disF.size * 0.2;
  const chipW = Math.min(maxW, Math.round(widthOf(market, 30) + 56)), chipX = rtl ? W - M - chipW : M, wmW = 190, wmY = H - 52;      // the wordmark is about 190px wide at 38px; the dot sits just before it
  const dotX = rtl ? M + wmW + 22 : W - M - wmW - 22, wmX = rtl ? M : W - M;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(alt || claim).slice(0, 240)}"><title>${esc(alt || claim).slice(0, 240)}</title>
<rect width="${W}" height="${H}" fill="${T.paper}"/><rect x="${rtl ? W - 18 : 0}" y="0" width="18" height="${H}" fill="${T.gold}"/>
<g><rect x="${chipX}" y="64" width="${chipW}" height="52" rx="26" fill="${T.tint}" stroke="${T.gold}" stroke-width="2"/><text x="${chipX + chipW / 2}" y="98" text-anchor="middle" font-family="${FONT_TEXT}" font-size="30" font-weight="600" fill="${T.goldDark}">${esc(market)}</text></g>
<g font-family="${FONT_TEXT}" font-size="${hookF.size}" fill="${T.soft}">${lines(hookF, top + 24, hookF.size * 1.3)}</g>
<g font-family="${FONT_DISPLAY}" font-size="${claimF.size}" font-weight="600" fill="${T.ink}">${lines(claimF, claimTop + claimF.size + nudge, claimF.size * 1.28)}</g>
<rect x="${M}" y="${ruleY}" width="${maxW}" height="2" fill="${T.rule}"/>
<g font-family="${FONT_TEXT}" font-size="${srcF.size}" font-weight="600" fill="${T.ink}">${lines(srcF, srcY, srcF.size * 1.35)}</g>
<g font-family="${FONT_TEXT}" font-size="${disF.size}" fill="${T.soft}">${lines(disF, disY, disF.size * 1.35)}</g>
<g><circle cx="${dotX}" cy="${wmY - 12}" r="9" fill="${T.gold}"/><text x="${wmX}" y="${wmY}" text-anchor="${rtl ? 'start' : 'end'}" direction="ltr" font-family="${FONT_DISPLAY}" font-size="38" font-weight="600" fill="${T.ink}">ShelterKart</text></g></svg>`;
  return { svg, width: W, height: H, fits, lines: { claim: claimF.lines, hook: hookF.lines, source: srcF.lines, disclaimer: disF.lines }, claimSize: claimF.size, sizes: { claim: claimF.size, hook: hookF.size, source: srcF.size, disclaimer: disF.size }, layout: { footTop, claimTop, claimMaxH, claimBottom: Math.round(claimTop + nudge + claimF.lines.length * claimF.size * 1.28), footBottom: H - wmH } };
}
module.exports = { cardSvg, parseCardText, wrap, fit, widthOf, sizeFor, T, SIZES, RTL, esc };
