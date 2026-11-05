# The marketing desk (backend/social)

Plans, checks, packs, approves and publishes one post per market per day, 36 markets, on a rotating platform. The founder approves one
weekly pack; a separate constitution checker can veto any post; nothing is published unless it is approved, unchanged, checked under
today's rules and not paused. The plan, with reasons: the Claude Doc "ShelterKart: the always-on posting engine".

**State on 26 Oct 2026: built and tested, OFF, with an EMPTY knowledge base. Nothing has been posted to any platform.**

## How a week flows

```
knowledge base (verified, dated, sourced)  ->  marketer drafts 252 posts (deterministic floor; model polish not built)
   ->  editor/checker: 26 rules + a judgement model (verify role)  ->  PASS | HOLD (fix and resubmit) | BLOCK (discarded)
   ->  weekly pack (+ one known-bad post)  ->  founder reads the sample, approves with a PIN  ->  veto window
   ->  tick every minute: fingerprint, rules version, last mechanical check, pause?  ->  publisher  ->  audit log (hash chain)
```

## Files

| File | Job |
|---|---|
| `schedule.js`, `data/wheel.json`, `data/platforms.json` | The wheel (36 markets x 7 days), time zones, jitter, 10-minute stagger, work weeks |
| `kb.js` | Knowledge items: typed, sourced, dated, in scope, verified; expiry, renewal, retirement; translations with native approval |
| `keeper.js` | The knowledge keeper: reads OFFICIAL pages, drafts facts with word-for-word quotes, a second model checks, rechecks before expiry, drafts translations |
| `lexicons.js`, `data/lexicons.json` | Forbidden terms in 21 languages; catches spacing, look-alikes, leetspeak, inflections |
| `checker.js` | The constitution checker: every rule, the judge hook, verdicts, audit |
| `marketer.js`, `data/curriculum.json` | Deterministic drafting from one knowledge item; the 12-week curriculum (new-build only) |
| `cards.js`, `render.js` | SVG cards from the brand tokens, every script, right-to-left; content-addressed JPEG files |
| `desk.js` | Plan, check, pack, approve, veto, pause, incidents, the publishing tick, circuit breakers |
| `publishers.js` | Dry run (default), the publishing service, Telegram, LINE; keys redacted from errors |
| `telegram.js` | Founder alerts, digest, /veto /pause /resume /status. No approve command, by design |
| `store.js`, `audit.js`, `../social.sql` | Memory / file / Postgres storage; hash-chained audit log (insert-only table) |
| `index.js` | Builds the desk from the environment, mounts the routes, runs the minute loop |
| `admin-social.html` (in `backend/social/`) | The desk screen, at `/admin/social` behind the admin login |
| `../test/social/` | Tests, the 270-post red-team set, TEST-ONLY fixtures and a local demo (`devserver.js`) |

## Turning it on (in this order)

1. Durable storage: `DATABASE_URL` (run `node tools/migrate.js`: `social.sql` is the eleventh) or `SOCIAL_DATA_DIR`.
2. `SOCIAL_APPROVAL_PIN`, `SOCIAL_EPOCH_MONDAY`, `PUBLIC_BASE_URL`; `SOCIAL_ENGINE=on`. Leave `SOCIAL_PUBLISH` unset: it is a dry run.
3. Install `sharp` (`npm install sharp`) and the brand and Noto fonts on the server, or cards cannot be drawn and image posts wait.
4. Fill the knowledge base (below). Plan a week in the desk, build the pack, read it, approve. Watch the dry run for two weeks.
5. Only then: platform accounts, `tools/social_sandbox_check.js --network`, one sandbox post per platform by hand, then `SOCIAL_PUBLISH=live`.

## The knowledge keeper

