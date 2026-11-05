/**
 * ShelterKart Backend
 * ====================
 * Consolidated from the two backend drafts in the project history:
 * fuzzy/typo-tolerant resolution across developers AND projects, dual
 * smart change-detection caching, and
 * OTP-gated report delivery.
 *
 * Honest status: this is a real, runnable API (search, cache,
 * OTP, dispute, checkout) backed by a real Postgres schema. The one
 * piece that is *inherently* not fakeable is the Tier-1 regulatory
 * data pipeline (MahaRERA/DLD/etc. scraping + OCR + LLM synthesis,
 * per the Developer Brief, Section 5/7) — that requires real source
 * connectors and an LLM API key. It is stubbed clearly below, once,
 * in fetchStructuredLegal() and the report-generation TODO.
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const app = express();
app.set('trust proxy', 1); // needed for correct req.ip behind any real load balancer/proxy
/* helmet()'s bare default sets script-src 'self' with no allowance for
   Razorpay, and script-src-attr 'none' -- meaning the moment payments
   are switched on, Razorpay's checkout script, its own payment iframe,
   and its own calls to api.razorpay.com would all be silently blocked
   by the CSP this same code ships. Confirmed against helmet's own
   documented default and Razorpay's own guidance to allow *.razorpay.com
   for exactly this.

   style-src and script-src still need 'unsafe-inline' here, honestly:
   the whole frontend is one inline <script> and <style> block today,
   plus a number of onclick="..." attributes -- a strict policy would
   break the page outright, not just tighten it. Removing that need is
   a real, separate piece of work (moving onclick handlers to delegated
   listeners throughout, and the inline script to its own file or a
   nonce) -- not something to fake by shipping a policy that doesn't
   match what the page actually does. Everything else below is real:
   no other third-party script origin, no framing of this site by
   anyone, no plugin/object embeds. */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://*.razorpay.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],   // the Home Buying Guide embeds its headline font
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'https://*.razorpay.com'],
      frameSrc: ['https://*.razorpay.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));

// Locked-down CORS: only your real frontend origin(s) may call this API in
// production. Comma-separate multiple origins in ALLOWED_ORIGINS. Wide-open
// CORS is one of the easiest ways a competitor's script scrapes this API
// directly from a browser — don't leave it at "*".
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server / curl / health checks
    if (allowedOrigins.includes(origin)) return cb(null, true);
    // Previously an EMPTY list allowed every origin -- failing open, the
    // exact risk the comment above warns about. Now an empty list is only
    // tolerated outside production, for local development.
    if (allowedOrigins.length === 0 && process.env.NODE_ENV !== 'production') return cb(null, true);
    cb(new Error('Origin not allowed'));
  }
}));
/* The global JSON parser must NOT touch these paths. The webhook's
   signature is checked against the exact raw bytes the provider sent;
   before this fix the global parser ran first, turned the body into an
   object, the webhook's own raw parser then skipped it, and hashing an
   object threw -- so no payment confirmation could ever be processed.
   The document check needs a larger limit than 10 KB. */
const OWN_BODY_PARSER = new Set(['/api/payments/webhook', '/api/payments/razorpay/webhook', '/api/payments/mor/webhook', '/api/research/document-check']);
const jsonSmall = express.json({ limit: '10kb' });
app.use((req, res, next) => OWN_BODY_PARSER.has(req.path.toLowerCase().replace(/\/+$/, '')) ? next() : jsonSmall(req, res, next));

const pool = require('./engine/poolGuard').guardPool(new Pool({ connectionString: process.env.DATABASE_URL }));
const { createErrorLog } = require('./engine/errorlog');
const ERRORLOG = createErrorLog({ pool: process.env.DATABASE_URL ? pool : null, enabled: String(process.env.ERROR_LOG || 'on').toLowerCase() !== 'off' });
ERRORLOG.hookConsole(console);

/* Express 4 does not catch errors thrown in async handlers: the request
   hangs and the error escapes as an unhandled rejection. Five admin
   routes had no try/catch at all; they are wrapped in this. */
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const disputeLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: { ok: false, error: 'Too many submissions. Please try again later.' } });


/* Search engines: which pages may be found. Private reports, previews, the working pages, the API and the admin pages are
   never listed and are disallowed. The independence page is left out until its claim is restored. */
const SITE_BASE = () => String(process.env.PUBLIC_BASE_URL || process.env.SITE_URL || '').replace(/\/+$/, '');
const PUBLIC_PAGES = ['/', '/about.html', '/contact.html', '/corrections.html', '/delivery.html', '/evidence.html', '/methodology.html',
  '/pricing.html', '/privacy.html', '/refunds.html', '/terms.html', '/guide', '/guide/pdf', '/guide/card.pdf'];
app.get('/robots.txt', (req, res) => {
  const base = SITE_BASE();
  res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
  res.send(['User-agent: *', 'Allow: /', 'Disallow: /r/', 'Disallow: /api/', 'Disallow: /admin', 'Disallow: /start', 'Disallow: /investigate',
    base ? `Sitemap: ${base}/sitemap.xml` : ''].filter(Boolean).join('\n') + '\n');
});
app.get('/sitemap.xml', (req, res) => {
  const base = SITE_BASE(); if (!base) return res.status(404).type('text/plain').send('Set PUBLIC_BASE_URL to publish a sitemap.');
  const esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const today = new Date().toISOString().slice(0, 10);
  const samples = ['celeste', 'london', 'dubai'].map(id => `/samples/${id}`);
  const urls = [...PUBLIC_PAGES, ...samples].map(p => `  <url><loc>${esc(base + p)}</loc><lastmod>${today}</lastmod></url>`);
  res.set({ 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
});
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'shelterkart-api', time: new Date().toISOString() }));

/* ============================================================
   RESEARCH ENGINE -- the product's core loop.
   Search lane (everything findable) + registry lane (official APIs
   where a connector exists) -> grounding gate -> marks -> questions.
   Needs no database. Registry calls go through the SSRF guard, with
   the permitted hosts taken from the connectors themselves.
   ============================================================ */
const { runResearch, purgeDurably, isAnswerable, getByRefAsync, listRecentReports, attachStore, hydrate, setReview, capOf, _daily: researchDaily } = require('./engine/research');
const REVIEW = require('./engine/review');
const CREDITS = require('./engine/credits');
const BOT = require('./engine/botguard');             // proof-of-work before NEW research (BOT_GUARD)         // licence credits for the official registers a report used          // adverse findings held for a person (ADVERSE_HOLD_MARKETS)
const { makeReviewStore, senderCheck, findingMatch } = require('./engine/reviews');
// Disputes and developer replies: Postgres when configured, memory otherwise, so the right of reply works in every mode.
const REVIEWS = makeReviewStore(process.env.DATABASE_URL ? pool : null);
// Respond or correct: the right of reply and the right of correction (engine/responses.js). Every outside thing is passed in.
const { makeResponses, makeResponseStore } = require('./engine/responses');
const RESPONSES = makeResponses({
  store: makeResponseStore(process.env.DATABASE_URL ? pool : null),
  getBrief: ref => getByRefAsync(ref).catch(() => null),
  sendMail: m => require('./engine/delivery').sendEmail(process.env, m),
  alert: (subject, text) => require('./engine/delivery').alertOperator(process.env, subject, text),
  siteBase: () => SITE_BASE(), refOk: ref => REF_RE.test(ref),
});
const { createAccounts } = require('./accounts');
const { makeAccountStore } = require('./accounts/store');
const ACCOUNTS = createAccounts({
  env: process.env, store: makeAccountStore(process.env.DATABASE_URL ? pool : null), bot: BOT, rateLimit, track: (event, req, body) => track(event, req, body),
  mail: m => require('./engine/delivery').sendEmail(process.env, m),
  mailConfigured: Boolean(require('./engine/delivery').emailProvider(process.env)),
  alert: (subject, text) => require('./engine/delivery').alertOperator(process.env, subject, text),
  entitled: async (userId, ref) => (await pool.query(`SELECT 1 FROM report_purchases WHERE user_id=$1 AND report_ref=$2 AND status='paid' LIMIT 1`, [userId, ref])).rows.length > 0,
  purchasesOf: async userId => (await pool.query(`SELECT report_ref, amount, currency, status, created_at FROM report_purchases WHERE user_id=$1 ORDER BY created_at DESC LIMIT 500`, [userId]))
    .rows.map(r => ({ ref: r.report_ref, amount: r.amount, currency: r.currency, status: r.status, createdAt: r.created_at })),
  briefInfo: async ref => { const b = await getByRefAsync(ref); return b ? { projectName: b.project && b.project.name, market: b.market } : null; },
});
const { makePgStore } = require('./engine/persistence');
// With a database configured, reports, aliases and the daily ceiling are
// durable: a deploy or crash no longer erases what buyers paid for.
const pgStore = process.env.DATABASE_URL ? makePgStore(pool) : null;
if (pgStore) attachStore(pgStore);
const ANALYTICS = require('./engine/analytics');
if (pgStore) ANALYTICS.attachStore(pgStore);
const { pickLanguage, publicList: languageList, languagesForMarket } = require('./engine/languages');
const TRANSLATE = require('./engine/translate');
if (pgStore) TRANSLATE.attachStore(pgStore);   // translated sentences are kept, so each is translated once
/* Record an analytics event without ever slowing or failing the request.
   `serverSide` marks events with no buyer behind them (payment webhooks). */
function track(event, req, body = {}, { serverSide = false } = {}) {
  try {
    let ownHost = '';
    try { const o = req && req.get && req.get('origin'); if (o) ownHost = new URL(o).hostname.replace(/^www\./, ''); } catch {}
    ANALYTICS.record(ANALYTICS.makeEvent(event, { ip: req && req.ip, ua: serverSide ? 'server' : (req && req.get && req.get('user-agent')),
      headers: (req && req.headers) || {}, body, ownHost }));
  } catch (e) { console.error('[analytics]', e && e.message); }
}
const { paywallActive, previewOf, verifyToken, issueToken, REF_RE } = require('./engine/access');
/* ---------- pricing and payments (see pricing/ and payments/) ----------
   The fee is set by the PROPERTY and the evidence depth, the same in dollars for every buyer; the buyer's
   country decides only the currency, the tax and the payment route. Everything country-specific is data. */
const PRICING = require('./pricing');
const PAYMENTS = require('./payments');
const morEngine = require('./engine/mor');
const ENGINES = require('./engines');               // which AI engine serves each agent (backend/engines)
const { refundPurchase, RefundError } = require('./payments/refunds');
const pricingData = PRICING.load(process.env);
{ const problems = PRICING.validate(pricingData); if (problems.length) console.error('[pricing] data problems:\n  ' + problems.join('\n  ')); }
const pricingStore = PRICING.makeStore({ pool: (process.env.DATABASE_URL || process.env.PRICING_STORE === 'pg') ? pool : null });
{ const on = [...pricingData.countries.keys()].filter(c => PRICING.saleStatus(pricingData, c).onSale);
  if (process.env.NODE_ENV !== 'test') console.log('[pricing] book ' + pricingData.book.version + '; on sale in ' + on.length + ' countries: ' + (on.join(' ') || 'none (set GSTIN for India; RAZORPAY_INTERNATIONAL=true and a tax profile for others)')); }

/** The buyer for this request: their own selection, else the network's suggestion. A country that has reached its tax
 *  registration threshold stops selling until registration is configured. */
