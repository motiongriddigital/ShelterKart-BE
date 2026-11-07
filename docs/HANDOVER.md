# ShelterKart: handover to the development team

State on 24 October 2026. **859 automated checks in 37 suites pass.** The site, the reports, the guide, nine languages, 36 markets, the pricing, the tax rules and both payment routes are built and tested. What stands between this and live sales is a short list of things that need an account, a credential or a person's decision. They are in section 3, in order.

`ShelterKart-Frontend-V1.html` is frozen: do not edit it. `ShelterKart-Frontend-V2.html` is the current site.

## 1. How a sale works

1. The buyer searches and sees a free preview.
2. **Quote.** `POST /api/research/quote` returns a signed price for that report and that buyer's country, locked for 30 minutes. The price comes from the price book (`backend/data/price-book.json`), never from the browser.
3. **Checkout.** `POST /api/research/checkout` takes the quote id, checks its signature and the billing country, stores a pending purchase, and opens a payment with a provider for exactly the quote's total.
4. **Two providers**, chosen by data (`backend/data/payment-routes.json`) and by configuration:
   - **India: Razorpay.** ShelterKart is the seller, charges GST (18%, tax-inclusive), and needs its GSTIN.
   - **Everywhere else: a Merchant of Record (Dodo Payments).** The merchant is the legal seller. It collects and remits the buyer's tax. ShelterKart holds no tax registration in those countries.
5. **Confirmation.** The provider's signed webhook, or (for the merchant) the server's own check of the merchant's records when the buyer returns. Either way the amount and currency must equal the quote to the smallest unit, or nothing unlocks.
6. The buyer receives a signed access token and the full report opens.

The merchant route opens a country only when **all three** hold: `DODO_API_KEY` and `DODO_WEBHOOK_KEY` are set, the currency has a product in `backend/data/mor-products.json`, and the country is not India. A missing piece closes the market; it never opens it half-way. Currencies with no product are quoted in US dollars, so a **USD product is mandatory**.

