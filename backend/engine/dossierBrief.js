'use strict';
/**
 * ShelterKart — the investigator's dossier as a report the existing commerce can sell.
 *
 * Quote, checkout, Razorpay verification, the webhook, access tokens, the review hold and retention are all keyed by a
 * report ref (SK- plus 12 hex). Wrapping each dossier in a report record under such a ref lets every one of those
 * routes serve it unchanged: there is no second payments path.
 */
const crypto = require('crypto');

const newRef = () => 'SK-' + crypto.randomBytes(6).toString('hex').toUpperCase();
// The same project typed differently ("Hubtown Celeste, Worli" / "celeste by hubtown  worli") gives the same key, so it is
// investigated once. Word order, case, punctuation and filler words do not count; the country does.
const FILLER = new Set(['by', 'the', 'at', 'in', 'of', 'and', 'a', 'an', 'project', 'residences', 'residence']);
const words = x => [...new Set(String(x || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(w => w && !FILLER.has(w)))].sort().join(' ');
const keyOf = (query, location, country) => [words(query), words(location), String(country || '').toLowerCase().trim()].join('|');

/** The listed price range from the dossier's own listings, used by the price book to set the report's price. */
function priceRange(d) {
  const r = d && d.checks && d.checks.priceRange;
  if (r && r.from > 0) return { price_from: r.from, price_to: r.to || r.from, price_currency: r.currency || 'INR' };
  const ps = ((d && d.checks && d.checks.prices) || []).filter(p => p.price > 0);
  if (!ps.length) return {};
  const cur = ps[0].currency || 'INR', same = ps.filter(p => (p.currency || 'INR') === cur).map(p => p.price);
  return { price_from: Math.min(...same), price_to: Math.max(...same), price_currency: cur };
}

/** The report record the commerce routes read. The full dossier rides inside; the public never sees it without a token. */
function briefOf({ ref, query, location, country, marketLabel, dossier = null, phase = 'starting', contact, review }) {
  const p = (dossier && dossier.project) || {};
  return {
    kind: 'dossier', ref, phase,
    query: 'dossier:' + query, location: location || '', market: String(country || '').toLowerCase(), marketLabel: marketLabel || '',
    project: { name: p.name || query, location: (dossier && dossier.location) || location || '', developer: p.promoter_legal_name || p.brand || '', ids: p.ids || [], ...priceRange(dossier) },
    findings: [], conflicts: (dossier && dossier.conflicts) || [], checkedAt: new Date().toISOString(),
    dossier, ...(contact ? { contact } : {}), ...(review ? { review } : {}),
  };
}

/** What anyone may see without paying: counts, promise-versus-record, three questions, how many more and for whom. */
function previewOf(d) {
  if (!d) return null;
  const rest = d.questions.slice(3), team = {};
  for (const q of rest) team[q.to] = (team[q.to] || 0) + 1;
  return { ref: d.ref, project: { name: (d.project && d.project.name) || d.query, ids: (d.project && d.project.ids) || [] }, location: d.location, market: d.market, asOf: d.asOf,
    counts: d.counts, promises: d.promises || [], questions: d.questions.slice(0, 3), more: { count: rest.length, byTeam: team }, phase: d.phase };
}

/** A dossier cut down to its preview, so the preview page can be rendered from it without the locked content present. */
function previewDossier(d) {
  if (!d) return null;
  return { ...d, questions: d.questions.slice(0, 3).concat(d.questions.slice(3).map(q => ({ id: q.id, to: q.to, when: q.when, question: '', locked: true }))),
    sections: [], inferences: d.inferences.map(() => ({})), sources: [], unreachable: [], glance: [], entities: [], checks: {} };
}

const EMAIL_RE = /^[^\s@<>()]{1,64}@[^\s@<>()]{1,190}\.[a-z]{2,24}$/i;
const PHONE_RE = /^\+[1-9]\d{7,14}$/;
function cleanContact({ email, phone } = {}) {
  const e = String(email || '').trim(), p = String(phone || '').replace(/[\s()-]/g, '');
  const out = {};
  if (e) { if (!EMAIL_RE.test(e)) return { error: 'Enter a valid e-mail address.' }; out.email = e.toLowerCase(); }
  if (p) { if (!PHONE_RE.test(p)) return { error: 'Enter a WhatsApp number with its country code, for example +91 98200 00000.' }; out.phone = p; }
  if (!out.email && !out.phone) return { error: 'Enter an e-mail address or a WhatsApp number so we can send the report.' };
  return { contact: out };
}

module.exports = { newRef, keyOf, briefOf, previewOf, previewDossier, priceRange, cleanContact };