async function buyerOf(req, { billing } = {}) {
  const body = req.body || {}, query = req.query || {};
  const b = PRICING.resolveBuyer(pricingData, { selected: body.country || query.country, network: PRICING.networkCountry(req.headers || {}), billing });
  if (b.onSale && await PRICING.ledger.thresholdReached({ data: pricingData, store: pricingStore, country: b.country })) return { ...b, onSale: false, reason: 'threshold_reached' };
  return b;
}
const sessionOf = req => String((req.body && req.body.session) || (req.query && req.query.session) || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'anon';
const { extractFields, crossCheck } = require('./engine/documents');
const rzp = require('./engine/razorpay');

/* The one place a purchase becomes paid. Both the checkout handler and
   the webhook come through here, so whichever arrives first settles it
   and the other finds nothing left to do. Keyed by the purchase's own
   id, never by report ref, which many buyers of one project share. */
async function markPurchasePaid(db, { purchaseId, ref, provider, paymentId }, ctx = {}) {
  const r = await db.query(
    `UPDATE report_purchases SET status='paid', provider_payment_id=$3, paid_at=NOW()
      WHERE id=$1 AND report_ref=$2 AND status='pending_payment' RETURNING id, amount, currency, quote_id, buyer_country, billing_country, buyer_kind, tax_id`,
    [purchaseId, ref, paymentId]);
  if (r.rows.length) {
    // Recorded only here, where a purchase is actually settled, so revenue
    // on the dashboard can never exceed what was really paid.
    // The paid event carries the market and the source saved at checkout; 'provider:src' marks a payment whose source is known.
    let a = {}; try { const s = await db.query(`SELECT attribution FROM report_purchases WHERE id=$1`, [purchaseId]); a = (s.rows[0] && s.rows[0].attribution) || {}; if (typeof a === 'string') a = JSON.parse(a); } catch { a = {}; }
    track('purchase_paid', ctx.req, { ref, value: Number(r.rows[0].amount), currency: r.rows[0].currency, detail: provider + (a.captured ? ':src' : ''), market: a.market || '', ...(a.captured ? { utm: a.utm, referrer: a.referrer } : {}) }, { serverSide: !ctx.req });
    await db.query(`INSERT INTO audit_log (actor, action, object_type, object_id, reason) VALUES ('system','RESEARCH_PURCHASE_PAID','report_purchase',$1,$2)`,
      [purchaseId, `${provider} payment ${paymentId}`]);
    await recordSale(r.rows[0]);
    let payer = null;
    if (ACCOUNTS.enabled) { try { const u = await db.query(`SELECT u.email FROM report_purchases p JOIN users u ON u.id = p.user_id WHERE p.id=$1`, [purchaseId]); payer = (u.rows[0] && u.rows[0].email) || null; } catch { payer = null; } }
    try { onReportPaid(ref, payer); } catch (e) { console.error('[investigate] could not continue a paid report:', e && e.message); }
  }
  return r.rows.length === 1;
}

/* What a settled sale adds to the books: the country's sales ledger (tax thresholds) and an invoice with a gap-free number.
   A failure here never undoes a payment that really happened: it is logged and recorded for follow-up. */
async function recordSale(row) {
  try {
    const q = row.quote_id ? await pricingStore.getQuote(row.quote_id) : null;
    if (!q) return;
    // Where the Merchant of Record is the seller, it issues the buyer's tax invoice and collects the tax. ShelterKart is not the seller
    // there: it books no sale in that country, issues no second invoice, and counts nothing toward a registration threshold (which would
    // raise false "register now" alerts). An audit event keeps the record.
    if (q.taxBy === 'merchant_of_record') {
      await pricingStore.addEvent('sale_via_merchant', { quoteId: q.id, ref: q.ref, details: { purchaseId: row.id, country: q.buyer.country, currency: q.currency, grossMinor: q.grossMinor } });
      return;
    }
    await PRICING.ledger.recordSale({ data: pricingData, store: pricingStore, country: q.buyer.country, grossMinor: q.grossMinor, taxMinor: q.taxMinor, currency: q.currency });
    await PRICING.invoice.issueInvoice({ data: pricingData, store: pricingStore, purchase: { id: row.id, billing_country: row.billing_country, buyer_kind: row.buyer_kind, tax_id: row.tax_id }, quote: q });
    await PRICING.ledger.checkThresholds({ data: pricingData, store: pricingStore, notify: async a => console.warn('[tax] ' + a.name + ' has reached ' + a.pct + '% of its registration threshold (' + a.level + ')') });
  } catch (e) {
    console.error('[pricing] settlement records failed for purchase ' + row.id + ':', e && e.message);
    try { await pricingStore.addEvent('settlement_records_failed', { details: { purchaseId: row.id, error: String(e && e.message).slice(0, 200) } }); } catch {}
  }
}

/** Full brief if the paywall is off or the caller holds a valid token for
 *  this brief; otherwise the allow-listed preview. Decided server-side. */
/* The report in the reader's language, AFTER the paywall has decided what they
   may see: a preview is translated as a preview, never widened. Translation
   can only fail into English; it never fails the request (engine/translate.js). */
async function localize(gated, req) {
  const lang = pickLanguage((req.body && req.body.lang) || (req.query && req.query.lang));
  if (lang === 'en') return gated;
  return { ...gated, brief: await TRANSLATE.translateBrief(gated.brief, lang) };
}
async function gateBrief(brief, req) {
  const active = paywallActive(process.env);
  // The fee for THIS buyer: set by the property and the evidence depth, read in the buyer's currency (pricing/quote.js).
  // Nothing is stored or locked here; a quote is issued when the buyer unlocks.
  const fee = PRICING.previewFee(pricingData, brief, await buyerOf(req));
  const paywall = active ? { active: true, price: fee.price, currency: fee.currency, depth: fee.depth, depthLabel: fee.depthLabel, basis: fee.basis,
    fee: { net: fee.net, tax: fee.tax, taxName: fee.taxName, taxRateBps: fee.taxRateBps, taxInclusive: fee.taxInclusive }, buyer: fee.buyer, priceBookVersion: fee.priceBookVersion } : { active: false };
  const open = !active || (ACCOUNTS.enabled ? await ACCOUNTS.entitled(req, brief.ref) : verifyToken(req.get('x-report-access'), brief.ref, process.env.ACCESS_TOKEN_SECRET));
  if (open) return { brief: { ...brief, locked: false }, paywall };
  return { brief: previewOf(brief), paywall };
}
const { MARKETS, depthOf } = require('./engine/markets');
const { CONNECTORS } = require('./engine/registry');
const HEALTH = require('./engine/health');
const { guardedFetch } = require('./connectors/egress');
const { makeRegistryHttp } = require('./engine/registryHttp');

const registryAllowSet = new Set(Object.values(CONNECTORS).flatMap(c => c.hosts));
const registryHttp = makeRegistryHttp({ guardedFetch, allowSet: registryAllowSet });

/* Many Indian mobile networks put large numbers of users behind one
   shared IP address, so a tight per-IP limit would lock out a crowd of
   real people at once during a spike. The limit is looser, and searches
   that can be answered from memory are exempt -- they cost nothing. The
   real cost ceiling is RESEARCH_DAILY_CAP, enforced in the engine. */
const researchLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: Number(process.env.RESEARCH_HOURLY_PER_IP) || 10,
  standardHeaders: true, legacyHeaders: false,
  skip: req => { try { const b = req.body || {};
    if (BOT.enabled(process.env) && req.path === '/api/research' && !(b.pow && b.pow.token)) return true;   // refused before any cost; counting it would charge twice
    return isAnswerable({ query: stripPII(b.query), location: stripPII(b.location), market: b.market }); } catch { return false; } },
  message: { ok: false, error: 'Too many new searches from this connection. Please try again in an hour.' } });

// A phone number or an email address typed into the search box would
// otherwise be sent to the search provider and the model, cached in
// memory, and echoed back in brief.query. Stripped before the query
// leaves this process, not after.
const PII_PATTERNS = [
  /[\w.+-]+@[\w-]+\.[\w.-]+/g,
  /\+?\d[\d\s().-]{7,}\d/g,
];
function stripPII(s) {
  return PII_PATTERNS.reduce((acc, re) => acc.replace(re, ' '), String(s || '')).replace(/\s+/g, ' ').trim();
}

/* Every /api/admin route sits behind this limiter, registered BEFORE any of
   them: Express applies middleware in registration order, and this used
   to be declared near the end of the file, so the purge route -- and the
   source-health routes -- were outside it. Admin password guessing on
   them was never rate-limited. */
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many attempts. Try again later.' },
});
app.use('/api/admin', adminLimiter);

// A named person or role who can act on a legal takedown notice. Wiring
// purgeByUrl/purgeByHost to nothing, as they were, meant a real request
// to remove a record would be acknowledged and then not actually happen
// for up to 24 hours -- the exact failure their own comment warns about.
app.post('/api/admin/purge', adminAuth, ah(async (req, res) => {
  const { url, host } = req.body || {};
  if (!url && !host) return res.status(400).json({ ok: false, error: 'Provide a url or a host.' });
  // Reported as purged only once storage has confirmed the deletion too.
  const { memory, stored } = await purgeDurably(url ? { url } : { host });
  res.json({ ok: true, purged: memory, purgedFromStorage: stored });
}));

const checkoutResearchLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const documentLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, error: 'Too many document checks from this address. Please try again in an hour.' } });

/* Start a purchase of one brief. Records the purchase as pending; only
   the signed webhook can mark it paid. No contact details are needed:
   access is delivered by token to whoever holds the purchase id. */
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

/* The Merchant of Record's hosted checkout for a purchase. The buyer is sent to the merchant, pays there (the merchant adds and
   collects any tax, included in the total), and comes back to ?sk_ref=...&sk_purchase=..., where the page confirms the payment.
   A session is single-use, so a retry gets a fresh one for the same pending purchase. */
function startMor(quote, purchaseId, billingCountry) {
  const base = SITE_BASE();
  if (!base) throw new Error('PUBLIC_BASE_URL is not set: the merchant checkout needs a return address');
  const ref = encodeURIComponent(quote.ref);
  return PAYMENTS.PROVIDERS.mor.createCheckout(quote, { purchaseId, env: process.env, billingCountry,
    productId: (pricingData.morProducts || {})[quote.currency], returnUrl: `${base}/?sk_ref=${ref}&sk_purchase=${encodeURIComponent(purchaseId)}`, cancelUrl: `${base}/?sk_ref=${ref}` });
}

/* Settle a pending merchant purchase from the merchant's OWN records, not from anything the browser or a webhook claimed:
   the session says which payment belongs to it, and the payment says what was charged. Used when the buyer comes back before
   the webhook has arrived, or when a webhook arrives without its metadata. Returns true when the purchase is now paid. */
async function reconcileMor(purchaseId, ref, row) {
  const s = await morEngine.getSession(row.provider_order_id, { env: process.env });
  if (!s || s.payment_status !== 'succeeded' || !s.payment_id) return false;
  const pay = await morEngine.getPayment(s.payment_id, { env: process.env });
  const expected = PRICING.toMinor(pricingData, Number(row.amount), row.currency);
  if (!pay || pay.status !== 'succeeded' || pay.currency !== row.currency || Number(pay.total_amount) !== expected) {
    await pricingStore.addEvent('webhook_amount_mismatch', { ref, details: { purchaseId, expected, got: pay && pay.total_amount, currency: pay && pay.currency, expectedCurrency: row.currency, via: 'reconcile' } });
    return false;
  }
  return markPurchasePaid(pool, { purchaseId, ref, provider: 'mor', paymentId: s.payment_id });
}

