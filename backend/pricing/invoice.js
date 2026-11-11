'use strict';
/**
 * ShelterKart -- invoices, numbered without gaps.
 *
 * India (domestic): a GST invoice. Buyers abroad: an export invoice (GST zero-rated, supplied under a Letter of
 * Undertaking when paid in foreign currency). The number comes from an atomic counter per series and Indian
 * financial year, so a number is never skipped or reused.
 *
 * V1 records the invoice data. Items for the tax adviser before launch are listed in LAUNCH.md: the service's
 * accounting code, the CGST/SGST versus IGST split (needs the buyer's state), and the Letter of Undertaking number.
 */
const IST_MS = 330 * 60000;
const inIndia = d => new Date(d.getTime() + IST_MS);
const fyOf = (d) => { const i = inIndia(d), y = i.getUTCFullYear(), m = i.getUTCMonth() + 1; const a = m >= 4 ? y : y - 1; return `${a}-${String((a + 1) % 100).padStart(2, '0')}`; };

async function issueInvoice({ data, store, purchase, quote, now = new Date(), env = process.env }) {
  const domestic = quote.buyer.country === 'IN' && quote.currency === 'INR';
  const kind = domestic ? 'gst' : 'export';
  const series = `SK/${kind === 'gst' ? '' : 'EXP/'}${fyOf(now)}`;
  const n = await store.nextInvoiceNumber(series);
  const number = `${series}/${String(n).padStart(6, '0')}`;
  const body = {
    number, date: inIndia(now).toISOString().slice(0, 10), kind,
    supplier: { name: env.BUSINESS_LEGAL_NAME || '', gstin: env.GSTIN || '', address: env.BUSINESS_ADDRESS || '', state: env.SUPPLIER_STATE || '' },
    recipient: { country: quote.buyer.country, billingCountry: purchase.billing_country || quote.buyer.country, state: purchase.billing_state || '',
                 kind: purchase.buyer_kind || 'individual', taxId: purchase.tax_id || '', taxIdValidated: false },
    service: { description: 'ShelterKart due diligence report', reportRef: quote.ref, accountingCode: env.GST_SAC || '' },
    currency: quote.currency, net: quote.net, tax: quote.tax, gross: quote.gross, taxName: quote.taxName, taxRateBps: quote.taxRateBps,
    gstTreatment: domestic ? (quote.taxRateBps > 0 ? `GST ${quote.taxRateBps / 100}%` : 'GST not charged') : 'Export of services: zero-rated under a Letter of Undertaking',
    lut: domestic ? '' : (env.LUT_NO || ''), priceBookVersion: quote.priceBookVersion, quoteId: quote.id,
  };
  await store.saveInvoice({ purchaseId: purchase.id, number, kind, country: quote.buyer.country, currency: quote.currency, net: quote.net, tax: quote.tax, gross: quote.gross, taxRateBps: quote.taxRateBps, body });
  return body;
}

module.exports = { issueInvoice, fyOf };
