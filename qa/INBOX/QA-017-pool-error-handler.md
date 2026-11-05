---
id: QA-017-pool-error-handler
title: The API stays up when the database drops an idle connection
repo: ShelterKart-BE
branch: fix/pool-error-handler
sha: 5f4b389
created: 2026-11-05
---

# QA-017: pool error handler

You are the QA agent. Your job is to verify, not to build. Read `qa/README.md` first and follow its rules. Terminal only, no browser. Same Windows setup as QA-015 and QA-016 (Git Bash, native PostgreSQL 16, `createdb` needs `-h 127.0.0.1 -U postgres` and `PGPASSWORD`, 127.0.0.1 instead of localhost, stop servers by process id, a fresh database per section).

## What is under test

ShelterKart-BE, branch `fix/pool-error-handler`, commit `5f4b389`, one commit on top of `main` (`247e621`), so it does NOT contain the admin panel or the backups. It fixes the finding from QA-016: the database pool had no `error` listener, so `pg_terminate_backend` (or a database restart) on an idle connection killed the whole API process. New: `backend/engine/poolGuard.js`, the pool in `backend/server.js` is created through it, `backend/test/poolguard.test.js` (5 checks).

## Setup

Clone ShelterKart-BE as `sk-be17`, `git checkout 5f4b389`, `cd backend && npm ci`. Create `sk_qa17`, run `node tools/migrate.js` from the repo root. Start the server in `backend` on port 4071: `NODE_ENV=development PORT=4071 DATABASE_URL=postgres://postgres:<password>@127.0.0.1:5432/sk_qa17 ADMIN_USERNAME=maya ADMIN_PASSWORD=qa-pass-123 ACCESS_TOKEN_SECRET=x QUOTE_SECRET=x PAYMENT_WEBHOOK_SECRET=x node server.js > /tmp/sk-qa17.log 2>&1 &`. `B=http://127.0.0.1:4071`.

## Checks

| # | Do this | Expect |
| --- | --- | --- |
| A1 | in `backend`: `node test/poolguard.test.js` | ends `all 5 passing` |
| A2 | `npm test` (BLOCKED with the reason if Playwright or python3 is missing) | exit code 0 |
| B1 | `GET $B/api/health` and one request that uses the database (for example `GET $B/api/admin/analytics/summary` with the admin login, or any route that queries) | 200 |
| B2 | with a request that keeps the pool warm done, run `psql -h 127.0.0.1 -U postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='sk_qa17' and pid <> pg_backend_pid()"` | returns true for each session |
| B3 | wait 3 seconds, then `GET $B/api/health` | 200; the server process is still alive (check its process id) |
| B4 | the same database-using request as B1 | 200 (the pool reconnected); it may fail once with a 500 if it picked up the dead connection, in which case repeat once and report both |
| B5 | `/tmp/sk-qa17.log` | contains `[db] an idle connection failed, the pool will reconnect on the next query:` and NO `Unhandled 'error' event` and no stack trace ending the process; no password and no `postgres://` anywhere in the log |
| C1 | repeat B2 to B4 five times in a row | the server stays up every time |
| C2 | stop PostgreSQL's connections by `ALTER DATABASE sk_qa17 ALLOW_CONNECTIONS false` plus terminate the sessions, wait 15 s, call `/api/health` and a database request, then `ALLOW_CONNECTIONS true` | health 200 throughout; the database request fails cleanly (not a process exit) while blocked and works again after |
| D1 | read `backend/engine/poolGuard.js` | it registers one `error` handler on the pool and scrubs connection strings and passwords; nothing is thrown from it |

## Look hardest at

- Any route that still takes the server down when a connection drops (the process id changes, or `/api/health` stops answering). Report the route and the log lines.
- Whether a request made right after the kill can hang instead of failing or succeeding. Report the time it took.

## Report

Write `qa/OUTBOX/QA-017-pool-error-handler.md` from `qa/RESULT-TEMPLATE.md`, then: `git add qa/OUTBOX && git commit -m "qa: QA-017 <pass|fail|blocked>" && git pull --rebase origin ops/admin-plan-and-qa && git push origin ops/admin-plan-and-qa`. Finish by printing the result table.
