// The pricing system, layer 2: the real server, quotes, checkout, webhook, refunds, ledger and invoices,
// through the SQL-aware database stub (PRICING_STORE=pg exercises the Postgres statements) with Razorpay's network faked.
// Test IDs refer to the approved plan in "V1 Pricing and Payments Architecture".
const crypto = require('crypto'), path = require('path');
Object.assign(process.env, { ANTHROPIC_API_KEY: 'k', PAYMENTS_ENABLED: 'true', ACCESS_TOKEN_SECRET: 'tok', PAYMENT_WEBHOOK_SECRET: 'whsec',
  RAZORPAY_KEY_ID: 'rzp_test_id', RAZORPAY_KEY_SECRET: 'key_secret', RAZORPAY_WEBHOOK_SECRET: 'rzp_whsec', NODE_ENV: 'test',
  GSTIN: '27ABCDE1234F1Z5', RAZORPAY_INTERNATIONAL: 'true', UK_VAT_NO: 'GB123456789', PRICING_STORE: 'pg', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'pw-for-tests' });
delete process.env.TAX_PROFILES; delete process.env.RAZORPAY_CURRENCIES;
const orders = [], refunds = []; let rzpRefundDown = false;
const PROPS = { 'Creek Bay Tower B': { market: 'ae', from: 1800000, to: 1900000, cur: 'AED' }, 'Hubtown Celeste': { market: 'in', from: 14900000, to: 21000000, cur: 'INR' }, 'Second Project': { market: 'in', from: 9000000, to: 9000000, cur: 'INR' } };
globalThis.fetch = async (url, o) => {
  const mk = (c, status = 200) => ({ ok: status < 400, status, json: async () => c });
  if (url === 'https://api.razorpay.com/v1/orders') { const b = JSON.parse(o.body); orders.push(b); return mk({ id: 'order_Q' + orders.length, amount: b.amount, currency: b.currency }); }
  const rf = /^https:\/\/api\.razorpay\.com\/v1\/payments\/(pay_\w+)\/refund$/.exec(url);
  if (rf) { if (rzpRefundDown) return mk({}, 502); const b = JSON.parse(o.body); refunds.push({ pay: rf[1], ...b }); return mk({ id: 'rfnd_' + refunds.length, amount: b.amount, status: 'processed' }); }
  const b = JSON.parse(o.body), q = (b.messages[0].content || '').toString(), name = Object.keys(PROPS).find(n => q.includes(n)) || 'Creek Bay Tower B', pr = PROPS[name];
  if (b.tools) { const out = { project: { name, location: '', developer: 'Dev', ids: [], price_from: pr.from, price_to: pr.to, price_currency: pr.cur }, sources: ['https://a.com/1', 'https://b.com/2'],
      findings: [{ id: 'f1', topic: 'price', claim: 'Listed prices are published.', kind: 'fact', src: [0, 1] }, { id: 'f2', topic: 'other', claim: 'A claim.', kind: 'fact', src: [0] }], conflicts: [], gaps: [] };
    return mk({ stop_reason: 'end_turn', content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: [{ url: 'https://a.com/1', title: 'A' }, { url: 'https://b.com/2', title: 'B' }] }, { type: 'text', text: JSON.stringify(out) }] }); }
  return mk({ content: [{ type: 'text', text: '{"reading":[],"questions":[]}' }] });
};
const app = require(path.join(__dirname, '..', '..', 'server.js'));
const { _db } = require('pg');
const P = require(path.join(__dirname, '..', '..', 'pricing'));
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route, body, headers = {}) { return new Promise(resolve => {
  const res = { code: 200, status(c) { this.code = c; return this; }, set() { return this; }, end() { resolve({ code: this.code }); }, json(o) { resolve({ code: this.code, body: o }); } };
  const req = { body, params: {}, query: {}, ip: '4.4.4.4', headers, path: route.path, get: k => headers[k.toLowerCase()] };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const x = hs[i++]; if (x) x(req, res, next); }; next(); }); }
const ADMIN = { authorization: 'Basic ' + Buffer.from('admin:pw-for-tests').toString('base64') };
let failures = 0;
const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });
const rzpHook = async (orderId, payId, amount, currency, extra = {}) => {
  const raw = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: payId, order_id: orderId, amount, currency, status: 'captured', ...extra } } } }));
  return call(find('post', '/api/payments/razorpay/webhook'), raw, { 'x-razorpay-signature': crypto.createHmac('sha256', 'rzp_whsec').update(raw).digest('hex') });
};

