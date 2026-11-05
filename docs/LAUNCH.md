# ShelterKart — Launch Guide

## What runs

A buyer types any property, anywhere. Within about a minute they get a research brief:

- **Every claim marked** — confirmed at source, reported by several sites, single source, developer's own claim, or disputed.
- **Every claim linked** to the page it came from; claims citing pages that never came back from the search are removed.
- **Where sources disagree**, shown side by side — never smoothed over.
- **Reading between the lines** — patterns, each tied to the findings behind it.
- **What couldn't be found**, stated plainly.
- **What to ask, and who** — ordered by when the buyer needs it, with a good answer and a red flag for each.

Two lanes feed it:

| Lane | Coverage | How |
|---|---|---|
| Search | Every country | A search provider, the same way Gemini and ChatGPT reach the web — never crawling a site that disallows it |
| Registry | UK, France, Norway, Singapore, Finland, Czech Republic, Australia, Ireland, Taiwan, India (insolvency) | Official APIs and official registers; the developer is checked at source |

No score is produced. A score needs primary evidence across its components, and scoring from search results would break the rule that only confirmed facts move a number.

## Run it — four steps

```bash
cd backend
npm install
cp .env.example .env        # then fill it in: ANTHROPIC_API_KEY, COMPANIES_HOUSE_API_KEY, ALLOWED_ORIGINS
npm test                    # 120 checks: 87 engine + 33 payment, no network or database needed
npm start
```

Then in `shelterkart-frontend.html`, set the backend address:

```js
const API_BASE = "https://api.your-domain.com";   // was "" (demo mode)
```

With `API_BASE` empty the site stays in demo mode; with it set, every search is real research.

## Keys

| Key | Needed for | Cost |
|---|---|---|
| `ANTHROPIC_API_KEY` | Search lane and adviser — required | Per-use |
| `COMPANIES_HOUSE_API_KEY` | UK registry checks | Free |
| `ABR_GUID` | Australia registry checks | Free, emailed after sign-up |
| France, Norway, Singapore, Finland, Czech Republic, Ireland, India | Registry checks | Free, no key |
| `GCIS_NOTIFIED=true` | Taiwan registry checks | Free; file the ministry's usage notification first |

## Verified vs not verified

**Verified by tests in this build (87 engine checks, all passing):**

- A claim citing a page the search never returned is removed.
- "Confirmed at source" is set only by an official domain; look-alike domains are rejected.
- Websites named after the project are treated as agents' sites, not the developer's.
- The registry refuses name-alike companies — "Berkeley Solaris Consulting" never matches "Berkeley Group".
- A lookup that returns nothing is retried with simpler wording before being reported as not found.
- A reply that tries to add fields such as a score is rejected whole.
- If search fails but the registry works, a brief is still delivered — with a note saying so.
- If both fail, the buyer gets an honest error, never an empty report.
- Repeat searches come from cache; a legally withdrawn record purges every cached brief that cited it.
- The seller, possession-date and escrow questions are always asked.
- Every registry connector returns no findings, never wrong ones, when a response has an unexpected shape.
- Finland reports current bankruptcy, liquidation or restructuring, and ignores situations that have ended.
- Australia takes status from the detail record, never from the name search's numeric code.
- The Czech connector looks up an exact company number directly whenever the search found one.
- The registry lane is never queried using the project's name as a stand-in for the developer's -- an unidentified developer skips the check rather than risking a wrong match.
- A page whose text matches a known injection pattern is downgraded, and can never be marked confirmed on the strength of that page alone.
- Two identical searches arriving at once share one pipeline, not two.
- A legal takedown can purge every cached brief tied to a source, by host, through an authenticated admin route.
- A phone number or email typed into the search box never reaches the search provider, the model, or the cache.

**Verified by loading the real `server.js`:** the `/api/research` and `/api/markets` routes, input validation, the no-indexing header, and the error handler's position.

**Not yet verified — first thing to check after `npm install`:**

- A live run against the real Anthropic API, Companies House, France's company API and Norway's register. The connectors were built from the real response shapes seen during research, but this sandbox had no network access.
- The server running on a real host with the real npm packages.

## Fixed in this build

- The error handler sat before the admin routes, so errors there never reached it. It is now registered last.
- Five admin routes had no error handling; a database error would hang the request. All are now wrapped.
- CORS allowed every origin when `ALLOWED_ORIGINS` was empty. It now refuses in production.
- An admin route returned raw database error text; it now returns a generic message.
- The SSRF guard could not send an API key; it now can, and drops the key if a request is redirected to another host.

## Markets

22 markets are listed, and the website, the flags and the engine are checked to hold exactly the same list. The header count is generated from that list, so it cannot go stale.

**Registry checks (10):** UK, France, Norway, Singapore, Finland, Czech Republic, Australia, Ireland and Taiwan confirm the developer company at source. India checks the developer against IBBI's insolvency claims register whenever its CIN is known, and is labelled "Insolvency checked at source", because that's all it establishes.

**Research briefs (12):** Estonia, Latvia, Lithuania, Poland, Spain, Denmark, Switzerland, Belgium, Sweden, Dubai, Hong Kong, New Zealand.

**Not built, deliberately:** Poland, Latvia and New Zealand connectors. Poland's API structure couldn't be confirmed. Latvia's register exists only as downloadable files, not in a searchable datastore. New Zealand's raw API fields aren't publicly documented; its register needs an approved key anyway. A parser guessed from a plausible shape is the one thing this system is built never to ship. Estonia, Lithuania and the Nordics publish bulk files, which need an import job rather than a connector.

## Selling reports

**Off by default.** With `PAYMENTS_ENABLED` unset, every brief is free and complete. The paywall switches on only when a purchase can actually finish: payments enabled, an access-token secret set, and a price set. Locking content nobody can buy would be a dead end.

**With payments on**, an unpaid buyer gets a preview: identity, the evidence bar, three findings, the topics of any disagreements, the gaps, and two questions. Everything else — the remaining findings and their sources, what each disagreement actually says, the reading between the lines, the rest of the questions, the pages checked, and the document check — is withheld on the server and never sent to the browser. Every spelling of the same project shares one report reference, so a buyer pays once.

**Payments run on Razorpay**, built from Razorpay's own documentation:

1. The buyer taps *Unlock*. The server records a pending purchase and creates a Razorpay order for it. The amount is set on the server from `RESEARCH_PRICE`, converted to paise (₹499 → 49900), and the order ID is stored against that purchase.
2. Razorpay's checkout opens. On success, the site sends the payment ID and signature to `/api/research/razorpay/verify`. The server checks the signature against the order ID **it stored**, never one the browser supplies, then issues a 30-day access token. The full report opens immediately.
3. If the buyer closes the tab before that happens, Razorpay's webhook to `/api/payments/razorpay/webhook` settles the purchase instead. It is verified over the raw request body, checked for currency and amount, and recorded so a redelivery is never processed twice. On the next visit, the buyer's purchase exchanges for a token.

**To switch payments on:**

1. In the Razorpay Dashboard, create API keys. Start with **test mode** keys (`rzp_test_...`).
2. Turn on **automatic capture** for payments. Without it, a payment is only authorised, and Razorpay may refund it.
3. Create a webhook pointing to `https://YOUR-API-DOMAIN/api/payments/razorpay/webhook`, with a secret you choose, subscribed to **payment.captured** and **order.paid**.
4. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `ACCESS_TOKEN_SECRET`, `RESEARCH_PRICE` and `PAYMENTS_ENABLED=true`, then run migration `razorpay_orders.sql`.
5. Make a test purchase with Razorpay's test cards. Only then switch to live keys.

If your web host adds a Content Security Policy, allow `https://checkout.razorpay.com` for scripts and `https://api.razorpay.com` for frames and connections. The page itself sets none.

**Tested through the real `server.js`:** three buyers of one project. A genuine payment unlocks instantly. A second buyer cannot reuse the first buyer's payment — the signature is checked against the server's own order. The webhook settles a closed-tab purchase. Redelivery, underpayment, forged signatures and foreign orders are all handled correctly, and a Razorpay outage returns an honest message instead of hanging. `npm test` runs all of it, and fails loudly if a money rule breaks: disabling the underpayment check makes it fail by name.

## The buyer's own documents

In the full report, the buyer can upload an allotment letter, an agreement or a registration certificate, as a PDF or a photo up to 8 MB. The model only extracts six property fields: document type, project name, registration numbers, selling company, possession date, and payment bank. It is told never to return personal details, and a reply containing any other field is rejected whole. Every comparison is then made in plain code: registration number, seller, possession date, project name, and the payment bank as information. The file is never stored, logged or cached.

## Entity memory

Every spelling of a project, and its registration number, resolves to one report — "Samraat Tropicano", "Samrat Tropicano" and its RERA number share one brief, one search cost and one price. A name that turns up for two different projects in different cities is marked ambiguous and never merged. A mistaken cache miss costs time; serving the wrong project's report would cost trust.

## Fixed in this round

- **Every payment confirmation would have failed.** The global JSON parser ran before the webhook, so the webhook never saw the raw bytes its signature check needs, and hashing the parsed object threw.
- **One payment could have unlocked other buyers' purchases.** The webhook marked purchases paid by report reference, which many buyers of one project share. Every payment path — Razorpay's handler, Razorpay's webhook, the generic webhook and the legacy report path — now goes through one function that marks a single purchase by its own ID. A test proves a second buyer stays pending.
- **The old entitlement check could never succeed.** It read a signed session cookie that nothing ever set, using a library that isn't installed. The live site doesn't use that path; it uses the new token layer.
- **The research time budget was never enforced.** The last round added a timer that nothing called. Search, registry and adviser now each run against a real deadline.
- **The website's research request had no timeout**, so a hung server left the search button disabled forever. It now gives up after 90 seconds with a clear message.

**Checked through the real `server.js` (18 checks):** payments off and on; two buyers of one project; a signed webhook; replay, underpayment and forged-signature attempts; token exchange; the document check; and the body-parser fix.

## Before the first public visitor — checklist

1. **Set `API_BASE`** in `shelterkart-frontend.html` to your server's address. Until you do, the site runs in preview mode, and a banner on every screen says reports are samples about fictional companies.
2. **Have a lawyer review the Privacy Policy and Terms.** The Privacy Policy now describes what the product actually does — searches, document checks, Razorpay, Anthropic as a processor — but it hasn't been reviewed by counsel. Under India's DPDP Act that review is yours to get before launch.
3. **Make sure `corrections@shelterkart.com` exists and is read.** The Privacy Policy and every report point people to it.
5. **Substitute `__BUILD_HASH__` in `sw.js`** on each deploy — a commit SHA or timestamp — so returning visitors pick up new versions.
6. **Taiwan:** email the Ministry of Economic Affairs' usage notification form to opendata.gcis@gmail.com. Set `GCIS_NOTIFIED=true` only after they confirm. Until then, Taiwan reports stay research briefs.

## Fixed in the audit

