---
id: QA-001-admin-users-bans
title: Sign-in activity, bans and admin routes for users and sessions
repo: ShelterKart-BE
branch: feature/admin-users
sha: 06c003e
created: 2026-11-04
---

# QA-001: sign-in activity, bans and admin routes for users and sessions

You are the QA agent. Your job is to verify, not to build. Read `qa/README.md` first and follow its rules.

## What is under test

Repository ShelterKart-BE (GitHub: motiongriddigital/ShelterKart-BE), branch `feature/admin-users`, commit `06c003e`. It adds a log of every sign-in attempt, bans for accounts and IP addresses (enforced), and twelve admin routes. Throwaway values only.

## What the builder did and how it was tested

Built: a log of every sign-in attempt, bans for accounts and for IP addresses (enforced on code request, verify and every guarded route), and twelve admin routes for users, sessions, bans and a sign-in summary (see `docs/admin/BACKEND-PLAN.md`, S1). Tested by the builder: the accounts unit tests (`test/accounts.test.js`), 35 server checks through the real route handlers (`test/harness/accounts-admin.test.js`) and the whole `npm test`. Those tests run on an in-memory store, so the real Postgres path and the real server are what this prompt adds: treat them as untested by the builder.

## Setup

You need Node 22 or newer, Docker, `curl`. In a folder other than the one holding `qa/`:

```
git clone https://github.com/motiongriddigital/ShelterKart-BE.git sk-under-test && cd sk-under-test
git checkout 06c003e
cd backend && npm ci && cd ..
docker run -d --name sk-qa-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=sk -p 5497:5432 postgres:16
export DATABASE_URL=postgres://postgres:pw@localhost:5497/sk
```

Wait until `docker exec sk-qa-pg pg_isready -U postgres` says accepting connections.

## Checks

Part A: the builder's own tests, run independently.

| # | Do this | Expect |
| --- | --- | --- |
| A1 | `cd backend && node test/accounts.test.js` | ends with `all passing` |
| A2 | `node -r ./test/harness/stub-loader.js test/harness/accounts.test.js` | ends with `all passing` |
| A3 | `node -r ./test/harness/stub-loader.js test/harness/accounts-admin.test.js` | ends with `all passing`; 35 lines starting `  ok` |
| A4 | `npm test` (needs python3 and Playwright browsers; if those are missing, say so and mark A4 BLOCKED, do not skip A1 to A3) | exit code 0 |

Part B: the migration on a real database. From the repository root.

| # | Do this | Expect |
| --- | --- | --- |
| B1 | `node tools/migrate.js` | last line `13 applied, 0 already applied` |
| B2 | `node tools/migrate.js` again | last line `0 applied, 13 already applied` |
| B3 | `docker exec sk-qa-pg psql -U postgres -d sk -c "\d auth_events" -c "\d bans"` | both tables exist; `bans.kind` has a check constraint for `account` and `ip` |

Part C: the live server. In `backend`, start it in the background (one command, one line):

```
NODE_ENV=development PORT=4010 ADMIN_USERNAME=qa ADMIN_PASSWORD=qa-pass-123 ACCOUNTS_ENABLED=on AUTH_PEPPER=pppppppppppppppppppppppppppppppppppppppp ACCOUNTS_DEV_ECHO=on ACCESS_TOKEN_SECRET=x QUOTE_SECRET=x PAYMENT_WEBHOOK_SECRET=x node server.js > /tmp/sk-qa-server.log 2>&1 &
```

Use `B=http://localhost:4010` and `ADM="-u qa:qa-pass-123"`. To pretend to be another visitor add `-H "X-Forwarded-For: <address>"`; the server trusts one proxy hop, so that header sets the client address. Do NOT use that header on admin calls (you would ban yourself). JSON calls need `-H "Content-Type: application/json"`.

