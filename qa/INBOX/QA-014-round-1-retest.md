---
id: QA-014-round-1-retest
title: Retest of the three back-end failures from round 1 (QA-001 D5, QA-002 C6, QA-007 F2)
repo: ShelterKart-BE
branch: fix/qa-round-1
sha: cb1b0cc
created: 2026-11-05
---

# QA-014: round 1 retest

You are the QA agent. Your job is to verify, not to build. Read `qa/README.md` first and follow its rules. Terminal only, no browser. Use Git Bash and the native PostgreSQL you installed in the last run (fresh database per section, as before).

## What is under test

ShelterKart-BE, branch `fix/qa-round-1`, commit `cb1b0cc` (stacked on `feature/admin-engines`, `4ac4f0b`, so it holds everything from QA-001 to QA-007; migrations: 16). Three fixes:

1. QA-001 D5: a refused `POST /api/admin/bans` (and `/api/admin/sessions/:id/ban-ip`) no longer runs on to a second reply, so no `TypeError` and no `ERR_HTTP_HEADERS_SENT` in the log, and a refused ban-ip no longer ends the session.
2. QA-002 C6: the hourly error chart buckets by UTC hour whatever the database timezone is.
3. QA-007 F2: after a failed write the engine counts are retried by themselves after a growing pause (6 s, 12 s, 24 s ... up to 60 s with the default 3 s flush), not only when a later call arrives.

## Setup

Clone `https://github.com/motiongriddigital/ShelterKart-BE.git` as `sk-be14`, `git checkout cb1b0cc`, `cd backend && npm ci`. For each section below use the Setup of the original prompt (QA-001, QA-002, QA-007) with this checkout instead of its own SHA, a fresh database, and `node tools/migrate.js` from the repo root.

## Checks

| # | Do this | Expect |
| --- | --- | --- |
| A1 | in `backend`: `npm test` (Git Bash) | exit code 0 |
| A2 | `node -r ./test/harness/stub-loader.js test/harness/accounts-admin.test.js`; `node test/enginehistory.test.js` | `all passing`; `all 21 passing` |
| B1 | Repeat QA-001 C15, C16, C17 (self ban, too-wide range, repeated ban), then QA-001 D5 | each answers `400`, `400`, `409`; `grep -ci "TypeError\|ERR_HTTP_HEADERS_SENT" <server log>` is `0` |
| B2 | Sign in a user, take their session id from `GET /api/admin/sessions`, `POST /api/admin/sessions/<id>/ban-ip` with `{"reason":"short"}` | `400`; the user's cookie still works on `GET /api/me`; no error line in the log |
| B3 | The same ban-ip with a proper reason (8 or more characters) | `200`; the session is ended |
| C1 | Set the database timezone: `alter database <db> set timezone='Asia/Kolkata'`, restart the server, then repeat QA-002 C1 to C6 | C6: the last `series` entry has `errors` at least 6, `totals.error` at least 6 |
| C2 | Repeat C6 with the timezone `UTC`, and with `America/New_York` | the same: errors counted in the right hour in both |
| D1 | Repeat QA-007 F1 (break the table, wait, health 200, a few `[engine-history] could not save usage` lines, not a flood) | as in the original |
| D2 | Rename the table back and then wait, with NO new calls, polling the table every 5 s for up to 75 s | the `openai` row appears by itself within 75 s, with the right count (not doubled); report the seconds it took |
| D3 | Break the table again, make 3 calls, restore the table at 14 s, make one more call at 25 s | the total is 4, not more |
| E1 | QA-007 E1 stays BLOCKED on Windows; say so | n/a |

## Look hardest at

- A refused ban that still did something afterwards (B2).
- Any place the chart is still off by half an hour (C1, C2); also look at the engine history table if it shows days: they are UTC days and should not move with the database timezone.
- A retry flood in the log while the table is down (D1): the pauses should lengthen.

## Teardown

Stop the server, drop the databases, remove temp files.

## Report

Write `qa/OUTBOX/QA-014-round-1-retest.md` from `qa/RESULT-TEMPLATE.md`, then commit and push as in `qa/README.md`.