app.post('/api/research/checkout', ACCOUNTS.guard, checkoutResearchLimiter, ah(async (req, res) => {
  if (!paywallActive(process.env)) return res.status(503).json({ ok: false, error: 'Payments are not enabled yet.' });
  const { ref, idempotencyKey, quoteId, billingCountry, buyerKind, taxId } = req.body || {};
  if (!REF_RE.test(String(ref || ''))) return res.status(400).json({ ok: false, error: 'Unknown report reference.' });
  if (!IDEMPOTENCY_KEY_RE.test(String(idempotencyKey || '')))
    return res.status(400).json({ ok: false, error: 'Missing or invalid idempotency key.' });

  // A retried checkout -- the same key seen before -- returns the SAME
  // purchase and order rather than starting a second one. This is the
  // whole fix: nothing below this block runs for a genuine retry.
  const existing = await pool.query(
    `SELECT id, amount, currency, provider, provider_order_id, status, quote_id, billing_country FROM report_purchases WHERE idempotency_key=$1`,
    [idempotencyKey]);
  if (existing.rows.length) {
    const row = existing.rows[0];
    if (row.status !== 'pending_payment' || !row.provider_order_id) {
      // Already paid, refunded, or the order step never completed last
      // time -- not a safe thing to silently hand back as if it were new.
      return res.status(409).json({ ok: false, error: 'This checkout attempt has already been used. Please start again.' });
    }
    if (row.provider === 'mor') {
      // A merchant checkout link is single-use: a retry of the same attempt opens a fresh session for the SAME pending purchase.
      const q0 = await pricingStore.getQuote(row.quote_id);
      if (!q0) return res.status(409).json({ ok: false, error: 'This checkout attempt has already been used. Please start again.' });
      try {
        const o = await startMor(q0, row.id, row.billing_country || q0.buyer.country);
        await pool.query(`UPDATE report_purchases SET provider_order_id=$2 WHERE id=$1`, [row.id, o.orderId]);
        return res.json({ ok: true, purchaseId: row.id, amount: Number(row.amount), currency: row.currency, quoteId: q0.id, mor: { checkoutUrl: o.checkoutUrl } });
      } catch (e) { console.error('[checkout] merchant session failed', e.message); return res.status(503).json({ ok: false, error: 'Payment could not be started right now. Please try again in a moment.' }); }
    }
    return res.json({ ok: true, purchaseId: row.id, amount: Number(row.amount), currency: row.currency,
      razorpay: { keyId: process.env.RAZORPAY_KEY_ID, orderId: row.provider_order_id,
                  amountSubunits: rzp.toSubunits(row.amount, row.currency) } });
  }

  // The quote the buyer reviewed and confirmed. Its total is what is charged: never a number recomputed here,
  // and never one the browser sent. A refused quote asks the page to show the current price again.
  if (!/^q_[0-9a-f]{20}$/.test(String(quoteId || ''))) return res.status(400).json({ ok: false, code: 'quote_required', error: 'Please review your price before paying.' });
  const quote = await pricingStore.getQuote(quoteId);
  if (!quote || quote.ref !== ref) return res.status(404).json({ ok: false, code: 'quote_unknown', requote: true, error: 'That price is no longer available. Please review the current price.' });
  const verdict = PRICING.verifyQuote(quote, process.env);
  if (!verdict.ok) {
    await pricingStore.addEvent('quote_refused', { quoteId, ref, details: { reason: verdict.reason } });
    const why = { expired: 'This price has expired. Please review the current price.', superseded: 'A newer price replaced this one. Please review it.', used: 'This price was already used. Please review the current price.', signature: 'This price could not be verified.' }[verdict.reason];
    return res.status(verdict.reason === 'signature' ? 400 : 409).json({ ok: false, code: 'quote_' + verdict.reason, requote: verdict.reason !== 'signature', error: why });
  }
  // Verify the country before any money moves. The billing country decides tax (and, for a card issued in India, that the
  // charge must be in rupees). If it differs from the quote, the buyer sees the new total and confirms it first.
  const billing = PRICING.cleanCode(billingCountry);
  if (!billing) return res.status(400).json({ ok: false, code: 'billing_required', error: 'Please confirm your billing country.' });
  if (billing !== quote.buyer.country) {
    const reportBrief = await getByRefAsync(ref);
    if (!reportBrief) return res.status(404).json({ ok: false, error: 'This report is no longer available. Search again, then unlock the new report.' });
    const nb = await buyerOf({ body: { country: billing }, headers: req.headers }, { billing });
    await pricingStore.addEvent('billing_mismatch', { quoteId, ref, details: { quoted: quote.buyer.country, billing, onSale: nb.onSale } });
    if (!nb.onSale) return res.status(409).json({ ok: false, code: 'not_on_sale', reason: nb.reason, country: billing, error: 'Reports are not on sale in that country yet.' });
    const nq = await PRICING.issueQuote({ data: pricingData, store: pricingStore, brief: reportBrief, buyer: nb, session: quote.session, supersedes: quote.id, details: { trigger: 'billing_mismatch' } });
    await pricingStore.addEvent('requote', { quoteId: nq.id, ref, details: { from: quote.id, previous: { country: quote.buyer.country, currency: quote.currency, grossMinor: quote.grossMinor } } });
    return res.status(409).json({ ok: false, code: 'billing_country', requote: true, error: 'Your billing country differs from the price you were shown.',
      previous: { country: quote.buyer.country, currency: quote.currency, gross: quote.gross }, quote: PRICING.publicQuote(nq) });
  }
  const route = PRICING.routeFor(pricingData, quote.buyer.country, quote.currency), adapter = PAYMENTS.adapterFor(route);
  if (!adapter) return res.status(503).json({ ok: false, code: 'not_on_sale', reason: 'no_payment_route', error: 'Reports are not on sale in your country yet.' });
  let purchaseId;
  try {
    const r = await pool.query(
      `INSERT INTO report_purchases (report_ref, amount, currency, status, provider, idempotency_key, quote_id, buyer_country, billing_country, amount_net, tax_amount, tax_rate_bps, tax_mode, price_book_version, buyer_kind, tax_id)
       VALUES ($1,$2,$3,'pending_payment',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      // V1 treats every buyer as a consumer: a business tax ID is kept for the invoice, not validated, and changes no tax.
      [ref, quote.gross, quote.currency, adapter.id, idempotencyKey, quote.id, quote.buyer.country, billing, quote.net, quote.tax, quote.taxRateBps, quote.taxMode, quote.priceBookVersion,
       buyerKind === 'business' ? 'business' : 'individual', String(taxId || '').toUpperCase().split(/[^A-Z0-9 .\-]/)[0].replace(/[^A-Z0-9]/g, '').slice(0, 20) || null]);   // ends at the first character a tax ID can't contain
    purchaseId = r.rows[0].id;
    if (ACCOUNTS.enabled) {
      try { const owner = await ACCOUNTS.user(req); await pool.query(`UPDATE report_purchases SET user_id=$2 WHERE id=$1`, [purchaseId, owner.id]); }
      catch (e2) { console.error('[accounts] purchase owner not saved:', e2 && e2.message); return res.status(503).json({ ok: false, error: 'Payment could not be started right now. Please try again.' }); }
    }
  } catch (e) {
    // A concurrent request with the same key beat this one to the insert
    // -- the unique index caught it. Treat it the same as the read-first
    // path above: fetch and return what the winner created.
    if (e && e.code === '23505') {
      const again = await pool.query(
        `SELECT id, amount, currency, provider_order_id FROM report_purchases WHERE idempotency_key=$1`, [idempotencyKey]);
      const row = again.rows[0];
      if (row && row.provider_order_id) {
        return res.json({ ok: true, purchaseId: row.id, amount: Number(row.amount), currency: row.currency,
          razorpay: { keyId: process.env.RAZORPAY_KEY_ID, orderId: row.provider_order_id,
                      amountSubunits: rzp.toSubunits(row.amount, row.currency) } });
      }
    }
    throw e;
  }
  await pricingStore.setQuoteStatus(quote.id, 'used');

  let order;
  try {
    // The amount is the quote's gross total, set on the server -- never anything the browser sent.
    order = adapter.id === 'mor' ? await startMor(quote, purchaseId, billing) : await adapter.createCheckout(quote, { purchaseId, env: process.env, billingCountry: billing });
  } catch (e) {
    console.error('[checkout] provider order failed', e.message);
    return res.status(503).json({ ok: false, error: 'Payment could not be started right now. Please try again in a moment.' });
  }
  // Razorpay's docs: store the order id against the transaction, and
  // verify every payment against THIS stored id.
  await pool.query(`UPDATE report_purchases SET provider_order_id=$2 WHERE id=$1`, [purchaseId, order.orderId]);
  // Where this buyer came from (the browser's first page of the visit) and the property's market, kept with the purchase so the
  // payment, which arrives later from the provider's webhook, can be traced to its channel on the marketing dashboard. Best effort:
  // a database without the column (migration purchase_attribution.sql not yet run) loses the trace, never the payment.
  const source = ANALYTICS.sourceOf(req.body && req.body.source), forMarket = await getByRefAsync(ref).catch(() => null), attribution = { market: (forMarket && forMarket.market) || '', ...(source || {}) };
  try { await pool.query(`UPDATE report_purchases SET attribution=$2 WHERE id=$1`, [purchaseId, JSON.stringify(attribution)]); } catch (e) { console.error('[checkout] attribution not saved:', e && e.message); }
  track('checkout_started', req, { ref, value: quote.gross, currency: quote.currency, lang: pickLanguage(req.body && req.body.lang), market: attribution.market, ...(source ? { utm: source.utm, referrer: source.referrer } : {}) });      // new attempts only, not idempotent retries
  if (adapter.id === 'mor') return res.json({ ok: true, purchaseId, amount: quote.gross, currency: quote.currency, quoteId: quote.id, mor: { checkoutUrl: order.checkoutUrl } });
  res.json({ ok: true, purchaseId, amount: quote.gross, currency: quote.currency, quoteId: quote.id,
             razorpay: { keyId: order.publicKey, orderId: order.orderId, amountSubunits: order.amountSubunits } });
}));

/* Where a buyer can be, and what is on sale there: feeds the country selector.
   Never cached: the suggestion depends on the visitor's network country. */
app.get('/api/pricing/countries', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const list = [...pricingData.countries.values()].filter(c => !c.blocked).map(c => {
    const q = PRICING.quoteCurrency(pricingData, c.iso), s = PRICING.saleStatus(pricingData, c.iso);
    return { iso: c.iso, name: c.name, currency: q.currency, onSale: s.onSale, reason: s.reason };
  }).sort((a, b) => a.name.localeCompare(b.name));
  res.json({ ok: true, countries: list, network: PRICING.networkCountry(req.headers || {}), priceBookVersion: pricingData.book.version });
});

/* Issue a signed quote for this report and buyer, locked for 30 minutes. Any earlier open quote for the same
   report and session is superseded, so a buyer who changes country is never left holding two live prices. */
app.post('/api/research/quote', ACCOUNTS.guard, researchLimiter, ah(async (req, res) => {
  const { ref, previousQuoteId } = req.body || {};
  if (!REF_RE.test(String(ref || ''))) return res.status(400).json({ ok: false, error: 'Unknown report reference.' });
  const brief = await getByRefAsync(ref);
  if (!brief) return res.status(404).json({ ok: false, error: 'This report is no longer available. Search again, then unlock the new report.' });
  if (REVIEW.isHeld(brief)) return res.status(409).json({ ok: false, code: 'held', error: 'A person is checking one or more findings in this report before it can be unlocked. Please try again later.' });
  if (brief.kind === 'dossier' && !brief.dossier) return res.status(409).json({ ok: false, code: 'not_ready', error: 'The first findings are still coming in. Please try again in a minute.' });
  const buyer = await buyerOf(req, { billing: req.body && req.body.billingCountry });
  res.set('Cache-Control', 'no-store');
  try {
    const q = await PRICING.issueQuote({ data: pricingData, store: pricingStore, brief, buyer, session: sessionOf(req), details: { trigger: previousQuoteId ? 'country_changed' : 'unlock' } });
    if (/^q_[0-9a-f]{20}$/.test(String(previousQuoteId || ''))) await pricingStore.addEvent('country_changed', { quoteId: q.id, ref, details: { from: previousQuoteId, to: q.buyer.country } });
    res.json({ ok: true, quote: PRICING.publicQuote(q) });
  } catch (e) {
    if (e instanceof PRICING.PricingError) return res.status(409).json({ ok: false, code: e.code, reason: e.reason, country: e.country, error: e.message });
    throw e;
  }
}));

/* A refund, in the original currency and amount (payments/refunds.js). Admin only. */
app.post('/api/admin/refunds', adminAuth, ah(async (req, res) => {
  const { purchaseId, amount, reason } = req.body || {};
  if (!/^[0-9a-f-]{36}$/i.test(String(purchaseId || ''))) return res.status(400).json({ ok: false, error: 'Invalid purchase id.' });
  try {
    const out = await refundPurchase({ db: pool, data: pricingData, store: pricingStore, purchaseId, amount, reason: String(reason || '').slice(0, 200), env: process.env });
    await pool.query(`INSERT INTO audit_log (actor, action, object_type, object_id, reason) VALUES ('admin','RESEARCH_PURCHASE_REFUNDED','report_purchase',$1,$2)`, [purchaseId, `${out.amount} ${out.currency}${out.full ? ' (full)' : ''}`]);
    res.json({ ok: true, ...out });
  } catch (e) {
    if (e instanceof RefundError) return res.status(409).json({ ok: false, code: e.code, error: e.message });
    throw e;
  }
}));

/* Which AI engine serves each agent, in what fail-over order, and what each did since the server started. Never shows a key. Admin only. */
/* ------------------------------------------------------------------
 * The investigator (pilot, admin only): a panel of AI engines investigates a property, follows every lead,
 * and produces the questions-first due-diligence report. Progress streams as Server-Sent Events.
 * Jobs live in memory for a day; INVESTIGATE_CONCURRENCY caps how many run at once (default 2).
 * ------------------------------------------------------------------ */
const INVESTIGATOR = require('./engine/investigator');
const { renderDossier } = require('./engine/dossierHtml');
const investigations = new Map();
const INVESTIGATION_TTL = 24 * 3600 * 1000;
function sweepInvestigations() { const cut = Date.now() - INVESTIGATION_TTL; for (const [id, j] of investigations) if (j.created < cut && j.status !== 'running') investigations.delete(id); }
function pushInvestigationEvent(job, ev) {
  const slim = ev.dossier ? { type: ev.type, stage: ev.stage, round: ev.round, counts: ev.dossier.counts } : ev;
  job.events.push({ at: Date.now(), ...slim });
  if (ev.dossier) job.dossier = ev.dossier;
  for (const res of job.listeners) { try { res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev.dossier ? { ...slim, dossier: ev.dossier } : slim)}\n\n`); } catch { /* client gone */ } }
}
app.post('/api/admin/investigate', adminAuth, express.json({ limit: '20kb' }), (req, res) => {
  sweepInvestigations();
  const b = req.body || {};
  const query = String(b.query || '').trim().slice(0, 200);
  if (query.length < 3) return res.status(400).json({ ok: false, error: 'Name the property to investigate.' });
  const running = [...investigations.values()].filter(j => j.status === 'running').length;
  if (running >= (Number(process.env.INVESTIGATE_CONCURRENCY) || 2)) return res.status(429).json({ ok: false, error: 'Investigations are already running. Try again when one finishes.' });
  const id = require('crypto').randomBytes(9).toString('base64url');
  const job = { id, query, status: 'running', created: Date.now(), events: [], listeners: new Set(), dossier: null, error: '' };
  investigations.set(id, job);
  const languages = Array.isArray(b.languages) ? b.languages.slice(0, 4).map(String) : [];
  INVESTIGATOR.investigate({ query, location: String(b.location || '').slice(0, 120), market: String(b.market || '').slice(0, 60), languages }, { onEvent: ev => pushInvestigationEvent(job, ev) })
    .then(d => { job.status = 'done'; job.dossier = d; })
    .catch(e => { notifyOps('a paid report failed', `Report ${job.ref} failed while running after payment. The buyer has paid and has not received a complete report. Error: ${String((e && e.message) || e).slice(0, 160)}`); job.status = 'failed'; job.error = String((e && e.message) || e).slice(0, 200); pushInvestigationEvent(job, { type: 'error', message: job.error }); })
    .finally(() => { for (const r of job.listeners) { try { r.end(); } catch { /* gone */ } } job.listeners.clear(); });
  res.status(202).json({ ok: true, id, events: `/api/admin/investigate/${id}/events`, report: `/api/admin/investigate/${id}/report` });
});
app.get('/api/admin/investigate/:id', adminAuth, (req, res) => {
  const job = investigations.get(req.params.id); if (!job) return res.status(404).json({ ok: false, error: 'No such investigation.' });
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, id: job.id, query: job.query, status: job.status, error: job.error, events: job.events, dossier: job.dossier });
});
app.get('/api/admin/investigate/:id/events', adminAuth, (req, res) => {
  const job = investigations.get(req.params.id); if (!job) return res.status(404).json({ ok: false, error: 'No such investigation.' });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders && res.flushHeaders();
  for (const ev of job.events) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
  if (job.dossier) res.write(`event: update\ndata: ${JSON.stringify({ type: 'update', dossier: job.dossier })}\n\n`);
  if (job.status !== 'running') return res.end();
  job.listeners.add(res); req.on('close', () => job.listeners.delete(res));
});
app.get('/api/admin/investigate/:id/report', adminAuth, (req, res) => {
  const job = investigations.get(req.params.id); if (!job || !job.dossier) return res.status(404).json({ ok: false, error: 'No report yet.' });
  res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.send(renderDossier(job.dossier));
});

/* ------------------------------------------------------------------
 * The investigator for buyers. /start names a property; /r/:ref shows the free preview (the panel's first sweep) with
 * the unlock form; payment goes through the SAME quote, checkout, Razorpay verification and webhook as every report,
 * because each investigation is stored under a normal report ref. When a purchase is marked paid, the investigation
 * continues (lead-following, the reviewer, the question writer) and the buyer is sent the link and the PDF.
 * Live progress streams as Server-Sent Events; the public stream never carries paid content.
 * Settings: INVESTIGATE_DAILY_CAP (100; 0 pauses), INVESTIGATE_MARKET_DAILY_CAP (40% of the daily cap, at least 5),
 * INVESTIGATE_PREVIEW_PANEL (1 engine for the free sweep), PREVIEW_SEARCHES (6) and PREVIEW_FETCHES (2) for its depth,
 * AI_CAP_SHARE (0.30: a report's AI spend stops at that share of its net price), AI_DAILY_ALERT_USD (warn) and
 * AI_DAILY_MAX_USD (new free previews pause for the day), LIVE_JOBS_DIR (saved investigations), INVESTIGATE_CONCURRENCY,
 * PUBLIC_BASE_URL (links in messages), and the delivery providers (engine/delivery.js).
 * ------------------------------------------------------------------ */
const DOSSIER_BRIEF = require('./engine/dossierBrief');
const PAGES = require('./engine/reportPages');
const PDF = require('./engine/pdf');
const { alertOperator } = require('./engine/delivery');
const notifyOps = (subject, text) => { alertOperator(process.env, subject, text).catch(() => {}); };
const DELIVERY = require('./engine/delivery').createDelivery({ env: process.env,
  onGiveUp: x => notifyOps('a report could not be delivered', `Report ${x.ref} (${x.channel}) failed after every retry, so the buyer has not received it by ${x.channel}. Their report link still works. Last error: ${x.error}`) });
const { reportLink } = require('./engine/delivery');
const { registerBrief, getByRef, pausedReason } = require('./engine/research');
const liveJobs = new Map();       // ref -> the running or finished investigation behind a buyer's report
const liveIndex = new Map();      // project key -> { ref, at }: the same project is not investigated twice in 30 days
const investigateDaily = { day: '', count: 0, byMarket: {} };
/* The same project under a different name: once a report is complete, its registration numbers point to it for 30 days.
   A later buyer of the same registered project gets that report, and its research is not paid for again. */
