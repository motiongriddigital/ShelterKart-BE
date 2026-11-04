---
id: QA-011-premium-search
title: Premium search engine behind PREMIUM_SEARCH, with a cost model
repo: ShelterKart-BE
branch: feature/premium-search
sha: cac600d
created: 2026-11-04
---

# QA-011: premium search (off by default) and the cost model

You are the QA agent. Your job is to verify, not to build. Read `qa/README.md` first and follow its rules. Terminal only, no browser. Do not use a real AI provider: there are no keys and none may be created.

## What is under test

ShelterKart-BE, branch `feature/premium-search`, commit `cac600d` (it merges `feature/admin-engines` `4ac4f0b`). New and off unless `PREMIUM_SEARCH=on`: `backend/search/premium/` (wider recall for readers who have bought a report: query expansion, a panel of engines chosen by cost, corroboration across sources, a second pass on weak or conflicting findings, a per-search dollar budget with hard stops, early stopping, a deterministic baseline policy and a decision log), two routes (`POST /api/search/premium` for a signed-in premium reader, `GET /api/admin/search/premium/episodes` for the admin), and a cost model (`backend/engines/costmodel.js`, `backend/data/cost-model.json`, `tools/cost_model.js`). "Premium" means a signed-in user with at least one `paid` (not `refunded`) purchase.

## What the builder did and how it was tested

Built by a separate engineer-agent from a cost analysis of the pipeline. Tested: 65 unit checks with stub engines (`test/search/premium.test.js`: the policy, budget stops, early stopping, corroboration, the flag off, the log format), a harness test that drives the real router and the Anthropic adapter with a stubbed `fetch` with the flag on and off, and the whole `npm test`. No live engine was ever called. Not tested: a real Postgres run of the premium gate, a server started with the flag on, and the numbers of the cost model against real calls (they are modelled).

## Setup

```
git clone https://github.com/motiongriddigital/ShelterKart-BE.git sk-be11 && cd sk-be11
git checkout cac600d && cd backend && npm ci && cd ..
docker run -d --name sk-qa-pg11 -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=sk -p 5489:5432 postgres:16
export DATABASE_URL=postgres://postgres:pw@127.0.0.1:5489/sk
node tools/migrate.js
```

Server in `backend` (port 4021). Variant OFF has no `PREMIUM_SEARCH`; variant ON adds `PREMIUM_SEARCH=on`. Always add `ACCOUNTS_ENABLED=on AUTH_PEPPER=<40 x characters> ACCOUNTS_DEV_ECHO=on ADMIN_USERNAME=qa ADMIN_PASSWORD=qa-pass-123 ACCESS_TOKEN_SECRET=x QUOTE_SECRET=x PAYMENT_WEBHOOK_SECRET=x NODE_ENV=development PORT=4021`. Run one variant at a time. A helper to sign a new user in and keep the cookie (use bash, not zsh):

```
signin() { C=$(curl -s -X POST http://127.0.0.1:4021/api/auth/request-code -H 'content-type: application/json' -d "{\"email\":\"$1\"}" | sed -E 's/.*"devCode":"([0-9]+)".*/\1/'); curl -s -c /tmp/sk-qa11-$1.jar -o /dev/null -X POST http://127.0.0.1:4021/api/auth/verify-code -H 'content-type: application/json' -d "{\"email\":\"$1\",\"code\":\"$C\",\"termsAccepted\":true}"; }
```

## Checks

