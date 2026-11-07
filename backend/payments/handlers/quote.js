'use strict';
const PRICING = require('../../pricing');
const { paywallActive, REF_RE } = require('../../engine/access');
const { getByRefAsync } = require('../../engine/research');
const REVIEW = require('../../engine/review');

module.exports = function create(c) {
  const { buyerOf, pricingData, pricingStore, sessionOf } = c;

  function countries(req) {
    const headers = {};
    headers['Cache-Control'] = 'no-store';
    const list = [...pricingData.countries.values()].filter(c => !c.blocked).map(c => {
      const q = PRICING.quoteCurrency(pricingData, c.iso), s = PRICING.saleStatus(pricingData, c.iso);
      return { iso: c.iso, name: c.name, currency: q.currency, onSale: s.onSale, reason: s.reason };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return { status: 200, body: { ok: true, countries: list, network: PRICING.networkCountry(req.headers || {}), priceBookVersion: pricingData.book.version }, headers };
  }

  async function issue(req) {
    const headers = {};
    const { ref, previousQuoteId } = req.body || {};
    if (!REF_RE.test(String(ref || ''))) return { status: 400, body: { ok: false, error: 'Unknown report reference.' }, headers };
    const brief = await getByRefAsync(ref);
    if (!brief) return { status: 404, body: { ok: false, error: 'This report is no longer available. Search again, then unlock the new report.' }, headers };
    if (REVIEW.isHeld(brief)) return { status: 409, body: { ok: false, code: 'held', error: 'A person is checking one or more findings in this report before it can be unlocked. Please try again later.' }, headers };
    if (brief.kind === 'dossier' && !brief.dossier) return { status: 409, body: { ok: false, code: 'not_ready', error: 'The first findings are still coming in. Please try again in a minute.' }, headers };
    const buyer = await buyerOf(req, { billing: req.body && req.body.billingCountry });
    headers['Cache-Control'] = 'no-store';
    try {
      const q = await PRICING.issueQuote({ data: pricingData, store: pricingStore, brief, buyer, session: sessionOf(req), details: { trigger: previousQuoteId ? 'country_changed' : 'unlock' } });
      if (/^q_[0-9a-f]{20}$/.test(String(previousQuoteId || ''))) await pricingStore.addEvent('country_changed', { quoteId: q.id, ref, details: { from: previousQuoteId, to: q.buyer.country } });
      return { status: 200, body: { ok: true, quote: PRICING.publicQuote(q) }, headers };
    } catch (e) {
      if (e instanceof PRICING.PricingError) return { status: 409, body: { ok: false, code: e.code, reason: e.reason, country: e.country, error: e.message }, headers };
      throw e;
    }
  }

  return { countries, issue };
};