const regIndex = new Map();       // registration number -> { ref, at }
const regIdsOf = d => ((d && d.project && d.project.ids) || []).map(x => String(x).toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(x => x.length >= 4);
function indexFinished(job, d) { for (const id of regIdsOf(d)) regIndex.set(id, { ref: job.ref, at: Date.now() }); }
function finishedTwin(job) {
  const d = (job.inv && job.inv.dossier) || (job.saved && job.saved.dossier);
  for (const id of regIdsOf(d)) {
    const hit = regIndex.get(id); if (!hit || hit.ref === job.ref || Date.now() - hit.at > 30 * 24 * 3600 * 1000) continue;
    const twin = liveJobs.get(hit.ref);
    const done = twin && twin.status === 'done' && ((twin.inv && twin.inv.dossier) || (twin.saved && twin.saved.dossier));
    if (done && done.phase === 'complete') return { ref: hit.ref, dossier: done };
  }
  return null;
}
const { costedEngines } = require('./engine/jobCosts');
const JOBS = require('./engine/jobStore').createJobStore({ dir: process.env.LIVE_JOBS_DIR || require('path').join(__dirname, 'data', 'live-jobs') });
const dayOf = () => new Date().toISOString().slice(0, 10);
const num = (k, d) => { const v = process.env[k]; return v === undefined || v === '' ? d : Number(v); };
const previewBudget = () => ({ searches: num('PREVIEW_SEARCHES', 6), fetches: num('PREVIEW_FETCHES', 2) });
const previewPanel = () => num('INVESTIGATE_PREVIEW_PANEL', 1) || 1;
const marketCap = () => num('INVESTIGATE_MARKET_DAILY_CAP', Math.max(5, Math.ceil(investigateCap() * 0.4)));

/* What the AI is costing: today's total and by market, and each report's own total (from engine/jobCosts.js). */
const spend = { day: '', usd: 0, byMarket: {}, alerted: false };
function addSpend(job, usd) {
  if (!(usd > 0)) return;
  const d = dayOf(); if (spend.day !== d) Object.assign(spend, { day: d, usd: 0, byMarket: {}, alerted: false });
  const m = String(job.input.country || '').toUpperCase() || '??';
  spend.usd += usd; spend.byMarket[m] = (spend.byMarket[m] || 0) + usd; job.costUsd = (job.costUsd || 0) + usd;
  const alert = num('AI_DAILY_ALERT_USD', 0);
  if (alert > 0 && !spend.alerted && spend.usd >= alert) { spend.alerted = true; console.warn(`[costs] AI spend today has passed $${alert}: $${spend.usd.toFixed(2)}`); }
}
const overDailyMax = () => { const m = num('AI_DAILY_MAX_USD', 0); return m > 0 && spend.day === dayOf() && spend.usd >= m; };
/** The most a paid report may spend on AI: AI_CAP_SHARE (30%) of its net price in the project's own country. */
function aiCapFor(brief) {
  const share = num('AI_CAP_SHARE', 0.30);
  try {
    const f = PRICING.previewFee(pricingData, brief, PRICING.resolveBuyer(pricingData, { selected: String(brief.market || 'in').toUpperCase() }));
    const usd = (f.net != null ? f.net : f.price) / pricingData.book.fx.perUsd[f.currency];
    if (Number.isFinite(usd) && usd > 0) return usd * share;
  } catch { /* fall back */ }
  return num('AI_CAP_FALLBACK_USD', 6);
}
function persistJob(job) {
  JOBS.save({ ref: job.ref, input: job.input, key: job.key || null, status: job.status, paid: Boolean(job.paid), contact: job.contact || null,
    costUsd: job.costUsd || 0, capUsd: job.capUsd == null ? null : job.capUsd, delivered: Boolean(job.delivered), createdAt: job.createdAt || Date.now(),
    updatedAt: Date.now(), saved: job.inv ? job.inv.exportState() : (job.saved || null) });
}
const tokenOk = (t, ref) => Boolean(t) && verifyToken(String(t), ref, process.env.ACCESS_TOKEN_SECRET);
const fullAccess = (req, ref, token) => (ACCOUNTS.enabled ? ACCOUNTS.entitled(req, ref) : Promise.resolve(tokenOk(token, ref)));
const ownsPurchase = async (req, purchaseId) => { const u = await ACCOUNTS.user(req); return Boolean(u) && (await pool.query(`SELECT 1 FROM report_purchases WHERE id=$1 AND user_id=$2`, [purchaseId, u.id])).rows.length > 0; };
const grantOf = ref => (ACCOUNTS.enabled ? { ok: true, entitled: true } : { ok: true, token: issueToken(ref, process.env.ACCESS_TOKEN_SECRET) });
const investigateCap = () => { const v = process.env.INVESTIGATE_DAILY_CAP; return v === undefined || v === '' ? 100 : Number(v); };
const publicEvent = e => ({ type: e.type, stage: e.stage, phase: e.phase, counts: e.counts, ...(e.stage === 'sweep' || e.type === 'error' ? { message: e.message } : {}) });

function saveLiveDossier(job, d) {
  d.ref = job.ref;
  const prev = getByRef(job.ref) || {};
  registerBrief(DOSSIER_BRIEF.briefOf({ ref: job.ref, query: job.input.query, location: job.input.location, country: job.input.country, marketLabel: job.input.market,
    dossier: d, phase: d.phase, contact: job.contact || prev.contact, review: prev.review }));
}
function liveEmit(job, ev) {
  const slim = { type: ev.type, stage: ev.stage, round: ev.round, message: ev.message, phase: ev.dossier && ev.dossier.phase, counts: ev.dossier && ev.dossier.counts };
  job.events.push({ at: Date.now(), ...slim }); if (job.events.length > 200) job.events.shift();
  if (ev.dossier) saveLiveDossier(job, ev.dossier);
  if (ev.dossier || ev.type === 'done' || ev.type === 'error') persistJob(job);
  for (const l of job.listeners) { try { l.res.write(`event: ${ev.type}\ndata: ${JSON.stringify(l.full ? slim : publicEvent(slim))}\n\n`); } catch { /* gone */ } }
}
/** The investigation behind a job: priced per call, stopped at its cap, and resumed from saved state when there is one. */
function makeInv(job, resume) {
  job.inv = INVESTIGATOR.createInvestigation({ query: job.input.query, location: job.input.location, market: job.input.market || job.input.country, country: job.input.country, budget: previewBudget() },
    { onEvent: ev => liveEmit(job, ev), engines: costedEngines(require('./engines'), usd => addSpend(job, usd)),
      shouldStop: () => job.capUsd != null && (job.costUsd || 0) >= job.capUsd, resume });
  return job.inv;
}
function newLiveJob(ref, input) {
  const job = { ref, input, status: 'sweeping', listeners: new Set(), events: [], contact: null, paid: false, costUsd: 0, capUsd: null, createdAt: Date.now() };
  makeInv(job, null);
  liveJobs.set(ref, job); persistJob(job);
  return job;
}
function deliverReport(job) {
  const brief = getByRef(job.ref); const contact = (brief && brief.contact) || job.contact;
  if (!contact || job.delivered || !process.env.ACCESS_TOKEN_SECRET) return null;
  job.delivered = true;
  const token = issueToken(job.ref, process.env.ACCESS_TOKEN_SECRET), link = ACCOUNTS.enabled ? reportLink(process.env, job.ref, '').replace(/\?t=$/, '') : reportLink(process.env, job.ref, token);
  if (contact.email) RESPONSES.watch(job.ref, contact.email).catch(() => {});   // told if a finding in this report is corrected: that one purpose only
  return DELIVERY.send({ ref: job.ref, project: (brief && brief.project && brief.project.name) || job.input.query, email: contact.email, phone: contact.phone, link, pdfLink: ACCOUNTS.enabled ? link + '/pdf' : link.replace(/\?t=/, '/pdf?t=') });
}
/** Run the paid part. Never twice. After a restart it resumes from the saved state, so the research is not paid for again. */
function completeLive(job) {
  if (job.completing) return;
  if (!job.inv) { makeInv(job, job.saved && job.saved.state ? job.saved : null); job.swept = Boolean(job.saved && job.saved.swept); }
  if (job.paid && job.capUsd == null) job.capUsd = aiCapFor(getByRef(job.ref) || {});
  const twin = finishedTwin(job);
  if (twin) {
    // Already investigated in full under another name: give this buyer that report, at no new AI cost.
    const d = JSON.parse(JSON.stringify(twin.dossier)); d.ref = job.ref; d.reusedFrom = twin.ref;
    job.reusedFrom = twin.ref; job.status = 'done'; job.inv = null;   // the unused investigation is dropped, so what is saved is this report
    job.saved = { state: null, dossier: d, swept: true };
    liveEmit(job, { type: 'done', dossier: d }); persistJob(job);
    try { const p = deliverReport(job); if (p && typeof p.catch === 'function') p.catch(e => console.error('[investigate] delivery failed for ' + job.ref + ':', e && e.message)); } catch (e) { console.error('[investigate] delivery failed for ' + job.ref + ':', e && e.message); }
    for (const l of job.listeners) { try { l.res.end(); } catch { /* gone */ } } job.listeners.clear();
    return;
  }
  job.completing = true; job.status = 'completing'; persistJob(job);
  const run = job.swept === false ? job.inv.sweep({ panel: previewPanel() }).then(() => job.inv.complete()) : job.inv.complete();
  // The research is done, so the report is done: a delivery problem is logged and retried by the delivery layer,
  // and never turns a finished, paid report into a failed one.
  run.then(() => {
    job.status = 'done'; indexFinished(job, job.inv.dossier); persistJob(job);
    try { const p = deliverReport(job); if (p && typeof p.catch === 'function') p.catch(e => console.error('[investigate] delivery failed for ' + job.ref + ':', e && e.message)); }
    catch (e) { console.error('[investigate] delivery failed for ' + job.ref + ':', e && e.message); }
  })
    .catch(e => { notifyOps('a paid report failed', `Report ${job.ref} could not be completed after payment. Error: ${String((e && e.message) || e).slice(0, 160)}`); job.status = 'failed'; console.error('[investigate] completion failed for ' + job.ref + ':', e && e.message); liveEmit(job, { type: 'error', message: 'The investigation stopped early. What was found is in your report.' }); deliverReport(job); })
    .finally(() => { for (const l of job.listeners) { try { l.res.end(); } catch { /* gone */ } } job.listeners.clear(); });
}
/** Called whenever a purchase is settled (the browser's verification or Razorpay's webhook). A no-op for other reports. */
function onReportPaid(ref, payerEmail) {
  const brief = getByRef(ref);
  if (!brief || brief.kind !== 'dossier') return;
  let job = liveJobs.get(ref);
  if (!job) { job = newLiveJob(ref, { query: brief.project.name, location: brief.location, country: brief.market.toUpperCase(), market: brief.marketLabel }); job.swept = false; job.status = 'preview'; }
  if (ACCOUNTS.enabled && payerEmail) { job.contact = { email: payerEmail }; if (job.status === 'done') job.delivered = false; }
  job.paid = true; job.capUsd = aiCapFor(brief); persistJob(job);
  if (job.status === 'done' && ACCOUNTS.enabled && payerEmail) { try { const p = deliverReport(job); if (p && typeof p.catch === 'function') p.catch(e => console.error('[investigate] delivery failed for ' + job.ref + ':', e && e.message)); } catch (e) { console.error('[investigate] delivery failed for ' + job.ref + ':', e && e.message); } }
  if (job.status === 'preview' || job.status === 'interrupted') completeLive(job);   // a sweep still running continues into completion when it ends
}

/* At start: reload saved investigations. Finished previews stay reusable for 30 days; a paid report that was still
   running resumes on its own from its saved state. */
for (const rec of JOBS.all()) {
  const job = { ...rec, listeners: new Set(), events: [], inv: null, completing: false };
  if (rec.status === 'sweeping' && !(rec.saved && rec.saved.swept)) job.status = 'interrupted';
  if (rec.status === 'completing') job.status = 'preview';
  liveJobs.set(rec.ref, job);
  if (rec.key && rec.saved && rec.saved.swept && Date.now() - (rec.createdAt || 0) < 30 * 24 * 3600 * 1000) liveIndex.set(rec.key, { ref: rec.ref, at: rec.createdAt });
  if (rec.status === 'done' && rec.saved && rec.saved.dossier && Date.now() - (rec.updatedAt || 0) < 30 * 24 * 3600 * 1000) for (const id of regIdsOf(rec.saved.dossier)) regIndex.set(id, { ref: rec.ref, at: rec.updatedAt });
  // Without a database the report store is in memory: put each saved report back, so buyers' links work after a restart.
  if (!process.env.DATABASE_URL && rec.saved && rec.saved.dossier) { try { saveLiveDossier(job, JSON.parse(JSON.stringify(rec.saved.dossier))); } catch (e) { console.error('[investigate] could not restore report ' + rec.ref + ':', e && e.message); } }
}
setImmediate(() => { for (const job of liveJobs.values()) if (job.paid && job.status !== 'done' && job.status !== 'failed' && !job.completing) { try { completeLive(job); } catch (e) { console.error('[investigate] could not resume ' + job.ref + ':', e && e.message); } } });

app.get('/start', ah(async (req, res) => {
  res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.send(PAGES.startPage({ botGuard: BOT.enabled(process.env), country: (await buyerOf(req)).country }));
}));
app.get('/assets/report-live.js', (req, res) => { res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300' }); res.send(PAGES.SCRIPT); });

// The new search (backend/search): candidates before research, matched however the buyer typed. SEARCH_V2=shadow (default) runs it
// silently beside every research request and keeps the comparison for the admin; =on lets the page show candidates; =off stops it.
const SEARCH = require('./search/service').createSearch({ env: process.env });
SEARCH.mount(app, { adminAuth, ah, jsonParser: express.json({ limit: '2mb' }), limiter: researchLimiter, stripPII, markets: MARKETS });

app.post('/api/investigate', ACCOUNTS.guardStart, researchLimiter, ah(async (req, res) => {
  const b = req.body || {};
  const query = String(b.query || '').trim(), location = String(b.location || '').trim().slice(0, 120), country = PRICING.cleanCode(b.country) || '';
  if (query.length < 3 || query.length > 120) return res.status(400).json({ ok: false, error: 'Name the project, in 3 to 120 characters.' });
  const paused = pausedReason(process.env, country.toLowerCase());
  if (paused) return res.status(503).json({ ok: false, code: 'paused', error: paused });
  const key = DOSSIER_BRIEF.keyOf(query, location, country), seen = liveIndex.get(key);
  if (seen && Date.now() - seen.at < 30 * 24 * 3600 * 1000 && (liveJobs.has(seen.ref) || await getByRefAsync(seen.ref))) {
    try { SEARCH.observeInvestigate({ query: stripPII(query), location: stripPII(location), market: SEARCH.marketOfCountry(country), reused: true }); } catch {}
    ACCOUNTS.touch(req, seen.ref);
    return res.json({ ok: true, ref: seen.ref, reused: true });
  }
  if (BOT.enabled(process.env)) { const v = BOT.verify(b.pow, process.env); if (!v.ok) return res.status(428).json({ ok: false, code: 'challenge', error: 'Please complete the quick check and try again.' }); }
  const today = new Date().toISOString().slice(0, 10);
  if (investigateDaily.day !== today) { investigateDaily.day = today; investigateDaily.count = 0; investigateDaily.byMarket = {}; }
  if (investigateCap() <= 0 || investigateDaily.count >= investigateCap()) return res.status(503).json({ ok: false, code: 'paused', error: 'New investigations are paused for today. Projects already investigated are still available.' });
  if (overDailyMax()) return res.status(503).json({ ok: false, code: 'paused', error: 'New investigations are paused for today. Projects already investigated are still available.' });
  const mk = country || '??';
  if ((investigateDaily.byMarket[mk] || 0) >= marketCap()) return res.status(503).json({ ok: false, code: 'paused', error: 'New investigations in this market are paused for today. Projects already investigated are still available.' });
  const running = [...liveJobs.values()].filter(j => j.status === 'sweeping' || j.status === 'completing').length;
  if (running >= (Number(process.env.INVESTIGATE_CONCURRENCY) || 2) * 2) return res.status(429).json({ ok: false, error: 'Many investigations are running. Please try again in a few minutes.' });
  investigateDaily.count++; investigateDaily.byMarket[mk] = (investigateDaily.byMarket[mk] || 0) + 1;
  const ref = DOSSIER_BRIEF.newRef(), input = { query, location, country, market: String(b.market || '').slice(0, 60) };
  ACCOUNTS.touch(req, ref);
  registerBrief(DOSSIER_BRIEF.briefOf({ ref, query, location, country, marketLabel: input.market, phase: 'starting' }));
  liveIndex.set(key, { ref, at: Date.now() });
  const job = newLiveJob(ref, input); job.key = key;
  try { SEARCH.observeInvestigate({ query: stripPII(query), location: stripPII(location), market: SEARCH.marketOfCountry(country), reused: false }); } catch {}   // the new search, in the shadow
  job.inv.sweep({ panel: previewPanel() })
    .then(() => { job.status = 'preview'; persistJob(job); if (job.paid) completeLive(job); getByRefAsync(ref).then(b => SEARCH.afterInvestigation(b, SEARCH.marketOfCountry(country))).catch(() => {}); })
    .catch(e => { job.status = 'failed'; persistJob(job); console.error('[investigate] sweep failed for ' + ref + ':', e && e.message); liveEmit(job, { type: 'error', message: 'The investigation could not run just now. Please try again later.' }); });
  res.status(202).json({ ok: true, ref });
}));

app.get('/api/investigate/:ref/events', ACCOUNTS.guard, ah(async (req, res) => {
  const ref = String(req.params.ref || ''); if (!REF_RE.test(ref)) return res.status(400).json({ ok: false });
  ACCOUNTS.touch(req, ref);
  const job = liveJobs.get(ref), full = await fullAccess(req, ref, req.query && req.query.t);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  if (res.flushHeaders) res.flushHeaders();
  for (const e of (job ? job.events : [])) res.write(`event: ${e.type}\ndata: ${JSON.stringify(full ? e : publicEvent(e))}\n\n`);
  const open = job && (job.status === 'sweeping' || (full && job.status === 'completing'));
  if (!open) return res.end();
  const l = { res, full }; job.listeners.add(l); req.on('close', () => job.listeners.delete(l));
}));

app.post('/api/investigate/:ref/contact', ACCOUNTS.guard, checkoutResearchLimiter, ah(async (req, res) => {
  const ref = String(req.params.ref || ''); if (!REF_RE.test(ref)) return res.status(400).json({ ok: false, error: 'Unknown report reference.' });
  const brief = await getByRefAsync(ref); if (!brief || brief.kind !== 'dossier') return res.status(404).json({ ok: false, error: 'Unknown report.' });
  if (ACCOUNTS.enabled) return res.json({ ok: true });
  const c = DOSSIER_BRIEF.cleanContact(req.body || {}); if (c.error) return res.status(400).json({ ok: false, error: c.error });
  const job = liveJobs.get(ref); if (job) { job.contact = c.contact; persistJob(job); }
  registerBrief({ ...brief, contact: c.contact });
  res.json({ ok: true });
}));

app.get('/r/:ref', ACCOUNTS.guardPage, ah(async (req, res) => {
  const ref = String(req.params.ref || '');
  res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  const brief = REF_RE.test(ref) ? await getByRefAsync(ref) : null;
  if (!brief || brief.kind !== 'dossier') return res.status(404).send(PAGES.startPage({ botGuard: BOT.enabled(process.env) }).replace('Know who you are paying, before you pay.', 'That report was not found. Start a new one.'));
  if (!brief.dossier) return res.send(PAGES.workingPage({ ref, query: brief.project.name }));
  ACCOUNTS.touch(req, ref);
  const t = String((req.query && req.query.t) || '');
  if (await fullAccess(req, ref, t)) {
    if (brief.dossier.phase !== 'complete') onReportPaid(ref);   // a paid report that is not yet complete (for example after a restart) continues
    return res.send(PAGES.fullPage(brief.dossier, { ref, token: t, pdf: PDF.available() }));
  }
  // An unknown visitor is priced in the project's own country; a visitor whose country is known keeps their own.
  let buyer = await buyerOf(req);
  if (buyer.source === 'default' && brief.market) buyer = await buyerOf({ ...req, body: {}, query: { country: brief.market.toUpperCase() } });
  let price = null;
  try { const f = PRICING.previewFee(pricingData, brief, buyer); price = { display: f.currency === 'INR' ? '₹' + Number(f.price).toLocaleString('en-IN') : `${f.currency} ${f.price}`, line: 'Set by the property\'s value and the depth of the research. The amount you pay is confirmed before payment.' }; } catch { price = null; }
  res.send(PAGES.previewPage(brief.dossier, { ref, price, country: buyer.country, held: REVIEW.isHeld(brief), payments: paywallActive(process.env) }));
}));

app.get('/r/:ref/pdf', ACCOUNTS.guard, ah(async (req, res) => {
  const ref = String(req.params.ref || ''); const t = String((req.query && req.query.t) || '');
  if (!REF_RE.test(ref) || !(await fullAccess(req, ref, t))) return res.status(403).json({ ok: false, error: 'This link has expired or is not valid.' });
  const brief = await getByRefAsync(ref); if (!brief || !brief.dossier) return res.status(404).json({ ok: false, error: 'No report yet.' });
  try {
    const pdf = await PDF.renderPdf(renderDossier(brief.dossier), { footer: `ShelterKart report: ${brief.project.name}. ${ref}. Research, not advice.` });
    const name = 'ShelterKart-Report-' + String(brief.project.name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.pdf';
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
    res.send(pdf);
  } catch (e) {
    if (e && e.code === 'pdf_unavailable') return res.status(503).json({ ok: false, error: 'PDF download is not available yet. Open the report and use your browser\'s print to save a PDF.' });
    throw e;
  }
}));

/* The reference reports, public: the same report a buyer receives, built from published research, so anyone can see
 * what they would get. Files: data/sample-reports/<id>.json (built by tools/build_dossier.js). PDFs are printed once. */
const sfs = require('fs'), spath = require('path');
const SAMPLE_REPORTS_DIR = spath.join(__dirname, 'data', 'sample-reports');
const samplePdfCache = new Map();
function loadSample(id) {
  if (!/^[a-z0-9-]{2,40}$/.test(id)) return null;
  try { return JSON.parse(sfs.readFileSync(spath.join(SAMPLE_REPORTS_DIR, id + '.json'), 'utf8')); } catch { return null; }
}
/* The free Home Buying Guide: one web page and one PDF, built by guide/build_guide.py and copied to data/guide/. */
const GUIDE_DIR = require('path').join(__dirname, 'data', 'guide');
const guideFile = name => { try { return require('fs').readFileSync(require('path').join(GUIDE_DIR, name)); } catch { return null; } };
app.get('/guide', (req, res) => {
  const page = guideFile('ShelterKart-Home-Buying-Guide.html');
  if (!page) return res.status(404).json({ ok: false, error: 'The guide is not installed on this server.' });
  res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
  res.send(page.toString('utf8'));
});
app.get('/guide/card.png', (req, res) => {
  const png = guideFile('ShelterKart-Sales-Office-Card.png');
  if (!png) return res.status(404).json({ ok: false, error: 'The card is not installed on this server.' });
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
  res.send(png);
});
app.get('/guide/card.pdf', (req, res) => {
  const pdf = guideFile('ShelterKart-Sales-Office-Card.pdf');
  if (!pdf) return res.status(404).json({ ok: false, error: 'The card is not installed on this server.' });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="ShelterKart-Sales-Office-Card.pdf"', 'Cache-Control': 'public, max-age=3600' });
  res.send(pdf);
});
app.get('/guide/pdf', (req, res) => {
  const pdf = guideFile('ShelterKart-Home-Buying-Guide.pdf');
  if (!pdf) return res.status(404).json({ ok: false, error: 'The guide PDF is not installed on this server.' });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="ShelterKart-Home-Buying-Guide.pdf"', 'Cache-Control': 'public, max-age=3600' });
  res.send(pdf);
});

app.get('/samples/:id', (req, res) => {
  const d = loadSample(String(req.params.id || ''));
  res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
  if (!d) return res.status(404).send(PAGES.startPage({ botGuard: BOT.enabled(process.env) }).replace('Know who you are paying, before you pay.', 'That sample was not found. Start your own report.'));
  res.send(PAGES.samplePage(d, { id: req.params.id, pdf: PDF.available() }));
});
app.get('/samples/:id/pdf', ah(async (req, res) => {
  const id = String(req.params.id || ''), d = loadSample(id);
  if (!d) return res.status(404).json({ ok: false, error: 'No such sample.' });
  try {
    if (!samplePdfCache.has(id)) samplePdfCache.set(id, await PDF.renderPdf(renderDossier(d), { footer: `ShelterKart sample report: ${(d.project && d.project.name) || d.query}. Research, not advice.` }));
    const name = 'ShelterKart-Sample-' + String((d.project && d.project.name) || id).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.pdf';
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}"`, 'Cache-Control': 'public, max-age=3600' });
    res.send(samplePdfCache.get(id));
  } catch (e) {
    if (e && e.code === 'pdf_unavailable') return res.status(503).json({ ok: false, error: 'PDF download is not available yet. Open the sample and use your browser\'s print to save a PDF.' });
    throw e;
  }
}));

app.get('/api/admin/costs', adminAuth, (req, res) => {
  const r = x => Math.round((x || 0) * 10000) / 10000, jobs = [...liveJobs.values()];
  const paidDone = jobs.filter(j => j.paid && j.status === 'done');
  res.json({ ok: true, today: { date: spend.day || dayOf(), usd: r(spend.usd), byMarket: Object.fromEntries(Object.entries(spend.byMarket).map(([k, v]) => [k, r(v)])) },
    limits: { alertUsd: num('AI_DAILY_ALERT_USD', 0), maxUsd: num('AI_DAILY_MAX_USD', 0), paused: overDailyMax(), capShare: num('AI_CAP_SHARE', 0.30),
      dailyCap: investigateCap(), marketCap: marketCap(), preview: { panel: previewPanel(), ...previewBudget() } },
    perPaidReport: paidDone.length ? r(paidDone.reduce((t, j) => t + (j.costUsd || 0), 0) / paidDone.length) : null,
    reports: jobs.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)).slice(0, 25)
      .map(j => ({ ref: j.ref, market: j.input && j.input.country, status: j.status, paid: Boolean(j.paid), costUsd: r(j.costUsd), capUsd: j.capUsd == null ? null : r(j.capUsd) })),
    pdf: PDF.queueState() });
});
app.get('/api/admin/delivery', adminAuth, (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ok: true, ...DELIVERY.status(), pdf: PDF.available() }); });

