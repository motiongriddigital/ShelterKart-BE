---
id: QA-006-failed-jobs-health-history
status: pass
tested_sha: e60607f
machine: Windows 11, node v24.20.0, Git Bash, native PostgreSQL 16.15 on 127.0.0.1:5432 (no Docker daemon)
finished: 2026-11-04
---

# Result for QA-006-failed-jobs-health-history

## Summary

The failed-jobs list, the retry and the register health history behave as described: reasons are scrubbed, retries never e-mail or charge, bad ids and days are refused with 400, history is stored in Postgres and pruned at 90 days. The failed-delivery path was covered only by the builder's unit tests (A1), as the prompt says.

## Checks

| # | Result | Evidence |
| --- | --- | --- |
| A1 | PASS | `all 13 passing` (this is the only coverage of the delivery path) |
| A2 | PASS | `all passing` |
| A3 | PASS | `npm test` exit 0 |
| B1 | PASS | `0 applied, 15 already applied.`; `source_health_history` has `market, state, reason, detail, checked_at` and index `idx_source_health_history_market_time btree (market, checked_at DESC)` |
| C1 | PASS | all three routes and the POST retry without login: `401` |
| C2 | PASS | `{"ok":true,"total":1,"jobs":[{"id":"report:SK-RETRY1","kind":"report",...,"reason":"the engine refused for [email] at [ip]",...,"retryable":true}]}` |
| C3 | PASS | grep for `someone@example.com`, `10.1.2.3`, `buyer@example.com`: 0 |
| C4 | PASS | `202 {"message":"Started again. Check the list in a moment."}`; after 3 s still one job, `failedAt":"2026-11-04T17:56:06.296Z"`, `reason":"no AI engine is set up and allowed for research"` |
| C5 | PASS | three more retries `202 202 202`; `sk-mails.log` does not exist (no mail) |
| C6 | PASS | `abc`, `report:`, `report:%2E%2E%2Fx`, `report:SK-RETRY1:email`, `delivery:SK-1`, `job:SK-1`: each `400` with `"code":"invalid"` |
| C7 | PASS | `report:SK-NOPE` `404`; `delivery:SK-NOPE:email` `409 {"code":"not_failed"}` |
| C8 | PASS | `GET .../jobs/SK-RETRY1/retry` `404`; POST without login `401` |
| C9 | PASS | `report_purchases` count 0 before and after, `refunds` count 0 (the tables were empty; no rows added by retries) |
| C10 | PASS | two simultaneous retries: both `202`. Log `completion failed for SK-RETRY1` lines went from 4 (C4 + C5) to 6, one per `202`. No `202` for a non-failed job. |
| C11 | PASS | status `done`: retry `409 not_failed`; status `failed` with `paid:false`: list `{"total":0,"jobs":[]}`, retry `409` |
| D1 | PASS | `days` 30, 10 registers (`uk,fr,no,sg,ie,tw,au,fi,cz,in`, equal to the markets in `engine/markets.js` that have a `registry`), each `checks` 0, `uptime` null, `points` empty |
| D2 | PASS | `?days=7`: `in` checks 2, healthy 1, uptime 0.5, latest `down`, points `["healthy","down"]`; `sg` checks 1, uptime 1; no other market has checks |
| D3 | PASS | `days=1` and `days=90`: `200` |
| D4 | PASS | `0`, `-5`, `91`, `1000`, `abc`, `1.5`, `1e3`: each `400` `"code":"invalid"` |
| D5 | PASS | `sg` row moved back 100 days; after the D2 script again, count of `sg` rows older than 90 days: `0` |
| D6 | PASS | after restart: `sg 1 1 1 healthy`, `in 4 2 0.5 down` (in has 4 because the D2 script was run twice, D2 and D5) |
| D7 | PASS | no e-mail, SQL text, stack frames or IPs in either route's bodies (grep count 0) |
| E1 | PASS | 300 failed files: default `total 300`, `returned 200` (0.018 s); `limit=10` returns 10 (0.004 s); `limit=0` returns 200 (default); `limit=9999` returns 300 (clamped at 500, no error) |

Look hardest at: C5 and C10 held (no mail, one completion per 202). Missing `source_health_history` table (database migrated, then the table dropped): the server started and `/api/health` stayed `200`; `GET /api/admin/health/registers/history` answered `500 {"ok":false,"error":"Internal server error"}` (clean, no SQL); `store.saveHealth` throws `relation "source_health_history" does not exist`, but its only caller `engine/health.js:297` wraps it in try/catch and logs `[source-health] could not save:`, so the nightly check cannot crash the server (I called saveHealth directly; I did not wait for a nightly run).

## Anything else you noticed

- The admin limiter on the main server is 20 requests per 15 minutes per address; this prompt makes more than that, so I ran the server with `TRUST_PROXY=1` and a different `X-Forwarded-For` per call (the new routes have their own 300-per-window limiter).
- Failed deliveries cannot be reached over HTTP; I did not test them end to end.

## Environment problems

- No Docker daemon: native PostgreSQL 16.15, fresh databases `sk_qa006` and `sk_qa006n` (both dropped). The e-mail stub, the jobs folder and the log were in the Windows temp folder and used `C:/...` paths for `NODE_OPTIONS --require` and `LIVE_JOBS_DIR`. 127.0.0.1 instead of localhost.
