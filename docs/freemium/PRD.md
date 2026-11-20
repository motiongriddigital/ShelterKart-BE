# Freemium engine, slice 2: the free preview when the AI cannot serve it: product requirements

Status: draft for the owner, written 14 November 2026. Companions: `TDD.md`, `FRONTEND-CONTRACT.md`, `IMPLEMENTATION-PLAN.md`. Earlier work: `docs/ai-tiers.md` (slice 1, the lean preview, SHEL-79, merged and off by default) and `docs/pdf/` (the free preview PDF, merged). Control Room: epic SHEL-92.

Everything marked "Decision" is a default chosen so work can start. Section 11 lists each one.

## 1. Summary

The client's rule is that the free preview runs on free AI and only paid reports use paid AI. Slice 1 built the lean preview and left a gap its own documents name: "when free capacity runs out the preview fails with the existing outage message", and a "preview with no AI from the registers and the cache" is not built. This document does two things:

1. **It specifies and builds what is clearly specified: a clear, typed state when the free preview cannot be made.** Today a buyer whose preview cannot run sees a generic message or, worse, a page that keeps saying "working" for ever. After this slice every case has a name, a reason, a time to try again and an honest sentence, in one shape the website can rely on.
2. **It tests the other half, a preview with no AI, against the real code and data, and reports what it found** (section 7): at launch it would almost never apply, so it is not built here; the document says what would have to be true first, and what to build instead.

## 2. Why

| Reason | Detail |
| --- | --- |
| Free capacity will run out | The preview is the free, high-volume stage. It stops when the free engine is down, when the daily dollar ceiling is reached (`AI_DAILY_MAX_USD`), when the daily count or a market's share is reached, when a market is paused, when the server is busy, or when one account has used its allowance. Each of these is a normal day, not an incident. |
| Buyers get no usable answer today | The start call answers 503 `paused` for four different causes with one text, 429 without a code when busy, and 429 `quota` for an account. A sweep that fails leaves the saved report at phase `starting`: the report call keeps answering "not ready" as if work were going on. |
| The website cannot tell the cases apart | The front end needs to say "try again tomorrow", "try again in a few minutes", "this market is paused" or "something failed on our side, search again" differently. It has only a status code and a sentence to read. |
| Nobody can see how often it happens | The operator has no count of refused or failed previews by cause, so the daily ceiling cannot be tuned. |

## 3. Goals

1. Every way a free preview is refused or fails maps to one **reason**, one HTTP status, one plain sentence and, where it is knowable, a time to try again.
2. The start call and the report call and the progress stream all use the same reasons.
3. A preview that failed is shown as failed, never as "working", and searching again starts a new attempt (as today).
4. Nothing already reachable changes: the existing `code` values and statuses stay; reasons and times are added.
5. The operator sees how many previews were refused or failed, by reason, today.
6. The free preview PDF says nothing for a preview that does not exist (no false "ready").

## 4. Non-goals

