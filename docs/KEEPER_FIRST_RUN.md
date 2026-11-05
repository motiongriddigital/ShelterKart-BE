# The knowledge keeper: the first real run

Everything the keeper has done so far was tested against a fake web and fake models. This checklist is for the first time it reads real official pages and calls real models. It posts nothing: the keeper only creates **drafts** in the knowledge base, and the desk stays off or in dry run.

What is verified and what is not, before you start:

- **Verified (by tests, 27 keeper checks):** it refuses http, unofficial hosts, redirects off the site and huge pages; reads HTML, text and PDF (PDF needs `pdftotext`); decodes older character sets; reads long documents in chunks; traces numbers spelled out in words; reports human-verification pages as blocked; keeps a statement only if its quote is on the page word for word, its numbers are in the quote, it is clean, and a second model agrees.
- **Not verified:** any real model's behaviour (does the writer find the right sentences, does it quote exactly, does the checker agree sensibly), any real page's layout, the real cost, and whether government sites let the keeper in.

## 1. Set up (once)

1. **Storage.** Set `DATABASE_URL`, or `SOCIAL_DATA_DIR` for files. The engine refuses to run without one (`SOCIAL_ALLOW_MEMORY=true` is a demo only).
2. **Switch the desk on, publishing off.** `SOCIAL_ENGINE=on`, `SOCIAL_APPROVAL_PIN=<a PIN>`. **Leave `SOCIAL_PUBLISH` unset**: unset means dry run. Do not set `SOCIAL_AUTOPLAN`, `SOCIAL_KEEPER_AUTOVERIFY` or `SOCIAL_KEEPER_RECHECK` yet.
3. **PDF reading.** Install poppler on the server (`apt-get install poppler-utils`) and check `pdftotext -v` works for the user the app runs as. Four of the first sources are PDFs.
4. **Two providers.** Set two API keys, for example `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`. Then pin the roles so the writer and the checker cannot be the same provider: `AI_ENGINES_ADVISER=anthropic` and `AI_ENGINES_VERIFY=openai` (or the reverse). Without pinning, the router picks the cheapest and both roles may land on one provider.
5. **Check it took.** Sign in at `/admin/social` and open `GET /api/admin/social/keeper`. It must show `providersDiffer: true`. If it shows `false` or `null`, stop and fix step 4.
6. **Approve the hosts you accept.** Open `backend/social/data/official-hosts.json`, read each entry's recommendation, and set `"approved": true` for the hosts you accept. Nothing is approved by default.
7. **Load the seeds.** `node tools/social_seed.js` (dry run: shows what would be sent), then `node tools/social_seed.js --send --user U --pass P --base https://your-site --allow-hosts`. Check `GET /api/admin/social/keeper` lists the markets and topics.

## 2. Run order: easiest first, so a problem is easy to see

Run one market and one topic at a time: `POST /api/admin/social/keeper/run` with `{"market":"AE","topic":"t07","wait":true}`.

