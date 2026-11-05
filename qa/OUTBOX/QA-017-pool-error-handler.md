---
id: QA-017-pool-error-handler
status: pass
tested_sha: 5f4b389
machine: the builder's Mac (macOS, node, PostgreSQL 16 from Homebrew on 127.0.0.1:5497). NOT the independent Windows QA machine: run by the builder on the owner's instruction of 5 November because the Windows QA is no longer running pending tests.
finished: 2026-11-05
---

# Result for QA-017-pool-error-handler (builder run, not independent)

## Summary

The API stays up when the database drops its connections. Five rounds of terminating every session of the server's database, each followed by a database request, all answered 200; with new connections refused the health route stayed 200 and a database request failed cleanly (500), then worked again once connections were allowed. No `Unhandled 'error' event` anywhere in the log.

## Checks

| # | Result | Evidence |
| --- | --- | --- |
| A1 | PASS | `node test/poolguard.test.js`: `all 5 passing` |
| A2 | PASS | `npm test` exit 0 |
| B1 | PASS | `/api/health` 200; `GET /api/admin/stats` with the admin login 200 |
| B2 | PASS | `pg_terminate_backend` ended 4 sessions in each of 5 rounds |
| B3 | PASS | after 3 s: `/api/health` 200; the server process was alive in all 5 rounds |
| B4 | PASS | the database request straight after: 200 and 200 in all 5 rounds, each round took under 1 s (the pool reconnected without a failed request) |
| B5 | PASS | log: 24 lines `[db] an idle connection failed, the pool will reconnect on the next query: terminating connection due to administrator command`; 0 `Unhandled 'error'`; 0 `postgres://`; 0 `password` |
| C1 | PASS | the five rounds above |
| C2 | PASS | `ALTER DATABASE ... ALLOW_CONNECTIONS false` plus terminating the sessions, 15 s wait: health 200, process alive, the database request 500 (an ordinary handled error, logged with a stack, not a process exit); after `ALLOW_CONNECTIONS true`: 200 and 200 |
| D1 | PASS | `backend/engine/poolGuard.js` registers one `error` handler and scrubs connection strings and passwords |

Before the fix (same pool settings, a script against the same database): the process exits with `Unhandled 'error' event ... terminating connection due to administrator command`.

## Anything else you noticed

- Not independent. The Windows machine should repeat this once it is available again.
