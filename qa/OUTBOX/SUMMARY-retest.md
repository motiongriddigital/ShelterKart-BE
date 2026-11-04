# QA retest summary (round 2): QA-014, QA-003, QA-008, QA-009

Finished: 2026-11-05 (QA machine time)
Machine: Windows 11 Pro, node v24.20.0, npm 11.2.0, Git Bash, Chromium for `npm test`, python3 through a `python3.cmd` shim
Database mode: native PostgreSQL 16.15 on port 5432 (Docker daemon not running); a fresh database per section, dropped afterwards. QA-003 needs no database.

| Item | Result (pass / fail / blocked) | One-line reason |
| --- | --- | --- |
| QA-014 | pass | refused bans log no error and keep the session; the error chart is right in Asia/Kolkata, UTC and America/New_York; engine counts retry by themselves (row appeared after 25 s, not doubled) |
| QA-003 | pass | gates clean, all 46 admin routes 200, unknown addresses show the not-found page, marketing/social show the sign-in gate |
| QA-008 | pass | `test:api` 32 checks twice, limiter as described, every action waits for the server, not-found behaviour as described |
| QA-009 | pass | `test:api` 41 checks twice, map reads the live store, 47 routes 200, `zz` is the not-found page |

## Owner Part M (not run)

- QA-003: M1 to M7
- QA-008: M1 to M6
- QA-009: M1 to M4

## Blocked checks

- QA-014 E1 (= QA-007 E1): Windows cannot send SIGTERM to node, so the clean-stop flush cannot be tested here.

## Failures for the builder

None in this round.

Notes (not failures): the page titles of 44 of 46 admin screens are all `ShelterKart — Admin`; `package.json`, `postcss.config.mjs` and the lockfile changed outside the admin folders (QA-003 C3); on Windows `format:check` needs a clone with `core.autocrlf=false`; the phrase "could not be found" is embedded in every admin page, so scripts must use the marker `NEXT_HTTP_ERROR_FALLBACK;404` to tell a not-found page from a real one.
