'use strict';
/**
 * ShelterKart -- who the buyer is, for pricing: country, currency, and how we know.
 *
 *   suggest -> confirm -> verify
 *
 * The network country only SUGGESTS. The buyer's own selection decides what they see. The
 * billing country, at payment, decides tax. Because the fee's LEVEL never depends on country
 * (it follows the property), a wrong or spoofed country can change only the currency and the tax,
 * never the dollar value of the fee.
 *
 * Precedence: billing > selected > network > none.
 */
const { quoteCurrency, saleStatus } = require('./data');

const HEADERS = ['cf-ipcountry', 'x-vercel-ip-country', 'cloudfront-viewer-country', 'fly-client-country'];   // what each hosting network calls the visitor's country

/** A clean ISO code from any signal, or ''. Rejects blanks, "XX", "T1" (Tor) and anything malformed. */
function cleanCode(v) {
  const c = String(v == null ? '' : v).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'T1' ? c : '';
}

/** The visitor's country from the hosting network's header, or ''. */
function networkCountry(headers = {}) {
  const h = {}; for (const k of Object.keys(headers)) h[k.toLowerCase()] = headers[k];
  for (const k of HEADERS) { const c = cleanCode(h[k]); if (c) return c; }
  return '';
}

/**
 * @returns {{ country, source, currency, fallback, onSale, reason, known }}
 * `country` is '' when no usable signal exists: the page then shows an indicative USD fee and asks the buyer to choose.
 */
function resolveBuyer(data, { selected, network, billing } = {}) {
  const pick = [['billing', cleanCode(billing)], ['selected', cleanCode(selected)], ['network', cleanCode(network)]];
  for (const [source, code] of pick) {
    if (!code) continue;
    if (!data.countries.has(code)) continue;                                   // not a country we know: try the next signal
    const q = quoteCurrency(data, code), s = saleStatus(data, code);
    return { country: code, source, currency: q.currency, fallback: q.fallback, wanted: q.wanted, onSale: s.onSale, reason: s.reason, known: true };
  }
  return { country: '', source: 'default', currency: 'USD', fallback: false, wanted: 'USD', onSale: false, reason: 'country_required', known: false };
}

module.exports = { resolveBuyer, networkCountry, cleanCode, HEADERS };
