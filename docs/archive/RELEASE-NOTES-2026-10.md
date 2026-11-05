# Release notes: the marketing desk (26 Oct 2026)

**The new search (31 Oct 2026).** backend/search: candidates before research, matched however the buyer typed (typos, sound-alikes, Hindi and Arabic script, registration numbers, phases, developer or area only, former names), with confidence labels and a reason per candidate; honest not-found with "tell us what you remember" and research anyway. Runs in SHADOW by default beside both search routes (the live investigator included); the candidate screen is built behind SEARCH_V2=on and translated into all nine languages, awaiting the founder's approval. The search dropdown's hint text is now 15 px (was 13). 37 messy test queries: right project first 30/30, never confidently wrong. Suite 1,253 checks in 51 suites, all passing; 13 browser checks in tools/search_ui_check.py. See SEARCH.md.

**Consent for the visit's source (29 Oct 2026).** Visitors in the EEA, the UK and Switzerland, and any whose country cannot be told, are now asked before the page keeps the campaign source on their device or sends it with an order: a two-button choice ("Allow" / "No thanks") in the existing notice's style, translated into all nine languages, remembered across visits. Others are only informed. New endpoint /api/source-consent; setting SK_SOURCE_CONSENT (eu / all / none). The banner's buttons are now at least 44 px tall (the existing OK button was 42). Privacy text updated on the site, privacy.html and legal pack clause 7.4 (questions for counsel). 7 server checks added to the suite (now 1,225 checks in 49 suites, all passing); 16 browser checks in tools/source_consent_check.py (run separately). The suite caught one test that assumed a single notice banner (tools/ui_smoke.py), fixed. Deck v5.15.

**Privacy wording kept true (29 Oct 2026).** The site's privacy section and privacy.html now say that, while a visit lasts, the browser keeps a note of the campaign link or website that brought the visitor (session storage, cleared when the tab closes, no identifier), that it is sent with an order, and that the purchase record keeps the visit's source and the property's market. The final legal pack has a matching clause 7.4, with a question for counsel on whether this needs consent or only notice (DPDP Act; GDPR and ePrivacy for buyers abroad). English only: the privacy text is not translated. Suite unchanged at 1,218 checks, all passing.

**Paid reports traced to their channel (29 Oct 2026).** The site sends the visit's first-page source (UTM tags and referrer) with the checkout; the checkout saves it with the property's market on the purchase (new migration purchase_attribution.sql, the twelfth); the paid event carries both. Before this, paid events carried no market either, so per-market paid counts on the dashboard would have been 'unattributed'. The dashboard now shows paid reports per channel, decides scale / hold / stop per channel, and computes Phase 2 payback. Best effort: a database without the new column loses the trace, never the payment. Run the migration before deploying. The suite is 1,218 checks in 49 suites, all passing; deck v5.14.