Tax rule: where the merchant sells, ShelterKart adds no tax of its own, even if the company later registers there. Its own invoice, sales ledger entry and registration-threshold count are skipped for those sales (the merchant issues the buyer's invoice).

## 2. Where things are

| What | Where |
|---|---|
| Site (one file) | `shelterkart-frontend.html`, built by `tools/` and `brand/` scripts |
| Server | `backend/server.js` |
| Pricing, taxes, sale status | `backend/pricing/` (`data.js`, `quote.js`, `release.js`) |
| Data: prices, countries, tax profiles, routes, products, rates | `backend/data/*.json` |
| Provider-neutral payment layer | `backend/payments/index.js`, `refunds.js` |
| Razorpay adapter | `backend/engine/razorpay.js` |
| Merchant adapter | `backend/engine/mor.js` |
| Research engine | `backend/engine/research.js`, `grounding.js`, `investigator.js` |
| Source tiers (official / social) | `backend/data/source-tiers.json` |
| Legal drafts for counsel | `legal/ShelterKart-Legal-Set-v2.md` (current); `legal/ShelterKart-Final-Legal-Pack.md` is the earlier version |
| Rules the product must follow | `CONSTITUTION.md` |

## 3. Going live: the checklist, in order

### A. Business (the owner; cannot be done in code)

1. **Form the company.** Legal name, registered address, **Grievance Officer** name, e-mail and postal address. Indian rules require these to be published; the policy pages show "NOT READY TO PUBLISH" until `tools/business.json` is filled in.
2. **GSTIN** (India). Without it India stays closed (`registration_missing`). Set `GSTIN` in the environment.
3. **Merchant account approved in writing** (Dodo Payments), including: (a) it will sell *property research reports*, which its acceptable-use terms must allow; (b) it serves **every market we list**, especially the Gulf, Brazil, Mexico, Malaysia, Thailand and the Philippines; (c) payout to the company's bank.
4. **Counsel signs the legal pack** and updates the privacy and terms text. The site currently names Razorpay as the payment processor; for sales outside India the merchant is the seller.
5. **Accountant**: how the company treats the merchant's payouts (export of services, LUT), and that merchant-served sales are *not* ShelterKart's consumer sales. Net revenue and fees are **not** recorded for merchant sales (`provider_fee` is empty): reconcile from the merchant's payout reports.

### B. Merchant setup (developer)

1. In the merchant's dashboard create **one product per charge currency**: one-time, **pay-what-you-want** (the per-report amount is passed in the request), a small minimum, and **tax-inclusive** prices. At minimum USD. Add GBP, EUR, AED, etc. when you want buyers to pay in local currency.
2. Put each product id in `backend/data/mor-products.json` under `"products"`, or set `MOR_PRODUCTS` (JSON). A currency is only offered if its price-book ladder exists (the startup validator checks this).
3. Set `DODO_API_KEY`, `DODO_WEBHOOK_KEY`, `DODO_MODE=test`, and `PUBLIC_BASE_URL` (the buyer returns to it).
4. Register the webhook in the dashboard: `https://YOUR-DOMAIN/api/payments/mor/webhook`, events `payment.succeeded`, `payment.failed`, `refund.*`. Do **not** put a JSON body parser in front of it: the signature is checked over the raw bytes.
5. **Run the sandbox checks** (section 4). Fix what they report.
6. Switch to live: `DODO_MODE=live`, live key, live webhook secret, live products. Run the readiness table again.

### C. India (Razorpay)
Keys and webhook secret in the environment, `GSTIN` set, `RAZORPAY_INTERNATIONAL` left `false` (foreign buyers go through the merchant). Razorpay settings are in `backend/.env.example`.

#### Razorpay international (optional, off by default)

Foreign buyers normally pay through the merchant (section B). To let Razorpay take foreign cards too:

1. In Razorpay's dashboard, ask for **International Payments** to be activated and get the list of currencies it confirms in writing.
2. Set `RAZORPAY_INTERNATIONAL=true` and `RAZORPAY_CURRENCIES=USD,AED,...` (only the confirmed ones). A tax profile must also be complete for each country (`backend/data/tax-profiles.json`), because Razorpay is not the seller.
3. Subscribe the webhook `https://HOST/api/payments/razorpay/webhook` to `payment.authorized`, `payment.captured`, `order.paid`, `payment.failed` and `refund.created`, `refund.processed`, `refund.failed`.
4. Run `node tools/razorpay_sandbox_check.js` with TEST keys: it opens one order per currency. Pay each, then `node tools/razorpay_sandbox_check.js --check-order <order id> --expect-sub <amount> --currency <code>`.
5. International payments are often only **authorized**. The server captures them (for exactly the quote's total, in its currency) on `payment.authorized`, or when the buyer returns and the order is checked, and settles the purchase on the capture.
6. Foreign-currency fees settle in rupees at Razorpay's rate: reconcile them from the settlement report. They are not written to `provider_fee`.

#### If a webhook fails halfway

A webhook is claimed before it is processed and marked finished afterwards. A failure answers 500, so the provider sends it again, and the retry is processed (it used to be swallowed as a duplicate, which could leave a paid purchase locked). A buyer who returns before the webhook settles is checked against the provider's own record of the order (Razorpay and the merchant alike): only the exact amount in the exact currency unlocks.

### D. Infrastructure
`LAUNCH.md` covers the server, the database migrations and the backups. Two items are still open: the **restore drill has never been run** (`ops/restore_drill.sh`; needs `pg_dump`), and the saved-job store is file-based, so more than one server needs a database. Set `OPS_ALERT_EMAIL` so a failed paid report reaches a person.

### E. Data
- **Exchange rates** are dated 26 June 2026. Run `node tools/fetch_fx.js` (needs network) to write a candidate from the official ECB file, review it, then release a new book with `node tools/build_price_book.js --version <next> --fx fx-snapshot.json`. The release guardrails apply, including the 15% step limit.
- **Local ladders for the seven markets** quoted in US dollars (Malaysia, South Africa, Brazil, Mexico, Japan, Thailand, Philippines): the steps are in the header of `tools/fetch_fx.js`.
- **Tax profiles**: 28 are marked unverified. They do not block merchant-served markets (the merchant is the seller) but would block a market if its merchant route were turned off.

## 4. What could not be verified here, and how to verify it

I read the merchant's documentation but had no credentials. These five facts decide whether a live payment works. Each is checked by a command, not by trust.

| Fact | Why it matters | How to check |
|---|---|---|
| The product is tax-**inclusive**, so the total charged equals the quote | If tax is added on top, the buyer is charged but **not unlocked**; the webhook refuses the mismatch and logs `webhook_amount_mismatch` | `node tools/mor_sandbox_check.js --check-payment pay_X --expect-minor N --currency USD` after a test payment |
| Session metadata (`purchase_id`) returns on the payment | Primary way a webhook finds its purchase. If absent, the buyer's return still settles it (the server checks the payment itself), so no payment is lost | same command |
| The live base URL (default `https://live.dodopayments.com`) | The test address is confirmed; the live one is the provider's standard | set `DODO_BASE_URL` if different |
| The partial-refund request shape (`items[{item_id, amount, tax_inclusive}]`) | Full refunds name only the payment; partial refunds follow a third-party client's description | refund one test payment partly |
| The refund webhook event name | Any `refund.*` event is recorded, not acted on | send a test refund and read `payment_events` |

Also run one test payment per mapped currency, one declined card, one 3-D Secure card, and one return before the webhook arrives. Support playbook: a `webhook_amount_mismatch` event means a buyer paid and was not unlocked; refund them and fix the product.

## 5. Known limits and open decisions

- **Depth pricing.** A report's price tier comes from its findings (Gold: 3+ confirmed at an official source; Heavy: 5+ confirmed or reported; else Thin). A report that drops a tier can rise by less than 40%: two sample reports do. The owner decides whether to keep depth pricing.
- **Search** in the live product still lacks the candidate list, typo suggestions and location ranking that the demo shows. Design is in the project notes; no register data is connected for any market yet.
- **Not built:** Google reviews, maps, social-platform and satellite connectors (each needs a paid API or a terms review and adds AI cost).
- **Two source-classification gaps, recorded as known-gap tests in `backend/test/tiers.test.js`:** bare government roots such as `gov.uk` and `gob.es` are not treated as official, and two social posts count as two sites. Fixing either changes existing marks and so prices; it is a method change to approve first.
- **Not yet on the brand system:** report PDFs, the static policy pages, the investor deck.
- **Tagline translations** need a native-speaker check before publishing.
- **Independence wording** on the site must match the legal pack before launch; the sample reports are labelled as hand-prepared.

## 6. Commands

```
cd backend && npm test                      # every suite (859 checks)
python3 tools/count_checks.py               # the same, with a summary line
node tools/market_readiness.js out.md       # which markets can sell today, and once the merchant is live
node tools/mor_sandbox_check.js             # opens one test checkout per currency
node tools/fetch_fx.js                      # official exchange rates -> a candidate file
node tools/build_price_book.js --dry-run    # price-book guardrails without writing
python3 brand/apply_frontend.py             # reapply the brand system to the site (repeatable)
python3 tools/ui_smoke.py                   # browser test of every window and a full purchase
```

## 7. Rules that must not be broken

`CONSTITUTION.md` governs the product. In short: no developer can pay to change a finding; every statement is a fact, an inference, an opinion or a prediction, and the reader knows which; if the evidence is not there the answer is "insufficient public data", never a guess; corrections are never silent. Nothing in a payment, a refund or a complaint may change a finding.

## 8. Investor materials

The investor deck (`deck/ShelterKart-Investor-Deck-v3.pdf`) and its model read every quoted price from the active price book through `deck/model/prices.json`. After any price-book release, run `node deck/model/prices_from_book.js`, then the rebuild in `deck/INVESTOR_V2_NOTES.md`; a test fails until you do. The deck also records the real test count from `tools/count_checks.py`, so rebuild it after the suite changes.

## 9. Respond or correct (the right of reply and the right of correction)

**What a visitor sees.** One panel, "Respond or correct", with no account: who are you (the developer, a reader or buyer, or someone named), what do you want to do, then a short form. It opens from a strip under every report preview (with live counts of replies and corrections), a line in the checkout, a link under every finding of the paid report, and the report footer. The demo shows it on a clearly fictional "Example Developers" record. The right of reply (developer or anyone named) and the right of correction (anyone) are separate in the panel and in the rules.

**The rules (do not weaken them).** A reply is free, unconditional, published beside its finding, labelled, and never changes the finding. A correction changes a finding only with evidence, after the sources are checked; every correction is dated and public, the original wording stays visible, and buyers of the report are told by e-mail. There is no payment path. Engagement never counts.

**How it works.** `POST /api/responses` stores the submission and e-mails a confirmation link (the sender confirms with `POST /api/responses/confirm`). A rule-based screen (`backend/engine/responses.js`, `screen()`) then decides: a clean reply is published at once; a flagged reply, every legal or privacy notice, and any reply that matches no finding are held for a person (`OPS_ALERT_EMAIL` is alerted); a correction waits for the research check. The public data is `GET /api/responses/:reportRef` (never an e-mail address). The sender reads status at `GET /api/responses/status/:ref?key=`. A person works the queue through `GET /api/admin/response-queue?status=held|in_review` and `POST /api/admin/response-queue/:id/resolve` (`outcome`: published, declined, corrected, not_changed, needs_info, with a plain-language `note`; a correction notifies every buyer who asked for e-mail delivery). Storage: Postgres (`backend/responses.sql`, added to the migration list) or memory when no database is set. An e-mail provider (Resend or Postmark) is REQUIRED: without one a response cannot be confirmed and is refused.

**Not built yet.**
- The AI classifier: `makeResponses({ classify })` is the one place to add it (it can only add reasons to hold a message; when it fails, the message is held).
- The research agent's re-check of a correction: today a person resolves it through the admin route.
- Admin screens for the queue: only the API exists.
- Replies beside findings in the live (non-dossier) report view: they show in the reference and paid dossier reports; the live brief shows counts and the corrections list.
- Developer verification beyond the domain label (for example, the registered contact in a RERA record).
- The older `/api/dispute` and `/api/developer-response` routes and their tables still work for existing clients. Remove them when no client uses them.

**Before launch.** The SQL has been run only against the test stub, not a real Postgres: run the migration and one submission on a scratch database. Counsel must approve the screening promise ("screened automatically; flagged items get a human look"), now in the policy pages, the privacy text and the legal drafts. The privacy notice covers storing responders' and delivery e-mails; keep it in step with the code.


## The marketing desk (added 26 Oct 2026)

Read `SOCIAL_ENGINE.md`. In short: off by default (`SOCIAL_ENGINE=on`), dry run by default (`SOCIAL_PUBLISH=live` to post), refuses to run without durable storage, empty knowledge base. Unverified: every live platform call, Postgres, a real judgement model, `sharp` rendering. Not built: video, the knowledge keeper, model polish, analytics loop. The first real task is filling the knowledge base (432 items for the first 12 weeks) and setting up a `verify`-role model.