| # | Do this | Expect |
| --- | --- | --- |
| C1 | `curl -s -o /dev/null -w '%{http_code}' $B/api/admin/users`, then the same with `$ADM` | `401`, then `200` |
| C2 | POST `$B/api/auth/request-code` body `{"email":"qa1@example.com"}`, header `X-Forwarded-For: 203.0.113.5` | `202`, body has `devCode` (six digits). Keep it. |
| C3 | Repeat C2 at once | `429`, body `"code":"cooldown"` |
| C4 | POST `/api/auth/verify-code` `{"email":"qa1@example.com","code":"000000","termsAccepted":true}` twice, same header | `400` both times, body has `attemptsLeft` (4 then 3) |
| C5 | Same call with the real `devCode`, add `-i` | `200`, `isNewUser` true, a `Set-Cookie` named `sk_session`. Keep the cookie value. |
| C6 | GET `$B/api/admin/users?q=qa1` with `$ADM` | one user, `activeSessions` 1, `disabled` false. Keep its `id`. |
| C7 | GET `$B/api/admin/users/<id>` with `$ADM` | `signIn.last24h` has `codesRequested` 1, `cooldownHits` 1, `wrongCodes` 2, `signIns` 1, `locked` 0. `signIn.events` newest first (first is `login_ok`). The body contains neither the `devCode` nor `203.0.113.5`. `sessions[0].ip` is exactly 12 hex characters. |
| C8 | POST `/api/admin/bans` `{"kind":"account","target":"qa1@example.com","reason":"qa test of the ban","days":1}` with `$ADM` | `200`, `ban.active` true, `ban.expiresAt` about 24 hours ahead |
| C9 | GET `/api/me` with `-H "Cookie: sk_session=<value from C5>"` | `401` (banning ended the session) |
| C10 | POST `/api/auth/request-code` for qa1 (header `X-Forwarded-For: 203.0.113.5`) | `403`, `"code":"account_banned"` |
| C11 | POST `/api/admin/bans/<ban id>/lift` with `$ADM`, then C10 again | lift `200`; then `429` with `cooldown` (NOT 403) |
| C12 | POST `/api/admin/bans` `{"kind":"ip","target":"198.51.100.0/24","reason":"qa test range ban"}` with `$ADM` | `200` |
| C13 | request-code `{"email":"qa4@example.com"}` with `X-Forwarded-For: 198.51.100.77` | `403`, `"code":"ip_banned"` |
| C14 | same with `X-Forwarded-For: 198.51.101.1` | `202` |
| C15 | POST `/api/admin/bans` `{"kind":"ip","target":"127.0.0.1","reason":"would block myself"}` with `$ADM` (no header) | `400`, `"code":"self_ban"` |
| C16 | POST `/api/admin/bans` `{"kind":"ip","target":"10.0.0.0/4","reason":"too wide to be safe"}` | `400` |
| C17 | repeat C12 | `409` |
| C18 | Sign in a user `qa2@example.com` (as C2 to C5, header `X-Forwarded-For: 192.0.2.44`). Then GET `/api/admin/sessions` with `$ADM` | the list contains qa2 with a 12-hex `ip`; keep that session `id` (16 hex) |
| C19 | POST `/api/admin/sessions/<id>/ban-ip` `{"reason":"qa test ban from a session","days":3}` | `200`, `ban.target` looks like `hash:` plus 12 hex |
| C20 | request-code with `X-Forwarded-For: 192.0.2.44` | `403`, `ip_banned` |
| C21 | Sign in `qa5@example.com` (header `X-Forwarded-For: 192.0.2.60`). POST `/api/admin/users/<id>/disable` with `$ADM`, then GET `/api/me` with its cookie, then POST `/enable` | `200`; `401`; `200` |
| C22 | GET `/api/admin/auth/summary?hours=24` with `$ADM` | `summary.wrongCodes` at least 2, `blocked` at least 3, `locked` 0 |
| C23 | Sign in `qa3@example.com` (header `X-Forwarded-For: 192.0.2.70`). `DELETE /api/me` with its cookie and body `{"confirm":"DELETE"}` | `200` |

Part D: what is in the database.

| # | Do this | Expect |
| --- | --- | --- |
| D1 | `docker exec sk-qa-pg psql -U postgres -d sk -c "select kind, count(*) from auth_events group by kind order by 1"` | rows for at least `code_requested`, `cooldown`, `code_wrong` (2 or more), `login_ok`, `login_blocked_account`, `login_blocked_ip` |
| D2 | `... -c "select count(*) from auth_events where ip_hash ~ '[.]'"` and `... -c "select count(*) from sessions where ip_hash ~ '[.]'"` | `0` and `0` (no raw address stored) |
| D3 | `... -c "select count(*) from auth_events where email_lower='qa3@example.com'"` | `0` (removed with the deleted account) |
| D4 | `... -c "select kind, target, lifted_at is not null as lifted from bans order by created_at"` | the bans from C8, C12, C19; the C8 one has `lifted` true |
| D5 | `grep -ci "error" /tmp/sk-qa-server.log` and read any lines | no stack trace from `accounts/`; quote any that exist |

## Look hardest at

- A request from a banned address that still gets through, or an unbanned address that is refused (try `198.51.100.0` and `198.51.100.255`, and `198.51.99.255`).
- Anything that answers 500 instead of a clean 4xx. Try a malformed id (`/api/admin/users/abc`, `/api/admin/sessions/xyz/revoke`) and expect 400.
- Whether a ban takes effect at once (the ban list is cached for 30 seconds; it must be dropped when a ban is added or lifted).
- Whether a lifted ban really lets the person back (not just that the status field changed).

## Teardown

Stop the server (`kill %1` or find its process), `docker rm -f sk-qa-pg`.

## Report

Write `qa/OUTBOX/QA-001-admin-users-bans.md` from `qa/RESULT-TEMPLATE.md`, then commit and push as in `qa/README.md`.