It drafts facts from official pages so nobody types 432 of them. A statement becomes a draft only if: the page is official (the research code's `isOfficial`, or a host a person listed for that market); a model quoted the page word for word and the quote is really on the page; every number in the statement is in the quote; the statement passes the checker's lexicons; and a SECOND model, asked separately, says the page supports it. Pages are treated as untrusted data in both prompts.

Drafts are verified by a person (the screen's "The facts behind the posts"), unless `SOCIAL_KEEPER_AUTOVERIFY=on`, which only takes effect when the writer (`adviser`) and checker (`verify`) roles run on different providers. `SOCIAL_KEEPER_RECHECK=on` re-reads the page of any item expiring within 21 days: still supported, the dates move forward; the supporting words gone, the item expires at once. Translations are drafted with an English back-translation (numbers must survive) and are never approved by the keeper: a named native speaker approves each one.

It needs a list of official pages: the playbooks describe sources in words, not addresses, so addresses are added on the screen or by `POST /api/admin/social/keeper/seeds` (up to five per market and topic), or found by an optional discovery hook whose results must pass the official test. Where there is no source the result is a reported gap.

**First real run: `KEEPER_FIRST_RUN.md` (set-up, run order, what to check, when to stop).

**Wave 1 seeds.** `backend/social/data/seeds-wave1.json` holds the official pages opened in the research file "ShelterKart: the knowledge universe, Wave 1 research file" (12 of the 13 Wave 1 markets plus Germany, France, Spain, Japan, Poland, Mexico and Switzerland and Saudi Arabia from Wave 2 and Brazil, Italy, the Netherlands and Portugal from Wave 3 (Belgium, Taiwan, Latvia, Thailand, the Czech Republic and Lithuania are researched but have no seed; Estonia is seeded with guessed focus words), 285 labelled facts, 105 market-and-topic seeds; Malaysia produced no confirmed fact). `node tools/social_seed.js` shows what would be loaded and sends nothing; `--send --user U --pass P` loads the addresses. Eighteen hosts in sixteen markets are not matched by the keeper's official-site rule (the Consumer Code, the NHBRC, Tarion, the Irish local government portal, the German federal law site, the Spanish Ombudsman, a Japanese prefecture, the Swiss Parliament and Federal Office of Justice, CONSAP in Italy, IPLO in the Netherlands AICCOPN in Portugal, which is a trade association and not a public body, Riigi Teataja in Estonia, KKV in Finland, Boverket in Sweden a municipality in Denmark, and the Parliament and Government in Norway). They are listed in `backend/social/data/official-hosts.json` with what each one is, why it is or is not official, and a recommendation (approve, approve with care, or decide). **Nothing is approved by default.** To approve a host, set `"approved": true` on its entry; `node tools/social_seed.js --allow-hosts` then sends only the approved ones, and a host missing from the list is never sent. Approving a host as official is a person's decision, and a test checks that the shipped file approves nothing. The research covers one place or subject only for the UAE (Dubai), Canada (Ontario freehold), Australia (New South Wales), Ireland (building control certificates) the United States (federal loan paperwork) Germany (the standard payment route only, in German) and France (off-plan rules from a January 2018 guide, in French) and Spain (the 2015 wording of the advance-payment guarantee, in-force status unconfirmed, in Spanish) and Japan (the new-house warranty's scope and ten-year period, in English and Japanese) and Poland (the escrow and guarantee-fund system from a ministry letter, in Polish: its seed carries a warning that the letter also discusses an enforcement case against a named company, which must not be used) and Mexico (the federal standard NOM-247-SE-2021 on selling homes, in Spanish). Switzerland (the Code of Obligations building-defects reform in force from 1 January 2026, in German) Saudi Arabia (the off-plan Law as published by REGA, in English) Brazil (Law 13.786 of 2018 as published by the Presidency, in Portuguese) Italy (Legislative Decree 122/2005: the ORIGINAL 2005 text, which must be checked against the current law, in Italian) the Netherlands (the Wkb handover dossier only, from the government's information point, in Dutch) Portugal (Decree-Law 84/2021: the 10-year and 5-year home warranty, from a trade association's copy of the Gazette, in Portuguese) and Finland (the three-layer collateral system for apartments sold during construction, from the consumer authority's English page; the Act is being amended in 2026). Taiwan is researched but has no seed: no official page could be read in full, and its English government page needs JavaScript to show text. Belgium is researched but has no seed: the EU Court ruled on 26 February 2026 that the Breyne completion guarantee breaches the Services Directive, so the law is in flux, and no Belgian official page could be opened.

## The knowledge base starts empty, on purpose

Nothing is seeded: a made-up fact about a country's property law would be published. Each item (`POST /api/admin/social/kb`) needs a statement
(<= 400 characters), its type, an official https source, the date it was checked, a recheck date within 180 days, and scope
`new_build_primary`. It is a draft until `POST /api/admin/social/kb/:id/verify` names who checked it. Posts restate an item word for word;
a market with no usable item for the week's topic gets a reported gap, never a guess. 36 markets x 12 topics = 432 items for the first level.

## What is verified, and how

| Claim | Evidence |
|---|---|
| The wheel: 36 posts a day, no platform twice in a row, LinkedIn in the work week, India X then Facebook; clock changes handled | `schedule.test.js` (16) |
| The checker stops every one of 270 deliberately bad posts, passes 756 good ones, every rule has a case, the judge fails safe (hold) | `checker.test.js` (26) |
| Forbidden terms are found despite tricks, in 21 languages, and innocent words are not | `lexicons.test.js` (15) |
| A week runs end to end with a fake clock; approval, canary, veto, pauses, integrity at posting, retries, restart recovery | `desk.test.js` (39) |
| Publisher requests, retries, key redaction, dry-run default; Postgres writes as upserts (fake query); the chat bot | `publishers.test.js` (20) |
| The Wave 1 seed file: every address https, every host official by the research code's own test or flagged for approval | `seeds.test.js` (11) |
| The keeper: quote-on-page, number and lexicon checks, the independent checker, auto-verify only across providers, recheck, translation round trips, PDFs, long documents in chunks, and a run from official pages to a planned week | `keeper.test.js` (31) |
| Cards fit in 9 languages, are never clipped, are content-addressed; layout checked by eye in a browser | `cards.test.js` (17) |
| Routes, authentication, PIN, canary, knowledge routes, media route, webhook secret | `routes.test.js` (31, including the keeper routes) |
| The screen, in a real browser on a phone and a desktop: a careful reader approves a week, a rubber-stamper is stopped, veto and pause work; text size, contrast, tap targets in every state | `tools/social_ui_check.py` (96) |

## What is NOT verified or NOT built

- **No live platform has been called.** The request shapes for the publishing service, Telegram and LINE follow their public documentation and were
  run only against a fake network. X, Instagram, Facebook, LinkedIn, YouTube, TikTok and Threads are reached through the publishing service, and its
  exact parameters (network names, YouTube and TikTok options, the AI label) are unconfirmed until a sandbox profile has posted once.
- **Postgres has not been run.** `social.sql` and the `pgPersist` queries are untested against a real database (a fake `query` was used).
- **The judgement model has only been run against stubs.** The prompt and parser are tested; no real model has judged a post. Until one is set up
  for the `verify` role, every post is HELD (the checker never passes without its judge). Use a different provider from the `adviser` role.
- **Video is not built.** The 71 YouTube and TikTok posts a week (of 252) wait, shown as "waiting for media", and are never published without a video.
- **Images need `sharp` and fonts on the server.** Without them every card waits. In the visual check the cards were drawn in Chromium, not by `sharp`.
- **The keeper has run only against a fake web and fake models.** No real official page has been read and no real model has drafted or checked a fact. It needs the list of official addresses, and two models on different providers. The existing source classification does not yet treat bare government roots (gov.uk, gob.es) as official: list them as allowed hosts per market, or approve that classification change.
- The keeper reads HTML, plain text and PDF pages. PDFs need `pdftotext` (poppler-utils) installed on the server; without it a PDF is skipped and reported. Numbers a source spells out in words (cinco, fünf, trente-cinq, trzydzieści pięć, 五年) count as digits when a statement's numbers are traced to its quote, for English, Spanish, French, German, Polish, Italian, Portuguese, Dutch and Chinese or Japanese numerals; articles (one, un, ein) and "per cent" never lend a number. Pages are decoded by the character set they declare (header, then the page's own meta tag), so older Japanese, Korean and Chinese encodings are read correctly. Page text is the page's real content: navigation menus, sidebars, forms, headers and footers are dropped and the `<main>` (or `<article>`) part is used when it holds enough text, so a site with a very long menu does not fill the reading budget with links. Pages that need a script to show their text, and short pages that are really a human-verification or access-denied wall (the Belgian federal finance page answers with one), are skipped and reported as blocked. A document longer than about 18,000 characters is read in up to four overlapping chunks. By default these are the first four, so a very long text (the Philippine decree, Estonia's Law of Obligations Act) is only partly read. A seed can carry focus words per address (up to 8, each at most 80 characters, in the seeds file's `focus` object or the seeds route): the keeper then reads the four chunks that mention them most. Every source in a run report carries `coverage` (chunks read of the total, whether focus was used, whether it matched anything) and is marked `partly_read` when the document was not read in full, so a partial read is never silent.
- **The model polish of hooks and rhythm, the exemplar set, hashtag banks per market, localised market names, the analytics loop and winner
  amplification are not built.** Posts today are the safe deterministic floor.
- **Nine languages only.** The 12 others (Thai, Dutch, Portuguese, Italian, Czech, the Nordics, the Baltics) post in English with local specifics.
  Every phrase, the disclaimers (21 languages) and the lexicons are written by an AI and need a native-speaker check in the dry run.
- Reddit and Facebook-group answers, and any boost, stay manual.

## When something happens

- Everything stops: the red button on the screen, `/pause` in the chat bot, or `POST /api/admin/social/pause {scope:'global'}`. Posts wait; they publish after resume if still inside six hours of their time, otherwise they expire and are never posted late.
- A market has bad news: report "a tragedy or disaster" on the screen; that market is held for 24 hours.
- The rules changed (any edit to a rule, lexicon, platform limit, disclaimer, curriculum or the wheel changes the rules version): approvals made under the old version are cancelled at posting time and the posts return to "checked" for a new pack. This is deliberate.
- A published post turns out to be wrong: `POST /api/admin/social/correction`. Two in a week pause that market. The visible dated correction on the platform is made by hand.
- The audit chain shows BROKEN: stop and investigate; do not approve anything.


## The marketing dashboard (`/admin/marketing`)

Built from "Metrics, dashboards and decision triggers" in the launch strategy. Behind the admin login, beside the Marketing desk. Code: `backend/marketing/dashboard.js` (pure rules) and `backend/marketing/index.js` (routes and inputs); screen: `admin-marketing.html`; tests: `backend/test/marketing/dashboard.test.js` (17), plus two end-to-end checks in `backend/test/harness/payments.test.js`.

- **This week's calls** at the top: pause everything (an open legal notice, a platform strike, or a reported factual error not yet corrected); the Phase 1 gate (all five conditions, each met, not met, or unknown with what is missing); scale, hold or stop for paid spend against the cost ceiling; Phase 2 readiness; and the budget rule (30% of last month's contribution, split 70 / 20 / 10).
- **The seven weekly numbers** for the anchor markets (India, the UAE, the UK, Singapore) and a table for all 36: visits by channel, previews and shares per 100 visits, "Ask us to check" requests (the `document_check` event), paid reports and revenue, cost per paid report ("Organic: no spend" in Phase 0), refund rate and open complaints (all markets only).
- **Early warnings:** refund rate, replies and corrections (open, resolved, median days to resolve), audience quality (share of visitors who opened a preview), content health (posts held by the checker and why), and the monthly AI-answer check.
- **Repeat, change, stop:** each tagged social topic and platform, judged by the previews its visitors opened, after 30 visits.
- **Monthly ranking** by paid reports per hour of effort.
- **Targets stay blank until two weeks of baseline exist**; the route refuses them before that.
- **Your inputs** (spend, ceilings, exchange rates, measured AI cost, counsel's decisions, legal notices, AI-answer checks, hours, phase) are kept in the desk's durable store (`meta/marketing`), so no migration is needed; without the desk they are kept in memory and the screen says so. India's ceiling starts at the strategy's provisional Rs 700.
- **Paid reports traced to their channel (from 29 Oct 2026).** The site keeps the UTM tags and referring page of a visit's first page (sessionStorage, cleared when the tab closes, no identifier) and sends them with the checkout. The checkout saves them, with the property's market, on the purchase (`report_purchases.attribution`, migration `purchase_attribution.sql`), and the paid event, which arrives later from the payment webhook, carries them; its detail ends in `:src`. The dashboard then shows paid reports per channel, decides scale, hold and stop per channel when spend is recorded against one (and for the whole market otherwise), and computes Phase 2 payback per channel. Payments made before this, or whose browser sent nothing, count for their market only, and the screen says how many. Refunds and replies still need the database; without it those lines say "Not connected".

### Consent for the visit's source (from 29 Oct 2026)

Keeping the visit's source on the visitor's device needs an explicit yes in the European Economic Area, the United Kingdom and Switzerland. `GET /api/source-consent` tells the page, from the visitor's country (the same header the analytics use), whether it must ask (`required`) or need only inform (`notice`). Unknown country is `required`: the safe default. `SK_SOURCE_CONSENT` overrides it (`eu` default, `all`, `none`). In `required` mode the page shows a two-button choice in the existing notice's style ("Allow" and "No thanks", translated into all nine languages) and, until the visitor agrees, neither stores the source in sessionStorage nor sends it with a checkout; the choice is remembered in localStorage. The first-party visit statistics are unaffected: they read the address on the server and store nothing on the device. Checked in a real browser by `tools/source_consent_check.py` (16 checks; run it with `python3 tools/source_consent_check.py`, it is not part of `npm test`) and by 7 server checks in `backend/test/harness/analytics.test.js`. The wording of the choice, and whether this note needs consent at all, are questions for counsel (legal pack, clause 7.4).