app.get('/api/admin/engines', adminAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, ...ENGINES.status(process.env) });
});

/* Tax exposure: twelve-month sales per country against its registration threshold, and which countries sell and why not. Admin only. */
app.get('/api/admin/tax', adminAuth, ah(async (req, res) => {
  const progress = await PRICING.ledger.progress({ data: pricingData, store: pricingStore });
  const countries = [...pricingData.countries.values()].filter(c => !c.blocked).map(c => ({ iso: c.iso, name: c.name, ...PRICING.saleStatus(pricingData, c.iso) }));
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, priceBookVersion: pricingData.book.version, progress, onSale: countries.filter(c => c.onSale).map(c => c.iso), off: countries.filter(c => !c.onSale) });
}));

/* The checkout's success handler. Instant unlock: the signature is
   checked against the order id stored on OUR server for this purchase,
   so a browser cannot pair a real payment with someone else's order. */
app.post('/api/research/razorpay/verify', ACCOUNTS.guard, checkoutResearchLimiter, ah(async (req, res) => {
  if (!paywallActive(process.env)) return res.status(503).json({ ok: false, error: 'Payments are not enabled yet.' });
  const { ref, purchaseId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
  if (!REF_RE.test(String(ref || '')) || !/^[0-9a-f-]{36}$/i.test(String(purchaseId || '')) || !/^pay_\w+$/.test(String(paymentId || '')))
    return res.status(400).json({ ok: false, error: 'Invalid request.' });
  const q = await pool.query(`SELECT status, provider_order_id FROM report_purchases WHERE id=$1 AND report_ref=$2`, [purchaseId, ref]);
  if (!q.rows.length || !q.rows[0].provider_order_id) return res.status(404).json({ ok: false, error: 'Purchase not found.' });
  if (ACCOUNTS.enabled && !(await ownsPurchase(req, purchaseId))) return res.status(403).json({ ok: false, code: 'not_entitled', error: 'This purchase belongs to another account.' });
  const valid = rzp.verifyCheckoutSignature({ serverOrderId: q.rows[0].provider_order_id, paymentId, signature, keySecret: process.env.RAZORPAY_KEY_SECRET });
  if (!valid) return res.status(400).json({ ok: false, error: 'This payment could not be verified. If you were charged, write to us with your receipt.' });
  if (q.rows[0].status !== 'paid') await markPurchasePaid(pool, { purchaseId, ref, provider: 'razorpay', paymentId }, { req });
  res.json(grantOf(ref));
}));

/* Razorpay's webhook: the backstop if the buyer closes the tab before
   the checkout handler runs. Verified over the raw body, as Razorpay's
   docs require. Always answers 2xx once the signature is valid, so
   Razorpay doesn't retry forever; what it DID is recorded instead. */
app.post('/api/payments/razorpay/webhook', express.raw({ type: 'application/json', limit: '1mb' }), ah(async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ ok: false });
  if (!Buffer.isBuffer(req.body) || !rzp.verifyWebhookSignature(req.body, req.get('x-razorpay-signature'), secret))
    return res.status(401).json({ ok: false, error: 'Invalid signature' });
  let event;
  try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).json({ ok: false }); }
  const p = rzp.parseWebhook(event);
  if (!p || !p.paymentId) return res.json({ ok: true, ignored: event && event.event });

  // One record per payment and event type: a redelivery collides here.
  const seen = await pool.query(
    `INSERT INTO payment_events (provider, event_id, payload_hash, signature_ok, process_status)
     VALUES ('razorpay', $1, $2, true, 'received') ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
    [`${p.paymentId}:${p.kind}`, crypto.createHash('sha256').update(req.body).digest('hex')]);
  if (!seen.rows.length) return res.json({ ok: true, duplicate: true });
  const eventRowId = seen.rows[0].id;
  const done = status => pool.query(`UPDATE payment_events SET process_status=$2, processed_at=NOW() WHERE id=$1`, [eventRowId, status]);

  const q = await pool.query(`SELECT id, report_ref, amount, currency, status FROM report_purchases WHERE provider='razorpay' AND provider_order_id=$1`, [p.orderId]);
  if (!q.rows.length) { await done('ignored'); return res.json({ ok: true, unknown_order: true }); }
  const row = q.rows[0];
  let expected;
  try { expected = rzp.toSubunits(row.amount, row.currency); } catch { expected = NaN; }
  // The webhook can only CONFIRM the quote's total. Any difference, even one unit, and nothing unlocks.
  if (p.currency !== row.currency || p.amountSubunits !== expected) {
    await pricingStore.addEvent('webhook_amount_mismatch', { ref: row.report_ref, details: { purchaseId: row.id, expected, got: p.amountSubunits, currency: p.currency, expectedCurrency: row.currency } });
    await done('failed'); return res.json({ ok: true, mismatch: true });
  }
  // A card issued in India can only be charged in rupees: a foreign-currency payment on an Indian card is flagged for review.
  if (p.international === false && row.currency !== 'INR') await pricingStore.addEvent('card_origin_mismatch', { ref: row.report_ref, details: { purchaseId: row.id, currency: row.currency } });
  await markPurchasePaid(pool, { purchaseId: row.id, ref: row.report_ref, provider: 'razorpay', paymentId: p.paymentId });
  if (p.feeSubunits != null && row.currency === 'INR') {
    // Net revenue is written ONCE, from the provider's own figure. (Foreign-currency fees settle in rupees at a rate we do not see here: reconcile those from the settlement report.)
    const m = 100, fee = p.feeSubunits / m;
    await pool.query(`UPDATE report_purchases SET provider_fee=$2, net_revenue=amount_net-$2 WHERE id=$1 AND net_revenue IS NULL`, [row.id, fee]);
  }
  await done('processed');
  res.json({ ok: true });
}));

/* The Merchant of Record's webhook. Verified over the RAW body (Standard Webhooks: id, timestamp, signature; five minute tolerance),
   de-duplicated by the webhook-id header, and able only to CONFIRM the quote's total: the same currency and the same amount in the
   smallest unit, or nothing unlocks. Always answers 2xx once the signature is valid so the merchant does not retry forever; what
   it did is recorded. A payment with no usable metadata is recorded as unmatched and settled by the buyer's return (reconcileMor). */
app.post('/api/payments/mor/webhook', express.raw({ type: 'application/json', limit: '1mb' }), ah(async (req, res) => {
  const secret = process.env.DODO_WEBHOOK_KEY;
  if (!secret) return res.status(503).json({ ok: false });
  const headers = { 'webhook-id': req.get('webhook-id'), 'webhook-timestamp': req.get('webhook-timestamp'), 'webhook-signature': req.get('webhook-signature') };
  if (!Buffer.isBuffer(req.body) || !morEngine.verifyWebhook(req.body, headers, secret)) return res.status(401).json({ ok: false, error: 'Invalid signature' });
  let event;
  try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).json({ ok: false }); }
  const p = morEngine.parseWebhook(event);
  if (!p) return res.json({ ok: true, ignored: event && event.type });
  const seen = await pool.query(
    `INSERT INTO payment_events (provider, event_id, payload_hash, signature_ok, process_status)
     VALUES ('mor', $1, $2, true, 'received') ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
    [headers['webhook-id'], crypto.createHash('sha256').update(req.body).digest('hex')]);
  if (!seen.rows.length) return res.json({ ok: true, duplicate: true });
  const eventRowId = seen.rows[0].id;
  const done = status => pool.query(`UPDATE payment_events SET process_status=$2, processed_at=NOW() WHERE id=$1`, [eventRowId, status]);
  if (p.kind !== 'paid') { await done('processed'); return res.json({ ok: true, noted: p.type }); }       // failed and refund events are recorded, not acted on here
  if (!p.paymentId || !/^[0-9a-f-]{36}$/i.test(String(p.purchaseId || ''))) {
    await pricingStore.addEvent('mor_unmatched_payment', { details: { paymentId: p.paymentId, type: p.type } });
    await done('ignored'); return res.json({ ok: true, unmatched: true });
  }
  const q = await pool.query(`SELECT id, report_ref, amount, currency, status FROM report_purchases WHERE id=$1 AND provider='mor'`, [p.purchaseId]);
  if (!q.rows.length) { await done('ignored'); return res.json({ ok: true, unknown_purchase: true }); }
  const row = q.rows[0], expected = PRICING.toMinor(pricingData, Number(row.amount), row.currency);
  // The webhook can only CONFIRM the quote's total. Any difference, even one unit, and nothing unlocks. (A mismatch usually means the
  // merchant's product is not tax-inclusive: fix the product. The buyer is NOT unlocked and the event is recorded for support.)
  if (p.currency !== row.currency || p.amountMinor !== expected) {
    console.error(`[mor] amount mismatch on purchase ${row.id}: expected ${expected} ${row.currency}, got ${p.amountMinor} ${p.currency}`);
    await pricingStore.addEvent('webhook_amount_mismatch', { ref: row.report_ref, details: { purchaseId: row.id, expected, got: p.amountMinor, currency: p.currency, expectedCurrency: row.currency } });
    await done('failed'); return res.json({ ok: true, mismatch: true });
  }
  await markPurchasePaid(pool, { purchaseId: row.id, ref: row.report_ref, provider: 'mor', paymentId: p.paymentId });
  if (p.taxMinor != null) await pricingStore.addEvent('mor_tax_collected', { ref: row.report_ref, details: { purchaseId: row.id, taxMinor: p.taxMinor, currency: row.currency } });
  await done('processed');
  res.json({ ok: true });
}));