| Round | Markets (topic) | Why this order |
| --- | --- | --- |
| A. Plain English HTML | AE t07, SG t07, AU t07, NZ t11, US t09, ZA t11, FI t07 | Official HTML pages in English, with facts you already know from the research file. Any failure here is the keeper, not the language. |
| B. PDFs | PH t07, IN t07, HK t07, CA t11, IE t11, SA t07, DK t11 | Tests `pdftotext`, long documents in chunks and PDF layout. (FR, PL and MX in round C are PDFs too. SA t07 is REGA's own PDF of the Law, a good clean test: its facts are listed article by article in the research file.) |
| C. Other languages | DE t07, FR t07, ES t07, PL t07, MX t11, CH t11, BR t08, IT t07, NL t12, PT t11 | Tests quoting in another language, number words and the checker across languages. |
| D. Hard cases | JP t11, GB t01, EE t11, SE t03, NO t07 | Older character set (Japan); an industry host (UK); a 260-page Act read through focus words that are guesses (Estonia): check the report's `coverage`; a page with a very long navigation menu (Sweden), which tests the extraction that skips menus and reads the `<main>` content. |

Do not run Belgium, Malaysia, Taiwan, Latvia, Thailand, the Czech Republic or Lithuania: they have no seed. (Belgium's federal page blocked an automated fetch, Taiwan's English government page needs JavaScript to show any text, and Malaysia's rules were only found on non-government pages. Each is a likely future test of the `blocked_by_bot_check` and `no_text` reports once an address is found.)

**Hosts that must be approved first (step 6):** GB (Consumer Code), ZA (NHBRC), CA (Tarion), IE (localgov.ie), DE (gesetze-im-internet.de), ES (Ombudsman), JP (Chiba Prefecture, one of its three sources), CH (Parliament and Federal Office of Justice) IT (CONSAP: its PDF is the original 2005 text, so Italian drafts need a check against the current law) NL (IPLO, the Dutch government's information point) PT (AICCOPN, a trade association hosting a copy of the Gazette: not a public body), EE (Riigi Teataja), FI (KKV, the Finnish consumer authority) SE (Boverket, the Swedish housing agency) DK (Svendborg Municipality: one local government's document) and NO (the Norwegian Parliament and Government: amendment texts, not the consolidated Act, so take no percentage from them). Until a host is approved, the keeper refuses to read it and reports `not_official`, which is correct behaviour, not a fault.

## 3. After each run: read, do not skim

For every **draft** the keeper created, open the source page and check:

1. The **quote** is really on the page, and the **statement** says no more than the quote does.
2. The statement names the **exact place** (Dubai, not the UAE; Ontario, not Canada; New South Wales, not Australia).
3. Every **number** and **date** matches the page.
4. It is **not** about a named company or person (Poland's seed warns about one such section).
5. It matches a fact in the research file, or it is a good new fact. Note which research facts the keeper did **not** find: that is its recall.

Then read the **rejected** list in the run's report. The reasons tell you what is going wrong:

| Reason | Meaning | What to do |
| --- | --- | --- |
| `quote_not_on_page` | The writer paraphrased instead of quoting | If frequent, the writer prompt or model needs work |
| `number_not_in_quote` | A digit is not in the quote | Check whether it is a number written in words in a language the reader does not cover |
| `checker_disagrees` | The second model said the quote does not support the statement | Read both: is the checker right? |
| `blocked_by_bot_check`, `pdf_unreadable`, `not_official` | The page could not be used | Note the host; blocked government sites may need a person to copy the text in |
| `refused:...` | The knowledge base rule refused it (scope, length, banned words) | Usually correct |

## 4. Stop and fix if any of these happen

- A draft states something the page does not say. **One false draft is enough to stop**: find out why before running more markets.
- A draft names a company or a person.
- A draft says "the UAE", "Canada" or "Australia" where the source covers one place.
- The checker agrees with a statement you can see is wrong.
- Most pages in a round are blocked or unreadable.

## 5. Judge the first rounds

Count, per round, for the markets you ran: drafts created, drafts you would verify as they stand, drafts you would reject, research-file facts found out of those available. Write the numbers down. They are the first real measure of whether the keeper replaces the human research, and nothing so far is.

- If **no draft is false** and most research facts are found, continue to rounds B, C and D.
- If **drafts are false or the recall is poor**, do not widen the run: tune the writer prompt and the model, and repeat round A.

## 6. What a person still does

- **Verify or reject each draft** on the screen ("The facts behind the posts"), or `POST /api/admin/social/kb/:id/verify` and `/reject`. A draft is not usable until then.
- **Translations** are drafted with a back-translation and are never self-approved: a named native speaker approves each one.
- **A lawyer samples** each market's verified facts before anything is posted. The research file lists what each fact rests on.

## 7. What stays off until later

`SOCIAL_PUBLISH=live`, `SOCIAL_AUTOPLAN=on`, `SOCIAL_KEEPER_AUTOVERIFY=on` and `SOCIAL_KEEPER_RECHECK=on` stay off until at least two weeks of drafts show no false item. Auto-verify only ever applies when the writer and checker are on different providers, and even then a lawyer's sample comes first.
