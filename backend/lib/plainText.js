'use strict';
/** Text from strangers is kept as plain text: HTML tags and comments are removed on the way in, as a second line behind escaping on the way out. A "<" or ">" used as a sign (a price below 5 lakh) stays. */

const LINE_BREAKS = new RegExp('[\\u0000-\\u001f\\u007f\\u2028\\u2029]+', 'g');
const MARKUP = /<!--[\s\S]*?(?:-->|$)|<[/!?]?[a-zA-Z][^>]*(?:>|$)/g;

function stripMarkup(s) {
  let t = String(s == null ? '' : s), before;
  do { before = t; t = t.replace(MARKUP, ''); } while (t !== before);
  return t;
}

/** One line: markup out, control characters and line breaks turned into single spaces. */
function oneLine(s) {
  return stripMarkup(s).replace(LINE_BREAKS, ' ').replace(/ {2,}/g, ' ').trim();
}

module.exports = { stripMarkup, oneLine };