| # | Do this | Expect |
| --- | --- | --- |
| A1 | in `backend`: `node test/search/premium.test.js` | ends `all 65 passing` |
| A2 | `node -r ./test/harness/stub-loader.js test/harness/premium.test.js` | ends `all passing` |
| A3 | `npm test` (needs Playwright and python3; mark BLOCKED with the reason if missing) | exit code 0 |
| B1 | Variant OFF: `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:4021/api/search/premium` and `curl -s -o /dev/null -w '%{http_code}\n' -u qa:qa-pass-123 http://127.0.0.1:4021/api/admin/search/premium/episodes` | `404` and `404`: nothing is registered with the flag off |
| B2 | Variant OFF: `grep -n "PREMIUM_SEARCH" backend/server.js`, and read how the premium modules are loaded | they are loaded only inside the flag check; with it off the server does not require them |
| B3 | `git diff --stat origin/feature/admin-engines...cac600d` (or `4ac4f0b..cac600d`) | the new files under `backend/search/premium`, `backend/engines/costmodel.js`, `backend/data/cost-model.json`, `tools/cost_model.js`, two test files, and small edits to `server.js`, `package.json`, `docs/api/openapi.yaml` and the pg test stub. List anything else. |
| C1 | Variant ON. The premium route with no login: `curl -s -i -X POST .../api/search/premium -H 'content-type: application/json' -d '{"query":"Test Heights"}'` | `401` with `auth_required` |
| C2 | `signin free@example.com`, then `curl -s -b /tmp/sk-qa11-free@example.com.jar -X POST .../api/search/premium -H 'content-type: application/json' -d '{"query":"Test Heights","country":"IN"}'` | `403` with `not_premium` |
| C3 | Give that user a paid purchase: `docker exec sk-qa-pg11 psql -U postgres -d sk -c "insert into report_purchases (report_ref, user_id, status, amount, currency) select 'SK-QA11', id, 'paid', 3000, 'INR' from users where email='free@example.com'"`, repeat C2 | no longer `403`: with no AI engine set up it answers `503` with `no_engine` (that is the expected end here; report what you get). The body carries no cost, no usage and no e-mail address. |
| C4 | Refund it: `update report_purchases set status='refunded' where report_ref='SK-QA11'`, repeat C2 | `403` `not_premium` again (a refund ends premium) |
| C5 | A pending purchase: set status `pending_payment`, repeat C2 | `403` |
| C6 | Bad queries as the premium user (put the `paid` status back first): `{}`, `{"query":""}`, `{"query":"a"}`, a 500-character query | `400` for the first three (`bad_query`); the long one is cut to 120 characters, not an error and not a crash |
| C7 | The admin route: without login, with the wrong password, with the right one | `401`, `401`, `200` with `enabled` true, a `policy` with an id and a version, a `summary` and `recent` |
| C8 | After C2 to C6, call the admin route again and search its body for an e-mail address, a cookie, an API key or a prompt text | none: only context features, the chosen action, costs and outcomes |
| C9 | `?limit=5`, `?limit=0`, `?limit=9999`, `?limit=abc` on the episodes route | `200` every time, at most 200 lines, never `500` |
| D1 | `node tools/cost_model.js` | prints the headline numbers without errors and without network; report them. The builder's numbers (modelled, per report at typical depth): free preview about $0.08, paid report about $2.86, premium search about $1.27; say if yours differ by more than 5% |
| D2 | `node tools/cost_model.js --json /tmp/cm.json` then `node -e "JSON.parse(require('fs').readFileSync('/tmp/cm.json','utf8')); console.log('valid json')"` | `valid json` |
| D3 | Change one assumption in a copy (do not edit the repo: copy `backend/data/cost-model.json` to `/tmp`, edit it, and see how `tools/cost_model.js` takes a file, or read its `--help` if any) | the output changes accordingly; if the tool cannot take another file, report that |
| E1 | Read `backend/search/premium/access.js` | premium is decided by a `paid` purchase that is not `refunded`; the predicate can be replaced by injection; it never reads `active` |
| E2 | Read `backend/search/premium/episodes.js` | one line per decision; the fields are context features, action, cost per step, latency, accepted findings and outcome; no query text, no user id or e-mail |
| E3 | Read `backend/search/premium/policy.js` for the budget and early-stop rules | a hard stop at the per-search budget; document what the number is and that nothing can exceed it |

## Look hardest at

- Anything that changes behaviour with the flag off (B1, B2, B3).
- A free or refunded user getting through the gate (C2, C4, C5).
- Anything personal or any prompt text in the episode log (C8, E2).
- The budget: can a single search spend more than its budget (E3)?

## Teardown

Stop the server; `docker rm -f sk-qa-pg11`; remove `/tmp/sk-qa11-*.jar` and `/tmp/cm.json`.

## Report

Write `qa/OUTBOX/QA-011-premium-search.md` from `qa/RESULT-TEMPLATE.md`, then commit and push as in `qa/README.md`.