/* Exchange a paid purchase for an access token. The purchase id is a
   random UUID known only to the buyer who started it. */
app.post('/api/research/access', ACCOUNTS.guard, checkoutResearchLimiter, ah(async (req, res) => {
  if (!paywallActive(process.env)) return res.status(503).json({ ok: false, error: 'Payments are not enabled yet.' });
  const { ref, purchaseId } = req.body || {};
  if (!REF_RE.test(String(ref || '')) || !/^[0-9a-f-]{36}$/i.test(String(purchaseId || '')))
    return res.status(400).json({ ok: false, error: 'Invalid request.' });
  const r = await pool.query(`SELECT status, provider, provider_order_id, amount, currency FROM report_purchases WHERE id=$1 AND report_ref=$2`, [purchaseId, ref]);
  if (r.rows.length && r.rows[0].status === 'pending_payment' && r.rows[0].provider === 'mor' && r.rows[0].provider_order_id) {
    try { if (await reconcileMor(purchaseId, ref, r.rows[0])) r.rows[0].status = 'paid'; } catch (e) { console.error('[mor] could not confirm the payment yet:', e && e.message); }
  }
  if (!r.rows.length || r.rows[0].status !== 'paid') return res.status(402).json({ ok: false, error: 'Payment has not been confirmed yet.' });
  if (ACCOUNTS.enabled && !(await ownsPurchase(req, purchaseId))) return res.status(403).json({ ok: false, code: 'not_entitled', error: 'This purchase belongs to another account.' });
  res.json(grantOf(ref));
}));

/* The buyer's own document, checked against the research. Never stored,
   never logged, never cached: it exists only for this request. */
app.post('/api/research/document-check', ACCOUNTS.guard, documentLimiter, express.json({ limit: '12mb' }), ah(async (req, res) => {
  const { query, location, market, file, mediaType } = req.body || {};
  try {
    const brief = await runResearch({ query: stripPII(query), location: stripPII(location), market }, { env: process.env, http: registryHttp });
    const gated = await gateBrief(brief, req);
    if (gated.brief.locked) return res.status(402).json({ ok: false, error: 'Checking your documents is part of the full report.' });
    const fields = await extractFields({ data: file, mediaType }, { env: process.env });
    track('document_check', req, { ref: brief.ref, market });
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, result: crossCheck(fields, brief) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.status ? e.message : 'The document check could not be completed.' });
  }
}));

/* A shared link opens the EXACT report that was shared -- not a fresh
   search that happens to share its name. Same paywall logic as every
   other route: a locked report shared before payment still shows only
   the preview here too, decided server-side, not by what the link
   claims. */
/* Languages a reader can choose, and each market's languages (the first is the one its buyers most often prefer). */
app.get('/api/languages', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ ok: true, languages: languageList(), markets: Object.fromEntries(Object.keys(MARKETS).map(m => [m, languagesForMarket(m)])) });
});

app.get('/api/research/by-ref/:ref', ACCOUNTS.guard, researchLimiter, ah(async (req, res) => {
  const ref = req.params.ref;
  if (!REF_RE.test(String(ref || ''))) return res.status(400).json({ ok: false, error: 'Not a valid report reference.' });
  const brief = await getByRefAsync(ref);   // memory first, then storage
  if (!brief) return res.status(404).json({ ok: false, error: 'This report is no longer available. Search again for the latest information.' });
  ACCOUNTS.touch(req, ref);
  track('report_open', req, { ref, market: brief.market, lang: pickLanguage(req.query && req.query.lang) });
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, ...(await localize(await gateBrief(CREDITS.attach(REVIEW.forBuyer(brief)), req), req)) });
}));

let healthRunning = false;
const runSourceHealth = async () => {
  if (healthRunning) return null;                       // never two runs at once
  healthRunning = true;
  try { return await HEALTH.runHealthChecks({ connectors: CONNECTORS, markets: MARKETS, http: registryHttp, env: process.env, store: pgStore }); }
  finally { healthRunning = false; }
};

/* What the nightly check currently believes about every register. */
app.get('/api/admin/source-health', adminAuth, ah(async (req, res) => {
  res.json({ ok: true, markets: Object.entries(MARKETS).filter(([, m]) => m.registry).map(([code, m]) => {
    const h = HEALTH.getHealth(code);
    return { market: code, label: m.label, state: h ? h.state : 'not_checked', reason: h && h.reason, detail: h && h.detail,
             consecutiveFailures: h ? h.consecutiveFailures : 0, lastOkAt: h && h.lastOkAt, checkedAt: h && h.checkedAt };
  }) });
}));
/* Check now -- after fixing a connector, or when an alert says a register recovered. */
app.post('/api/admin/source-health/run', adminAuth, ah(async (req, res) => {
  const results = await runSourceHealth();
  if (!results) return res.status(409).json({ ok: false, error: 'A health check is already running.' });
  res.json({ ok: true, results });
}));

/* The browser's own events: page views, unlock clicks, PDF saves and
   WhatsApp shares. Only these four names are accepted, and only these
   fields: nothing a script sends here can move searches, purchases or
   revenue, which are recorded by the server itself. */
const trackLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
app.post('/api/track', trackLimiter, (req, res) => {
  const b = req.body || {};
  if (!ANALYTICS.CLIENT_EVENTS.has(b.event)) return res.status(400).json({ ok: false });
  track(b.event, req, { path: b.path, referrer: b.referrer, utm: b.utm, market: b.market, ref: b.ref });
  res.status(204).end();
});

/* A buyer who paid on another device, or whose browser was cleared, gets
   their access back with the payment ID from Razorpay's receipt email.
   Payment IDs are long and random, and this route is rate-limited. */
app.post('/api/research/recover', checkoutResearchLimiter, ah(async (req, res) => {
  if (ACCOUNTS.enabled) return res.status(410).json({ ok: false, code: 'use_account', error: 'Sign in with the e-mail you bought with. Your reports are under My reports.' });
  if (!paywallActive(process.env)) return res.status(503).json({ ok: false, error: 'Payments are not enabled yet.' });
  const paymentId = String((req.body || {}).paymentId || '').trim();
  if (!/^pay_[A-Za-z0-9]{8,30}$/.test(paymentId))
    return res.status(400).json({ ok: false, error: 'Enter the payment ID from your Razorpay receipt. It starts with pay_.' });
  const q = await pool.query(`SELECT report_ref FROM report_purchases WHERE provider_payment_id=$1 AND status='paid'`, [paymentId]);
  if (!q.rows.length) return res.status(404).json({ ok: false, error: 'No paid ShelterKart report matches that payment ID. If you were charged, write to us with your receipt.' });
  const ref = q.rows[0].report_ref;
  track('access_recovered', req, { ref });
  res.json({ ok: true, ref, token: issueToken(ref, process.env.ACCESS_TOKEN_SECRET) });
}));

/* The admin Reports panel: recent reports, and any report in full --
   the owner's view, never the paywalled one. Admin-only, like every
   /api/admin route (rate-limited and behind adminAuth). */
app.get('/api/admin/reports', adminAuth, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, reports: listRecentReports(100) });
}));
app.get('/api/admin/reports/:ref', adminAuth, ah(async (req, res) => {
  const ref = String(req.params.ref || '');
  if (!REF_RE.test(ref)) return res.status(400).json({ ok: false, error: 'Not a valid report reference.' });
  const brief = await getByRefAsync(ref);
  if (!brief) return res.status(404).json({ ok: false, error: 'No such report is held.' });
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, brief });
}));

/* The dashboard's numbers, all computed from raw events in one pure
   function (engine/analytics.js aggregate), so every figure is testable. */
app.get('/api/admin/analytics', adminAuth, ah(async (req, res) => {
  const days = Math.min(400, Math.max(1, parseInt((req.query || {}).days, 10) || 30));
  const now = new Date();
  const since = new Date(now.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10) + 'T00:00:00.000Z';
  const LIMIT = 250000;
  const rows = await ANALYTICS.loadRows(since, LIMIT);
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, ...ANALYTICS.aggregate(rows, { days, now, truncated: rows.length >= LIMIT }), stored: Boolean(pgStore) });
}));

// Does this visitor have to agree before the page keeps the visit's source (the campaign link or website that brought them) in the
// browser? Decided from the visitor's country; varies by visitor, so it is never cached. See SK_SOURCE_CONSENT in .env.example.
app.get('/api/source-consent', (req, res) => {
  res.set('Cache-Control', 'private, no-store'); res.json({ mode: ANALYTICS.sourceConsentMode(req.headers, process.env) });
});
app.get('/api/markets', (req, res) => {
  res.json(Object.entries(MARKETS).map(([code, m]) => {
    const off = Boolean(m.registry) && !HEALTH.isRegistryUsable(code);
    return { code, label: m.label, status: m.status,
      depth: off ? 'Research' : depthOf(code),
      note: off ? 'The official register is temporarily switched off, so briefs here rest on web research only.' : m.note };
  }));
});

