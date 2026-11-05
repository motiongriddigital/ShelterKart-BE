---
id: QA-015-encrypted-backups
status: fail
tested_sha: 08ff3df
machine: Windows 11, node v24.20.0, Git Bash, native PostgreSQL 16.15 on 127.0.0.1:5432 (pg_dump, pg_restore, psql, createdb from the PostgreSQL 16 bin folder)
finished: 2026-11-05
---

# Result for QA-015-encrypted-backups

## Summary

The backups themselves work on Windows: encrypted files are produced, hash correctly, decrypt and restore into a scratch database (5,000 rows identical), wrong keys and damaged files are refused, and rotation, keep, the off state, the schedule and the restart rules all behave. Two checks fail: when the database cannot be reached, the notice and list routes answer 500 instead of `level: error` and a failed row (E1, E2); and the manual-run quota (3 an hour) is used up by unauthenticated requests, which an outsider can use to block the admin's Run button (finding under F2).

## Checks

| # | Result | Evidence |
| --- | --- | --- |
| A1 | PASS | `all 18 passing` |
| A2 | PASS | `npm test` exit 0 (default npm shell); `ok   migrations: exactly the seventeen, in the documented order, each present on disk` |
| B1 | PASS | fresh database: `applied backups.sql`, `17 applied, 0 already applied`; again `0 applied, 17 already applied`; `\d backups` shows index `backups_started_idx btree (started_at DESC)` |
| C1 | PASS | `GET /api/admin/backups`, `/notice`, `/keys` and `POST /run`: `401` with no login and `401` with a wrong password, all four |
| C2 | PASS | `{"notice":{"level":"warn","text":"No backup has been taken yet.","lastOkAt":null,"nextDueAt":null,"overdue":true,"everyDays":14}}` |
| C3 | PASS | `200 {"backup":{"id":1,"fileName":"db-20261105T070407Z-q1.skbk","sizeBytes":238306,"sha256":"5d56bc6b...4a44","keyId":"q1"}}`; the file is in the backup folder, 0 `.partial` files |
| C4 | PASS | `sha256sum` of the file equals the `sha256` in C3 (`5d56bc6b5fd20909122b27031ad663d0269afdaaf14e7cd29d531a72a69c4a44`) |
| C5 | PASS | `GET /api/admin/backups`: `"enabled":true,"everyDays":14,"keep":6,"destination":"folder"`, one row `status ok`, `trigger manual`; the table row (id 1, ok, manual, q1, same file name and sha256) matches |
| C6 | PASS | notice `{"level":"ok","text":"Last backup 2026-11-05; next due 2026-11-19."...}` (14 days out); keys `[{"id":"q1","active":true,"firstUsedAt":"2026-11-05T07:04:07.878Z","ageDays":0}]` |
| C7 | PASS | key text (and the key's raw bytes) found 0 times in: the server log, the C3 output, C5 output, C6 output, `select * from backups`, and the backup file |
| C8 | PASS | the file starts `SKBK1`; neither `md5('1')` (`c4ca4238...`) nor `CREATE TABLE`, `PGDMP`, `demo` appear in it |
| D1 | PASS | `[backup-decrypt] ok: key q1 -> ...restored.dump`, exit 0, 238,270 bytes |
| D2 | PASS | `pg_restore --no-owner --dbname=postgres://...sk_qa15_drill` exit 0; `select count(*), min(a), max(a) from demo` gives `5000 | 1 | 5000` |
| D3 | PASS | wrong key: `[backup-decrypt] failed: wrong key or the file was changed`, exit 1, no output file |
| D4 | PASS | one byte flipped in the middle: same message, exit 1, no output file |
| D5 | PASS | truncated by 10 bytes: `failed: wrong key or the file was changed` (exit 1); plain text file: `failed: not a ShelterKart backup file` (exit 1); missing path: `failed: ENOENT: no such file or directory, open '...nothere.skbk'` (exit 1); no stack traces and no output files |
| E1 | FAIL | second server on port 4052 with `DATABASE_URL=...does_not_exist`: `POST /run` gave `502 {"code":"failed","error":"The backup failed: database \"does_not_exist\" does not exist"}` (no password and no `postgres://` in it: that part passes), but `GET /api/admin/backups/notice` answered `{"ok":false,"error":"Internal server error"}` (500), not `level` `error`, because it reads the `backups` table through the same unreachable database |
| E2 | FAIL (as written) | no partial file in the second server's backup folder (it is empty). `GET /api/admin/backups` also answered `500 {"ok":false,"error":"Internal server error"}`, so there is no `failed` row to show; with a database that does not exist the failed attempt cannot be recorded. Log: 0 hits for the password or `postgres://`. |
| E3 | PASS (with a finding) | After stopping the second server a run on the first gave `429 "Too many requests"`, not `200`: see the finding under F2. After a restart (limiter reset) runs succeed (`200`). A failure on the other server did not wedge anything. |
| F1 | PASS | database 206 MB (3,000,000-row table): two runs at once: one `200` (id 2, 66,689,389 bytes, 7 s) and one `409 {"code":"running","error":"A backup is already running."}`; exactly one new `.skbk` file, no `.partial` |
| F2 | PASS (with a finding) | after restart: F1 used two requests (200, 409); the third request was `200`, the fourth `429 {"error":"Too many requests. Please try again later."}`. Finding: the quota counts every request to `POST /run`, including ones refused with `401`. After a restart, three unauthenticated `POST /run` (`401 401 401`) made the next authenticated run `429`. That is why E3 was `429` after only one real run (C3 plus the four `401`s in C1). Anyone who can reach the API can block the manual backup for an hour. |
| G1 | PASS | `BACKUP_KEEP=2`, fresh folder, three backups (`200 200 200`): exactly two `.skbk` files remain (the newest two, `...070552Z` and `...070553Z`), 0 `.partial`; the table has three new rows (ids 4, 5, 6, all `ok`) and `GET /backups` lists all of them (6 rows in total, `keep` 2) |
| G2 | PASS | restart with `BACKUP_KEY_ID=q2` plus q1 and q2: new file `db-20261105T070559Z-q2.skbk`; `GET /keys`: q1 `active:false`, q2 `active:true`; the old q1 file decrypts with q1 (`ok: key q1`); the q2 file decrypts with q2 only (`ok: key q2`); with only q1 set: `failed: no key for id q2`, exit 1 |
| G3 | PASS | no `BACKUP_KEY_ID`: `enabled:false`; notice `level:"off","text":"Backups are not set up yet."`; `POST /run` `409 {"code":"not_configured","error":"Backups are not set up: a key and a database are needed."}`; `/api/health` 200 |
| G4 | PASS (note) | `BACKUP_KEY_q1=abc`: server up (`/api/health` 200), `enabled:false`, notice `level:"off"`; the log has no backup line and no key text. Note: nothing in the log tells the operator that the key was rejected as malformed. |
| H1 | PASS | `BACKUP_EVERY_DAYS=1`, fresh database, no calls: a row `trigger schedule`, `status ok` (id 1, `db-20261105T070828Z-q1.skbk`) appeared after 123 s; the file exists |
| H2 | PASS | restarted and waited 150 s: still one row and one file (no second scheduled backup) |
| I1 | PASS (with changes) | the Restore section in Git Bash: step 1 (`node tools/backup-decrypt.js`) as written, `ok: key q1`; step 2 needed `createdb` with `-h 127.0.0.1 -U postgres` and a password (`PGPASSWORD`), otherwise it waits for a password prompt; `pg_restore --no-owner --dbname=postgres://.../shelterkart_drill restored.dump` worked as written once the URL is filled in; the restored database had 60 tables and 1 `backups` row; step 4 (`dropdb`, delete the dump) fine |
| Crash | PASS | hard kill (taskkill /F) 2 s into a run on the 206 MB database: the `backups` row stayed `running` and a 20,234,260-byte `.db-...skbk.partial` file stayed in the folder. After restart, within 5 s `GET /backups` showed `{"id":8,"status":"failed","error":"the server stopped during this backup"}` and the partial file was gone (folder empty); no scheduled run started because a good backup was recent. |

## Anything else you noticed

- The run quota should count only authenticated requests (put the rate limiter after `adminAuth`, or count only the allowed ones). Other routes that mount `rateLimit` before `adminAuth` may have the same weakness.
- `GET /api/admin/backups/notice` cannot report a problem when the database is unreachable (500); an operator relying on the notice would see an error, not a warning.
- A malformed `BACKUP_KEY_<id>` switches backups off silently.
- The first scheduled backup starts about two minutes after the server starts (123 s here).

## Environment problems

- No Docker daemon; native PostgreSQL 16.15 on port 5432. Databases `sk_qa15`, `sk_qa15b`, `sk_qa15_drill`, `sk_qa15h` were created and dropped. The Windows `createdb` needs `-h`, `-U` and a password. 127.0.0.1 instead of localhost. The keys were random per run and kept only in temp files that were removed; none is in this report.