- **The demo published invented findings about real companies.** It named Lodha Group, Macrotech Developers, Oberoi Realty, DAMAC, Berkeley Group, City Developments and Mattamy Homes, with real project names and some real-format or real IDs, and it was what a visitor saw by default. Every one is now a fictional company with `SAMPLE-` identifiers, preview mode is labelled on every screen, and a test fails if a real name or a MahaRERA-format number ever returns.
- **The site claimed more than it does.** "Built only from public-domain regulatory and financial records" appeared in the page, the search description, the link previews, the structured data and a screen-reader label — but research also reads listing sites and news, marked by strength. All now say what's true: every claim is traced to its source.
- **The title promised "Trust Scores"** while every live report says "No score". Now: *Independent Property & Builder Research*.
- **The Privacy Policy described flows the product doesn't use**, and none it does. Rewritten; the public "draft" notice moved to this checklist.
- **Every shared link would have previewed without an image**: `share-card.png` didn't exist. Now it does.
- **Spike protection:** a daily ceiling on new research, looser per-IP limits for shared mobile IPs, and no limit at all on already-researched projects.
- **Brand drift:** 39 hard-coded colours in the live report replaced with tokens, and the five evidence marks became named brand tokens.
- **A comment promised a test that didn't exist.** The test now exists: the website's and the engine's market lists must match exactly.

## Connectors added in this round

- **Ireland** — the Companies Registration Office's own data dictionary: identity, status, dissolution date, last annual return, last accounts and NACE industry code.
- **Taiwan** — the Ministry of Economic Affairs' own Swagger definition: identity, paid-in capital, suspension of business, and revocation applications. The register holds Chinese names, so the search step now asks for the developer's local-script legal name, and the matcher compares Chinese names as whole strings. Minguo dates are converted, so `0680718` becomes 18 July 1979.
- **India** — IBBI's per-company claims register, keyed by CIN. The parser reads only the page's own "Total Records" line; anything else is treated as not understood, and yields no finding. The search step now asks for developer company numbers, and India's check runs on a CIN even when the developer's name is unknown.
- The server's market list now takes its depth labels from the engine, so there's one rule instead of two.

## Logo and share card, regenerated in real Fraunces

The earlier PNGs used a fallback serif because Fraunces genuinely wasn't reachable — no internet access to fetch it. It turned out to already exist locally, in a skill's asset folder, just not installed; a real fix was possible after all.

- **`logo/shelterkart-lockup.svg` / `.png`** — the primary lockup for light backgrounds: navy "Shelter", red "Kart" — the mark's own documented palette. Background is genuinely transparent (alpha, not a white match — checked by compositing onto an unrelated colour).
- **`logo/shelterkart-lockup-on-dark.svg` / `.png`** — new: cream "Shelter", terracotta "Kart", gold mark strokes — an exact match for the site's own live hero treatment, for use wherever that's needed as a standalone file.
- **`share-card.png`** — same palette as before; the tagline now renders in real Fraunces, not a fallback.

The wordmark text in both SVGs is **outlined to real vector paths cut from the actual Fraunces SemiBold font** — not live `<text>` — so it renders identically everywhere, with no dependency on the viewer having Fraunces installed. That's a stronger fix than just naming the right font: the original SVG never named Fraunces at all, it requested Georgia.

Fraunces is licensed under the SIL Open Font License 1.1. The full licence text ships alongside the font wherever it's installed in this build; keep that attribution if the font file itself is redistributed. The outlined logo files are ordinary vector artwork and carry no font-license obligation of their own.

All three PNGs were re-compressed after generation — the raw renders came out 30–80x larger than necessary for flat-colour artwork (up to 6.9MB for a two-colour wordmark). Losslessly recompressed to 84–96KB each, pixel-for-pixel identical.

## P0 security fix: the old architecture removed entirely (this round)

Two independent audits found the same thing: an old demo report system still lived in the same file as the new live research pipeline, and its payment path could unlock a paid report without real payment confirmation. Verified directly against the code, then removed rather than patched — a second payment path is itself the risk, however well-guarded.

**Confirmed and removed:**
- `payAndUnlock()` — called a different, unauthenticated endpoint (`/api/report-checkout`) and set `reportUnlocked = true` the moment it returned `ok: true`, which the code's own comment admitted only meant "recorded as pending," not paid.
- The global click delegate (`data-nav-type`) that reached this old system with **no live-mode guard at all** — worse than either audit stated, since it meant the old path was reachable in production, not just in the demo preview.
- All of `DEVELOPERS`/`PROJECTS` demo data, the old `search()`, `renderDeveloper()`/`renderProject()` and every renderer feeding them, the OTP flow, client-side pricing (`getFlatFee`), the `localStorage`-based unlock list, and the client-side score-breakdown display — none of which is needed now that the real backend exists.
- A JavaScript function embedded inside the `<style>` block (parses in most browsers by luck, not by rule).
- Fuse.js's fuzzy search, confirmed dead: the script tag was `defer`, the code using it was not, so it always ran first and always fell back to substring matching.
- Two other genuinely orphaned pieces found only by systematically checking every function call against its definition: the old disambiguation UI (`ambiguousCandidates`/`renderDisambiguation`), and a `breakdownModal` HTML block left behind after its trigger was removed.

**Fixed in the process, not just removed:**
- `aria-hidden` on the background is now correctly cleared when a modal closes — previously set on open and never removed, so a screen-reader user lost the whole page after closing one dialog. Proven with a real execution test across three open/close cycles, not just read-through.
- The modal focus-trap listener leak — every open added a keydown listener, close never removed it. Now removed on close; the same test proves the listener count returns to baseline every cycle, with no accumulation.
- `withTerms()`, the glossary-tooltip function, was rebuilt to construct real DOM nodes instead of an HTML string — fixing its XSS risk at the root rather than escaping around it — and is now actually used in the live brief's finding text, not left as an unused utility.
- "Report an inaccuracy" and "Developer Right of Reply" — both called out by name as good product thinking — were about to become unreachable once the old report page was removed. Rewired to the live system's real report reference, with a fail-safe message if no report is open yet, and added to the live brief's own footer.
- The old fuzzy-search fallback, when no backend is configured, is replaced with an honest message rather than fake results from fictional demo companies.

**A mistake made and caught in the process:** an early cut swept up `openModal`, `closeModal`, `apiCall`, `failureMessage`, and `focusablesIn` along with the old system, even though every remaining modal depends on them. Caught by building a real execution test rather than trusting a read-through -- the same class of check that found the two removed-but-still-referenced items above. All five restored, with the modal fixes above applied while rebuilding them.

**Verified, not assumed:** a systematic check comparing every function call in the script against its actual definition, run to convergence (each fix re-triggered the check); a real DOM execution test proving the modal cycle, the dispute/reply guards, and the live brief renderer all behave correctly under `vm.runInThisContext`, not just `require()`; the project's own copy gate; CSS brace and comment balance; and a check that every `getElementById` target still exists in the HTML.

File size: 5,364 lines before this round, 3,948 after.

## Three more fixes, verified this round

**A CSP that was silently ready to break payments.** `helmet()` with no configuration sets `script-src 'self'` by default -- meaning the moment `PAYMENTS_ENABLED=true`, Razorpay's own checkout script, its payment iframe, and its calls to its own API would all have been blocked by the CSP this code was already shipping. Confirmed against helmet's own documented default and Razorpay's own integration guidance, not assumed. The new policy allows exactly `https://*.razorpay.com` and Google Fonts, blocks everything else third-party, blocks framing of the site, blocks object embeds -- and is honest in its own comment that `'unsafe-inline'` stays for script and style because the whole frontend is one inline `<script>`/`<style>` block today; removing that need is real, separate work (moving every `onclick` to a delegated listener), not something to fake by shipping a policy that doesn't match what the page does.

**Checkout had no idempotency.** A network timeout followed by a retry created a second Razorpay order and a second pending purchase row for the same buyer. Fixed with a client-generated key, persisted in `sessionStorage` so even a page reload resubmits the same one: a repeated key now returns the existing purchase instead of creating a duplicate. The genuine race -- two requests with the same key arriving at once -- is caught by a real unique index on `idempotency_key` (`idempotent_checkout.sql`), and the test suite simulates Postgres's own `23505` unique-violation error to prove the server's fallback path actually handles it, not just the read-first happy path.

**Shared links pointed at a search, not a report.** `?q=...&m=...` meant opening a shared link re-ran the whole pipeline -- wasteful, and worse, not actually the same report: the same search months later could resolve differently, or simply return different findings. A specific claim traceable to a specific source is the entire premise here, so what gets forwarded on WhatsApp needs to be the report that was actually seen. Reports are now shared and opened by their own stable ref (`?ref=SK-...`), served from a new store kept independently of the regular 24-hour research cache and for much longer -- 30 days, matching the access token's own lifetime. Past that, the honest answer is "no longer available," not a silent, possibly-different re-run. The same ref-based lookup is now also used to reopen a report immediately after payment, which used to re-run the entire research pipeline a second time for research that had already been done seconds earlier.

All three verified by loading the real `server.js` and exercising the actual behavior -- the real CSP header string checked against every real requirement, a genuine retried checkout proven to return the same purchase, a shared link proven to open the same report (locked for one buyer, unlocked for the one who paid), and a legal purge proven to reach the new store, not just the original cache. Two mistakes were caught and fixed in the process: a purge test that silently purged nothing because it targeted the wrong hostname, and a CSP test that couldn't have failed either way because it was exercising a plain pass-through stub rather than a real header-building one. Both were bugs in the verification, not the code -- exactly why the verification has to be checked as carefully as the fix.

## Sample paid reports (`sample-reports/`)

Four full paid-tier reports, one per launch market: the UK (Sutton Garden Square, Berkeley), Singapore (River Modern, GuocoLand), India (Casagrand Casamia, Chennai) and Dubai (Creek Bay Tower B, Emaar). Each is built from real searches run on 26 September 2026 and rendered with the live site's own report styles and print stylesheet. **Every evidence mark was decided by the engine's own `markFinding()`, not typed by hand**, and the evidence counts are derived from those marks, as they are for a live report.

What building them caught:
- **The engine treated India's stock exchanges as official, but not Singapore's, Dubai's, London's or Australia's.** A listed developer's own SGX filing was marked no stronger than a listing site. `links.sgx.com`, `dfm.ae`, `londonstockexchange.com` and `asx.com.au` are now official, with a test. A developer's own website is still never official.
- **The Singapore draft overclaimed.** It marked the registration number "confirmed" partly from the developer's own site, and labelled the developer's corporate page as an "official register match". Corrected, and the engine then overruled one more hand-mark, applying the project-named-microsite rule.
- **Two drafts printed inferences that rested on no finding** (India's CIN, Dubai's "never cancelled" claim). The live adviser drops such inferences, so each is now backed by a visible, sourced finding.
- **Tamil Nadu's regulator changed.** Its registered-projects page now disallows automated access, although the homepage is still readable. The India sample says so, and `engine/markets.js`'s India note should be updated to match.

Limits, stated in the reports themselves: the Singapore sample confirms the developer through SGX filings rather than a live ACRA query; the India sample does not run the IBBI check a live report would; and Dubai remains research-only until Dubai Pulse access is approved. Body text is set in DejaVu Sans, because IBM Plex Sans wasn't available where they were rendered. The headings use the real Fraunces.

## Durable reports (migration 018)

**The failure this fixes.** Reports, the spellings and registration numbers that map to them, and the daily research counter all lived only in server memory. Every deploy or crash erased them. A buyer who had paid could open their report link the next day and be told "This report is no longer available", with a valid access token and nothing behind it.

**How it works now.** Memory stays the fast layer, and nothing about the existing logic changed. Every new report, alias and daily count is also written to Postgres in the background. On startup the server reloads recent reports before accepting traffic. If a report link names something this server doesn't hold in memory — because another instance created it, or it was evicted — the server reads it from Postgres before ever saying "not available". A legal purge now reports success only once storage has confirmed the deletion. If the database is down, searches still work: failures are logged as `[persistence] ... failed`, and no buyer sees an error.