/* A proof-of-work challenge for the browser to solve before a NEW research. Light limiter: fetching one never costs a search. */
app.get('/api/research/challenge', trackLimiter, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const cap = capOf(process.env), usage = cap > 0 && researchDaily.day === new Date().toISOString().slice(0, 10) ? researchDaily.count / cap : 0;
  res.json({ ok: true, ...BOT.issue(process.env, { usage }) });
});

app.post('/api/research', ACCOUNTS.guard, researchLimiter, ah(async (req, res) => {
  const { query, location, market } = req.body || {};
  // New research costs money; a report already researched does not. Only the first needs the browser's proof of work.
  if (BOT.enabled(process.env) && !isAnswerable({ query: stripPII(query), location: stripPII(location), market })) {
    const v = BOT.verify(req.body && req.body.pow, process.env);
    if (!v.ok) return res.status(428).json({ ok: false, code: 'challenge', reason: v.reason, error: 'This search needs a short automatic check from your browser. Please try again.' });
  }
  try {
    const brief = await runResearch({ query: stripPII(query), location: stripPII(location), market }, { env: process.env, http: registryHttp });
    try { SEARCH.afterResearch({ query: stripPII(query), location: stripPII(location), market, brief }); } catch {}   // shadow comparison; the project becomes findable
    res.set('X-Robots-Tag', 'noindex, nofollow'); // some sources forbid search-engine indexing of reused data
    res.set('Cache-Control', 'no-store');         // a paid brief must never sit in a shared cache
    ACCOUNTS.touch(req, brief.ref);
    track('search', req, { market, query: stripPII(query), ref: brief.ref, lang: pickLanguage(req.body && req.body.lang), detail: brief.matchedAs ? 'matched' : brief.cached ? 'cached' : 'fresh' });
    res.json({ ok: true, ...(await localize(await gateBrief(CREDITS.attach(REVIEW.forBuyer(brief)), req), req)) });
  } catch (e) {
    track('search', req, { market, query: stripPII(query), detail: e.status === 400 ? 'invalid' : e.status === 503 ? 'unavailable' : 'error' });
    res.status(e.status || 500).json({ ok: false, error: e.status ? e.message : 'Research failed. Please try again.' });
  }
}));


// ============================================================
// ============================================================
// TIER-1 STRUCTURED FETCH (stub) — the one piece that genuinely
// requires real, country-specific source connectors (MahaRERA,
// Dubai Pulse, Companies House, etc. — see Developer Brief §7)
// plus OCR for scanned filings. Kept as a single, clearly marked
// integration point rather than scattered TODOs.
// ============================================================
async function fetchStructuredLegal(country, city, entityId) {
  // TODO: real registry connector per country/tier. Returning null
  // signals "could not verify" — callers must treat that as
  // "assume changed, regenerate" rather than silently trusting stale data.
  return null;
}

// ============================================================
// CACHE-FIRST REPORT RETRIEVAL — with smart change-detection
// ============================================================
// On a cache hit older than RECHECK_DAYS, run ONLY the free Level 0
// structured fetch (no LLM) and compare key fields against the cached
// version. If nothing material changed, just refresh the cache
// timestamp — zero AI cost. Only run the full pipeline (which may
// reach Level 1/2 AI) if something real changed.
const RECHECK_DAYS = 7;

function hasSourceChanged(cachedFacts, freshFacts) {
  if (!cachedFacts || !freshFacts) return true; // can't compare → be safe, regenerate
  return cachedFacts.registrationStatus !== freshFacts.registrationStatus
    || (cachedFacts.litigation?.length || 0) !== (freshFacts.litigation?.length || 0);
}


/* ============================================================
   REPORT ENTITLEMENT — server-side gating

   The demo frontend ships every paid finding in the client bundle and
   decides what to show from a localStorage boolean. Both bypasses are
   two lines in devtools:

     localStorage.setItem('sk_unlocked_reports', ...)   // flip the flag
     console.log(PROJECTS['lodha-park'])                // skip the UI

   No amount of frontend work fixes this. A gate the client evaluates
   is not a gate. The server must be the authority, and paid fields
   must never leave it unless the caller is entitled.

   The revenue loss is the obvious half. The half that matters more:
   the Constitution treats a report as a traceable artifact tied to an
   identified buyer. Anonymous extraction destroys the audit trail —
   there is no record of who holds which version of which finding, so
   a later correction cannot be delivered to the people who relied on
   the superseded one.
   ============================================================ */







// OTP codes are hashed before storage (scrypt + random salt per code,
// Node's built-in crypto — no new dependency). A compromised database
// should never yield directly-usable codes, even briefly within their
// 5-minute validity window.
const crypto = require('crypto');



/* Retired: the old OTP / lead-capture / client-priced checkout system.
   Nothing calls these any more, and they let an anonymous caller create
   pending purchases and buyer_leads rows (with phone_verified hardcoded
   true) and, for /api/checkout, name their own price -- which would also
   have polluted any count of leads or purchases. 410 Gone, not 404, so a
   stale cached copy of the site gets an explicit answer. */
app.all(['/api/resolve', '/api/report/:type/:id', '/api/send-otp', '/api/verify-otp', '/api/checkout', '/api/report-checkout'],
  (req, res) => res.status(410).json({ ok: false, error: 'This endpoint has been retired.' }));

/* ---- Respond or correct. The RIGHT OF REPLY (the developer or anyone named in a report) and the RIGHT OF CORRECTION (anyone).
   Free. No account. The sender confirms by e-mail, a screen checks the message, a clean reply is published beside its finding at once,
   and a correction changes a finding only with evidence, publicly and dated. Nothing here can be bought, and nothing here changes a
   finding by itself. The older /api/dispute and /api/developer-response routes below still work for existing clients. ---- */
const respondLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 8, message: { ok: false, error: 'Too many submissions. Please try again later.' } });
const respondReadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 240, message: { ok: false, error: 'Too many requests. Please try again later.' } });
app.post('/api/responses', respondLimiter, ah(async (req, res) => {
  const b = req.body || {};
  const r = await RESPONSES.submit({ reportRef: b.reportRef, kind: b.kind, role: b.role, findingId: b.findingId, findingText: b.findingText, body: b.body,
    evidenceUrls: b.evidenceUrls, senderName: b.senderName, email: b.email, website: b.website });
  if (r.ok && !r.silent) track('respond_submit', req, { detail: r.kind });
  res.status(r.status).json(r.ok ? { ok: true, publicRef: r.publicRef, statusKey: r.statusKey || null } : { ok: false, error: r.error });
}));
app.post('/api/responses/confirm', respondLimiter, ah(async (req, res) => {
  const r = await RESPONSES.confirm(String((req.body || {}).token || ''));
  res.status(r.status).json(r.ok ? { ok: true, publicRef: r.publicRef, state: r.state } : { ok: false, error: r.error });
}));
app.get('/api/responses/status/:publicRef', respondReadLimiter, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const r = await RESPONSES.statusOf(req.params.publicRef, String(req.query.key || ''));
  res.status(r.status).json(r.ok ? { ok: true, publicRef: r.publicRef, kind: r.kind, state: r.state, createdAt: r.createdAt, resolution: r.resolution } : { ok: false, error: r.error });
}));
// Public: the published replies and the dated corrections of one report. Never an e-mail address.
app.get('/api/responses/:reportRef', respondReadLimiter, ah(async (req, res) => {
  if (!REF_RE.test(String(req.params.reportRef || ''))) return res.status(400).json({ ok: false, error: 'Unknown report reference.' });
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, ...(await RESPONSES.publicFor(req.params.reportRef)) });
}));
app.get('/api/admin/response-queue', adminAuth, ah(async (req, res) => {
  const status = String(req.query.status || 'held');
  if (!['held', 'in_review', 'needs_info'].includes(status)) return res.status(400).json({ ok: false, error: 'status must be held, in_review or needs_info' });
  res.set('Cache-Control', 'no-store'); res.json({ ok: true, status, responses: await RESPONSES.list(status) });
}));
app.post('/api/admin/response-queue/:id/resolve', adminAuth, ah(async (req, res) => {
  const r = await RESPONSES.resolve(req.params.id, req.body || {});
  res.status(r.status).json(r.ok ? { ok: true, publicRef: r.publicRef, outcome: r.outcome, notified: r.notified } : { ok: false, error: r.error });
}));

ACCOUNTS.mount(app);
ACCOUNTS.mountAdmin(app, { adminAuth });
ERRORLOG.mountAdmin(app, { adminAuth, ah, rateLimit });

app.post('/api/dispute', disputeLimiter, ah(async (req, res) => {
  const { contact, note, reportRef } = req.body || {};
  if (!note || typeof note !== 'string') return res.status(400).json({ ok: false, error: 'Please describe what is wrong.' });
  if (note.length > 4000) return res.status(400).json({ ok: false, error: 'Please keep the description under 4,000 characters.' });
  try { await REVIEWS.addDispute({ contact: contact ? String(contact).slice(0, 200) : null, note, reportRef: REF_RE.test(String(reportRef || '')) ? reportRef : null }); res.json({ ok: true }); }
  catch (e) { console.error('[dispute] could not be saved:', e && e.message); res.status(500).json({ ok: false, error: 'Your report of an inaccuracy could not be saved. Please try again, or write to us.' }); }
}));

// ============================================================
// (The older reply route, kept for existing clients. New submissions use /api/responses, above: one panel, e-mail confirmation, screening.)
// DEVELOPER RIGHT OF REPLY — Constitution rule 5. Free, unconditional,
// admin-reviewed before publication (never auto-published — that's
// what keeps this from becoming a channel for pressure or spam),
// and always displayed alongside the original finding, never in
// place of it. A developer cannot use this to alter a finding.
// ============================================================
const replyLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 3, message: { ok:false, error:'Too many submissions. Please try again later.' } });

app.post('/api/developer-response', replyLimiter, ah(async (req, res) => {
  const { reportRef, findingText, responseText, contactEmail } = req.body || {};
  if ([reportRef, findingText, responseText, contactEmail].some(v => typeof v !== 'string') || !reportRef || !findingText || !responseText || !contactEmail) {
    return res.status(400).json({ ok: false, error: 'reportRef, findingText, responseText, and contactEmail are required.' });
  }
  if (String(responseText).length > 2000) return res.status(400).json({ ok: false, error: 'Response cannot exceed 2000 characters.' });
  if (String(findingText).length > 2000) return res.status(400).json({ ok: false, error: 'Please quote only the finding you are replying to.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  if (!REF_RE.test(String(reportRef))) return res.status(400).json({ ok: false, error: 'Please use the report reference shown on the report (it starts with SK-).' });
  // A reply must answer a report that exists. Who sent it, and which finding it answers, are checked for the reviewer below.
  const brief = await getByRefAsync(reportRef).catch(() => null);
  if (!brief) return res.status(404).json({ ok: false, error: 'No report with that reference is available. Please check the reference on the report.' });
  try {
    await REVIEWS.addReply({ reportRef, findingText: String(findingText), responseText: String(responseText), contactEmail: String(contactEmail).toLowerCase() });
    res.json({ ok: true, message: 'Submitted for review. Approved responses are published within 48 hours.' });
  } catch (e) {
    console.error('[developer-response] could not be saved:', e && e.message);
    res.status(500).json({ ok: false, error: 'Your response could not be saved. Please try again in a moment.' });
  }
}));

// Public: only replies a person has approved, never the sender's address. Says whether it came from the developer's own domain.
app.get('/api/developer-response/:reportRef', ah(async (req, res) => {
  const ref = String(req.params.reportRef || '');
  if (!REF_RE.test(ref)) return res.status(400).json({ ok: false, error: 'Unknown report reference.' });
  try {
    const brief = await getByRefAsync(ref).catch(() => null);
    const rows = await REVIEWS.approvedReplies(ref);
    res.json({ responses: rows.map(r => ({ finding_text: r.finding_text, response_text: r.response_text, submitted_at: r.submitted_at, from_developer_domain: senderCheck(r.contact_email, brief) === 'match' })) });
  } catch (e) {
    console.error('[developer-response] could not be read:', e && e.message);
    res.status(500).json({ ok: false, error: 'Replies could not be loaded right now.' });
  }
}));


// ============================================================
// ONE-TIME REPORT UNLOCK — separate from the Watch subscription above.
// Frontend's payAndUnlock() calls this after OTP verification, before
// showing the download/WhatsApp-share screen. Recorded the same
// pending_payment-until-webhook way as checkout, for the same reason.
// ============================================================

/* ============================================================
   PAYMENT INTEGRITY

   Three defects were present in the checkout path:

   1. `amount` was read from req.body. A buyer could POST amount: 1
      for a 5,999 report; validation only checked it was a positive
      number below 1,000,000. Price is now derived server-side from
      the report and the market, and the client-supplied figure is
      ignored entirely rather than validated — a number the client
      controls should never reach a ledger.

   2. Nothing anywhere inserted into `entitlements`, so the gate on
      /api/report could never open. A paying customer would have been
      charged and still shown the locked report.

   3. No webhook handler existed, so there was no path from "payment
      succeeded" to "access granted" at all.

   The webhook below is the only thing permitted to grant access. It
   is never called by our own frontend — a client-initiated grant is
   indistinguishable from a forged one.
   ============================================================ */

class PaymentEventError extends Error {}

/* Prices live in pricing/ only: a versioned price book, a quote per buyer, stored on the purchase at checkout. */

/* Raw body is required for signature verification: any re-serialisation
   changes the bytes and invalidates the HMAC. This must be registered
   BEFORE the global express.json() parser for this path. */
app.post('/api/payments/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  ah(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) return res.status(415).json({ ok: false, error: 'Unsupported content type' });
    const provider = String(req.get('x-sk-provider') || 'unknown');
    const signature = req.get('x-sk-signature') || '';
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;

    if (!secret) {
      console.error('[webhook] PAYMENT_WEBHOOK_SECRET unset — refusing.');
      return res.status(503).json({ ok: false });
    }

    // 1. Verify the signature over the raw bytes, timing-safely.
    const expected = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
    let signatureOk = false;
    try {
      const a = Buffer.from(signature, 'hex');
      const b = Buffer.from(expected, 'hex');
      signatureOk = a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch { signatureOk = false; }

    let event;
    try { event = JSON.parse(req.body.toString('utf8')); }
    catch { return res.status(400).json({ ok: false, error: 'Malformed payload' }); }

    const payloadHash = crypto.createHash('sha256').update(req.body).digest('hex');
    const eventId = String(event?.id || '');
    if (!eventId) return res.status(400).json({ ok: false, error: 'Missing event id' });

    // 2. Record the event before acting on it. The UNIQUE constraint on
    //    (provider, event_id) is what makes replay impossible: a
    //    duplicate delivery collides here and is acknowledged without
    //    granting anything a second time. Recording rejected signatures
    //    too gives an audit trail of forgery attempts.
    let inserted;
    try {
      inserted = await pool.query(
        `INSERT INTO payment_events (provider, event_id, payload_hash, signature_ok, process_status)
         VALUES ($1,$2,$3,$4,'received')
         ON CONFLICT (provider, event_id) DO NOTHING
         RETURNING id`,
        [provider, eventId, payloadHash, signatureOk]
      );
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'Event log failed' });
    }

    if (inserted.rows.length === 0) {
      // Already seen. Acknowledge so the provider stops retrying.
      return res.json({ ok: true, duplicate: true });
    }
    const eventRowId = inserted.rows[0].id;

    // 3. Only now reject bad signatures — after logging the attempt.
    if (!signatureOk) {
      await pool.query(`UPDATE payment_events SET process_status='ignored', processed_at=NOW() WHERE id=$1`, [eventRowId]);
      return res.status(401).json({ ok: false, error: 'Invalid signature' });
    }

    if (event.type !== 'payment.succeeded') {
      await pool.query(`UPDATE payment_events SET process_status='ignored', processed_at=NOW() WHERE id=$1`, [eventRowId]);
      return res.json({ ok: true, ignored: event.type });
    }

    // 4. Grant, inside a transaction, re-deriving price server-side and
    //    confirming the amount actually captured matches it.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const purchaseRef = event?.data?.reportRef;
      const paid        = Number(event?.data?.amount);

      // Live research purchases. Many buyers share one ref (one per
      // project), so the purchase is marked paid by its OWN id. The
      // generic "WHERE report_ref = $1" below would have marked every
      // pending purchase of that project paid on one buyer's payment.
      if (REF_RE.test(String(purchaseRef || ''))) {
        const purchaseId = String(event?.data?.purchaseId || '');
        if (!/^[0-9a-f-]{36}$/i.test(purchaseId)) throw new PaymentEventError('Missing purchase id');
        // Compare with the price THIS purchase was sold at (stored at
        // checkout), not today's price list.
        const row = await client.query(`SELECT amount FROM report_purchases WHERE id=$1 AND report_ref=$2`, [purchaseId, purchaseRef]);
        const expected = row.rows.length ? Number(row.rows[0].amount) : NaN;
        if (!Number.isFinite(paid) || !Number.isFinite(expected) || paid < expected) {
          await client.query(`UPDATE payment_events SET process_status='failed', processed_at=NOW() WHERE id=$1`, [eventRowId]);
          await client.query('COMMIT');
          return res.status(400).json({ ok: false, error: 'Amount does not match report price' });
        }
        // Same single path as Razorpay's handler and webhook, so the rules
        // for becoming "paid" can never drift apart between providers.
        const settled = await markPurchasePaid(client, { purchaseId, ref: purchaseRef, provider, paymentId: eventId });
        if (!settled) throw new PaymentEventError('No matching pending purchase');
        await client.query(`UPDATE payment_events SET process_status='processed', processed_at=NOW() WHERE id=$1`, [eventRowId]);
        await client.query('COMMIT');
        return res.json({ ok: true });
      }

      // Only ShelterKart research reports are sold. The older purchase type that
      // used a tiered price table can no longer be created (its routes return 410).
      throw new PaymentEventError('Unknown purchase type');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      await pool.query(`UPDATE payment_events SET process_status='failed', processed_at=NOW() WHERE id=$1`, [eventRowId]).catch(() => {});
      return res.status(400).json({ ok: false, error: 'Could not process payment event' });
    } finally {
      client.release();
    }
  })
);



