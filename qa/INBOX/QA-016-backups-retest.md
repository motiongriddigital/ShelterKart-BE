---
id: QA-016-backups-retest
title: Retest of QA-015 failures: backup notice and list with the database down, manual-run quota, malformed key log
repo: ShelterKart-BE
branch: feature/admin-backups
sha: b29bdaf
created: 2026-11-05
---

# QA-016: backups retest

You are the QA agent. Your job is to verify, not to build. Read `qa/README.md` first and follow its rules. Terminal only, no browser. Use Git Bash and the native PostgreSQL 16 on this machine, exactly as in QA-015 (`pg_dump`, `pg_restore`, `psql` and `createdb` on PATH; `createdb` needs `-h 127.0.0.1 -U postgres` and `PGPASSWORD`; 127.0.0.1 instead of localhost; `T=$(cygpath -m /tmp)`; stop servers by process id). A fresh database for each section.

## What is under test

ShelterKart-BE, branch `feature/admin-backups`, commit `b29bdaf` (one commit on top of `08ff3df`, which you tested in QA-015). It fixes what QA-015 reported:

1. E1 and E2: with the database unreachable, `GET /api/admin/backups/notice`, `GET /api/admin/backups` and `GET /api/admin/backups/keys` no longer answer 500.
2. F2 finding: the manual-run limit (3 an hour) counted every `POST /api/admin/backups/run`, including requests refused with 401. It now counts only requests that passed the admin login.
3. G4 finding: a malformed `BACKUP_KEY_<id>` switched backups off with nothing in the log. The server now logs why, without the key.
4. I1 finding: the restore runbook in `docs/admin/BACKUPS-DESIGN.md` now shows `PGPASSWORD`, `-h` and `-U`.

The unit test file now ends `all 21 passing` (it was 18).

## Setup

Same as QA-015 (`qa/INBOX/QA-015-encrypted-backups.md`, Setup): clone ShelterKart-BE as `sk-be16`, `git checkout b29bdaf`, `cd backend && npm ci`, create `sk_qa16`, `node tools/migrate.js` from the repo root, the `demo` table with 5,000 rows, two random 64-hex keys `K1` and `K2`. Start the server on port 4061 with `BACKUP_KEY_ID=q1 BACKUP_KEY_q1=$K1`, `BACKUP_DIR=$T/sk-qa16-bk`, admin login `maya:qa-pass-123`, `B=http://127.0.0.1:4061`. Never print or commit a key.

## Checks

For every check write PASS or FAIL and, on FAIL, the exact command and output.

| # | Do this | Expect |
| --- | --- | --- |
| A1 | in `backend`: `node test/backups.test.js` | ends `all 21 passing` |
| A2 | `npm test` (mark BLOCKED with the reason if Playwright or python3 is missing) | exit code 0 |
| B1 | one `POST /api/admin/backups/run` with the login, then `GET /backups`, `/notice`, `/keys` | `200` for the run; notice `level` `ok`; `recordsAvailable` is `true` in the list; the backup file decrypts with `tools/backup-decrypt.js` and `K1` and restores into a scratch database with 5,000 rows (a short regression of QA-015 C3, C5, D1, D2) |
| C1 | second server on port 4062 with `DATABASE_URL` pointing at a database that does not exist (same key and a different empty `BACKUP_DIR`); with the login: `POST /run` | `502`, `code` `failed`; the error text has no password and no `postgres://` |
| C2 | same server: `GET /notice` | `200` (not 500), `notice.level` `error`, `notice.recordsAvailable` `false` |
| C3 | same server: `GET /api/admin/backups` | `200`, `recordsAvailable` `false`, `backups` holds one row with `status` `failed` and the same error text as C1 |
| C4 | same server: `GET /api/admin/backups/keys` | `200`; key `q1` is listed with `firstUsedAt` `null` |
| C5 | search the second server's log and every response in C1 to C4 for the database password and for `postgres://` | 0 hits |
| C6 | stop the second server; no `.partial` file in its backup folder | none |
| D1 | restart the first server (resets the limiter). Send `POST /run` four times with NO login and four times with a WRONG password | all eight answer `401`, none `429` |
| D2 | straight after D1: `POST /run` with the login | `200` (it was `429` in QA-015) |
| D3 | `POST /run` with the login twice more, then a fourth authenticated request in the same hour | the first two `200` or `409 running` (never `429`), the fourth authenticated request after three counted runs answers `429` |
| D4 | `GET /notice` and `GET /backups` while limited | still `200`: only `POST /run` is limited |
| E1 | start a server with `BACKUP_KEY_ID=q1` and `BACKUP_KEY_q1=abc` (not 64 hex characters) | `/api/health` is 200, `enabled` false, `POST /run` answers `409 not_configured` |
| E2 | the log of that server | one line saying backups are off and why (it names `BACKUP_KEY_<id>` and 64 hexadecimal characters), and the text `abc` appears nowhere in the log |
| E3 | start a server with `BACKUP_KEY_ID` unset and no key variable | no such warning line in the log |
| E4 | start a server with `BACKUP_KEY_ID=bad id!` | backups off; the log line says the key id is invalid; no stack trace |
| F1 | follow the Restore section of `docs/admin/BACKUPS-DESIGN.md` exactly as now written, filling in the placeholders | works with no change to the commands (the earlier run needed `-h`, `-U` and a password) |
| F2 | read the same section | the first scheduled backup is described as starting about two minutes after the server starts |

## Look hardest at

- D2 and D3: that the limiter really sits after the admin login on a server that is behind the usual order of middleware (the first limiter, 300 requests in 15 minutes, is meant to stay before the login as a brute-force guard; if you can show a `429` on unauthenticated `POST /run` after 300 attempts, that is expected, report it as a note).
- C2 and C3 when the database goes away AFTER the server started: with the first server running, stop PostgreSQL's connection to `sk_qa16` (for example `pg_terminate_backend` of its sessions and `ALTER DATABASE sk_qa16 ALLOW_CONNECTIONS false`, then undo it), call `/notice` and `/backups`. Expect `200`, `level` `error`, `recordsAvailable` `false`, and a normal answer again after you undo it. Report the exact output.
- Any other admin route that answers 500 or `429` for an unauthenticated request it should have refused with 401 (list the route and the output; do not fix anything).

## Report

Write `qa/OUTBOX/QA-016-backups-retest.md` from `qa/RESULT-TEMPLATE.md`, then commit and push as in `qa/README.md` (`git add qa/OUTBOX && git commit -m "qa: QA-016 <pass|fail|blocked>" && git pull --rebase origin ops/admin-plan-and-qa && git push origin ops/admin-plan-and-qa`). Finish by printing the result table.