**Retention.** Reports are kept for 30 days and then deleted from storage at startup, not merely ignored. The Privacy Policy said 24 hours, which had already been untrue since shared links arrived, and now states 30 days accurately. Within the first 24 hours a stored report also answers new searches instantly; after that it stays reachable by its link only.

**Set `DATABASE_URL` in production.** Without it the server logs a warning at startup and runs memory-only, which is fine for local testing and wrong for real buyers.

**Tested:** 8 engine tests (a paid report surviving a restart, another spelling after a restart, read-through, a durable purge, retention, the daily ceiling, ambiguity surviving a restart, and a database outage) and 12 end-to-end tests. The end-to-end tests run the real server and the real `persistence.js` against a database stand-in that understands its exact SQL and rejects wrong parameter types. Swapping two of its parameters on purpose made 5 of them fail by name.

**Not tested: the SQL against a real PostgreSQL.** None was available where this was built. The statements are deliberately plain (upserts, `TEXT[]` with `= ANY()`, one JSONB column), but run this on first deploy:

1. `psql "$DATABASE_URL" -f backend/research_persistence.sql`
2. Start the server. The log should say `[persistence] restored 0 report(s)`.
3. Run one search, then `SELECT ref, array_length(page_urls, 1) FROM research_briefs;` should show one row.
4. Restart the server. The log should say `restored 1 report(s)`. Open `?ref=<that ref>`: the report should open.
5. Confirm the log contains no `[persistence] ... failed` lines.

## Source health (migration 019)

**Why.** Tamil Nadu's regulator stopped allowing automated access to its project listing, and nobody noticed until it turned up by accident. A register that quietly stops working is worse than one that says so: a buyer told "no match" concludes the developer has no record.

**What it does.** Once a day, for each market with a live register, it looks up one well-known company through the very connector production uses, and checks two things. First, that the lookup still finds the company. The connector's own parser does the reading, so a changed response shape shows up as "no match", not just a dead host. Second, that the register's `robots.txt` still allows every URL that connector actually requested. Those URLs come from the request itself, so they can't drift from a hand-kept list.

**What happens next.**
- One failure makes a market *degraded*: nothing changes, and nobody is told.
- **Two failures in a row after it once passed** switch its register off: `research-only`, with the reason stated in every report ("temporarily switched off because it is not responding as expected"). It is never reported as "no match", and never claims a register check that didn't happen.
- **A `robots.txt` block switches it off at once**, even one that never passed. Compliance beats availability.
- A market whose canary has *never* passed is `unconfirmed`, not down: still in use, with one digest message asking you to check the canary. So a wrong guess in the canary table can never switch off a working register.
- One passing check brings it back, with a message.
- Alerts fire on changes only. `GET /api/admin/source-health` shows every register's state; `POST /api/admin/source-health/run` checks now, which is useful after fixing a connector.

**Turn it on.**
1. Run `source_health.sql`.
2. Set `ALERT_WEBHOOK_URL` (a Slack or Discord incoming webhook).
3. Set `SOURCE_HEALTH_SCHEDULE=true` on **one** instance, or run `npm run health` from cron. The CLI exits 1 if anything is switched off.
4. Expect **one digest on the first run** listing markets whose canary has never passed. That is normal: see below.

**What is and isn't verified.** Only two canaries assert a specific record: the UK (Berkeley Group, 05172586, read live on Companies House) and Singapore (GuocoLand, 197600660W, from its own annual reports). The other seven only require that a well-known company is found, and I haven't seen those live, so a wrong pick shows up as "unconfirmed" on day one. India has no canary yet, because IBBI needs a CIN known to have a claims page. Add it to `CANARIES` when you have one. Everything here was tested against a faked network; the `robots.txt` evaluator follows RFC 9309 and is unit-tested on that basis. If a register's `robots.txt` blocks an API that its own terms clearly permit, the alert says so and `HEALTH_ROBOTS_OVERRIDE=<market>` keeps it running. It's your decision, made once you've read those terms.

**Three real bugs found while building it.**
- **Czech name searches were silently sent as a GET.** The server's registry client passed only headers, so the POST body the connector sends was dropped, and every Czech lookup came back "no match". No test noticed, because every test injected its own fake client. The client is now its own module with a test on what reaches the network layer, and the canary would catch a recurrence nightly.
- **The UK register would never have been checked.** The canary table used the connector name (`gb`) where the market code is `uk`, so the flagship market was skipped as "no canary defined". A test now requires every market with a register to have a canary or be explicitly exempt.
- **The admin rate limiter never covered the purge route.** It was registered near the end of the file, and Express applies middleware in registration order, so admin password guessing on `/api/admin/purge` was unlimited. It now sits above every admin route, and a test fails if any admin route is ever registered before it.

## The admin dashboard and visit statistics (migration 020)

**Open `admin.html`**, set its `API_BASE` to your server, and sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`. The credentials are now checked *before* the dashboard is shown; previously it opened on any input and failed later. For any period (today, 7, 30 or 90 days, or 12 months) it shows:

- **Headline numbers:** visitors, page views, searches, reports opened from shared links, paid reports, revenue per currency, PDFs saved, WhatsApp shares, document checks, unfinished checkouts, open disputes, replies to review.
- **Every day:** visitors, searches and paid reports as a chart.
- **From visit to payment:** visited → searched → saw a report → clicked unlock → started checkout → paid, with the conversion at each step.
- **Where people come from:** channel (Instagram, WhatsApp, Google, direct...), tagged campaigns, referring websites, countries and devices.
- **What buyers want:** the most-searched projects and markets, and how searches ended — including searches where the buyer got nothing.
- **Official registers:** the nightly health check, with a button to run it now.
- **Disputes and developer replies**, as before.

**How it counts, and what it never does.**
- No cookies, and no IP address or browser string is stored.
- Unique visitors are counted with a code that changes every UTC day; only today's salt is kept, so nobody can be followed from one day to the next — the same person on two days counts twice.
- Bots and link previews (WhatsApp, Instagram, Slack and others) are not visitors.
- Searches, report opens, checkouts and payments are recorded by the **server**, so ad blockers can't hide them.
- The browser can report only four things — page views, unlock clicks, PDF saves and WhatsApp shares — so no script can inflate purchases or revenue.
- Revenue is recorded only at the moment a purchase is actually settled, whether by the buyer's browser or by Razorpay's webhook, and is never summed across currencies.
- Events are kept for 400 days.
- The Privacy Policy now says all of this.

**Country** comes from your hosting edge (Cloudflare's `CF-IPCountry`, or Vercel, CloudFront or Fly equivalents). Without one it shows as "not provided".

**Tag your links, or Instagram looks like "direct".** Instagram's in-app browser and WhatsApp usually send no referrer. Use `https://shelterkart.com/?utm_source=instagram&utm_medium=bio&utm_campaign=launch` in your bio, a different `utm_campaign` for each Reel or story link, and `utm_source=youtube`, `utm_source=newsletter` and so on elsewhere. The site's own WhatsApp share button already tags its links `utm_source=whatsapp&utm_medium=share`.

## Buyer flow fixes found in this audit

- **Paid access disappeared when the tab closed.** It was kept in `sessionStorage`. It now uses `localStorage`, which also makes the consent banner's promise ("your unlocked reports are here when you return") true.
- **A buyer on a new phone had no way back in.** "Restore a purchase", in the footer and on every locked report, now takes the payment ID from Razorpay's receipt email (`pay_...`), finds the paid purchase, and reopens the report. It's rate-limited, and returns nothing for a payment ID that paid for nothing.
- **Six legacy routes were still live**: `/api/send-otp`, `/api/verify-otp`, `/api/checkout`, `/api/report-checkout`, `/api/resolve`, `/api/report/:type/:id`. Nothing called them, but anyone could use them to create fake leads and pending purchases (with `phone_verified` hardcoded to true), and `/api/checkout` accepted a price from the caller. Any purchase count would have been counting junk. They now answer **410 Gone**, and 14 orphaned helpers went with them. The cleanup was checked with an inventory rule: exactly these routes and definitions removed, nothing else. That check caught a first attempt that had silently commented out the dispute and developer-reply routes.
- **The stats panel counted every pending checkout as a purchase**, and showed "leads" that only the retired routes created. It now counts paid purchases, and shows unfinished checkouts separately.

**Tested:** 8 analytics unit tests (privacy, bots, channels, exact funnel and revenue arithmetic), 26 end-to-end server checks, 11 checks of the real website script (tracking, share tagging, PDF, restore access, no tracking when no backend is connected), and 10 checks of the real dashboard script (wrong password never reveals it, HTML in a dispute is escaped, an expired session signs out). None of it has touched a real network or a real PostgreSQL, so the `LAUNCH.md` first-deploy check applies here too. After deploying, visit the site once from your phone and confirm a page view appears on the dashboard.

## Investor demo: five real sample reports

**To run the demo:** open `shelterkart-frontend.html` in a browser, with the `sample-reports/` folder next to it. No backend is needed. The page shows "Preview mode" and, under the search box, **Sample reports** for:

| Project | Market | Checked | At a glance |
|---|---|---|---|
| Hubtown Celeste, Worli | India (Mumbai) | 29 Sep 2026 | Registration reported by 5 sites; 4 disagreements, including possession (December 2027 against 3 July 2028) and building height |
| Casagrand Casamia, Pallavaram | India (Chennai) | 26 Sep 2026 | Six possession dates from March 2027 to March 2032 for one registration number |
| The Kensington, Sutton Garden Square | UK | 26 Sep 2026 | Developer confirmed at Companies House; two price disagreements |
| River Modern | Singapore | 26 Sep 2026 | Developer confirmed through its own SGX filings; a microsite claim downgraded by the engine |
| Creek Bay Tower B, Dubai Creek Harbour | UAE | 26 Sep 2026 | Research only; a marketing claim ("never cancelled a project") tested against independent data |

Each opens in the same renderer a live report uses, and has a **Free preview / Full paid report** toggle — the business model in one tap — plus a **Download the PDF** link. Searching one of their names on the preview (for example "hubtown") opens it, and a sample's link (`?ref=SK-…`) opens it directly, even with no backend. "Unlock" on a sample's free preview opens the full report and takes no payment. The demo makes no network request of any kind.

**Every sample now has a ShelterKart Score**, computed by the same code as a live report. See *The ShelterKart Score* below.

**These are real companies, researched from public sources, and dated.** Findings may have changed since. Every finding cites the pages it came from, and every mark was decided by the engine's own `markFinding`. The free view is exactly what the server's `previewOf` sends. None of this is typed by hand: `node tools/build_samples.js` rebuilds the samples from `tools/samples/*.json` through the real engine functions, and rewrites the page's `SAMPLE_REPORTS` block. A test fails if any sample finding is unsourced, carries a mark the engine wouldn't give it, shows more in the free view than `previewOf` allows, carries a score, lacks its PDF, or if any real developer name appears anywhere outside the sample reports. Planting a hand-upgraded mark, or an invented finding, makes that test fail.

The PDFs were regenerated so their references match the web reports. The Hubtown Celeste PDF is new. Body text is set in DejaVu Sans, because IBM Plex Sans wasn't available where they were rendered; the headings use the real Fraunces.

## Pricing: one price per market, in its own currency — SUPERSEDED by "Pricing and payments, V1" below