- A preview from the registers with no AI (see section 7: analysed, not built).
- A "notify me when it is ready" e-mail. It needs a contact captured before payment (a privacy decision) and is listed as an option.
- Trying a free engine on the lean prompt (slice 3: needs the owner's Gemini key) and choosing the switch's default (slice 4: the owner's judgement).
- Changing any price, cap or limit. The numbers stay as configured.

## 5. Users

| User | What they need |
| --- | --- |
| Buyer | To know whether to wait, retry now, retry later or give up, in one sentence. |
| Front-end developer | One stable shape: `reason`, `retryAt`, `state`. |
| Operator | A count by reason; the daily ceiling visible. |

## 6. Requirements

### 6.1 The reasons

| Reason | When | Start call | Time to retry |
| --- | --- | --- | --- |
| `engines_unavailable` | The preview sweep failed because every engine on the panel failed (outage, key, rate limit) | 202 at start; later seen in the report call and stream | a few minutes (`retryAt` = now + 5 min) |
| `restarted` | The server restarted while the free search was running; settled at start-up | none at start; seen in the report call and stream | now |
| `daily_budget` | `AI_DAILY_MAX_USD` reached | 503 | next UTC midnight |
| `daily_cap` | the day's count of new investigations reached (`INVESTIGATE_DAILY_CAP`) | 503 | next UTC midnight |
| `market_cap` | the market's share of the day reached | 503 | next UTC midnight |
| `paused` | operator pause (`RESEARCH_PAUSED`, a market pause) | 503 | none known |
| `busy` | too many investigations running at once | 429 | 3 minutes |
| `quota` | this account used today's allowance | 429 | next UTC midnight |

FR-1: every refusal body is `{ ok: false, code, reason, error, retryAt? }` where `code` is the existing code (`paused`, `quota`, or `busy` where none existed) and `reason` is from the table. `retryAt` is an ISO time, present when the table gives one.
FR-2: the existing statuses and `code` values are unchanged; `busy` gains `code: "busy"` (it had none).
FR-3: the sentences name the cause in plain words and never blame the buyer.

### 6.2 A failed preview is visible

FR-4: when the preview sweep fails, the saved report records `phase: "failed"` and `reason: "engines_unavailable"`.
FR-5: `GET /api/report/:ref` answers a failed preview with 200 `{ ok: true, ready: false, state: "unavailable", ref, phase: "failed", reason, retryAt, error }`; a preview that is still being made keeps 202 with `state: "working"`.
FR-6: the progress stream's `error` event carries `reason` and `retryAt`.
FR-7: `GET /r/:ref/preview.pdf` for a failed or missing preview answers 404 (no dossier) and `GET /api/report/:ref` says `pdf.reason: "pending"` only while working; for a failed preview there is no `pdf` block.
FR-8: searching the same project again after a failure starts a new attempt (existing behaviour, now covered by a test).

### 6.3 The operator

FR-9: `GET /api/admin/delivery` (the existing operations status) gains `freePreview: { today: { started, refused: { <reason>: n }, failed: n }, day }`, kept in memory per day.
FR-10: the existing `GET /api/admin/engines` limits block already shows the daily ceiling; nothing is duplicated.

### 6.4 Non-functional

NFR-1: no new dependency, no new table. NFR-2: nothing here adds a call to an AI engine. NFR-3: a paid report is never affected: the reasons apply to the free preview and its start call only; a failed paid completion keeps its own handling.

## 7. The preview with no AI: what was found

The plan listed "a preview with no AI from the registers and the cache". Before building it, the code and data were read. Findings (14 November 2026, `main` at 6476c04):

1. **A register lookup needs the developer's legal name, not the project's.** `engine/research.js` says so in as many words (the "Hubtown Solaris trap": a project name can match an unrelated company, and "no match is a better outcome than a wrong one"). A buyer types a project name. Only the AI sweep finds the developer's legal name.
2. **The one source of project-to-developer facts without AI is the project index (`backend/search`), and it is empty at launch.** `data/search/projects.json` holds `[]`; the index grows only from projects ShelterKart has already researched.
3. **For a project that is in the index, a preview already costs no AI**: the same project is reused for 30 days (by name, by registration number, by a twin), so a register preview would add nothing for it.
4. **The registers answer questions about the company, not the project**: identity, status, insolvency history, overdue accounts, charges. They cannot produce the cards the free view leads with (marketed against filed dates, units against sanctioned area). A register-only preview would be a different, thinner product than the one the owner is asking about, and would have to be labelled as such.
5. **Coverage** is 13 registers, and each needs its own key or terms (Companies House, ABN, SEC need keys).

Conclusion: built today, a no-AI preview would apply to almost no searches. It becomes worth building when (a) the project index holds real data (seeded, or after a few hundred investigations), or (b) there is an explicit "check a builder" entry where the buyer types a company name or number (the home page already says "Search a property or builder"), which removes the name-matching risk. Either is a product decision. Recommendation: do slice 2a now, build neither (a) nor (b) until the owner chooses; in the meantime the cheapest real saving is slice 1's lean mode.

## 8. Privacy and compliance

No new personal data. The reasons and counts hold no query text beyond what the investigation already stores; the in-memory counters hold numbers only.

## 9. Success measures

| Measure | Target |
| --- | --- |
| Refusals and failures that carry a reason and a retry time (where known) | 100 percent |
| A failed preview shown as "working" | zero |
| Operator can read refusals by reason for the day | yes |

## 10. Release and rollout

Additive: no setting, no migration. The new fields are ignored by a website that does not read them. Rollback is a revert.

## 11. Decisions and open questions

| # | Decision (default) | Affects |
| --- | --- | --- |
| D1 | Reasons are additive; existing codes and statuses stay. | FR-1, FR-2 |
| D2 | A failed preview is a 200 with `state: "unavailable"`, not an error status, so a polling page can stop cleanly. | FR-5 |
| D3 | `retryAt` for daily limits is the next UTC midnight (the counters reset by UTC day). | table 6.1 |
| D4 | The register-only preview is not built now (section 7). | non-goals |
| Q1 | Should a buyer be able to leave an e-mail to be told when a refused search can run? Needs a privacy decision. | non-goal |
| Q2 | Seed the project index with a list of projects (the client's data) so a register preview has something to start from? | section 7 |
| Q3 | A separate "check a builder" entry (company name or number, registers only, no AI)? | section 7 |

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| A website that shows only the status text keeps the old behaviour | Fields are additive; texts stay readable on their own. |
| `retryAt` promises a time that then fails again | It is a hint ("try again after"), worded that way. |
| Counters reset on restart | Documented: per instance, per day, in memory, like the existing daily counters. |