**The marketing dashboard (29 Oct 2026).** /admin/marketing, behind the admin login, built from the launch strategy's "Metrics, dashboards and decision triggers": this week's calls (pause everything, the Phase 1 gate's five conditions, scale / hold / stop against the cost ceiling, Phase 2 readiness, the budget rule), the seven weekly numbers for the four anchor markets and all 36, early warnings, the repeat-change-stop list, the monthly ranking per hour of effort, and the founder's inputs (kept in the desk's durable store). Targets are refused until two weeks of baseline exist. Known gap, shown on screen: payments carry no source tag, so cost per paid report and payback are per market, not per channel. 13 new tests; the suite is 1,212 checks in 49 suites, all passing; deck v5.13.

**All 36 markets searched (28 Oct 2026).** Thailand, the Czech Republic and Lithuania were searched and returned only law-firm, content-site and academic pages, so each is recorded as 'researched, nothing postable' with the official places to look next. The research file stands at 285 labelled facts in 30 markets with facts; 8 markets have nothing postable (Malaysia, Belgium, Taiwan, Estonia, Latvia, Thailand, the Czech Republic, Lithuania; Belgium and Taiwan have labelled facts that are not safe to post). The deck's knowledge slide now says 'markets with facts' so the two cards do not overlap; deck v5.12.

**Latvia (28 Oct 2026):** searched, nothing usable found (no Latvian official page on buying a new home surfaced; the only Latvian official item concerned temporary-use contracts). Recorded as 'researched, nothing postable' with the official places to look next (likumi.lv, PTAC). The deck's nothing-postable card now lists five markets (Malaysia, Belgium, Taiwan, Estonia, Latvia). Counts unchanged: 285 labelled facts in 30 markets. The deck is v5.11.

**Norway (28 Oct 2026):** researched from the Norwegian Parliament's amendment decisions and committee reports and a Ministry consultation notice, all as search excerpts (8 facts: the contractor must provide a guarantee, immediately after the contract and before building starts, lasting five years after handover; the consumer may terminate if it is not documented; advance payments need a separate guarantee; it cannot be waived; a five-year complaint period). The guarantee PERCENTAGES are deliberately not stated: sources disagree (3%, 5%, 10%) and the Act's current text on Lovdata was not found. The Parliament and Government are two more hosts awaiting approval (eighteen in all). The research file has 285 labelled facts in 30 markets; the seed file covers 29 markets and 105 addresses; the deck is v5.10.

**Denmark (28 Oct 2026):** researched from a Danish municipality's fact sheet on the mandatory construction-damage insurance (9 facts, opened in full: 10 years, serious damage such as mould, roof leaks and radon, inspections at years 1 and 5, paid through the developer, in force from takeover). It is one local government's document, not the national authority's page or the Building Act, so those are listed as leads; the municipality (svendborg.dk) is a sixteenth host awaiting approval, marked 'approve with care'. The research file has 277 labelled facts in 29 markets; the seed file covers 28 markets and 102 addresses; the deck is v5.9.

**Sweden, and the keeper stops reading menus (28 Oct 2026).** Sweden researched from Boverket's handbook on economic plans for tenant-owner associations (5 facts: one from a page's description line that was opened, four from search excerpts; the regulations are being replaced from 1 January 2027; the completion protection was not found; Boverket is a fifteenth host awaiting approval). The page's body sat under a navigation menu of several hundred links, which exposed a real weakness: the keeper's text extraction kept every menu, sidebar and footer, so a long menu could fill its whole reading budget. It now drops navigation, sidebars, forms, headers and footers and prefers the page's main content (two new tests; three test fixtures moved from the footer into the main content). The research file has 268 labelled facts in 28 markets; the seed file covers 27 markets and 99 addresses; the suite is 1,199 checks in 48 suites; the deck is v5.8.

**Finland (28 Oct 2026):** researched from the Finnish Competition and Consumer Authority's English page on collateral for new-build housing (10 facts, opened in full: the three-layer guarantee system for apartments sold during construction). The Housing Transactions Act is being amended in 2026, which is listed as unconfirmed. KKV is a fourteenth host awaiting approval. The research file now has 263 labelled facts in 27 markets; the seed file covers 26 markets and 97 addresses; the deck is v5.7.

**Keeper reads the right part of a long document (28 Oct 2026).** A seed can carry up to 8 focus words per address (seeds file `focus` object, or the seeds route); for a document too long to read in full the keeper then reads the four chunks that mention them most, in document order, instead of the first four. Every source in a run report now carries `coverage` (chunks read of the total, focus used, focus matched) and is marked `partly_read` when it was not read whole. Estonia is seeded with focus words that are GUESSES (Riigi Teataja is a thirteenth host awaiting approval). The suite is 1,197 checks in 48 suites, all passing; the deck is v5.6.

**Estonia (27 Oct 2026):** researched, no fact ready. Riigi Teataja publishes the Law of Obligations Act in English, but the section on a consumer's burden of proof was not reached, and the two-year presumption was seen only on a law firm's page. Recorded as 'nothing postable'; the deck's card now reads that list from research_state.json (4 markets: Malaysia, Belgium, Taiwan, Estonia).

**Knowledge base, Wave 3 begun (27 Oct 2026).** Brazil researched from the Presidency's official text of Law 13.786/2018 (16 facts, opened in full; the 2018 text, amendments not checked). Italy researched from the ORIGINAL 2005 text of Legislative Decree 122/2005 hosted by CONSAP (12 facts; the decree was reformed in 2019, so every Italian draft must be checked against the current law on Normattiva; CONSAP is a tenth host awaiting approval). Netherlands researched from the government's information point (IPLO) page on the Wkb handover dossier (8 facts, opened in full; the contractor's liability after delivery is unconfirmed; IPLO is an eleventh host awaiting approval). Portugal researched from the full Official Gazette text of Decree-Law 84/2021, as a PDF copy hosted by a construction trade association (15 facts, opened in full: a 10-year warranty for structural defects and 5 years for others on homes, from contracts after 1 January 2022; AICCOPN is a twelfth host, marked 'decide' because it is not a public body). The research file now has 253 labelled facts in 26 markets; the seed file covers 24 markets and 94 market-and-topic addresses. The deck (v5.5) and the rebuild-cost estimate read the counts from deck/model/research_state.json, which now has three waves.

**Investor deck v5.0 (27 Oct 2026).** 48 slides. (1) ShelterKart is a private limited company: the structure slide, status, roadmap and sources no longer say a One Person Company must convert. (2) Ten moats listed on two slides with their evidence and status. (3) TAM, SAM and SOM walked step by step, with sanity checks. (4) New model deck/model/pnl.py: unit economics per paid report, and a five-year P&L (revenue, gross profit, EBITDA, tax, PAT) for the four scenarios, with a sensitivity table; every figure is checked for arithmetic by check_deck_v2.py. (5) Revaluation: same method, factors re-scored on what was built, Berkus 7-11, rebuild cost 37.6 person-months (32 earlier + 2.6 measured from code size + 3.0 estimated research); fair value 11.9 to 12.2 crore (+2.4%), ask held at 15 crore post. A slide shows what 10, 15, 20 and 30 crore would each ask of an investor. v4.0 and earlier decks are untouched; the v4.0 builder and model are in deck/_before_v4.

**Investor deck v4.0 (27 Oct 2026).** 38 slides, rebuilt for today: four new slides (Languages, The knowledge record, Always-on growth, Why we believe this works), a rewritten Status slide, two new risk rows (a wrong claim at scale; research out of date), and go-to-market reworded for an organic phase zero. Fixed a bug where slide 14 printed the valuation (11.88305632179272) where an average price belonged: the price blend and the valuation shared one variable name. The number check now finds slides by title, checks every new number against deck/model/research_state.json, and fails on any unrounded number. Earlier decks (v2 to v3.8) are untouched; the v3.8 builder is kept in deck/_before_v4.

**Update 2, same day: Wave 1 research and the keeper's reach.** A research file (Claude Doc, "ShelterKart: the knowledge universe, Wave 1 research file") covers 10 of the 13 Wave 1 markets with 90 facts read from official pages, each labelled Opened / Search excerpt / Not confirmed. `backend/social/data/seeds-wave1.json` and `tools/social_seed.js` load those addresses into the keeper. The keeper now reads PDFs (needs `pdftotext`) and long documents in chunks, because 4 of the 10 primary sources are PDFs. It also decodes pages by their declared character set, because Japan's ministry pages are in an older encoding and were read as garbage. Its number check reads numbers spelled out in words (cinco, fünf, trente-cinq, 五年), so a correct fact from a Spanish, French, German, Polish or Japanese source is no longer rejected for writing a number in letters. It also reports human-verification pages as blocked instead of drafting from them. The government hosts the keeper's rule does not match are now in one reviewed list (official-hosts.json) with a recommendation for each; nothing is approved by default, and the seed loader sends only the hosts a person has approved. KEEPER_FIRST_RUN.md is the checklist for the first run against real pages and real models. The research file now covers 12 Wave 1 markets plus Germany, France, Spain and Japan from Wave 2 (169 labelled facts, with Poland and Mexico added later the same day).

**Update, same day: the knowledge keeper is built** (`backend/social/keeper.js`): drafts facts from official pages with word-for-word quotes, an independent second model checks, rechecks before expiry, drafts translations (never self-approved). Run only against a fake web and fake models. The screen has a new section, "The facts behind the posts".

**Built and tested, OFF by default, empty knowledge base, nothing posted anywhere.** See `SOCIAL_ENGINE.md`.

- `backend/social/`: the weekly wheel (36 markets x 7 days, time zones, clock changes, 10-minute stagger), the constitution checker (26 rules, 21-language lexicons, a judgement-model hook that fails safe to HOLD), the deterministic marketer, SVG cards for every script, the desk (plan, pack, approve, veto, pause, incidents, publishing tick, circuit breakers), publishers (dry run by default), the chat bot (no approve command), hash-chained audit log, memory/file/Postgres storage.
- `admin-social.html` at `/admin/social`: the desk screen. Approve is disabled until the sample posts are read; every pack hides one known-bad post to show whether approvals are still being read.
- `backend/social.sql` (the eleventh migration; the ops test now expects eleven).
- 8 new suites (236 checks; the whole suite is now 1,193 checks in 48 suites, all passing, with the keeper and the Wave 1 seeds), including a 270-post red-team set and a real-browser check of the screen on a phone and a desktop.
- Corrected from the plan: the 12-week curriculum no longer includes resale (constitution rule 7); the burst guarantee is "10 minutes between posts on a platform", not "two an hour" (measured); the chat bot does not approve.

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

## Respond or correct (October 2026, round 9)
- One panel replaces the two old windows. Entry points: a strip under every preview (with counts), a line in the checkout, a link under every finding of the paid report, the report footer, and a clearly fictional example in the demo.
- Backend: `backend/engine/responses.js`, `backend/responses.sql` (migration list updated), routes `/api/responses`, `/api/responses/confirm`, `/api/responses/status/:ref`, `/api/responses/:reportRef`, admin `/api/admin/response-queue` and `/resolve` (the older reply queue keeps `/api/admin/responses`). E-mail confirmation, rule-based screening, auto-publish of clean replies, held queue for a person, public dated corrections, buyer notification on correction.
- Tests: `test/responses.test.js` (22), `test/harness/responses.test.js` (server level), and the browser smoke test and readability sweep now cover the panel in every step and in Arabic. 58 new strings in nine languages.
- Wording: the policy pages, the page's privacy text and the legal drafts now say replies are screened automatically and flagged items get a human look (they used to say a person reviews each reply within 48 hours).

## Investor deck refreshed to the new prices (October 2026, round 8)
- The model and deck read every quoted price from the active price book (`deck/model/prices_from_book.js` writes `prices.json`); a test fails if they drift. Output: `ShelterKart-Investor-Deck-v3.pdf`; the v2 deck and the earlier model files are kept.
- India's typical home (gold depth) 2,100 -> 3,100 rupees; TAM 2,655 -> 2,723 crore, SAM 2,160 -> 2,199 crore (only India's price changed); proof-tranche price 22-30 -> 33 crore (single computed figure, 10x the net run-rate); Base runway 19 -> 60 or more months (the model's counting limit, now stated). Fair value (11.9 crore) and the ask (15 crore post) are unchanged.
- The deck now says the model keeps the same number of buyers at the higher prices.
- 860 checks in 37 suites, none failing.

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
