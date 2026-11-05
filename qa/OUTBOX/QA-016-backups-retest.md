---
id: QA-016-backups-retest
status: pass
tested_sha: b29bdaf
machine: Windows 11, node v24.20.0, Git Bash, native PostgreSQL 16.15 on 127.0.0.1:5432 (no Docker daemon)
finished: 2026-11-05
---

# Result for QA-016-backups-retest

## Summary

All four QA-015 findings are fixed: with the database unreachable the three read routes answer 200 with `level: error` and `recordsAvailable: false`, unauthenticated `POST /run` no longer uses the admin's run quota, a malformed key now logs why (without the key), and the restore runbook works as written. One new, separate problem turned up while testing "the database goes away": terminating the server's database sessions kills the whole API process (see the findings).

## Checks

| # | Result | Evidence |
| --- | --- | --- |
| A1 | PASS | `all 21 passing` |
| A2 | PASS | `npm test` exit 0, `all passing` |
| B1 | PASS | `POST /run` `200` (`id 1`, `db-20261105T073843Z-q1.skbk`, 238,306 bytes); list: `"recordsAvailable":true`, one `ok` manual row; notice `{"level":"ok","text":"Last backup 2026-11-05; next due 2026-11-19."...}`; keys `q1 active`; `backup-decrypt` with K1: `ok: key q1`, exit 0; `pg_restore` exit 0 into a scratch database: `select count(*) from demo` = `5000`; key text in the log: 0 |
| C1 | PASS | server on 4062 with `DATABASE_URL` for a database that does not exist: `502 {"ok":false,"code":"failed","error":"The backup failed: database \"does_not_exist\" does not exist"}`; no password, no `postgres://` |
| C2 | PASS | `GET /notice` `200`: `{"level":"error","text":"The backup records cannot be read, so the state of the backups is unknown. The last attempt on this server failed.","lastOkAt":null,"nextDueAt":null,"overdue":true,"everyDays":14,"recordsAvailable":false}` |
| C3 | PASS (note) | `GET /api/admin/backups` `200`, `"recordsAvailable":false`, one row `{"id":null,"trigger":"manual","status":"failed","fileName":null,...,"keyId":"q1","error":"database \"does_not_exist\" does not exist"}`. The row's error is C1's text without the prefix "The backup failed: ". |
| C4 | PASS | `GET /keys` `200`: `[{"id":"q1","active":true,"firstUsedAt":null,"ageDays":null}]` |
| C5 | PASS | database password or `postgres://` in C1 to C4 outputs and the second server's log: 0 hits; key text: 0 hits |
| C6 | PASS | second server stopped; its backup folder holds no `.partial` file (nothing was created) |
| D1 | PASS | restarted; `POST /run` with no login x4: `401 401 401 401`; with a wrong password x4: `401 401 401 401`; none `429` |
| D2 | PASS | straight after, `POST /run` with the login: `200` (`id 2`) |
| D3 | PASS | two more authenticated runs: `200`, `200`; the fourth authenticated request: `429 {"error":"Too many requests. Please try again later."}` (three counted runs, as expected) |
| D4 | PASS | while limited: notice `200`, list `200`, keys `200` |
| E1 | PASS | `BACKUP_KEY_q1=abc`: `/api/health` 200; list `"enabled":false`; `POST /run` `409 {"code":"not_configured"}` |
| E2 | PASS | log: `[backups] backups are off: BACKUP_KEY_ID names a key id with no valid BACKUP_KEY_<id> (64 hexadecimal characters).` One line; `abc` appears 0 times |
| E3 | PASS | `BACKUP_KEY_ID` unset: no line containing "backup" in the log (3 normal start lines only) |
| E4 | PASS | `BACKUP_KEY_ID=bad id!`: health 200, `enabled:false`, log `[backups] backups are off: BACKUP_KEY_ID names an invalid key id (1 to 16 letters or digits).`; 0 stack lines |
| F1 | PASS | the Restore section as now written, with the placeholders filled: step 1 `ok: key q1`; `export PGPASSWORD=...`; `createdb -h 127.0.0.1 -U postgres shelterkart_drill` exit 0; `pg_restore --no-owner --dbname=postgres://postgres@127.0.0.1:5432/shelterkart_drill restored.dump` exit 0 (password from `PGPASSWORD`); `select count(*) from demo` = `5000`; drop and delete fine. No command needed a change. |
| F2 | PASS | `BACKUPS-DESIGN.md` says: "The first scheduled backup starts about two minutes after the server starts, then the check runs hourly." |

Look hardest at:

- **Database goes away after the server started.** With `ALTER DATABASE sk_qa16 ALLOW_CONNECTIONS false` and a 15 s wait (so the pool's idle connections closed): `/api/health` 200; `GET /notice` `200 {"level":"error","text":"The backup records cannot be read, so the state of the backups is unknown.",...,"recordsAvailable":false}`; `GET /backups` `200 {"enabled":true,...,"recordsAvailable":false,"backups":[]}`; `GET /keys` `200` (`firstUsedAt` null). After `allow_connections true`: notice `level:"ok"` with the real last backup, list `recordsAvailable:true` with the rows. PASS.
- **Terminating the sessions instead (the prompt's `pg_terminate_backend`)** killed the API process: the log shows `Error: Unhandled 'error' event ... error: terminating connection due to administrator command` at `pg-pool/index.js:62 Client.idleListener`, then `Node.js v24.20.0`; `/api/health` no longer answers. There is no `pool.on('error', ...)` handler in `server.js`, `engine/persistence.js` or `accounts/*.js`. Any database restart, failover or administrator kill of an idle connection stops the whole server. This is not in the backup code and is probably older than this branch, but it matters for production; I did not test an earlier commit.
- **Other admin routes answering 500 or 429 for a request that should be refused with 401:** all 52 `/api/admin/...` routes found in the source (`app.get/post/...`; 39 without the accounts feature plus the 13 account routes with `ACCOUNTS_ENABLED=on`) answered `401` with no login, none `500`, none `429` (with a different `X-Forwarded-For` for each, `TRUST_PROXY=1`). Routes registered in another way than `app.<method>('/api/admin...')` would not have been found by my search.
- **Note, 429 after repeated unauthenticated requests:** from one address, 25 unauthenticated `POST /run` gave `401` x20 then `429` x5, and an authenticated run from the same address then also gave `429`. This is the general admin limiter (20 refused requests per 15 minutes per address), not the backup limiter: the run quota itself is unaffected (D1/D2). Behind a proxy without `TRUST_PROXY` all visitors share one address, so a few failed requests from anyone can lock the admin out for 15 minutes.

## Anything else you noticed

- Nothing else; the four QA-015 findings are closed.

## Environment problems

- No Docker daemon; native PostgreSQL 16.15. Databases `sk_qa16` and `sk_qa16_drill` were dropped; the keys were random temp files that were removed and are not in this report. 127.0.0.1 instead of localhost.