| Market | Full report |
|---|---|
| India | ₹1,499 |
| Dubai (UAE) | AED 149 |
| United Kingdom | £39 |
| Singapore | S$69 |
| Australia / New Zealand | A$69 / NZ$69 |
| Hong Kong / Taiwan | HK$349 / NT$1,290 |
| Switzerland | CHF 49 |
| Norway / Sweden / Denmark | NOK 449 / SEK 449 / DKK 299 |
| Czech Republic / Poland | CZK 990 / PLN 179 |
| Eurozone markets | €39 |

**The logic.** Square Yards' own worked example of an ₹88 lakh Mumbai flat shows the buyer paying about ₹24,000 in loan processing and ₹88,000 in brokerage. A check that could save them from the wrong building shouldn't cost less than a dinner out: ₹499 read as cheap. ₹1,499 is about 0.02% of that flat and about 6% of that loan fee. Elsewhere, prices sit at roughly US$40–55, in each currency's usual price endings rather than converted to the cent. **These are starting prices to test, not market research.** Watch "Clicked unlock → Paid" on the dashboard and adjust.

**Change a price without touching code:** `RESEARCH_PRICES={"in":{"amount":1999,"currency":"INR"}}`. A malformed entry is ignored, never charged. Every purchase stores the price it was sold at, so a change never breaks a payment already in progress (tested: a Dubai buyer who started at AED 149 still completes after the price rises to AED 199). The old `RESEARCH_PRICE` / `RESEARCH_CURRENCY` settings are gone. The sample reports and the public pricing page read the same table, and a test fails if a demo price differs from what the server charges.

**Charging outside India needs Razorpay's international payments switched on**: Dashboard → Account & Settings → International payments → activation form. Card fees for international payments run up to about 3%. Until it's approved, only rupee payments work.

**Taxes: ask your CA before going live.** Decide whether prices include GST, and how sales to buyers abroad are treated. The pricing page currently says "the price you see is the price you are charged", which is only true if prices are tax-inclusive.

## Policy pages Razorpay requires (blocker for live keys)

Razorpay checks About, Contact, Pricing, Terms, Privacy, Cancellation & Refunds and a Shipping (delivery) policy before issuing live keys, and the refund policy must give concrete timelines. `node tools/build_policies.js` builds all seven, as `about.html`, `pricing.html`, `refunds.html`, `delivery.html`, `contact.html`, `terms.html` and `privacy.html`, next to the site, and the site's footer links to them. Business details come **only** from `tools/business.json`. With any required detail blank (legal name, registered address, phone, support email, grievance officer name and email), every page carries a red *"Draft — not ready to publish"* banner and the command exits 1. Nothing is invented. Terms and Privacy are copied from the site's own pop-ups, and prices from the pricing table.

**Decide the refund policy; the draft is a proposal.** It offers a full refund within 7 days for:
- a duplicate charge;
- a report that wouldn't open and wasn't fixed within 2 business days;
- a report on the wrong project;
- a finding shown to be wrong against its own cited source and not corrected within 7 days.

There are no refunds for a change of mind once a report opened correctly — the free preview exists for that. Replies go out within 2 business days, and refunds within 7 business days of approval. Change these in `tools/business.json` or in the builder text, then rebuild.

## The ShelterKart Score (methodology SK-1), restored — superseded by SK-2 below

**Why it came back.** Withholding a score unless the regulator itself confirmed the evidence meant that no Indian or Dubai report could ever have one, because MahaRERA blocks automated access and Dubai Pulse isn't connected. That removed the product's central idea. The fix is a score that can be defended, not the absence of one.

**What it measures:** how well the public record backs a project, out of 100, from four parts:

| Part | Weight | What it looks at |
|---|---|---|
| Registration and identity | 30% | The project's registration number (India, Dubai) and the developer's legal identity, by strength of evidence |
| Red flags | 30% | Insolvency, liquidation, dissolution or suspension in an official register, or corroborated reports of them |
| Consistency between sources | 25% | Disagreements, weighted by whether they concern a key fact (possession, registration) and how many versions exist |
| Transparency of key facts | 15% | Whether the registration number, developer identity, possession date and approvals are published and corroborated |

**The rules (engine/score.js, each proven by a test):**
1. Computed by code from the finished report, never by the AI. Every point is explained in the report's breakdown.
2. **Only corroborated evidence moves it:** confirmed at an official source, or reported by two or more independent sites. The developer's own claims and single-source findings never add or remove a point, so no developer can buy, write or talk the score up.
3. **What couldn't be checked is never counted against the developer.** It scores as neutral and lowers the *confidence* (High, Medium or Low, with the reason shown), while a clean check in an official register earns credit.
4. **A serious finding confirmed in an official register caps the score below 40**, whatever else looks good.
5. No score only when there's too little to go on (fewer than three findings), and the report says so.
6. The bands describe the **record**, never the developer, and never say buy or avoid: *Strong public record* (80+), *Mixed public record — verify key points* (60–79), *Weak public record* (40–59), *Serious concerns in the public record* (under 40).

**The free preview shows the number, the band, the confidence and each part's value.** How each part was worked out quotes paid findings, so it's in the full report — and it's a strong reason to unlock.

**The samples:**
- Sutton Garden Square **88** (Strong, High confidence)
- River Modern **82** (Strong, Medium)
- Hubtown Celeste **71** (Mixed, Medium)
- Casagrand Casamia **69** (Mixed, Low)
- Creek Bay Tower B **57** (Weak, Low)

Each can be traced line by line in its report and PDF.

**Before launch, a lawyer should read the methodology and the Terms together.** Term 5 already presents the score as an opinion on the public record, not a guarantee. Publishing the methodology (this section) and keeping the developer right of reply are the main protections for a score on a named company. The methodology is versioned: changing a weight or a rule means a new version (SK-2), so a score can always be reproduced.

**Also corrected:** the Terms promised fees that vary by "property value band" and are "reduced where coverage is partial". Neither was true. They now say the fee depends only on the market. Everything is called the "ShelterKart Score", replacing the older "Trust Score".

## The ShelterKart Score, methodology SK-2: fair to the developer, useful to the buyer

**Why SK-1 was replaced.** SK-1 scored the *paperwork we managed to find*. A developer lost points when our search missed its registration number, when estate agents' listing sites disagreed with each other, and when a regulator blocked our access. None of that is the developer's doing, and the score never looked at what a buyer most needs to know: has this developer delivered before, on time, and what do buyers say?

**What SK-2 measures:**

| Part | Weight | What counts |
|---|---|---|
| Developer track record | 30% | Corroborated evidence about its other projects: handed over, on time, delayed, stalled |
| Project timeline and progress | 25% | This project only: a date stated by the developer or an official source, or corroborated by several sites; construction milestones; corroborated delays |
| Regulatory and legal standing | 25% | Registration; developer confirmed in an official register or at an official source; corroborated legal action; insolvency confirmed in a register (caps the score below 40) |
| What buyers say | 10% | Recurring themes across reviews, forums, YouTube and social media. One voice is not a pattern |
| Developer's own disclosure | 10% | Verifiable facts the developer's own website publishes: registration, dates, approvals |

**The fairness rules (engine/score.js), each with a test that fails if the rule is broken:**
1. **Not finding something is never held against the developer.** A part with no corroborated evidence is *not assessed*: left out of the score, and shown as "Not assessed" with the reason.
2. **Listing sites disagreeing with each other is not the developer's fault.** Buyers see every version, but the score falls only if the developer's own statements or an official source disagree.
3. **A negative finding counts only when corroborated** (two or more independent sites) or confirmed in an official record.
4. **The developer's marketing never raises the score**, even when repeated by agents ("90% on time" on promotional pages is recorded as a developer claim). Its own website counts only for verifiable disclosures, and only in its favour.
5. **A developer's other projects are track record, never this project's progress**, and a building described as "36 storeys" is its design, not its progress.
6. **A score needs enough evidence:** at least half the weight assessed, across two or more parts. Otherwise the report explains that it can't yet score fairly.
7. **Confidence** is High (80%+ assessed, including an official source), Medium (60%+) or Low, and the report names every part it couldn't assess.

