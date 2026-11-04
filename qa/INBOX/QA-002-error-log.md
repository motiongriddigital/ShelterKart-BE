---
id: QA-002-error-log
title: Grouped, scrubbed error log and its admin routes
repo: ShelterKart-BE
branch: feature/admin-error-log
sha: fbe6149
created: 2026-11-04
---

# QA-002: grouped, scrubbed error log and its admin routes

You are the QA agent. Your job is to verify, not to build. Read `qa/README.md` first and follow its rules.

## What is under test

Repository ShelterKart-BE, branch `feature/admin-error-log`, commit `fbe6149` (stacked on QA-001's branch). Every `console.error` and `console.warn` is also written to a database log that groups repeats, scrubs personal data, and is read through three admin routes. It adds the fourteenth migration.

## What the builder did and how it was tested

Built: `backend/engine/errorlog.js` mirrors every `console.error` and `console.warn` into a grouped, scrubbed, flood-throttled log (30 days), the fourteenth migration `error_log.sql`, and three admin routes. Tested by the builder: 17 unit checks (`test/errorlog.test.js`), 5 server checks through the real route handlers, the whole `npm test`, and a run against a real Postgres. Not tested by the builder: the flood and `ERROR_LOG=off` steps below, run end to end.

## Setup

Same as QA-001 Setup, but check out `fbe6149` and use port 5496 for Postgres and container name `sk-qa-pg2`:

```
git clone https://github.com/motiongriddigital/ShelterKart-BE.git sk-under-test2 && cd sk-under-test2
git checkout fbe6149 && cd backend && npm ci && cd ..
docker run -d --name sk-qa-pg2 -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=sk -p 5496:5432 postgres:16
export DATABASE_URL=postgres://postgres:pw@localhost:5496/sk
```

## Checks

| # | Do this | Expect |
| --- | --- | --- |
| A1 | in `backend`: `node test/errorlog.test.js` | ends with `all passing`; 16 lines starting `  ok` |
| A2 | `node -r ./test/harness/stub-loader.js test/harness/errorlog.test.js` | ends with `all passing` |
| A3 | `npm test` (Playwright and python3 needed; mark BLOCKED with the reason if missing) | exit code 0 |
| B1 | from the repo root `node tools/migrate.js` twice | `14 applied, 0 already applied`, then `0 applied, 14 already applied` |
| B2 | `docker exec sk-qa-pg2 psql -U postgres -d sk -c "\d error_log" -c "\d error_hits"` | tables exist; `error_log.fingerprint` is unique; `error_hits.error_id` references `error_log` with ON DELETE CASCADE |

Start the server in `backend`:

```
NODE_ENV=development PORT=4011 ADMIN_USERNAME=qa ADMIN_PASSWORD=qa-pass-123 ACCESS_TOKEN_SECRET=x QUOTE_SECRET=x PAYMENT_WEBHOOK_SECRET=x node server.js > /tmp/sk-qa2-server.log 2>&1 &
```

`B=http://localhost:4011`, `ADM="-u qa:qa-pass-123"`.

| # | Do this | Expect |
| --- | --- | --- |
| C1 | `curl -s -o /dev/null -w '%{http_code}' $B/api/admin/errors` then with `$ADM` | `401`, then `200` with `"errors":[]` (or only startup lines) |
| C2 | Break something on purpose: `docker exec sk-qa-pg2 psql -U postgres -d sk -c "alter table disputes rename to disputes_x"` | `ALTER TABLE` |
| C3 | Three times: `curl -s $B/api/admin/stats $ADM` and three times `curl -s $B/api/admin/disputes $ADM` | both answer `500` with a clean JSON error, no stack trace, no SQL text |
| C3b | Wait two seconds (a short burst is written by a timer, not at once) | |
| C4 | GET `$B/api/admin/errors` with `$ADM` | at least one group with `level` `error`. One group should have source `server` and a message about `relation "disputes" does not exist` (the stats route); one should have source `http` and a message starting `GET /api/admin/disputes failed:`. Each has `count` 3. If the shape differs, report exactly what you got. |
| C5 | GET `$B/api/admin/errors?q=disputes&level=error` and `?level=warn` | the first returns the groups, the second returns none of them |
| C6 | GET `$B/api/admin/errors/summary?hours=24` | `series` has 24 entries; the last one has `errors` at least 6; `totals.error` at least 6; `topSources` lists `server` and `http` |
| C7 | GET `$B/api/admin/errors/<id from C4>` | `error.hits` has at least one entry with `times` |
| C8 | GET `$B/api/admin/errors/abc` and `/api/admin/errors/99999` | `400` and `404` |
| C9 | `docker exec sk-qa-pg2 psql -U postgres -d sk -c "select source, level, count, left(message,60) from error_log"` and `-c "select count(*), sum(n) from error_hits"` | rows match C4; `sum(n)` equals the sum of the counts |
| C10 | In that output look for any e-mail address, IP address or long token | none |
| C11 | Restore: `alter table disputes_x rename to disputes`. Request `/api/admin/disputes` and `/api/admin/stats` | `200` |
| C12 | Stop the server. Restart it with `ERROR_LOG=off` added. Rename the table again, call `/api/admin/stats` three times, rename back. Then `select sum(count) from error_log` | the same total as before this step (nothing new recorded) |
| C13 | Run the first check in C3 once more with the log on and then `grep -c "failed" /tmp/sk-qa2-server.log` | the original line is still printed to the log file (the log is mirrored, not replaced) |

## Look hardest at

- Whether the server's behaviour changed in any way except the extra rows: response codes, response bodies and timing for the failing routes must be exactly what they were before.
- Whether a flood (use `for i in $(seq 1 200); do curl -s -o /dev/null $B/api/admin/stats $ADM; done` with the table renamed) stays fast, wait three seconds, then `count` in `error_log` equals 200 more than before (a timer writes the held count about one second after a burst), with only a few `error_hits` rows (they are throttled to one per second per problem).
- Any 500 from the three new routes themselves.

## Teardown

Stop the server; `docker rm -f sk-qa-pg2`.

## Report

Write `qa/OUTBOX/QA-002-error-log.md` from `qa/RESULT-TEMPLATE.md`, then commit and push as in `qa/README.md`.
