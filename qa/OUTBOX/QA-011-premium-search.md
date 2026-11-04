---
id: QA-011-premium-search
status: pass
tested_sha: cac600d
machine: Windows 11, node v24.20.0, Git Bash, native PostgreSQL 16.15 on 127.0.0.1:5432 (no Docker daemon)
finished: 2026-11-04
---

# Result for QA-011-premium-search

## Summary

With the flag off nothing is registered or loaded; with it on, free, refunded and pending readers are refused, a paid reader passes the gate, the episode log holds no personal data, and the cost model reproduces the builder's numbers. `npm test` only passes on Windows when run through a POSIX shell (see A3). No real engine was used, so the search itself ended at `no_engine`.

## Checks

| # | Result | Evidence |
| --- | --- | --- |
| A1 | PASS | `all 65 passing` |
| A2 | PASS | `all passing` |
| A3 | PASS (note) | With npm's default Windows shell: exit 1 right after the premium harness, `'PREMIUM_SEARCH_TEST' is not recognized as an internal or external command` (the package.json `test` script contains `PREMIUM_SEARCH_TEST=1 node ...`, POSIX-only syntax). With `npm test --script-shell="C:/Program Files/Git/bin/bash.exe"`: exit 0, `all passing`. |
| B1 | PASS | flag off: `POST /api/search/premium` `404`; admin episodes route `404` |
| B2 | PASS | `server.js:783: if (String(process.env.PREMIUM_SEARCH \|\| '').toLowerCase() === 'on') {` (comment line 782: "Nothing is loaded or registered unless PREMIUM_SEARCH=on"); the server log with the flag off has no "premium" line (count 0) |
| B3 | PASS | `git diff --stat 4ac4f0b..cac600d`: 16 files: `backend/data/cost-model.json`, `backend/engines/costmodel.js`, `backend/package.json`, `backend/search/premium/{access,corroborate,episodes,expand,index,policy,routes}.js`, `backend/server.js` (+9), `backend/test/harness/premium.test.js`, `backend/test/harness/stubs/pg/index.js` (+1), `backend/test/search/premium.test.js`, `docs/api/openapi.yaml`, `tools/cost_model.js`. Nothing outside the list in the prompt. |
| C1 | PASS | `401 {"code":"auth_required","error":"Sign in to continue."}` |
| C2 | PASS | `403 {"code":"not_premium","error":"Premium search is open to readers who have bought a report."}` |
| C3 | PASS | after a `paid` purchase: `503 {"code":"no_engine","error":"No search engine is set up right now."}`; body has no cost, usage or e-mail |
| C4 | PASS | `refunded`: `403 not_premium` |
| C5 | PASS | `pending_payment`: `403 not_premium` |
| C6 | PASS | `{}`, `{"query":""}`, `{"query":"a"}`: `400 bad_query` ("Name the project, in 2 to 120 characters."); 500-character query: `503 no_engine` (it passed validation; not an error or crash; the 120-character cut itself is not visible from outside) |
| C7 | PASS | no login `401`, wrong password `401`, right login `200` with `{"enabled":true,"policy":{"id":"baseline","version":1},"summary":{...},"recent":[]}` |
| C8 | PASS | grep for `@`, cookie, `sk_session`, api key, the query text: 0 matches. (No episode was logged here because the search ended at `no_engine`; the unit/harness test "the episode log shows one search and holds no personal data" is the evidence for a logged search.) |
| C9 | PASS | `limit=5`, `0`, `9999`, `abc`: `200` each, `recent` 0 lines |
| D1 | PASS | `node tools/cost_model.js` no errors, no network: preview `$0.049 / $0.080 / $0.090` (low / typical / high), paid_report `$0.589 / $2.86 / $10.06`, premium_search `$0.172 / $1.27 / $4.22`, legacy_brief `$0.133 / $0.188 / $0.225`; typical values equal the builder's ($0.08, $2.86, $1.27) |
| D2 | PASS | `valid json` |
| D3 | PASS (note) | the tool takes no file argument (`--json`/`--tables` are outputs only; its header says to change the number in `backend/data/cost-model.json`). I copied `tools/cost_model.js`, `backend/engines`, `backend/data` and `backend/pricing` to a temp folder, set `leadRounds.typical` from 2 to 4 there, and `paid_report` typical changed from `$2.86` to `$5.07` (premium_search unchanged). The repo was not edited. |
| E1 | PASS | `access.js`: `makeIsPremium({ hasPaidPurchase, windowDays, now })` returns false for no user or `disabledAt`, else `hasPaidPurchase(user.id, since)`; injected; no `active` anywhere |
| E2 | PASS | `episodes.js` DROP list removes `query, location, prompt, answer, text, claim(s), email, phone, user, userId, name, url(s), response`; project is a one-way hash (comment lines 12-13); I did not see a logged episode live (see C8) |
| E3 | PASS (note) | per-search budget default `$2.5` (`PREMIUM_SEARCH_BUDGET_USD`), clamped between `$0.05` and `PREMIUM_SEARCH_BUDGET_MAX_USD` (default `$6`) (`index.js:67`). Waves are only started for engines the remaining budget can afford (`policy.js:58`), the loop stops with `stop = 'budget'` as soon as `total.spent >= budget` (`index.js:119`, `142`). The stop is checked after each wave, so one wave's real cost above its estimate can pass the budget by that amount; the unit tests (65) cover the stub case, no live engine was used. |

## Anything else you noticed

- The test script uses POSIX-style `VAR=1 node` in package.json, which breaks `npm test` for anyone on Windows without a POSIX script shell.

## Environment problems

- No Docker daemon: native PostgreSQL 16.15, database `sk_qa011` (dropped). 127.0.0.1 instead of localhost.
