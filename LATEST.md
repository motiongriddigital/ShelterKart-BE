# ShelterKart: what this release is (13 October 2026)

**The product is the report.** A buyer names a project; several AI engines investigate it independently, follow every
lead (the company that really sells, its people, cases, complaints, group finances), check the numbers, and turn it
all into the questions to put to each team at the developer. Every finding is linked and marked verified, reported or
inferred. The report never tells anyone whether to buy.

## What a buyer does
1. **Search** on the site (or `/start`). The anti-bot check runs, and the investigation starts.
2. **Free preview** at `/r/<ref>`, live until ready: who really sells it against the brand, marketing against the record, three questions, the price.
3. **Unlock**: e-mail (and WhatsApp, optional), then the existing quote, checkout and Razorpay payment.
4. **Full report** on the same page, filling in live while the paid investigation completes; **PDF** download.
5. **Delivery** by e-mail and WhatsApp when complete.
6. **Samples** for anyone: `/samples/celeste`, `/samples/london`, `/samples/dubai` (and `/pdf`).

## Where things are
| Part | Files |
| --- | --- |
| The investigator (panel sweep, lead rounds, reviewer, question writer, spending stop) | `backend/engine/investigator.js` |
| Reasoning in code (merge, conflicts, common control, area and date checks, delay cost, questions) | `backend/engine/dossier.js` |
| The report and the preview as pages and PDF | `backend/engine/dossierHtml.js`, `reportPages.js`, `pdf.js` |
| Selling it through the existing commerce | `backend/engine/dossierBrief.js`; routes in `backend/server.js` |
| Delivery (Resend or Postmark, WhatsApp Cloud API) | `backend/engine/delivery.js` |
| The website: search starts an investigation; samples link to the new reports | `shelterkart-frontend.html` (`REPORT_FLOW`, next to `API_BASE`) |
| Reference reports and their pass-or-fail tests | `tools/dossier/`, `tools/golden/`, `backend/data/sample-reports/`, `tools/samples/ShelterKart-Report-*.pdf` |
| The first live run (check, dry run, live with a spending stop) | `tools/first_live_run.js`, `backend/.env.first-run.example` |

## Commands
- Tests: `cd backend && npm test` (681 checks in 20 suites on 2026-10-15). `python3 tools/count_checks.py` runs them all and records the counts the investor deck quotes.
- Rebuild a reference report: `node tools/build_dossier.js celeste|london|dubai`; score it: `node tools/golden_check.js tools/samples/dossier-<name>.json tools/golden/<name>.expected.json`.
- First live run: see `backend/.env.first-run.example` (`--check`, `--dry`, then live).
- Translations: `node tools/build_i18n.js` after editing `i18n/*.json`; copy gate: `python3 tools/check_copy.py shelterkart-frontend.html`.

## Before going live
Install Playwright with Chromium, and IBM Plex Sans and Fraunces, on the server. Set `PUBLIC_BASE_URL`, an e-mail
provider and `DELIVERY_FROM`, a Meta-approved WhatsApp template (two body parameters: project, link), and
`DELAY_RATE_PCT`. Then do the first live run with real keys, and compare quality and cost with the cheaper models
before fixing prices. Everything else on the original launch checklist in `LAUNCH.md` still applies.

## Known limits
The investigator's own pages (`/start`, `/r`, `/samples`) and the reports are in English; the main site's eight
languages are unchanged. Running investigations live in memory, so a restart re-runs a paid report's investigation.
The reference reports were built from research gathered by hand with the same method, not by a live run. The
WhatsApp API version in the settings was not confirmed as current.

## Markets added (October 2026)
36 markets on the website and backend, each with a drawn flag, running largest first. All 36 are sized: TAM Rs 2,655 Cr (range 2,463–2,672), SAM Rs 2,160 Cr; two sizes are estimates (South Africa, the Philippines). Seventeen country playbooks in `backend/data/playbooks.json`. Detail: `deck/MARKETS_ADDED.md`. Recommended: `ADVERSE_HOLD_MARKETS=in,us`.

## Investor deck v2 (October 2026)
`deck/ShelterKart-Investor-Deck-v2.pdf` (32 slides), built by `deck/build_deck_v2.py` from `deck/model/investor_v2.json`; `deck/check_deck_v2.py` checks the PDF against the model. The earlier deck and model are kept. Notes, the ask and what to confirm: `deck/INVESTOR_V2_NOTES.md`.

