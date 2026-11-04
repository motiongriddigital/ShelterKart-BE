---
id: QA-001-admin-users-bans
status: fail
tested_sha: 06c003e
machine: Windows 11, node v24.20.0, Git Bash, native PostgreSQL 16.15 on 127.0.0.1:5432 (no Docker daemon)
finished: 2026-11-04
---

# Result for QA-001-admin-users-bans

## Summary

Every functional check passed against a real Postgres and a real server. One check fails: D5, because every rejected `POST /api/admin/bans` (self ban, too-wide range, duplicate) writes a `TypeError` plus `ERR_HTTP_HEADERS_SENT` stack trace from `accounts/admin.js` to the server log, although the client gets the correct 4xx.

## Checks

| # | Result | Evidence |
| --- | --- | --- |
| A1 | PASS | `node test/accounts.test.js` last line `31 passed, 0 failed` (wording differs from "all passing", no failures) |
| A2 | PASS | last line `all passing` |
| A3 | PASS | last line `all passing`; 35 lines starting `  ok` |
| A4 | PASS | `npm test` exit 0 (Chromium installed, python3 shim) |
| B1 | PASS | `13 applied, 0 already applied. Next: node tools/seed_pricing.js` |
| B2 | PASS | `0 applied, 13 already applied.` |
| B3 | PASS | `\d bans` shows `"bans_check" ... bans_kind_check CHECK (kind = ANY (ARRAY['account'::text, 'ip'::text]))`; `auth_events` exists |
| C1 | PASS | `401` then `200` |
| C2 | PASS | `202`, body has `devCode` |
| C3 | PASS | `429` `"code":"cooldown"` |
| C4 | PASS | `400` twice, `attemptsLeft` 4 then 3 |
| C5 | PASS | `200`, `isNewUser":true`, `Set-Cookie: sk_session=...` |
| C6 | PASS | one user qa1, `"disabled":false,"activeSessions":1` |
| C7 | PASS | `{"codesRequested":1,"signIns":1,"wrongCodes":2,"locked":0,...,"cooldownHits":1}`, events `login_ok,code_wrong,code_wrong,cooldown,code_requested`, session ip `960c9d518280` (12 hex), body contains neither the devCode nor `203.0.113.5` (grep count 0) |
| C8 | PASS | `200`, `"active":true`, `expiresAt` 24 h after `createdAt` |
| C9 | PASS | `401` |
| C10 | PASS | `403` `account_banned` |
| C11 | PASS | after lift (D4 shows lifted true), request-code gave `429` `cooldown` |
| C12 | PASS | `200` |
| C13 | PASS | `403` `ip_banned` |
| C14 | PASS | `202` |
| C15 | PASS | `400` `"code":"self_ban"` |
| C16 | PASS | `400` `"code":"invalid"` |
| C17 | PASS | `409` `"code":"exists"` |
| C18 | PASS | qa2 in `/api/admin/sessions`, `"ip":"168970b1682d"`, id `110c54dafa45347f` (16 hex) |
| C19 | PASS | `200`, `"target":"hash:168970b1682d"` |
| C20 | PASS | `403` `ip_banned` |
| C21 | PASS | disable `200`; `/api/me` `401`; enable `200` |
| C22 | PASS | `{"codesRequested":5,"signIns":3,"wrongCodes":2,...,"locked":0,...,"blocked":5}` |
| C23 | PASS | `{"ok":true} 200` |
| D1 | PASS | kinds: code_requested 5, code_wrong 2, cooldown 2, login_blocked_account 1, login_blocked_ip 4, login_ok 3 |
| D2 | PASS | `0` and `0` |
| D3 | PASS | `0` |
| D4 | PASS | account qa1 lifted `t`; ip `198.51.100.0/24` `f`; ip `hash:168970b1682de610ce3aaa5b41ddc92d` `f` |
| D5 | FAIL | `grep -ci error` gave 9. Three times (once each for C15, C16, C17) the log has `TypeError: Cannot read properties of undefined (reading 'startsWith') at banRow (accounts\admin.js:37:67) at accounts\admin.js:136:31` followed by `Error [ERR_HTTP_HEADERS_SENT]: Cannot set headers after they are sent to the client`. Route: `POST /api/admin/bans`; after `addBan` has already answered 400/409, `if (ban) json(res, { ban: banRow(ban) })` runs on a truthy non-ban value. Clients got the right 4xx. |

Look-hardest: `198.51.100.0` and `198.51.100.255` refused (`ip_banned`), `198.51.99.255` accepted (`202`). `GET /api/admin/users/abc`, `POST /api/admin/sessions/xyz/revoke`, `POST /api/admin/bans/zzz/lift`: all `400`. Ban took effect at once (C9, C10, C13 immediately after adding). Lifted ban let the person back (C11 changed 403 to 429 cooldown).

## Anything else you noticed

- The same `banRow` crash can be reproduced on any rejected ban add; the error-log feature (QA-002) will probably record these as server errors.

## Environment problems

- No Docker daemon: used native PostgreSQL 16.15 (port 5432) with a fresh database `sk_qa001`, dropped at teardown, in place of the `docker run` container. All `docker exec ... psql` commands were run with `psql -h 127.0.0.1`.
- Used `127.0.0.1` instead of `localhost`, the server's log file under the Windows temp folder.
- A first attempt ran the server without `DATABASE_URL` (my mistake); the whole of Part C was redone against Postgres, and the results above come from that second run.
