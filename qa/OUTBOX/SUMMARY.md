# QA summary: QA-001 to QA-013

Finished: 2026-11-05 (QA machine time)
Machine: Windows 11 Pro, node v24.20.0, npm 11.2.0, Git Bash, Chromium installed for `npm test`, python3 through a `python3.cmd` shim
Database mode: native PostgreSQL 16.15 on port 5432 (Docker is installed but its daemon is not running; one fresh database per item, dropped afterwards). QA-003, QA-010 and QA-013 need no database.

| Item | Result (pass / fail / blocked) | One-line reason |
| --- | --- | --- |
| QA-001 | fail | D5: each rejected `POST /api/admin/bans` (self ban, too wide, duplicate) logs a `TypeError` and `ERR_HTTP_HEADERS_SENT`; clients get the right 4xx |
| QA-002 | fail | C6: error summary `series` is all zeros when the database timezone is +05:30 (Asia/Calcutta) |
| QA-003 | fail | crawl finds 1 page, unknown admin paths answer 200, marketing/social lack the "live backend" text, "Database backups" still in code |
| QA-004 | PASS (earlier result, not rerun) | |
| QA-005 | pass | country from the header only, totals add up, 5,000 users in 0.05 s |
| QA-006 | pass | failed jobs, retry (no mail, no charge) and register history all as specified |
| QA-007 | fail | F2: held counts are not written after the table returns until a later call arrives; E1 blocked on Windows |
| QA-008 | fail | unknown admin paths answer 200 not 404 (C7); crawl 1 page (C8); B2 cannot run as written |
| QA-009 | fail | `/admin/map/zz` answers 200 not 404 (D2); crawl 1 page (D1) |
| QA-010 | pass | contact removed from the reader's report; old commit fails the test as expected; no other reader route returns it |
| QA-011 | pass | flag off registers nothing; free, refunded and pending readers refused; cost model matches |
| QA-012 | pass | five actions audited under `admin:maya`; refusals write nothing; missing ledger gives `audited:false` |
| QA-013 | pass | stranger's request no longer replaces the owner's code; 20-a-day absorb confirmed over a 20-minute run |

## Owner Part M (not run)

- QA-003: M1 to M7 (login page, sidebar, dashboard, dark theme, user map hover and full screen, 390 px width, bans dialog)
- QA-008: M1 to M6 (sign-in, real accounts on the Users screens, ban and lift, ban from a session, back end stopped, dark theme and 390 px)
- QA-009: M1 to M4 (map shaded by real numbers, tooltip and full screen, back end stopped, dark theme and 390 px)

## Blocked checks

- QA-007 E1: Windows cannot send SIGTERM to a node process from Git Bash, so the graceful flush on stop could not be tested (`kill -TERM` ended the process and the 2 waiting calls were not written; E2 and E3 behaved as the prompt says).
- QA-013 E2: not attempted (no ban created); marked n/a.

## Failures for the builder

- QA-001 D5: `grep -ci error /tmp/sk-qa-server.log` gave 9; `TypeError: Cannot read properties of undefined (reading 'startsWith') at banRow (accounts\admin.js:37:67) at accounts\admin.js:136:31`, then `Error [ERR_HTTP_HEADERS_SENT]`, for each of C15, C16, C17.
- QA-002 C6: `curl -u qa:qa-pass-123 "$B/api/admin/errors/summary?hours=24"` gave `series[last]` `{"errors":0,"warnings":0}` with `totals.error` 6 under timezone Asia/Calcutta; after `alter database ... set timezone='UTC'` it gave `"errors":6` (`engine/errorlog.js:65`, `date_trunc('hour', at)` in the session timezone).
- QA-003 B1: `node crawl.mjs` printed `200 BAD-BODY /admin 13869b` and `pages: 1`.
- QA-003 B2: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/admin/does-not-exist` gave `200` (and `/admin/users/does-not-exist` `200`).
- QA-003 B5: `curl -s .../admin/marketing | grep -io "live backend"` printed nothing (same for `/admin/social`).
- QA-003 C1: `grep -rn "Database backups" src` matched `src/constants/adminNav.ts:220` and `src/constants/adminPanels.ts:114`.
- QA-007 F2: after `alter table eud_x rename to engine_usage_daily`, the `openai` row stayed at 0 calls for 40 s while idle; written only when a later call arrived (3 calls, not doubled).
- QA-008 C7: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/admin/nope` gave `200` (also `/admin/sales/some-id` `200`, expected 404).
- QA-008 C8 and QA-009 D1: crawl `pages: 1`.
- QA-008 B2: a third `npm run test:api` ran into `429` at `check-admin-people.mjs:70` because each run uses about 10 of the 20 allowed refused requests; 25 wrong passwords then gave `429` x25.
- QA-009 D2: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/admin/map/zz` gave `200` (expected 404).

Also noted (not failures): `npm test` fails on Windows with the default npm shell at QA-011 (`'PREMIUM_SEARCH_TEST' is not recognized`); `format:check` fails on a default Windows clone because of CRLF (QA-003); QA-012 audits actions on ids that do not exist and stores an e-mail address pasted into a purge url.