(async () => {
  const research = find('post', '/api/research'), quoteR = find('post', '/api/research/quote'), checkout = find('post', '/api/research/checkout');
  const dubai = await call(research, { query: 'Creek Bay Tower B', market: 'ae', country: 'IN' }), ref = dubai.body.brief.ref;
  const quote = (country, session, extra = {}) => call(quoteR, { ref, country, session, ...extra });

  // ---------- the property sets the level; the buyer's country sets the currency ----------
  const qIN = (await quote('IN', 'mumbai-buyer')).body.quote, qGB = (await quote('GB', 'london-buyer')).body.quote;
  ok('a buyer in Mumbai sees the Dubai property in AED and the fee in INR, with GST inside it', dubai.body.paywall.currency === 'INR' && dubai.body.paywall.basis.property.currency === 'AED' && qIN.currency === 'INR' && qIN.taxName === 'GST' && qIN.property === undefined);   // the property's value is kept in the pricing record, not sent to the page
  ok('a buyer in the UK gets the same report in GBP with UK VAT, and the same dollar value (within 10%)', qGB.currency === 'GBP' && qGB.taxName === 'VAT' && Math.abs((qGB.gross / 0.7565) / (qIN.gross / 94.40) - 1) < 0.10);
  ok('the quote carries what the checkout screen shows: net, tax, gross, lock time', qIN.net + qIN.tax === qIN.gross && Date.parse(qIN.expiresAt) - Date.parse(qIN.issuedAt) === 30 * 60000);

  // ---------- C1: a manual country change re-quotes and supersedes ----------
  const before = (await quote('IN', 'switcher')).body.quote, after = (await quote('GB', 'switcher', { previousQuoteId: before.id })).body.quote;
  const old = await call(checkout, { ref, idempotencyKey: 'switcher-attempt-aaaaaaaaa', quoteId: before.id, billingCountry: 'IN' });
  ok('C1 a manual country change issues a new quote in the new currency and the old one can no longer be paid', after.currency === 'GBP' && old.code === 409 && old.body.code === 'quote_superseded' && old.body.requote === true);

  // ---------- C2/C3: billing country checked before any money moves ----------
  const ordersBefore = orders.length;
  const mm = await call(checkout, { ref, idempotencyKey: 'mismatch-attempt-bbbbbbbbb', quoteId: qGB.id, billingCountry: 'AE' });
  ok('C2 a billing country that differs from the quote stops the checkout before any order exists (here: a country not on sale)', mm.code === 409 && mm.body.code === 'not_on_sale' && orders.length === ordersBefore);
  const ukThenIndia = await call(checkout, { ref, idempotencyKey: 'card-india-attempt-ccccccc', quoteId: qGB.id, billingCountry: 'IN' });
  ok('C3 a UK quote paid with an Indian billing country is re-quoted in INR before any charge', ukThenIndia.code === 409 && ukThenIndia.body.requote && ukThenIndia.body.quote.currency === 'INR' && ukThenIndia.body.previous.currency === 'GBP' && orders.length === ordersBefore);
  const events = _db.pricingEvents.map(e => e.type);
  ok('C4 every change, mismatch and re-quote is written to the pricing events', ['quote_issued', 'country_changed', 'quote_refused', 'billing_mismatch', 'requote'].every(t => events.includes(t)));
  ok('...the re-quoted INR price is payable, and the old GBP quote is superseded', (await call(checkout, { ref, idempotencyKey: 'gbp-after-requote-ddddddd', quoteId: qGB.id, billingCountry: 'GB' })).body.code === 'quote_superseded');

  // ---------- checkout charges the quote; the webhook can only confirm it ----------
  const buy = await call(checkout, { ref, idempotencyKey: 'india-buyer-attempt-eeeeee', quoteId: qIN.id, billingCountry: 'IN' });
  const row = _db.purchases.find(p => p.id === buy.body.purchaseId);
  ok('checkout charges exactly the quote: Razorpay order in INR paise, and the quote id travels in its notes', buy.code === 200 && orders.at(-1).amount === Math.round(qIN.gross * 100) && orders.at(-1).currency === 'INR' && orders.at(-1).notes.quoteId === qIN.id);
  ok('X4 the purchase stores its quote, countries, net, tax, rate and price-book version', row.quote_id === qIN.id && row.buyer_country === 'IN' && row.billing_country === 'IN' && row.amount_net === qIN.net && row.tax_amount === qIN.tax && row.tax_rate_bps === 1800 && row.price_book_version === qIN.priceBookVersion);
  ok('M7 a retried checkout with the same key returns the same purchase and order, and a used quote cannot start a second purchase',
    (await call(checkout, { ref, idempotencyKey: 'india-buyer-attempt-eeeeee', quoteId: qIN.id, billingCountry: 'IN' })).body.purchaseId === buy.body.purchaseId
    && (await call(checkout, { ref, idempotencyKey: 'india-buyer-second-ffffff', quoteId: qIN.id, billingCountry: 'IN' })).body.code === 'quote_used');
  const sub = Math.round(qIN.gross * 100);
  const under = await rzpHook(buy.body.razorpay.orderId, 'pay_UNDER', sub - 1, 'INR'), over = await rzpHook(buy.body.razorpay.orderId, 'pay_OVER', sub + 1, 'INR'), wrongCur = await rzpHook(buy.body.razorpay.orderId, 'pay_CUR', sub, 'USD');
  ok('M6 a webhook one unit short, one unit over, or in another currency is rejected and nothing unlocks', under.body.mismatch && over.body.mismatch && wrongCur.body.mismatch && row.status === 'pending_payment');
  const paid = await rzpHook(buy.body.razorpay.orderId, 'pay_EXACT', sub, 'INR', { fee: 5900, international: false });
  ok('the exact total settles the purchase', paid.body.ok && row.status === 'paid');
  ok('net revenue is written once, from the provider\u2019s own fee', row.provider_fee === 59 && Math.abs(row.net_revenue - (qIN.net - 59)) < 1e-9);
  const inv = _db.invoices.find(i => i.purchase_id === row.id);
  ok('a paid Indian sale gets a GST invoice with a gap-free number, and is added to the tax ledger', inv && /^SK\/\d{4}-\d{2}\/000001$/.test(inv.number) && inv.kind === 'gst' && [..._db.ledger.values()].some(l => l.country === 'IN' && l.currency === 'INR' && l.gross_sales === qIN.gross));

  // ---------- a foreign sale ----------
  const qGB2 = (await quote('GB', 'london-buyer-2')).body.quote, gbBuy = await call(checkout, { ref, idempotencyKey: 'london-buyer-attempt-gggggg', quoteId: qGB2.id, billingCountry: 'GB' });
  await rzpHook(gbBuy.body.razorpay.orderId, 'pay_GBP', Math.round(qGB2.gross * 100), 'GBP', { international: true });
  const gbRow = _db.purchases.find(p => p.id === gbBuy.body.purchaseId);
  ok('a UK sale settles in GBP with UK VAT recorded, an export invoice, and no fee-based net revenue (foreign fees reconcile from the settlement report)', gbRow.status === 'paid' && gbRow.tax_amount === qGB2.tax && gbRow.net_revenue == null && _db.invoices.some(i => i.purchase_id === gbRow.id && i.kind === 'export'));
  const qGB3 = (await quote('GB', 'london-buyer-3')).body.quote, gb3 = await call(checkout, { ref, idempotencyKey: 'london-indian-card-hhhhhhh', quoteId: qGB3.id, billingCountry: 'GB' });
  await rzpHook(gb3.body.razorpay.orderId, 'pay_INDIANCARD', Math.round(qGB3.gross * 100), 'GBP', { international: false });
  ok('a GBP payment made on an India-issued card is flagged for review', _db.pricingEvents.some(e => e.type === 'card_origin_mismatch'));

  // ---------- refunds ----------
  const refundR = find('post', '/api/admin/refunds');
  ok('refunds are admin-only', (await call(refundR, { purchaseId: row.id })).code === 401);
  const part = await call(refundR, { purchaseId: row.id, amount: 1000, reason: 'goodwill' }, ADMIN);
  const expectTax = Math.round(qIN.tax * (1000 / qIN.gross) * 100) / 100;
  ok('R2 a partial refund is in the original currency and reverses tax pro rata', part.code === 200 && part.body.currency === 'INR' && part.body.amount === 1000 && Math.abs(part.body.taxReversed - expectTax) < 0.011 && row.status === 'paid' && refunds.at(-1).amount === 100000);
  const rest = await call(refundR, { purchaseId: row.id, reason: 'not useful' }, ADMIN);
  ok('R1 the rest refunds the original amount exactly, the tax is fully reversed, and the purchase is marked refunded', rest.code === 200 && Math.abs(part.body.amount + rest.body.amount - qIN.gross) < 1e-9 && Math.abs(part.body.taxReversed + rest.body.taxReversed - qIN.tax) < 0.02 && row.status === 'refunded');
  ok('...a third refund is refused: never beyond what was paid', (await call(refundR, { purchaseId: row.id }, ADMIN)).body.code === 'already_refunded');
  ok('R3/R4 a refund reads the purchase, never the current price book or any exchange rate', !/book|fx|perUsd|ladder/.test(require('fs').readFileSync(path.join(__dirname, '..', '..', 'payments', 'refunds.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
  ok('R5 refunds reduce net revenue by the net share and take the sale off the tax ledger', Math.abs(row.net_revenue - (qIN.net - 59 - qIN.net)) < 0.02 && Math.abs([..._db.ledger.values()].find(l => l.country === 'IN').gross_sales) < 1e-6);
  rzpRefundDown = true;
  const failRef = await call(refundR, { purchaseId: gbRow.id }, ADMIN);
  ok('a refund the provider refuses changes nothing in our records', failRef.code === 500 && gbRow.status === 'paid' && !_db.refunds.some(r => r.purchase_id === gbRow.id));
  rzpRefundDown = false;

  // ---------- multiple reports, corporate buyers ----------
  const second = await call(research, { query: 'Second Project', market: 'in', country: 'IN' }), ref2 = second.body.brief.ref;
  const a = (await call(quoteR, { ref, country: 'IN', session: 'two-reports' })).body.quote, b = (await call(quoteR, { ref: ref2, country: 'IN', session: 'two-reports' })).body.quote;
  ok('U1/U3 two reports get two quotes with their own prices, and neither supersedes the other', a.ref !== b.ref && a.gross !== b.gross && (await P.verifyQuote(await (P.makeStore({ pool: new (require('pg').Pool)() })).getQuote(a.id), process.env)).ok);
  const tokenOf = async (purchaseId, r) => (await call(find('post', '/api/research/access'), { ref: r, purchaseId })).body.token;
  const tok = await tokenOf(gbBuy.body.purchaseId, ref);
  const again = await call(research, { query: 'Creek Bay Tower B', market: 'ae', country: 'GB' }, { 'x-report-access': tok });
  ok('U2 a buyer who already unlocked the report is shown it unlocked, not asked to pay again', again.body.brief.locked === false);
  const qK = (await call(quoteR, { ref, country: 'GB', session: 'company-k2' })).body.quote;
  const kBuy = await call(checkout, { ref, idempotencyKey: 'company-k2-attempt-kkkkkkk', quoteId: qK.id, billingCountry: 'GB', buyerKind: 'business', taxId: ' gb 999 9999 73<script>' });
  await rzpHook(kBuy.body.razorpay.orderId, 'pay_K2', Math.round(qK.gross * 100), 'GBP', { international: true });
  const kInv = _db.invoices.find(i => i.purchase_id === kBuy.body.purchaseId);
  ok('K2 a business tax ID is stored as given (cleaned, not validated) and printed on the invoice', kInv && kInv.body.recipient.taxId === 'GB999999973' && kInv.body.recipient.kind === 'business' && kInv.body.recipient.taxIdValidated === false);
  ok('K1 a business buyer is treated as a consumer in V1: the same tax-inclusive quote (documented behaviour)', (await call(quoteR, { ref, country: 'GB', session: 'company-x', buyerKind: 'business', taxId: 'GB999999973' })).body.quote.taxName === 'VAT');

  // ---------- what is on sale, and why not ----------
  const countries = (await call(find('get', '/api/pricing/countries'), null, { 'cf-ipcountry': 'CH' })).body;
  const byIso = Object.fromEntries(countries.countries.map(c => [c.iso, c]));
  ok('the country list says what is on sale and why not, and suggests the network country', countries.network === 'CH' && byIso.IN.onSale && byIso.GB.onSale && byIso.CH.onSale && !byIso.FR.onSale && byIso.FR.reason === 'registration_required' && byIso.AE.reason === 'unverified' && !byIso.RU);
  const ae = await call(quoteR, { ref, country: 'AE', session: 'dubai-buyer' });
  ok('a buyer in a country that is not on sale gets a clear reason and no quote', ae.code === 409 && ae.body.code === 'not_on_sale' && ae.body.reason === 'unverified');
  const tax = await call(find('get', '/api/admin/tax'), null, ADMIN);
  ok('the admin tax view lists threshold progress per country and every country that is off, with its reason', tax.code === 200 && tax.body.progress.some(p => p.country === 'CH' && p.thresholds[0].basis === 'worldwide') && tax.body.off.some(o => o.iso === 'FR' && o.reason === 'registration_required'));
})();