// ============================================================
// ADMIN — the founder's one place to manage the company, per
// HANDOFF.md's "one-person company" plan. Protected by HTTP Basic
// Auth against ADMIN_USERNAME/ADMIN_PASSWORD env vars — simple on
// purpose; a single-operator dashboard doesn't need a full auth
// system, it needs to not be publicly reachable. Never put anything
// here that can edit a finding directly — see CONSTITUTION.md rule 1.
// ============================================================
/* Admin credential comparison, hardened.

   Three defects were present here:

   1. `user !== ENV_USER || pass !== ENV_PASS` short-circuits and
      compares byte-by-byte, so response time leaks how much of the
      credential was correct. Over enough requests that is enough to
      recover a password one character at a time. Now hashed to a fixed
      length and compared with timingSafeEqual, which takes constant
      time regardless of where the first difference falls.

   2. No rate limit on the admin surface at all — unlimited guesses
      against a single password. Now limited per IP, and the limiter is
      applied to the router rather than to each route, so a new admin
      route cannot accidentally ship unprotected.

   3. If ADMIN_PASSWORD were unset, `undefined !== undefined` is false
      and every request would authenticate. Startup now refuses to boot
      in production without both variables set, and the middleware fails
      closed if they are missing at request time.
*/
function safeEqual(a, b) {
  // Hash first: timingSafeEqual throws when lengths differ, and the
  // length difference is itself a leak. SHA-256 makes both sides 32
  // bytes regardless of input.
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function adminAuth(req, res, next) {
  const envUser = process.env.ADMIN_USERNAME;
  const envPass = process.env.ADMIN_PASSWORD;

  // Fail closed. Without this, unset credentials would make every
  // comparison below trivially true.
  if (!envUser || !envPass) {
    console.error('[admin] ADMIN_USERNAME/ADMIN_PASSWORD not configured — refusing all admin access.');
    return res.status(503).json({ ok: false, error: 'Admin access is not configured.' });
  }

  const hdr = req.headers.authorization || '';
  const [scheme, encoded] = hdr.split(' ');
  if (scheme !== 'Basic' || !encoded) {
    res.set('WWW-Authenticate', 'Basic realm="ShelterKart Admin"');
    return res.status(401).json({ ok: false, error: 'Authentication required' });
  }

  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }
  // Split on the FIRST colon only: passwords may legitimately contain one.
  const sep = decoded.indexOf(':');
  const user = sep === -1 ? decoded : decoded.slice(0, sep);
  const pass = sep === -1 ? '' : decoded.slice(sep + 1);

  // Evaluate both comparisons before branching, so the boolean operator
  // itself cannot short-circuit and reintroduce a timing signal.
  const userOk = safeEqual(user, envUser);
  const passOk = safeEqual(pass, envPass);
  if (!(userOk && passOk)) {
    res.set('WWW-Authenticate', 'Basic realm="ShelterKart Admin"');
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }
  next();
}

/* Route params reach SQL as bound parameters, so injection is not the
   risk — but an unparseable id causes Postgres to raise a type error
   that surfaces as a 500 and lands in logs as noise. Reject early with
   a 400 instead. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requireUuid(req, res, next) {
  if (!UUID_RE.test(req.params.id || '')) {
    return res.status(400).json({ ok: false, error: 'Invalid identifier.' });
  }
  next();
}

app.get('/api/admin/stats', adminAuth, ah(async (req, res) => {
  try {
    // "Purchases" means PAID: a pending checkout is not a sale. Leads were
    // only ever created by the retired OTP routes, so they are no longer shown.
    const [paid, pending, openDisputes, pendingResponses] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM report_purchases WHERE status = 'paid'`),
      pool.query(`SELECT COUNT(*) FROM report_purchases WHERE status = 'pending_payment'`),
      pool.query(`SELECT COUNT(*) FROM disputes WHERE status = 'open'`),
      pool.query(`SELECT COUNT(*) FROM developer_responses WHERE status = 'pending'`),
    ]);
    res.json({
      paidPurchases: Number(paid.rows[0].count),
      pendingCheckouts: Number(pending.rows[0].count),
      openDisputes: Number(openDisputes.rows[0].count),
      pendingResponses: Number(pendingResponses.rows[0].count),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'Could not load stats.' });
  }
}));

app.get('/api/admin/disputes', adminAuth, ah(async (req, res) => { res.json(await REVIEWS.openDisputes()); }));

app.post('/api/admin/disputes/:id/resolve', adminAuth, requireUuid, ah(async (req, res) => { await REVIEWS.resolveDispute(req.params.id); res.json({ ok: true }); }));

/* Pending developer replies, each with what the reviewer needs to judge it: whether the sender's email domain matches
   the developer's own website, and which finding the reply quotes (or that it quotes none of them). */
app.get('/api/admin/responses', adminAuth, ah(async (req, res) => {
  const rows = await REVIEWS.pendingReplies(), briefs = new Map();
  for (const r of rows) if (!briefs.has(r.report_ref)) briefs.set(r.report_ref, await getByRefAsync(r.report_ref).catch(() => null));
  res.json(rows.map(r => { const b = briefs.get(r.report_ref), i = findingMatch(r.finding_text, b);
    return { ...r, sender_check: senderCheck(r.contact_email, b), developer_site: (b && b.project && b.project.developer_site) || null, finding_match: i, report_available: Boolean(b) }; }));
}));

app.post('/api/admin/responses/:id/approve', adminAuth, requireUuid, ah(async (req, res) => { await REVIEWS.setReply(req.params.id, 'approved'); res.json({ ok: true }); }));

app.post('/api/admin/responses/:id/reject', adminAuth, requireUuid, ah(async (req, res) => { await REVIEWS.setReply(req.params.id, 'rejected'); res.json({ ok: true }); }));

/* Reports held for a person (ADVERSE_HOLD_MARKETS): the negative findings to check, with their sources. */
app.get('/api/admin/held', adminAuth, ah(async (req, res) => {
  const out = [];
  for (const r of listRecentReports(300)) {
    const b = await getByRefAsync(r.ref).catch(() => null);
    if (!b || !REVIEW.isHeld(b)) continue;
    out.push({ ref: b.ref, project: b.project && b.project.name, developer: b.project && b.project.developer, market: b.market,
      adverse: REVIEW.adverseIndexes(b).map(i => ({ index: i, claim: b.findings[i].claim, topic: b.findings[i].topic, sources: (b.findings[i].sources || []).slice(0, 5) })) });
  }
  res.json({ ok: true, markets: REVIEW.holdMarkets(), held: out });
}));
app.post('/api/admin/held/:ref/approve', adminAuth, ah(async (req, res) => {
  const ref = String(req.params.ref || '');
  if (!REF_RE.test(ref)) return res.status(400).json({ ok: false, error: 'Unknown report reference.' });
  const b = await setReview(ref, { status: 'approved', adverse: REVIEW.adverseIndexes(await getByRefAsync(ref) || {}).length });
  if (!b) return res.status(404).json({ ok: false, error: 'No such report.' });
  res.json({ ok: true, ref, review: b.review });
}));

// Generic error handler. It used to sit mid-file, before the admin
// routes, so their errors never reached it. Registered last, it covers
// every route, and never leaks a stack trace or database text.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ ok: false, error: 'Malformed JSON' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ ok: false, error: 'Request body too large' });
  console.error('[http] ' + req.method + ' ' + ((req.route && req.route.path) || 'unmatched route') + ' failed: ' + (err && err.message), err);
  if (err && err.message === 'Origin not allowed') return res.status(403).json({ ok: false, error: 'Origin not allowed' });
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
if (require.main === module) {
  // Reload recent reports before accepting traffic. A storage failure is
  // logged and the server still starts: report links fall back to reading
  // storage on demand, so buyers are not locked out while it recovers.
  (async () => {
    try {
      const h = await hydrate();
      if (pgStore) {
        const day = ANALYTICS.today();
        const salt = await pgStore.loadSalt(day);
        if (salt) ANALYTICS.loadSalt(day, salt);                         // a mid-day restart must not double-count visitors
        await pgStore.pruneEventsOlderThan(new Date(Date.now() - 400 * 86400000).toISOString());
        await pgStore.pruneTranslationsOlderThan(new Date(Date.now() - 90 * 86400000).toISOString());
      }
      if (process.env.DATABASE_URL) console.log(`[persistence] restored ${h.reports} report(s), ${h.aliases} alias(es); ${h.dailyCount || 0} new research run(s) today`);
      else console.warn('[persistence] DATABASE_URL not set: reports live in memory only and are lost on restart.');
    } catch (e) {
      console.error('[persistence] startup reload failed, starting with empty memory:', e && e.message);
    }
    // The marketing desk (backend/social): plans, checks, packs and publishes the daily posts for all 36 markets. It is OFF unless
    // SOCIAL_ENGINE=on, posts nothing real unless SOCIAL_PUBLISH=live, and refuses to run without durable storage. Its routes answer 503 while off.
    let social = null;
    try {
      social = await require('./social').createSocial({ env: process.env, pool: process.env.DATABASE_URL ? pool : null });
      social.mount(app, { adminAuth, ah, jsonParser: express.json({ limit: '20kb' }) });
      if (social.start()) console.log('[social] the marketing desk is running');
    } catch (e) { console.error('[social] the marketing desk did not start: ' + (e && e.message)); }
    // The marketing dashboard (backend/marketing): the weekly numbers per market, early warnings and decision triggers from the
    // launch strategy, read from analytics, refunds, replies and the desk. Read-only except for the founder's own inputs.
    try {
      require('./marketing').mount(app, { adminAuth, ah, jsonParser: express.json({ limit: '20kb' }), loadRows: since => ANALYTICS.loadRows(since, 250000), pool: process.env.DATABASE_URL ? pool : null, social });
    } catch (e) { console.error('[marketing] the dashboard did not start: ' + (e && e.message)); }
    // Run the nightly source-health check on ONE instance only
    // (SOURCE_HEALTH_SCHEDULE=true); run several and each would alert.
    if (process.env.SOURCE_HEALTH_SCHEDULE === 'true') {
      HEALTH.startSchedule(runSourceHealth, { hours: Number(process.env.SOURCE_HEALTH_HOURS) || 24 });
      console.log('[source-health] scheduled: first run in a minute, then every ' + (Number(process.env.SOURCE_HEALTH_HOURS) || 24) + 'h');
    }
    if (ACCOUNTS.problems.length) {
      console.error('[accounts] configuration problems:\n - ' + ACCOUNTS.problems.join('\n - '));
      if (process.env.NODE_ENV === 'production') process.exit(1);
    }
    setInterval(() => ERRORLOG.purge().catch(e => console.error('[errorlog] clean-up failed:', e && e.message)), 24 * 3600 * 1000).unref();
    if (ACCOUNTS.enabled) setInterval(() => ACCOUNTS.cleanup().catch(e => console.error('[accounts] clean-up failed:', e && e.message)), 6 * 3600 * 1000).unref();
    app.listen(PORT, () => console.log(`ShelterKart API listening on port ${PORT}`));
  })();
}
module.exports = app;
