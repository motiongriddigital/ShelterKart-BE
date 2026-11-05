'use strict';
/** The fingerprint of a post: a hash of exactly what will be published. Approval is attached to it; change one comma and it changes. */
const crypto = require('crypto'), { canonical } = require('./audit');
function content(spec) {
  const s = spec || {};
  return {
    market: s.market, lang: s.lang, platform: s.platform, title: s.title || '', body: s.body || '', hashtags: s.hashtags || [],
    links: (s.links || []).map(l => ({ url: l.url, purpose: l.purpose || '' })), scheduledUtc: s.slot && s.slot.scheduledUtc,
    media: (s.media || []).map(m => ({ kind: m.kind, alt: m.alt || '', text: m.text || '', sha256: m.sha256 || '', synthetic: Boolean(m.synthetic) })),
    disclosure: { aiGenerated: Boolean(s.disclosure && s.disclosure.aiGenerated), aiLabel: Boolean(s.disclosure && s.disclosure.aiLabel) },
    claims: (s.claims || []).map(c => c.kbId),
  };
}
const fingerprintOf = spec => crypto.createHash('sha256').update(canonical(content(spec))).digest('hex');
module.exports = { fingerprintOf, content };