**Deeper search.** Each new report now runs three focused research passes in parallel, which is no slower for the buyer:
- **the official record and the developer's own website** (registrations, registries, courts, exchange filings, and what the developer itself states);
- **track record and timeline** (delivered, delayed or stalled projects, complaints and orders, this project's construction progress);
- **what buyers say** (portal reviews, forums, YouTube, Instagram, TikTok, Facebook).

The developer's own site is accepted only if the search actually reached it and its domain carries the developer's name, so an agent's project-named microsite can't pass as the developer. Social-media findings are labelled as individual views. A pass that fails is named in the report, and its parts show as "not assessed", never as "nothing found".

**Cost:** up to three times the search calls per *new* report (cached and matched searches cost nothing). Tune with `SEARCH_FACETS` (default `record,track,voice`) and `SEARCH_USES_PER_PASS` (default 8). The daily research ceiling still applies.

**The samples were re-researched for this, on 30 September 2026:**

| Sample | Score | Confidence | Key evidence |
|---|---|---|---|
| River Modern, Singapore | **80**, Strong | Low (55% assessed) | GuocoLand's own SGX filings: Midtown Bay completed Q2 2024, Lentor Modern Q3 2025, Martin Modern handed over. No completion date for River Modern yet |
| Hubtown Celeste, Mumbai | **80**, Strong | Medium (80%) | 25 South tower handed over (earnings call and a portal), structure to the 27th floor (two sites), registration and Commencement Certificate corroborated. Seven listing dates, March 2027 to July 2029, shown but not counted. No buyer reviews or videos found |
| Sutton Garden Square, London | **76**, Mixed | Medium (60%) | Companies House, and Berkeley's own site publishes the completion timing. Track record not researched this round |
| Casagrand Casamia, Chennai | **73**, Mixed | Low (50%) | Registration corroborated; August 2028 given by three sites. The two company names resolved: one company, converted to public. "90% on time" is marketing, and not counted |
| Creek Bay Tower B, Dubai | **72**, Mixed | Medium (80%) | DLD data on portals: active, April 2030 handover. Emaar's Creek Harbour handovers corroborated |


**Bugs caught while building SK-2:**
- a misplaced line in the grounding code downgraded *every* finding to single-source;
- merged research passes renamed findings so the adviser's valid citations stopped resolving;
- another project's completions counted as this project's progress;
- "36-storey" counted as construction progress;
- a PDF crashed on parts with no score.

All were caught by tests before shipping.

## The two demos

**Client demo: `shelterkart-frontend.html`,** with `sample-reports/` next to it. With no server connected it runs as the client's own journey on the five real sample reports:
1. Search, or tap one of the five **"Try a real project"** suggestions under the search box.
2. A short research sequence runs.
3. The **free preview** appears: exactly what the server's `previewOf` sends, including the score, its parts, the first findings, and what is locked.
4. **Unlock** opens a checkout at that market's price, marked *"Demo: no money is taken"*.
5. After "paying", the **full report** unlocks, with the PDF.

Nothing is open by default, and a shared link opens the free preview unless that visitor has paid. The page makes no network request, and the top banner says it's a demo.

**Admin demo: `admin.html`,** in the same folder. With no server it offers **"Open the demo dashboard"**, with no sign-in. Every view carries a banner saying the data is a demo:
- **Visitor traffic is simulated** by a repeatable generator, and run through the *real* analytics code, so every figure is computed exactly as live. **Never present these numbers as traction.**
- **The Reports panel lists the five real reports**, with score, confidence, price and sales. **Open full report** opens the complete PDF (the owner's view); **View as client** opens the paywalled page a visitor sees.
- Register health, disputes and developer replies are illustrative, and the actions on them work within the demo.
- Rebuild the demo data with `node tools/build_admin_demo.js`, after `node tools/build_samples.js`.

**Live:** set `API_BASE` in both files. The admin page then requires sign-in, and its Reports panel reads `GET /api/admin/reports` (recent reports) and `GET /api/admin/reports/:ref` (the full report, never the paywalled one), both behind the admin rate limiter and sign-in. Server-side PDF generation for live reports is the next step; until then the admin's full view of a live report is its data.

**Fixed while rebuilding the client demo:** the gallery's cleanup also deleted the score panel's styles, so the score showed as plain lines. A test now fails if any class the report code uses has no style rule, and it was proven to catch that exact deletion.

## Sample reports, deepened (30 September 2026)

| Sample | Score | Confidence | What the extra research added |
|---|---|---|---|
| Hubtown Celeste, Mumbai | **80**, Strong | Medium (80%) | 25 South handover; construction to the 27th floor; seven listing dates shown, not counted |
| Sutton Garden Square, London | **77**, Mixed | **High** (90%) | Berkeley completed 4,076 homes in FY2026, with net cash of £363m and £1.8bn liquidity, both corroborated by independent financial press. Its NPS and HomeViews claims appear only on its own site, so they're shown, not scored |
| River Modern, Singapore | **77**, Mixed | **High** (90%) | Estimated TOP 2H 2030, from the developer and The Edge; statutory vacant possession by 31 Dec 2032; 93% sold. Listings saying "July 2029" shown, not counted |
| Casagrand Casamia, Chennai | **73**, Mixed | Low (50%) | Unchanged this round |
| Creek Bay Tower B, Dubai | **72**, Mixed | Medium (80%) | Trustpilot: about 117 reviews averaging 1.5/5, mostly about build quality, with Trustpilot's own caveat that they may not be representative. One platform, so shown, not scored. A snagging question was added |

"What buyers say" stays *not assessed* everywhere. Every buyer voice found came from a single platform or from the developer itself, and the score waits for a second independent source. That rule protects developers from one-sided review sites. Two more scorer fixes came out of this round: an estimated date for a *future* permit (Singapore's TOP) is no longer read as an approval already granted; and the single-platform note no longer calls 117 reviewers "one voice".

## Buyer protections, currency, and success metrics

**"Your protections as a buyer"** is in every paid report for India, Dubai, the UK and Singapore (`engine/protections.js`). It's plain data, never generated by a model. Each item is labelled *Your right*, *Budget for* or *If it goes wrong*, and names the law it rests on and its sources:
- **India (RERA Act 2016)**, citing the Act's official text on India Code and the Legislative Department: the 10% cap before a registered agreement (s.13(1)); monthly interest or a full refund for late possession (s.18); five years to report defects, fixed within 30 days (s.14(3)); 70% of buyers' money in the project's own account (s.4(2)(l)(D)); complaints to the state RERA (s.31); GST on under-construction homes.
- **Maharashtra:** stamp duty and registration, about 7% (6% stamp duty including metro cess, 5% for women; registration 1%, capped at ₹30,000; not covered by a home loan).
- **Tamil Nadu:** the rate couldn't be verified from more than one source, so no number is printed. Buyers are sent to tnreginet.gov.in.
- **Dubai:** escrow (Law 8 of 2007), Oqood registration and remedies if the 4% fee was taken but the sale wasn't registered (Law 13 of 2008), the 4% Land Department fee, and late handovers.
- **UK:** the 14-day reservation cooling-off, deposit protection, the 10-year warranty plus 2 years of builder liability, pre-completion inspection and service-charge disclosure, the New Homes Ombudsman, and SDLT (sent to HMRC's calculator, no rates quoted).
- **Singapore:** the progressive payment scheme, the binding vacant-possession date versus the estimated TOP, and BSD/ABSD (sent to IRAS's calculator).

The free preview says only how many protections are included, and for where ("7 buyer protections for India — Maharashtra, each cited to the law"). The protections are paid content.

**Re-verify every six months.** A test fails once `VERIFIED` in `engine/protections.js` is more than 183 days old, because laws change. Re-check each item against its sources, update the date, and rebuild the samples. A lawyer in each market should review this file once before launch.

**Currency, audited end to end:**
- **One formatter for every price on the site.** A bare "$" (Singapore, Australian, Hong Kong or New Zealand dollars in their own locales) or "kr" (Norway, Sweden, Denmark) gets its currency code, for example "$69 (SGD)".
- **A missing currency shows no price**, never a guessed one. The unlock button used to fall back to rupees, which would have shown a Dubai report's AED 149 as ₹149.
- **The admin dashboard uses Indian grouping for rupees only**, so £819,000 no longer appears as "£8,19,000".

All of this is tested in eighteen locales' worth of cases. The pricing page, sample cards, checkout and admin revenue were all checked.

**Success metrics** are on the dashboard (Visitor → paid, Unlock → paid, Searches answered, Open disputes per 100 paid reports, PDFs saved and shares per paid report, each with its target and status), with the full set and how to measure each in `SUCCESS_METRICS.md`.

## Institutional polish (before the investor demo)

- **The rating scale.** The score now sits on a horizontal scale across its four bands at their real widths: Serious concerns (0–39), Weak (40–59), Mixed (60–79), Strong (80–100). The report's own band is at full strength and the others are muted, and one marker travels to the score once. It's the page's single orchestrated motion, and it's off for visitors who prefer reduced motion. Screen readers hear "Score 80 out of 100, in the strong band". The PDFs carry the same scale.
- **"How this score is worked out"** opens the published methodology: five parts with their weights, the fairness rules, the bands and confidence. A test fails if any published part or weight differs from what the scorer actually uses, or if the version differs.
- **Research progress, shown honestly.** The three searches appear running *together*, as they do on the server, with grading waiting until they finish. On the demo they complete at slightly different moments, as parallel searches do; live, the report replaces the list when it arrives. Nothing pretends to a progression that isn't happening.
- **Sentence case** for the score label, replacing the all-caps kicker. The scale is built from inline blocks, not flexbox, so it renders identically on older phone browsers.

After the meeting: the landing-page redesign (data-led hero instead of the emblem stack, gold as an accent only) and the trust pages (Methodology, How we grade evidence, Corrections, Independence).

## Trust pages, offline font, and a real-browser check

- **Four trust pages**, built by `node tools/build_policies.js` with the policy pages and linked from the site's footer:
  - *How the score is worked out* (the site's own methodology, word for word);
  - *How we grade evidence* (each grade the reports use, and what is removed);
  - *Corrections* (how to report an error, the reply time, refunds for uncorrected errors, and developers' right of reply);
  - *Independence* (the site's own Principles, plus: paid by buyers, for reports; the price never depends on what a report finds).

  Tests fail if the methodology page drifts from the site's text, or if the evidence page stops explaining any grade the reports use.
- **The Principles were corrected.** "ShelterKart's ShelterKart Score" is now "The ShelterKart Score". "At any subscription tier" is gone, since there are no developer subscriptions. "Tagged as verified or unverified" now names the four grades actually used.
- **The headline font is embedded as an offline fallback** (Fraunces SemiBold, SIL Open Font License, copyright notice included), so headings keep the brand typeface even if Google Fonts can't load on venue Wi-Fi. This was checked in Chrome with all network blocked. Body text falls back to the system sans-serif when offline.
- **The full client journey was run in real Chrome at laptop (1440×900) and phone (390×844) sizes**: landing, research, preview, unlock, checkout, payment, full report and methodology, with no script errors and no sideways scrolling. The admin demo opens cleanly.
- **Demo tip:** tap **OK** on the small storage notice at the start, so it doesn't cover the report. Until `tools/business.json` is filled in, the footer's policy and trust pages show a red "Draft" banner.

**Admin revenue cards** now span two columns, so money figures fit. Checked in real Chrome at 1440, 1280, 1024 and 390 pixels wide, including a ₹12,34,56,789 stress value, with no card overflowing. **`DEMO_SCRIPT.md`** has the five-minute investor walkthrough and honest answers to likely questions.

## Casagrand Casamia, re-researched; restoring the PDF font

- **Casamia now scores 55, "Weak public record", at Low confidence** (it was 73). Two independent publications (Constro Facilitator in 2020; DT Next in 2022) report Tamil Nadu regulator and tribunal penalties against Casagrand Builder Private Limited, the same company as Casamia's developer, for misrepresentation. These include the cancelled registration of its Bloom project, with a ₹30 lakh fine. The report also records the developer's denial, that the appeal outcome wasn't found, and that its website still lists Bloom. A 2026 delay-interest order (Casagrand Divinity) and a 2025 buyer petition (Casagrand Utopia) are single-source, so they're shown, not scored. A new question asks for written confirmation that no order is outstanding or under appeal. The samples now range from 80 down to 55.
- **The PDF builder needs Fraunces installed** (`~/.fonts/Fraunces-SemiBold.ttf`). If it's missing, convert the licensed woff2 with fontTools. Where the Brotli module isn't installed, a shim that delegates to Node's built-in `zlib.brotliDecompressSync` works. Check with `pdffonts`: every sample PDF should list Fraunces.

## Pricing, approved October 2026: one price per report — SUPERSEDED by "Pricing and payments, V1" below

**The formula (`backend/engine/pricing.js`):**

> **price = market standard × (project price ÷ market's average new home)^0.537 × depth**

The result is rounded to a clean local price, with a **floor of 40%** and a **cap of 6×** the market standard.

- **Project price** is the midpoint of the project's own listed prices, captured by the research. It's used only if it's in the market's currency, plausible (1/25× to 60× the market average), and backed by a finding about price that survived grounding. Otherwise the project counts as an average home. The exponent 0.537 is fitted to the founder's two willingness-to-pay points: **₹2,000 at ₹1 crore and ₹10,000 at ₹20 crore**.
- **Market standard** is a Gold-standard report on an average new home. India's is **₹2,500** (the average new home is ₹1.52 crore: Anarock, ₹6 lakh crore over 3,95,625 homes). Every other market's is India's × √(its income per person ÷ India's), using IMF GDP per capita (PPP, April 2026), converted at ECB rates (26 June 2026: $1 = ₹94.40) and rounded. Examples: **AED 255, £45, S$130, A$95, €55 (France), €85 (Ireland), CHF 60, NOK 800, DKK 470, CZK 1,300, PLN 210**. The average new home is sourced so far only for India (₹1.52 crore) and Dubai (AED 3.17 million); other markets price every project as average until theirs is sourced.
- **Provisional markets** (Hong Kong, New Zealand, Taiwan, Sweden, Finland, Estonia, Latvia, Lithuania, Spain, Belgium) keep their earlier fixed price until their income figures are added.
- **Depth** is decided by the evidence, never chosen by the buyer: Gold standard (high confidence) 100%, Heavy (medium) 80%, Thin (low, or not enough to score) 60%.
- **The price never depends on the score's value**, or on whether the findings favour the developer. A test proves two reports differing only in score get the same price.
- **One price, before payment.** The free preview states the depth and what the price follows (for example "this project's listed prices, ₹1.49–2.1 crore"), linking to the pricing page. Checkout charges exactly that price, and the purchase stores it.
- **Settings:** `PRICE_SCALE` (0.5–1.5) scales every formula price, for the launch test: watch Unlock → Paid (target ≥50%). `RESEARCH_PRICES` sets a market's price flat, for operations and promotions.

**The samples:**

| Sample | Price | Depth | Basis |
|---|---|---|---|
| Hubtown Celeste | ₹2,200 | Heavy | Listed ₹1.49–2.10 crore |
| Casagrand Casamia | ₹1,500 | Thin | No listed price found, so priced as an average home |
| Sutton Garden Square | £45 | Gold | UK standard |
| River Modern | S$130 | Gold | Singapore standard |
| Creek Bay Tower B | AED 155 | Heavy | Listed AED 1.8–1.9 million |

**Unit economics.** In India the contribution is about 83% of net price at the ₹1,000 floor and about 90% at ₹2,500. That's after GST of 18% (if inclusive), about 2% gateway fees, 3% refunds, and AI at about $1 per new report (₹94, not yet measured). Break-even for the ₹1 crore plan is about 525 paid reports a month at the samples' depth mix, against about 754 at the old flat ₹1,499.

**Updated to match:**
- the Terms' fee clause, the pricing page (generated from the engine) and the Independence page;
- the free preview, the demo and its checkout;
- the admin demo data, `.env.example` and the demo script;
- the deck: prices, unit economics, market size at the average price paid, exchange rate ₹94.4/$, AI cost ₹94, and the budget rebalanced to keep exactly ₹1 crore.

**Removed:** an older tiered price table (£44/£89/£179…) and the webhook branch that used it. Only the retired purchase routes could reach them, and they contradicted this model.

## Market size, awareness and valuation (October 2026)

Full tables and every assumption: `MARKET_AND_VALUATION.md`. The model that produces them is in `deck/model/` (`python3 market_model.py`, then `python3 som_valuation.py`), and the deck reads its output, so the two cannot disagree.

- **TAM ₹1,657 crore ($175.5 M) a year**: 1.93 million new homes bought a year across the 22 markets × 2 reports × the average price paid. Counts are official where public (India top 7 cities, Dubai off-plan, Singapore, Hong Kong, the UK, Australia, Taiwan, New Zealand, Ireland) and Euroconstruct-based for Europe, with its 3.1-per-1,000 average standing in for the nine smallest markets.
- **SAM ₹1,332 crore**: the 80% reachable online (83% of buyers research online; 57% in India's big cities).
- **SOM by awareness (year 5)**: 2% awareness ₹1.9 crore; 5% ₹4.6 crore; 12% ₹11 crore; 25% ₹23 crore. Awareness is the variable.
- **Valuation**: headline ₹20 crore post-money; weighted fair value about ₹15 crore; floor ₹12 crore. On reports alone the VC method gives only ₹1–5 crore; ₹20 crore needs about $10 M of yearly revenue, which needs subscriptions and lender checks that aren't built. The deck states this openly.
- **Ask**: ₹2.5 crore in two tranches. ₹1 crore for 5% at ₹20 crore post-money now; ₹1.5 crore (about 6.6%, ₹23 crore post-money) when 1,000 paid reports a month and a cost to win a buyer of ₹800 or less are reached. About 11.6% in total.

**Correction to the pricing section above.** It said about 83–90% of the price was contribution and break-even was about 525 paid reports a month. Both left out two real costs: the AI research behind every free preview (about 12.5 searches per paid report, 30% needing fresh research, about $1 each), and the cost to win a buyer. Corrected: **about 66% of an average Indian report's price is contribution** (₹1,648 on ₹2,500), and **break-even depends on the cost to win a buyer**: about 980 paid reports a month at ₹600, about 1,340 at ₹800, over 5,300 at ₹1,200. The deck and demo script now say this. **Measure AI cost per paid report and the cost to win a buyer from the first week.**

**Earlier deck claims withdrawn:** the ₹1 crore ask, and "1,000+ paid reports a month" on ₹12 lakh of marketing. At the cost to win a buyer that India's click prices imply, 1,000 a month needs about ₹1 crore of marketing over the ramp.

## Languages, phase 1 (October 2026)

**What a buyer sees.** A language picker above the search: English, हिन्दी, العربية, Français.
- The browser's language is used if it's supported. A remembered choice and a shared link's language take precedence. Nothing is forced.
- Choosing a market whose buyers usually read another language offers it once ("इसे हिन्दी में पढ़ें").
- Arabic is right to left; the score scale stays a left-to-right number line.
- Every translated report says "Translated with AI. The English original governs", with a one-tap "Show English". Until a native speaker signs off, it also says the translation is unreviewed.
- **Prices are the same in every language.**

**How it stays accurate (`backend/engine/translate.js`).** Reports are researched and written in English, then translated sentence by sentence.
- **Only words are translated.** Marks, scores, sources, ids and prices never are, and they stay attached to the English finding.
- **Code checks every translation.** Every number, date, registration id, URL and e-mail must survive. No new number may appear. Project, developer and register names (MahaRERA, RERA, NSE, DLD…) stay in Latin script.
- **Failures fall back to English.** A failure is retried once, then that sentence shows in English, never a doubtful translation.
- **Sensitive claims get a second check.** Negative, legal, financial and registration claims get an independent meaning check by a second model call.
- **Each sentence is translated once.** Translations are cached in `translation_cache` (90 days) and reused by every report containing the sentence.
- **Translation never blocks a report.** No key, the daily cap (`TRANSLATE_DAILY_CAP`) or an outage all mean the report opens in English and says so.
- **The paywall decides first.** Translation runs after it: a preview is translated as a preview, never widened.

**Research in the local language too.** Each market's own languages are added to the research prompt (`engine/languages.js`, `researchLanguages`), for example "search in Polish as well as English". Local sources often hold the official record. Findings are still written in English, with names and ids exactly as the source gives them.

**The interface.**
- **Dictionaries:** `i18n/en.json` lists every string the page can show (the English text is the key). `i18n/hi.json`, `ar.json` and `fr.json` translate them: 216 strings each, AI-assisted.
- **Build:** `node tools/build_i18n.js` checks for missing, extra or broken entries and writes them into the page; `--check` changes nothing; `--init` refreshes en.json after adding strings.
- **Tests:** they fail if a string is untranslated, a {placeholder} breaks, a protected name is translated, or the page and files differ.
- **Legal text stays English.** The Terms, Privacy, Principles and Methodology pop-ups say they are English only and that the English governs, until a lawyer has reviewed a translation.

**The demo.** Hubtown Celeste is fully translated into Hindi (96 sentences) and Creek Bay Tower B into Arabic (60 sentences), in `tools/samples/translations/`. `build_samples.js` holds them to the same fact checks and refuses a translation that misses a sentence. The other samples show the honest fallback: the interface in the chosen language and the findings in English, with a note saying so.

**Measuring it.** `analytics_events.lang` records the reading language. The admin dashboard has a **Languages** panel: visitors, searches, unlock clicks and checkouts per language, plus search-to-checkout. That shows whether a language actually converts better.

**Deploying.**
- Run **migration 021, `backend/translations.sql`**, after the seven earlier ones. (Since pricing V1, nine migrations are required: see "Pricing and payments, V1".)
- Settings: `TRANSLATE_ENABLED`, `TRANSLATE_VERIFY`, `TRANSLATE_MODEL`, `TRANSLATE_DAILY_CAP`.
- `GET /api/languages` lists the enabled languages and each market's languages.

**Before calling a language finished:**
1. A native speaker reviews its dictionary and glossary (`GLOSSARY` in translate.js).
2. Then set `reviewed: true` in `engine/languages.js`.
3. Legal pages need a lawyer in that country.

**Next languages,** by unserved TAM: French is done; then Polish ($17M), Traditional Chinese for Taiwan and Hong Kong ($13M), Spanish ($9M), German for Switzerland, Czech, Dutch, and the Nordic and Baltic languages. Each needs:
- an entry in languages.js;
- a dictionary;
- a glossary;
- a native review.

**Not yet multilingual:** sample PDFs, e-mail and WhatsApp messages (not built yet), and the policy and trust pages.

## Languages, wave 2 (October 2026): Polish, Traditional Chinese, Spanish

The three largest markets whose buyers had no language of their own: Poland ($17.2M TAM), Taiwan and Hong Kong ($13.3M), and Spain ($8.9M).
- **Coverage:** **87% of the TAM can now read ShelterKart in its buyers' main language**, up from 64%.
- **What's included:** a dictionary for each (216 strings, AI-assisted, unreviewed), a glossary of key terms in `translate.js`, and a writing rule for Traditional Chinese (as used in Taiwan and Hong Kong).
- **Browser detection:** `zh-TW` and `zh-HK` browsers are mapped to Traditional Chinese.
- **Fonts:** Traditional Chinese system fonts were added to the page's font list.
- **What's left:** Switzerland (German), Czechia, Belgium (Dutch), Sweden, Norway, Denmark, Finland and the three Baltic states, $23M in total. Switzerland and Belgium are partly served by French meanwhile: the registry offers each market's enabled languages first.
- **Demo samples:** no sample is in these languages yet. They show the interface translated, with English findings and an honest note.
- **Before calling any of these finished,** a native speaker must review the dictionary and glossary; then set `reviewed: true`.

## Languages, wave 3: German; Casamia in Hindi

- **German** is enabled: 216 strings, a glossary, and a Swiss Standard German writing rule ("ss", not "ß"; formal "Sie"). It's Switzerland's main language and the largest market that was left without its own. **90% of the TAM can now read ShelterKart in its buyers' main language.**
- **Still to come:** Czech, Dutch (Belgium, which is offered French meanwhile), Swedish, Norwegian, Danish, Finnish and the three Baltic languages, about $17.6M of TAM in all.
- **Casagrand Casamia is now fully in Hindi** (71 sentences). 23 are shared with Hubtown, mostly the buyer protections and standard notes, and are reused rather than retranslated. Both Indian samples now work entirely in Hindi.
- **The penalty findings were checked closely.** The regulator penalties (₹30 lakh, ₹25 lakh, 2020, 2022) and the developer's denial pass the same fact checks as the rest, and a test confirms they survive in Hindi.

## Translation review: passed, checked by AI (October 2026)

The founder decided that ShelterKart runs without human reviewers. Every enabled language (Hindi, Arabic, French, Polish, Traditional Chinese, Spanish and German), plus the three translated samples, has passed an AI review. The full record is in **`i18n/REVIEW.md`**.

- **Mechanical checks** (`node tools/i18n_review/scrutiny.js`) cover numbers, names, placeholders, negations, question marks, leftover English, lengths and duplicates. They raised 26 flags; all were correct idioms.
- **A line-by-line read** of composed sentences, promises and every negative or legal finding found **10 real errors, all fixed**: gender and case agreement (French, German, Polish, Hindi), Spanish "de el" → "del", an Arabic prefix, German repetition, the Arabic and Chinese list commas, and **plurals**. Polish and Arabic now have 30 plural forms, chosen by the browser's plural rules.
- **The status is truthful.** Languages are marked `review: 'ai'` (the choices are `'none'`, `'ai'` and `'native'`). The page says "Translated and checked with AI. The English original governs." It never claims a native-speaker review. Live report translations say "checked automatically", which is what the server's checks do.
- **Limits:** the reviewer and the translator are both AI from the same family of models, so this catches errors of fact, grammar and meaning, not every idiom a native speaker would choose. Rerun the review for any new or changed strings before release.

## Pricing and payments, V1 (October 2026) — the model in force

The design was approved in the document "ShelterKart — V1 Pricing and Payments Architecture". **This section supersedes both earlier pricing sections**: `engine/pricing.js`, `PRICE_SCALE` and `RESEARCH_PRICES` no longer exist.

**The model.** A report's price is set by the **property** (its listed price, in dollars at the price book's frozen exchange rates) and the **evidence depth**. It is the same in dollars for every buyer. The buyer's country decides only the currency, the tax and the payment route. Prices are round numbers from a versioned **price book** (`backend/data/price-book.json`): 14 price points in each of 21 currencies, and a quote never uses a live exchange rate.

**Where things live.**
- **`backend/pricing/`:**
  - `data.js`: countries, tax profiles, the on-sale rule;
  - `buyer.js`: suggest, confirm, verify;
  - `quote.js`: fee, tax split, signed 30-minute quotes;
  - `ledger.js`: tax thresholds;
  - `invoice.js`: gap-free numbers;
  - `release.js`: the four guardrails;
  - `store.js`: memory or Postgres.
- **`backend/payments/`:** the provider-neutral layer, a Razorpay adapter, refunds.
- **Data, all reviewed release files:** `backend/data/countries.json`, `tax-profiles.json`, `currencies.json`, `payment-routes.json`, `price-params.json`, `fx-snapshot.json`.

**Turning countries on. With nothing set, nothing sells.**

| To sell in | Set | Notes |
| --- | --- | --- |
| India | `GSTIN` | Prices include 18% GST |
| Switzerland, Canada, Singapore, Australia, New Zealand, Norway, United States, Hong Kong | `RAZORPAY_INTERNATIONAL=true` once Razorpay activates international payments | Below their thresholds, so no tax is charged; the ledger warns at 70% and 90% and stops a country at 100% |
| United Kingdom | `UK_VAT_NO` | Registration required from the first sale (GOV.UK) |
| The 24 EU countries | `EU_OSS_VAT_NO` | One non-Union OSS registration |
| UAE, Saudi Arabia, Qatar, Bahrain, Oman, Taiwan | `TAX_PROFILES` override, after the tax adviser confirms the rule | Not verified |
| Iran, North Korea, Syria, Cuba, Russia, Belarus | — | Blocked |

`TAX_GATE=off` opens every country for local development only; it is ignored in production.

**The checkout.**
1. Unlock asks the server for a signed quote (`POST /api/research/quote`).
2. The checkout pop-up shows:
   - the property in its own currency, marked as not charged by ShelterKart;
   - the fee, the tax and the total, as separate lines;
   - the currency, the lock time and the billing country.
3. `POST /api/research/checkout` takes only `quoteId` and `billingCountry`. If the billing country differs, it returns `409` with a new quote; the page shows both totals and asks again.
4. The webhook settles a purchase only if the amount and currency **equal** the quote's total.
5. A card issued in India paying a foreign currency is flagged.

**Refunds.** `POST /api/admin/refunds { purchaseId, amount?, reason }`.
- Refunds are in the original currency and amount; tax is reversed pro rata.
- Net revenue and the tax ledger are adjusted.
- A refund can never exceed what was paid.

**Price changes.**
- `node tools/build_price_book.js --check-drift new-rates.json` tells you when the active book has drifted at today's rates.
- `node tools/build_price_book.js --version 2026-11.1 --fx new-rates.json` releases a new book, only if all four guardrails pass (margin, corridor, drift, step size).
- Open quotes and past purchases never change.

**Deploying.**
- Run **migration 022, `backend/pricing_v2.sql`**, after the eight earlier ones. **Nine migrations are now required.**
- Then run `node tools/seed_pricing.js` with `DATABASE_URL` set. It copies the reviewed release files into the reference tables for audit.

**Dashboard.**
- **Conversion by country:** visitor, search, unlock and checkout-start counts per country.
- **Tax exposure:** each country's twelve-month progress toward its threshold, and every country that is off, with its reason.

**For the tax adviser before launch:**
- the GST rate and accounting code for this service;
- the Letter of Undertaking (`LUT_NO`);
- splitting CGST/SGST from IGST, which needs the buyer's state (collected later);
- the rules for the unverified countries;
- whether to register in the UK and EU now, or wait for a Merchant of Record.

**Merchant of Record.** No adapter exists yet, and none should be built until a provider (Paddle or Dodo) accepts ShelterKart in writing. Both publish category rules that a due-diligence report sits close to.

**Known follow-up: the deck's market sizing still uses the retired per-market prices.** TAM, SAM, SOM and the valuation in `deck/model/market_model.py` should be recomputed under this model. That needs each market's typical new-home price, which is sourced only for India and Dubai today. Rich markets will likely show a lower average price per report.

**Update, 24 October 2026 (deck prices):** the investor model and deck now take India's price, the price ladder and the unit-economics prices from the active price book (`deck/model/prices_from_book.js`). Other markets still use scenario prices by design (a sourced typical new-home price exists only for India and Dubai). See `deck/INVESTOR_V2_NOTES.md`.

## AI engines: five vendors on equal terms, cheapest qualified first (October 2026)

**Four agents use an AI model:** research (three parallel passes with web search), the adviser, the document check, and translation with its meaning check. Each asks `backend/engines`, never a vendor.

**Five engines:** Anthropic (Claude), OpenAI (ChatGPT models), Google (Gemini), xAI (Grok) and DeepSeek. **No engine is preferred by name.** Anthropic was the default only because the first code was written on it. With only its key set, everything runs exactly as before.

**How an engine is chosen, per agent.** It must be:
- **set up:** its API key is set; the model is the per-agent setting, the engine setting, or the catalogue default;
- **able:** DeepSeek has no API web search and no image input; Grok and OpenAI read images but not PDFs here;
- **allowed:** the optional `AI_ENGINES` / `AI_ENGINES_<AGENT>` allow-lists;
- **approved for personal data, for the document check only:** `AI_PERSONAL_DATA_ENGINES`. It is empty by default, which keeps the check off until a lawyer approves an engine;
- **qualified:** once quality-gate results exist for that agent, only engines that passed are used.

**Ranking.** The router then sorts the qualified engines by expected cost per call:
1. measured on this server after five calls;
2. else the quality gate's measured cost;
3. else catalogue prices (`backend/data/ai-engines.json`).

The cheapest serves and the rest take over in order if it fails. `AI_ROUTING=order` uses the allow-list's order instead. Cheaper models per agent are a setting, for example `ANTHROPIC_MODEL_ADVISER=claude-haiku-5-5`. On catalogue prices, Haiku 5.5 makes that agent about twenty times cheaper than Sonnet 5.5.

**The catalogue** holds each engine's models, prices, search price, jurisdiction and data notes, checked 7 October 2026. Only Anthropic's prices were read on the vendor's own page; the others are marked unverified, from secondary sources quoting the official pages.

| Engine | Default model | Price in / out per million tokens | Search, per 1,000 |
| --- | --- | --- | --- |
| Claude | Sonnet 5.5 | $2 / $10 | $10 |
| Claude | Haiku 5.5 | $0.10 / $0.50 | $10 |
| OpenAI | GPT-5.4 mini | $0.75 / $4.50 | $10 |
| Gemini | 3.5 Flash | $1.50 / $9 | $14, after 5,000 free a month |
| Grok | 4.3 | $1.25 / $2.50 | $5 |
| DeepSeek | V4 Flash | $0.14 / $0.28 | no API search |

**DeepSeek, plainly.** As reported, its API data is processed and stored in China and used for training by default unless you opt out. The router never sends it a buyer's documents. Whether to allow it at all, even for public information about companies, is the company's decision through `AI_ENGINES`.

**Grounding is the same for every engine.** Each engine must hand back the pages its search used:
- Claude: its search results;
- OpenAI: `sources`;
- Grok: `citations`;
- Gemini: `groundingChunks`. Its Google redirect links are resolved to the real address, by hand, one hop, Google's host only, and both forms count.

A claim is kept only if it cites one of those pages. The score is computed by code. Translations keep every number, date, ID and URL, or fall back to English.

**The quality gate is the same test for every vendor:** `node tools/engine_benchmark.js --engine all`.
- **Research:** it runs the five sample reports and judges facts that are true whoever wrote them: the official registration number, the developer's legal entity, an official source, and claims removed by grounding (at most 30%). It does not judge resemblance to the stored samples, because one engine wrote those.
- **Translation:** `--role translate --lang hi` measures the fallback-to-English rate (at most 15%).
- **Output:** results go to `tools/benchmarks/results.json`, which the router reads.

**The dashboard** shows, per agent, the engines cheapest first with model, cost and basis, and why any engine is left out. Per engine it shows the jurisdiction, calls, failures, rescues, searches, tokens, time and cost.

**Before going live:**
- run the gate with real keys;
- set `AI_PERSONAL_DATA_ENGINES` as the lawyer advises;
- add every engine you allow to the privacy policy's list of processors;
- re-check the catalogue prices on each vendor's page.

## Blind-spot fixes, first round (October 2026)

From the blind-spot review, the most important problems that code can fix:

- **#1, never run for real.** `tools/migrate.js` applies the nine migrations in order, once each, in transactions. It records each in `schema_migrations` with a checksum and refuses to continue if an applied file was edited. `tools/smoke.js <url>` checks a real running server: health; real security headers; CORS refusing an unknown origin; the price book; the database; the payment webhook refusing a forged signature and accepting one signed over the exact raw bytes; and the real rate limiter. `.github/workflows/ci.yml` runs the logic tests, then the first real run: real dependencies, PostgreSQL 16, the migrations (twice, to prove nothing applies twice), the seed, the server and the smoke test. **There is no `package-lock.json` yet:** the first CI run must generate it, someone must commit it, and the pipeline then switches to `npm ci`.
- **#3, legal exposure.** `ADVERSE_HOLD_MARKETS` (for example `in,ae`, or `all`) makes a person check negative findings before a buyer sees them. Until then each one shows as "being checked", the score and "reading between the lines" are held, and the report cannot be quoted, so nobody pays for an incomplete report. The admin dashboard has a "Held for a person" card with the findings and their sources and a release button. The approval is stored inside the report, so no new migration is needed. Insurance, per-market lawyers and a notice procedure are still the founder's to arrange.
- **#4, right of reply.**
  - Replies and disputes now work with or without a database.
  - A reply must name a real report.
  - The reviewer sees which finding it quotes, and whether the sender's email domain matches the developer's own website. Look-alike domains and bare suffixes such as `co.in` never count as a match.
  - Approved replies are now **shown to readers** beside the finding they answer, in all eight languages. Before this, they were never displayed, although the corrections page promised it.
  - The public never sees the sender's address.
- **#5 and #20, cost attack and emergency pause.**
  - `RESEARCH_PAUSED=true` stops all new research, and `RESEARCH_MARKETS_OFF` stops it in particular markets.
  - `RESEARCH_DAILY_CAP=0` now pauses; it used to be read as 1,500.
  - Alerts fire at 50%, 80% and 100% of the day's allowance.
  - The per-connection default drops from 60 to 10 new researches an hour.
  - Bot protection, such as a challenge for first-time visitors, is still to do.
- **#21, error text.** No route returns raw error text any more.

**Tests:** two new suites, `ops.test.js` and `harness/review.test.js`: 586 checks in 17 suites.

## Blind-spot fixes, second round: validating the score, crediting the registers (October 2026)

- **#2, is the score valid?** `tools/validation/cases.json` holds 10 troubled and 10 clean Indian developers. Each label carries its public source:
  - **Troubled:** insolvency admitted, a cancelled registration, a court-supervised rescue, or projects under NCLT proceedings.
  - **Clean:** large listed developers with a public delivery record and no insolvency, cancellation or court takeover found.
  - "Clean" is a proxy, and the file says so.

  - **score detection:** troubled developers with a median score below 60;
  - **evidence detection:** a troubled report showing a corroborated negative finding;
  - **false alarms:** clean developers below 60;
  - **withheld rates** for each group;
  - **run-to-run movement and band changes.**

  The starting targets are 70% detection, at most 15% false alarms and a median movement of at most 10 points. They were set before any run. The tool writes `results-<date>.json` and a plain summary to publish, misses included. Every market added later needs its own 10 and 10.
- **#2, the band and its confidence.** The report already shows the confidence directly beneath the band; nothing needed to change.
- **#6, register licences are now credited.**
  - `backend/data/registers.json` lists the ten registers, the addresses that identify each, its licence and its credit line.
  - Every report gets an "Official records used in this report" section at its foot, computed from its own sources. It survives the paywall and appears in the demo: the UK sample shows the Companies House credit.
  - The Evidence page lists every register with its licence.
  - A test fails if a connector calls an address that has no credit entry.
  - The licence wording is marked unconfirmed until a lawyer checks it. The Taiwan usage notice is recorded as not yet sent.
- **Also found and fixed:** the Independence page still said a report's price "depends on the market". It now says the price depends on the project's listed price and the evidence depth, and the buyer's country decides only the currency and the tax.

## Bot protection: proof of work before new research (October 2026)

**What happens.** Before a *new* research, the visitor's browser solves a small puzzle: find a number that makes SHA-256(token + ":" + number) start with 16 zero bits.
- **For a person:** about 0.05 to 0.2 seconds in testing here, and around a second on a slower phone. It is invisible.
- **For a script** wanting thousands of new researches: it must pay that cost thousands of times.
- **Already-researched reports** never need it.

**Where it lives:** `backend/engine/botguard.js`, plus about 50 lines in the page. The page carries its own SHA-256, tested byte for byte against Node's, so no third-party script loads and nothing about the visitor is stored or sent anywhere.

**The rules:**
- **Puzzles** are signed by the server, last 5 minutes and are accepted once.
- **Difficulty** rises by one bit at 50% of the day's research allowance and by two at 80%.
- **The per-connection limit** now counts only searches that carry a solved puzzle, so a refused attempt never costs a visitor one of their 10 new searches an hour.

**Settings:** `BOT_GUARD` (on in production by default), `BOT_POW_BITS` and `BOT_SECRET`. The smoke test checks that the challenge route works on the real server.

**Honest limit.** This slows bulk abuse; it does not stop a determined attacker with real computing power. Together with the daily cap, the budget alerts and the pause switches, it bounds the damage. A third-party challenge (Cloudflare Turnstile, for example) can be added behind the same check if attacks are seen. It would load an outside script and share visitor data with that provider, so it should be a deliberate choice.

## Investor deck rebuilt, October 2026

The deck now has 30 slides. New: the three families of moat (logic and reasoning, technical, legal and structural), how hard the product is to copy, a sized scale slide, and a three-slide valuation. Refreshed: the status (604 checks, 17 suites), the risks, the roadmap and the sources, which are split in two.

**The valuation was re-based, and it fell.** The earlier fair value of ₹15 crore rested on one benchmark source. Three 2026 sources (Treelife, Cashfree, practitioner guidance) give a weighted fair value of **₹11 crore**. The deck therefore asks **₹15 crore post-money** (₹1 crore for 6.7%), expects ₹11–15 crore, and moves to ₹20 crore only on three proofs: the score validated, a Merchant of Record cleared, and the first real buyers. To change the ask, edit `ask`, `stretch` and `floor` in `deck/model/som_valuation.py` and rebuild; every slide reads them from there.

**Also corrected:** the status slide said "160 + 10 checks"; the SWOT cited "Indian seed funding down 37% in 9M 2026", which conflicts with Inc42's H1 2026 figure (seed up 18%), so it was replaced.

## ₹30 crore, the TAM and the 22-country plan (9 October 2026)

The question was whether the TAM had counted only one country and whether the valuation should be at least ₹30 crore. **The TAM already sums all 22 countries; India is 12.5% of it.** The model was tested for how large it could honestly be, and a country-by-country plan was added (`deck/model/plan.py`, `plan.json`).

- **TAM sensitivity:** ₹407 to ₹4,108 crore across $22–65 a report and 1–4 reports per purchase. The deck's base case is ₹1,328 crore ($40, 2 reports).
- **Four waves:** wave 1 India; wave 2 the UAE, UK and Singapore through the Merchant of Record; wave 3 nine markets with a language and a lawyer ready; wave 4 nine markets awaiting a language. Cumulative revenue at 5% awareness: ₹0.3, 1.1, 3.3 and 3.7 crore.
- **₹30 crore today is not supported:** it needs ₹141 crore of yearly revenue, 13.4% of today's SAM. It is supported as the price of tranche 2 once 1,500 paid reports a month across two markets, the validated score and a live Merchant of Record exist (8.9× the run-rate, inside the 2026 seed range).
- **Deck:** 32 slides. New: the TAM sensitivity and the country plan. Changed: tranche 2 is priced at ₹23 to 30 crore in two tiers; the ladder says why not ₹30 crore today; the ask no longer says Razorpay in dirhams or a Dubai launch in wave 1.

## The investigator and the questions-first report (13 October 2026)

**Built.** A goal-driven investigator replaces the fixed three-pass research for the new report (`backend/engine/investigator.js`):
every engine on the panel investigates at once (`engines.runEach`), Claude reads full pages (`web_fetch`), leads are followed in rounds,
a reviewer asks what a top lawyer, accountant, engineer and journalist would still check, and the panel writes the questions.
`backend/engine/dossier.js` merges what the engines found, keeps every unverified fact with its link and status, records disagreements,
links companies by shared people and e-mail domains, checks the area arithmetic, measures date gaps and prices a delay, and assembles
the questions with no cap. `backend/engine/dossierHtml.js` renders the report: questions first, reasoning shown, never a verdict.

**Routes (admin, pilot):** `POST /api/admin/investigate`, `GET /api/admin/investigate/:id`, `/events` (live), `/report` (the page).
Settings: `INVESTIGATE_CONCURRENCY` (2), `INVESTIGATE_PANEL_SIZE` (all engines), `DELAY_RATE_PCT` (the statutory delay rate in force),
`ANTHROPIC_WEB_FETCH=off` to disable page reading, `ANTHROPIC_WEB_FETCH_TOOL` to adopt a newer tool version.

**Celeste.** `tools/build_dossier.js celeste` builds the reference report from `tools/dossier/celeste.*.json` through the product code;
`tools/golden_check.js` scores any dossier against `tools/golden/celeste.expected.json` (13 must-find items, leads kept as leads, no verdict).

**Not yet done:** a live run with real keys (no network here); wiring the investigator into the paid flow; Plex fonts for PDFs; the two
other-country reference cases.

## The buyer flow for the questions-first report (13 October 2026)

**Built and tested end to end** (`backend/test/harness/buyer.test.js`, through the real routes with the AI, Razorpay and e-mail mocked):
1. **`/start`**: the buyer names the project; the existing proof-of-work check runs when `BOT_GUARD` is on.
2. **Free preview at `/r/:ref`**: the panel's first sweep only (`INVESTIGATE_PREVIEW_PANEL`, default 2 engines), so unpaid traffic stays cheap. It shows promise-versus-record, three questions and what is locked, priced from the price book at gold-standard depth (an unknown visitor is priced in the project's own country).
3. **Unlock**: the buyer leaves an e-mail and, optionally, a WhatsApp number, then pays through the **existing** quote, checkout, Razorpay verification and webhook. Each investigation is stored under a normal report ref, so there is no second payments path. The review hold applies: in a held market a person releases the report before it can be quoted.
4. **Paid completion**: `markPurchasePaid` calls `onReportPaid`, which continues the same investigation (lead rounds, reviewer, question writer). The full report at `/r/:ref?t=token` updates live until complete.
5. **Delivery**: when complete, the buyer receives an e-mail (Resend or Postmark) and a WhatsApp template message (Meta Cloud API) with the link; retried at 1, 5 and 30 minutes; status at `/api/admin/delivery`.
6. **PDF**: `/r/:ref/pdf?t=token`, printed by Playwright's Chromium on the server; without Playwright the page asks the buyer to print.

**Guards:** `INVESTIGATE_DAILY_CAP` (0 pauses), `RESEARCH_PAUSED` and market pauses, the same project reused for 30 days, the public event stream never carries paid content, tokens gate the full report and the PDF.

**Before going live:** install Playwright and its Chromium, and IBM Plex Sans and Fraunces, on the server; set `PUBLIC_BASE_URL`, an e-mail provider and `DELIVERY_FROM`; get a WhatsApp template approved by Meta with two body parameters (project, link); set `DELAY_RATE_PCT`; a first live run with real keys. Running investigations live in memory: a restart re-runs a paid report's investigation from the start (the preview and the payment are kept).

## The first live run (13 October 2026)

1. Copy `backend/.env.first-run.example` to `backend/.env.first-run` (ignored by git: it holds the API keys) and paste the five keys.
2. `node tools/first_live_run.js --check`: free; shows the research panel (Claude Opus 5.5, GPT-5.5, Gemini 3.1 Pro, Grok 4.5; DeepSeek cannot search) and the reviewer and question writer (Claude Opus 5.5, then GPT-5.5).
3. `node tools/first_live_run.js --dry`: free; runs the pipeline on stand-in data and writes every file.
4. `node tools/first_live_run.js`: the live run on Hubtown Celeste (Mumbai), The Kensington, Sutton Garden Square (London) and Creek Bay Tower B (Dubai). It stops itself at `FIRST_RUN_MAX_USD` ($75) as estimated from catalogue prices. Results: `tools/samples/live/`, with `summary.md` (counts, minutes, estimated cost per property, the Celeste pass-or-fail test).
5. Then delete the model lines and run again, to compare quality and cost with the cheaper default models before setting prices.

Delay rate: `DELAY_RATE_PCT=10.80` is SBI's three-year MCLR of 8.80% (effective July 2026, per BankBazaar) plus 2%; confirm on sbi.co.in on the day.

## Reference reports for London and Dubai (13 October 2026)

`tools/build_dossier.js london|dubai` builds reference reports from `tools/dossier/<name>.*.json` through the product code, priced in the buyer's own currency from the price book (London £42, Dubai AED 170, Celeste ₹4,300). Pass-or-fail tests: `tools/golden/london.expected.json` (11 items: planning DM2022/01764 and its variation, St George behind the Berkeley brand, the "Chalk Gardens" name, the building-safety gateways, piling from 16 July 2026, the former chalk quarry, 217 council homes, prices) and `tools/golden/dubai.expected.json` (9 items: DLD project 4198, completion 30 April 2030, 0.62% certified progress, the payment-plan and master-developer disagreements, Dubai Law 19 of 2017 default rules, escrow and Oqood). The first live run scores all three. The glance now shows any key fact the research names as a field, so the summary works outside India.