## Languages (October 2026)
Nine languages: English, Hindi, Arabic, French, Polish, Traditional Chinese, Spanish, German and Japanese (AI-checked, recorded in `i18n/REVIEW.md`). After a country is chosen, a row offers every language of that market we have, English included (India: Hindi or English; Japan: Japanese or English; the US: English or Spanish); every one of the 36 markets has its languages in `backend/engine/languages.js`, which also makes research search local-language sources (Japanese, Portuguese, Thai). Reports stay in English; the site says so.

- **Checkout shows only the report's charges.** The property's value (the midpoint of the listing's range) still sets the price, and it is kept in the server's pricing record, but it is no longer sent to the page or shown at checkout. The checkout lists the report fee, the tax and the total.

## Merchant of Record (October 2026, round 6)
- Decision (from the chat history): sales outside India go through a Merchant of Record (Dodo Payments, 5.5% + $0.40, already in the price model). The merchant is the seller of record and handles the tax, so no ShelterKart tax registration is needed in those markets.
- Code: the sale check now honours an enabled merchant route for every listed market except India (India stays on its own GST registration). Sanctioned countries stay blocked. The route is still OFF in the data until the provider approves and an adapter is built. Tested in backend/test/mor.test.js.
- Still before day one: written approval from the merchant; the merchant adapter (checkout, webhook, refunds); confirmation that the merchant serves all listed markets (the route currently says all); the quote and invoice must show the merchant's tax, not ShelterKart's; India's GSTIN; FX rates for the seven unpriced markets from one official reference source, not web snippets (search results disagree, e.g. MYR 4.08 to 4.70 per USD).

## Merchant of Record built; handover document (October 2026, round 7)
- **Merchant adapter** (`backend/engine/mor.js`, Dodo Payments): hosted checkout for exactly the quoted total, Standard Webhooks verification (replay, tampering, duplicates), the buyer's return settled from the merchant's own records, refunds. Opens a market only when both keys are set, the currency has a product, and the country is not India. A currency with no product is quoted in US dollars (a USD product is mandatory).
- **No double tax:** where the merchant sells, ShelterKart adds no tax, even if the company later registers. The checkout says any tax is included and shown on the receipt (nine languages). Merchant sales get no second invoice, no sales-ledger entry and no registration-threshold count; their refunds are not reversed in the ledger.
- **Seven markets** (Malaysia, South Africa, Brazil, Mexico, Japan, Thailand, Philippines) added to the pricing data, quoted in US dollars until local ladders are released. **Readiness:** 0 of 36 today; 35 of 36 once the merchant is live (India waits for GSTIN).
- **Tools:** `tools/fetch_fx.js` (official ECB rates to a candidate file), `tools/mor_sandbox_check.js`, `tools/market_readiness.js`. **Tests:** `test/mor.test.js`, `test/harness/mor.test.js`, `test/tools.test.js`, `test/tiers.test.js`, `test/coverage.test.js` (859 checks in 37 suites, none failing).
- **HANDOVER.md** is the document for the developer team: how a sale works, the ordered go-live checklist, what could not be verified without credentials and the command that verifies each, open decisions, commands.
- The price book is 2026-10.2 (every price point 41.7% to 54.9% above the previous book). Exchange rates are dated 26 June 2026 and need a refresh before live prices.

## Pricing, tax and market readiness (October 2026, round 5)
- **Price book 2026-10.2 is active.** Every price point is 41.7% to 54.9% above the previous book (one recorded release exception). The depth rule (findings counts) is in force.
- **Site tests updated** to the approved prices. The page's checkout arithmetic is checked (2,627.12 + 472.88 = 3,100).
- **Market coverage test** (`backend/test/coverage.test.js`): fails for seven markets with no price, tax profile or currency: Malaysia, South Africa, Brazil, Mexico, Japan, Thailand, Philippines.
- **Market readiness** generated from the data (`tools/market_readiness.js`, output `ShelterKart-Market-Readiness.md`): 0 of 36 markets can take payment today. The tax gate refuses sale where registration is required (17), where no payment route exists (8), where tax is unverified (3), where India's GSTIN is missing (1), and where the market is not in the pricing data (7).
- **Open:** 28 tax profiles are not verified; the FX snapshot is dated 26 June 2026; the depth rule can lower a report's price on a tier change (two sample reports rise under 40%).

## Microphone and readability (October 2026, round 4)
- **Microphone access is requested on the page.** The first click shows "Allow microphone" in the search box; that starts the browser's own permission prompt. If the microphone is blocked, the page explains how to switch it on (the lock icon in the address bar, Microphone set to Allow) and offers "Try again", which works without reloading the page, and "Type instead".
- **Readability of every state.** The voice panel and the results dropdown set their own ink on white. They no longer inherit the navy card's light text. The previous version measured 1.24:1 in the voice messages; the requirement is 4.5:1.
- **Readability is now tested everywhere a visitor goes.** `tools/search_readability.py` checks every search state, including every microphone state. `tools/readability_sweep.py` checks the home page, search results, a record, the report preview (inside its shadow root, 85 pieces of text), the checkout, every window and the Arabic home page. Both are in the suite.
- Corrected in the tests: the sweep and the check now measure gradient backgrounds properly (the first run flagged a navy card that was fine).
- Not verifiable here: real permission prompts on real devices, and the browser's behaviour after a permission is changed.

## Search, voice and demo (October 2026, round 3)
- **Dropdown:** closed as soon as it opened, because an outside-click rule treated the Search button as outside the search. Fixed: the whole search card counts as the search. Results now sit in the page flow, between the field and the Search button, so the button is never covered. The phone keyboard's return key says Search.
- **Voice:** the microphone is always shown. Where voice cannot work, the buyer is told why (secure page needed; browsers that support speech; microphone blocked; no microphone; no speech heard; speech service unreachable). Heard words are still confirmed before any search.
- **Demo search:** illustrative records (labelled as not real projects): a name with several matches grouped by country with counts and a best match; a spelling suggestion; developer-and-area matching; a record's details; an honest "not in our records yet" for unknown names. The three real sample reports are unchanged.
- **Tests:** `tools/demo_search_test.py` (new), `tools/voice_test.py` (updated); both in the suite, with the site test updated for the not-found answer.
- **Not in the demo, and not verifiable here:** live research on real projects, real registers, real payment, live e-mail and WhatsApp delivery, real speech on real devices.

## Voice search (October 2026)
- A microphone sits in the search box. Where the browser supports speech recognition on a secure page, the button shows; elsewhere it stays hidden and typing works as before.
- What the buyer says is shown back as "Did you mean “...”?" with "Search this" and "Edit". Nothing is searched until the buyer confirms. The text is shown as plain text, never as markup, and is capped at 120 characters.
- The page states that the browser turns speech into text and that ShelterKart does not record the voice. ShelterKart stores only the search text, under the same rules as typed searches.
- Tests: `tools/voice_test.py` (12 checks, with a stand-in for the browser's speech recognition), in the suite.
- Not yet verified: real speech on real devices, accents, and Hindi and mixed-language speech. These need testing with real people before launch.

## Layout audit (October 2026)
- `tools/layout_audit.py` checks the website at 360, 390, 768, 1024, 1280 and 1920 px on the home page, the report preview and the checkout: sideways scrolling, edge clipping, controls under 44 px, and overlapping text. It is in the test suite.
- Fixed: language selector, city chips, checkout country and close controls raised to 44 px; the share button in the guide card is level with its neighbours and not underlined; the billing country dropdown is full width like the fields beside it.
- Result: no sideways scrolling, no clipping, and no control under 44 px at any width. The only remaining flag is the two lines of the headline, which touch by design.
- Not changed: the first screen, the independence wording, and the gold decoration.

## First screen (October 2026): reverted
The first-screen reordering and the flat-navy hero made in an earlier round were reverted at the owner's request. The first impression is the original: the emblem, then the country flags (the global appeal), then the search. The readability fixes for faint text on the home page are kept. Any change to the first screen needs the owner's approval first. Ideas not yet built: show more countries on the first screen; bring the guide card higher.

## Developer right of reply (October 2026)
- Every finding in a full report (the paid report, and the published samples) now has a "Developer Right of Reply" link. It opens the reply window with that finding's text filled in and the report's own reference. Before this, the reply window was reachable only from code: no visible control opened it.
- Checks: `ops.test.js` (every finding has a link that carries its report reference) and `tools/ui_smoke.py` (after payment, the link opens the reply window with the finding filled in).
- Not yet decided: the colour changes (reduce gold, lighten the home hero). Waiting for approval.

## Fix: four windows could not be opened (October 2026)
Removing the share block from the checkout also deleted the checkout window's two closing tags. From then until this fix, the Restore, Reply, Terms and Privacy windows sat inside the hidden checkout and could not be opened. The tags are restored, and two checks now guard against it: `tools/check_markup.py` (no window inside another, every opened window exists and has its own close button, block tags balanced; it fails on the broken copy) and `tools/ui_smoke.py` (a browser opens and closes every window, checks every visible text for contrast, restores, opens the guide and every sample report, completes a purchase to the full report, opens Terms in Hindi and Arabic, and fails on any script error). Both run in the test suite.
Also in this pass: three faint text items on the home page raised to readable contrast, and the hero icon given a one-time entrance (its outline traces in, then the fold and lines appear; nothing loops; none under reduced motion) to replace the old seal's animation.

## Brand system (October 2026)
- **One source:** `brand/tokens.json` holds the name, the tagline ("Peace of mind, on the record."), 17 colours, the two font families (Fraunces for headings, Instrument Sans for reading text, both with their OFL licences in `brand/fonts/`), the type scale, radii, icon stroke and motion rules. No surface may define its own colour, font or logo.
- **Builder:** `python3 brand/build_brand.py` checks every text colour pair for contrast (it stops below 4.5:1; the lowest is 5.1), then writes `brand/dist/`: `tokens.css` and `tokens.inline.css`, the icon (closed page, level base, gold folded corner) for paper and navy, the app icon, the lockups with and without the tagline, the favicons (32, 180, 192, 512) and the share card (1200 x 630). It copies the favicons to `icons/` and the share card to the site root.
- **Gate:** `python3 brand/check_brand.py` reports every surface's off-palette colours, other fonts and traces of the old logo; with `--strict` (in the test suite) it fails if a migrated surface breaks the system.
- **Migrated:** the website (V2), the guide (web and PDF), the sales-office card, the share card and the favicons. The website is moved by `python3 brand/apply_frontend.py` (idempotent; run it after any brand change): it embeds the tokens and both fonts (no Google Fonts), points the site's 46 colour variables at the tokens, maps every other colour to its nearest brand colour (flags excepted; decorative tints never borrow a status colour), sets every font to the two brand families, replaces the old shield and seal with the brand icon, and sets the tagline "Peace of mind, on the record." in English everywhere (left to right inside Arabic) until a native speaker has checked each translation. Its structured data now names the tagline and all 36 markets. The three labels around the hero icon are unchanged.
- **Not yet migrated** (counts from the check): the report pages and their PDFs, the investor deck and the static pages. The old shield files remain in `deck/img/` until the deck is migrated.

## Sharing (October 2026)
- **The sales-office card** (`guide/build_card.py`): Appendix A on one A4 page, as a PDF (for printing) and a PNG (for sharing). It reads its 25 questions from the guide's source, and the build fails if the card does not fit on one page. Served at `/guide/card.pdf` and `/guide/card.png`.
- **Sharing the guide:** the guide's bar has a Share button, and the home page's guide card has "Share the question card". Both open WhatsApp with the guide's address. Shares from the home page and from the reader are counted as `guide_share`, with the place they came from. Nothing personal is stored.
- **Preview images:** the guide's shared link shows the card as its preview image (when `PUBLIC_BASE_URL` is set).
- **Measure:** the summary reports `guide_shares` next to `guide_opens` and `guide_downloads`. The share rate is decided from the closed beta, not assumed.
- Tests: `backend/test/harness/guide.test.js` (card on one page, all 25 questions present, routes, share link, counting).

- **Checkout carries nothing but the charges and the Pay button.** The general share block that was briefly placed below Pay is removed: the question card must not appear at the moment of decision. The share on the success screen after payment remains a candidate for after the first beta.

## Operations (October 2026)
- **Search:** `/robots.txt` keeps reports, previews, the API and admin pages out of search. `/sitemap.xml` lists the public pages and the three published samples, and needs `PUBLIC_BASE_URL`. The independence page is left out until its claim is restored.
- **Sharing:** every report and preview has share tags (title, description, preview image). Reports and previews carry `noindex`; the published samples are indexable.
- **Operator alerts:** set `OPS_ALERT_EMAIL` (and an e-mail provider). The operator is alerted when a paid report fails, and when a report cannot be delivered after every retry. Without the address, alerts are written to the server log only.
- **Backups:** `ops/backup.sh` (nightly: the database with pg_dump, and the server's saved files; 14 days kept). Set `BACKUP_DIR` to a location off the server.
- **Restore drill:** `ops/restore_drill.sh` restores the newest backup into a scratch database and checks the tables. It must be run and recorded before live payments. It has NOT been run yet: this build environment has no Postgres tools.
- **Not yet done:** the saved-investigation store is still file-based and works for one server only. A database-backed version is needed before running more than one server.
- Tests: `backend/test/harness/ops.test.js`.

## Money and scale controls (October 2026)
- **Free preview is shallow:** one engine, 6 searches, 2 page reads (`INVESTIGATE_PREVIEW_PANEL`, `PREVIEW_SEARCHES`, `PREVIEW_FETCHES`). It was up to 2 engines, 50 searches and 24 page reads.
- **Per-report AI cap:** a paid report stops spending at 30% of its net price (`AI_CAP_SHARE`), measured per call from the catalogue (`engine/jobCosts.js`).
- **Saved investigations:** every job is written to `LIVE_JOBS_DIR` (`engine/jobStore.js`). After a restart, finished previews stay reusable for 30 days and paid reports still running resume from their saved state, so research is never paid for twice.
- **Limits:** a per-market daily cap (`INVESTIGATE_MARKET_DAILY_CAP`, default 40% of the daily cap), a daily spend alert and a hard stop for new free previews (`AI_DAILY_ALERT_USD`, `AI_DAILY_MAX_USD`). Paid reports always continue.
- **PDFs:** one browser reused, at most `PDF_CONCURRENCY` (2) at a time, the rest queued.
- **A delivery failure no longer marks a finished, paid report as failed.**
- **One investigation per project, however it is typed:** the reuse key ignores word order, case, punctuation and filler words (`engine/dossierBrief.js`).
- **One investigation per registered project:** once a report is complete, its registration numbers point to it for 30 days; a later buyer of the same registered project (found under another name) gets that report with no new AI cost.
- **Without a database, report links survive a restart:** saved reports are put back in the report store at start. Production should still set `DATABASE_URL`.
- **Cost view:** `GET /api/admin/costs` shows today's spend by market, each report's cost and cap, the average per paid report and the queue.
- Tests: `test/harness/scale.test.js` (including a real restart in a second process) and `test/pdf.test.js`. The file store suits one server; several instances need a database.

## Home Buying Guide (October 2026)
`guide/` builds the free guide in two forms from one source: a self-contained web page and an A4 PDF (44 pages). It is part of the customer flow.
- **Source and build.** Text: `guide/content/part1.md` to `part5.md` (founder page, how to use, Chapters 1 to 12, Appendices A to C). Design: `guide/guide.css`. Builder: `python3 guide/build_guide.py --final` (without `--final` the cover and footer say "Draft for review"). It also copies the two files to `backend/data/guide/`, where the server serves them.
- **The PDF** has a running chapter title in every footer, 43 clickable bookmarks, a tagged structure for screen readers and document properties. The founder page carries the name only.
- **In the website:** a "Free guide" card under the search (read it, or Download PDF), a "Home Buying Guide" footer link, and a reader window that holds the guide on the page. Reports carry a short guide box (preview and full report; hidden when printed) whose links open the reader at the chapter they name. The guide is embedded in the page like the sample reports: `python3 guide/embed_in_frontend.py` after every guide build (`--check` verifies). Where the page is opened on its own, Download PDF opens the browser's print dialog for the same PDF; on the server it downloads the file.
- **Server:** `GET /guide` (the page) and `GET /guide/pdf` (the download). Fonts as `data:` URIs are allowed in the content-security settings for the guide's headline font.
- **Checks:** `python3 guide/check_guide.py` (every source line is in the finished guide); `backend/test/harness/guide.test.js` (routes, chapter structure, no company names, no promises, the report links); the site test covers the card, the reader and the embedded copy. The guide is in English; the card text is translated into all nine languages.
- **Counted:** two analytics events, `guide_open` (detail = the chapter, or `start`) and `guide_download`, appear in the analytics summary as `guide_opens` and `guide_downloads`. Nothing personal is stored.
- **The name printed on the legal pages** (`RESPONSIBLE_NAME`, backend/engine/research.js and .env.example) is now "Preeyancc". Older seed files still carry the earlier spelling "Preeyanck" (backend/*_reviews.sql, editor_default.sql, tools/samples/ae.json and uk.json, the earlier deck): change them if you want one spelling everywhere.
- **The deck's headline font** now loads from `deck/fonts/` inside the project, not from a folder outside it.
- **Cleanup (October 2026):** removed the unused company and project scoring functions and the verdict labelling function from `server.js`. They were never called, contained hard-coded values, and produced verdict labels (such as "Trusted") that the no-verdict rule forbids. `.env.example` now documents `PRICING_STORE`. The name is spelled "Preeyancc" everywhere except the frozen V1 file.
- **Before it is published:** counsel's review of the market-specific legal points. The home page, the report notice and the Independence page still make independence claims; hold those until the founder's last working day.
