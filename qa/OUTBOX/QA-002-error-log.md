---
id: QA-002-error-log
status: fail
tested_sha: fbe6149
machine: Windows 11, node v24.20.0, Git Bash, native PostgreSQL 16.15 on 127.0.0.1:5432 (no Docker daemon; database timezone Asia/Calcutta)
finished: 2026-11-04
---

# Result for QA-002-error-log

## Summary

The error log records, groups, scrubs and counts correctly, and `ERROR_LOG=off` records nothing. One real defect: `GET /api/admin/errors/summary` returns an all-zero hourly `series` when the database session timezone is not a whole-hour offset from UTC (here Asia/Calcutta, +05:30), so C6 fails.

## Checks

| # | Result | Evidence |
| --- | --- | --- |
| A1 | PASS | `all passing`, 16 lines `  ok` |
| A2 | PASS | `all passing` |
| A3 | PASS | `npm test` exit 0 |
| B1 | PASS | `14 applied, 0 already applied.` then `0 applied, 14 already applied.` |
| B2 | PASS | `"error_log_fingerprint_key" UNIQUE CONSTRAINT, btree (fingerprint)`; `error_hits_error_id_fkey FOREIGN KEY (error_id) REFERENCES error_log(id) ON DELETE CASCADE` |
| C1 | PASS | `401`, then `200` with `{"ok":true,"errors":[],"limit":50,"offset":0}` |
| C2 | PASS | `ALTER TABLE` |
| C3 | PASS | stats: three x `500 {"ok":false,"error":"Could not load stats."}`; disputes: three x `500 {"ok":false,"error":"Internal server error"}`; no stack trace, no SQL |
| C4 | PASS | `2 error http 3 GET /api/admin/disputes failed: relation "disputes" does not exist` and `1 error server 3 relation "disputes" does not exist` |
| C5 | PASS | `q=disputes&level=error` returned 2 groups; `level=warn` returned `[]` |
| C6 | FAIL | `series` has 24 entries but the last is `{"hour":"2026-11-04T17:00:00.000Z","errors":0,"warnings":0}` and no entry has errors; `totals` `{"error":6,"warn":0,"info":0}`, `topSources` `http` 3 and `server` 3. After `alter database ... set timezone='UTC'` and a server restart the same call gave last entry `"errors":6`. Cause: `engine/errorlog.js:65` groups with `date_trunc('hour', at)` in the session timezone, so with +05:30 the bucket falls at :30 UTC and the lookup by UTC hour misses. India is such a timezone. |
| C7 | PASS | `error.hits` = `[{"at":"...17:37:58.481Z","times":2},{"at":"...17:37:57.414Z","times":1}]` |
| C8 | PASS | `400` and `404` |
| C9 | PASS | rows `server error 3` and `http error 3`; `count 4, sum 6` (sum equals 3+3) |
| C10 | PASS | grep for e-mail, dotted-quad or 32+ char token over `error_log.message`: no match |
| C11 | PASS | rename back, `/api/admin/disputes` `200`, `/api/admin/stats` `200` |
| C12 | PASS | with `ERROR_LOG=off`: before `23|7` (sum(count)|hit rows), three x `500`, after `23|7`; no `failed` line in its log either |
| C13 | PASS (note) | the original line is still in the log file (`error: relation "disputes" does not exist` with its stack, 394 lines). `grep -c "failed"` after a stats call gave `0` because the stats route's own message does not contain the word "failed"; after an `/api/admin/disputes` call it gave `1`. |

Look hardest: failing-route status codes and bodies were the same with the log on and off (500s above). Flood: see Notes. No 500 from the three new routes.

## Anything else you noticed

- Flood check as written cannot run: `adminLimiter` (server.js:310, `max: 20` per 15 min per address, counts every request) answers 429 after 20 admin calls. My first two flood attempts stopped at exactly 20 counted. I reran with a different `X-Forwarded-For` per request (this commit trusts one proxy hop, so that gives each request its own limiter bucket): 200 calls, all `500`, `sum(count)` went from `3` to `203` (exactly +200), `error_hits` rows `2` to `16` (throttled), single request afterwards `0.0033s`, loop of 200 curls took 12.6 s (about 63 ms each, curl start-up dominated).
- Admin sessions that cause 20 failing requests (even 500s) lock the admin out for 15 minutes.

## Environment problems

- No Docker daemon: native PostgreSQL 16.15, fresh databases `sk_qa002`, `sk_qa002b`, `sk_qa002c` (all dropped). Database timezone was Asia/Calcutta; this is what exposed C6.
- 127.0.0.1 used instead of localhost.
