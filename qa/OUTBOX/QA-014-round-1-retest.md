---
id: QA-014-round-1-retest
status: pass
tested_sha: cb1b0cc
machine: Windows 11, node v24.20.0, Git Bash, native PostgreSQL 16.15 on 127.0.0.1:5432 (no Docker daemon)
finished: 2026-11-05
---

# Result for QA-014-round-1-retest

## Summary

All three round-1 fixes hold: refused bans no longer log a second-reply error and a refused ban-ip keeps the session, the hourly error chart is right in Asia/Kolkata, UTC and America/New_York, and engine counts are retried by themselves after a failed write. QA-007 E1 stays blocked on Windows.

## Checks

| # | Result | Evidence |
| --- | --- | --- |
| A1 | PASS | `npm test` exit 0 with Git Bash as script shell and also with npm's default shell (exit 0, `all passing`) |
| A2 | PASS | `accounts-admin.test.js` ends `all passing`; `enginehistory.test.js` ends `all 21 passing` |
| B1 | PASS | C15 `{"code":"self_ban"...}|400`; C16 `400`; C17 `{"code":"exists",...}|409` (first add of the range `200`). `grep -ci "TypeError\|ERR_HTTP_HEADERS_SENT"` on the server log: `0` |
| B2 | PASS | `POST /api/admin/sessions/94955085cadb0a9d/ban-ip` `{"reason":"short"}`: `{"code":"invalid","error":"Say why, in 8 to 500 characters..."}|400`; `GET /api/me` with the user's cookie afterwards `200`; `grep -ci error` on the log `0` |
| B3 | PASS | `{"reason":"a proper reason here","days":3}`: `200`, `ban.target "hash:6a4df98ce34c"`; `/api/me` afterwards `401` (session ended); TypeError lines still `0` |
| C1 | PASS | database timezone `Asia/Kolkata` (confirmed with `show timezone`): C1 `401` then `200` with `"errors":[]`; after the broken `disputes` table and 3+3 failing calls (all `500`), C4 groups `http error 3 GET /api/admin/disputes failed...` and `server error 3 relation "disputes" does not exist`; C6 `series` 24 entries, last `{"hour":"2026-11-04T19:00:00.000Z","errors":6,"warnings":0}`, `totals.error` 6, the only non-zero bucket is that hour |
| C2 | PASS | `UTC` and `America/New_York`: identical results (last bucket `errors` 6 at `19:00:00.000Z`, `totals.error` 6, one non-zero bucket). No `TypeError` in the logs. |
| D1 | PASS | table renamed under the running server with the poke script: `/api/health` 200; log lines `[engine-history] could not save usage, will try again: relation "engine_usage_daily" does not exist` appeared at t+5, 10, 25 and 50 s (1, 2, 3, 4 lines in 70 s): the pauses lengthen, no flood |
| D2 | PASS | table renamed back, no new calls, polled every 5 s: the `openai` row appeared after **25 s** with `calls` 2; 20 s later still 2 (not doubled); `day` shown as `2026-11-04` (UTC day; the database timezone was Asia/Kolkata at about 00:45 on 11-05 local time, so the day did not move with the timezone) |
| D3 | PASS | 3 calls at 3 s, table restored at 14 s, one more call at 25 s: total 3 at t+24 s (the retry), 4 at t+29 s, then 4 for 100 s more; final `calls` 4, cost 0.012 |
| E1 | BLOCKED (Windows cannot send SIGTERM to node) | n/a, as stated |

## Anything else you noticed

- Nothing new. The run used the original QA-001, QA-002 and QA-007 setups on `cb1b0cc` with fresh databases (`sk_qa014a`, `sk_qa014c`, `sk_qa014d`, all dropped).

## Environment problems

- No Docker daemon: native PostgreSQL 16.15. 127.0.0.1 instead of localhost. SIGTERM unavailable (E1).
