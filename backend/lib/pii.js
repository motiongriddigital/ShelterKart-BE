'use strict';

// A phone number or an email address typed into the search box would
// otherwise be sent to the search provider and the model, cached in
// memory, and echoed back in brief.query. Stripped before the query
// leaves this process, not after.
const PII_PATTERNS = [
  /[\w.+-]{1,64}@[\w-]{1,63}\.[\w.-]{1,255}/g,
  /\+?\d[\d\s().-]{7,}\d/g,
];
function stripPII(s) {
  return PII_PATTERNS.reduce((acc, re) => acc.replace(re, ' '), String(s || '')).replace(/\s+/g, ' ').trim();
}

module.exports = { stripPII };
