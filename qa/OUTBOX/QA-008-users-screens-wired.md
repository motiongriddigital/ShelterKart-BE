---
id: QA-008-users-screens-wired
status: fail
tested_sha: FE 944e971 + BE 4ac4f0b
machine: Windows 11, node v24.20.0, Git Bash, native PostgreSQL 16.15 on 127.0.0.1:5432 (no Docker daemon), no browser
finished: 2026-11-04
---

# Result for QA-008-users-screens-wired

## Summary

The screens' mapping against the real back end works (32 checks, twice), the limiter now skips successful requests, every action calls the server before changing the screen and the login header lives only in memory. Failing: unknown admin paths still answer 200 instead of 404 (C7, same cause as QA-003 B2), and the crawl still sees only the sign-in page (C8). B2 as written cannot happen because `test:api` itself uses up the 20 refused-request allowance.

## Checks

| # | Result | Evidence |
| --- | --- | --- |
| A1 | PASS | lint, typecheck, format:check, build all exit 0 (clone with `core.autocrlf=false`; build warning only about the inferred workspace root from the stray `C:\Users\parab\package-lock.json`) |
| B1 | PASS | run 1 and run 2 each: exit 0, `all passing`, 32 lines `  ok` (Node 24 so `test:api` ran; MODULE_TYPELESS_PACKAGE_JSON warning only) |
| B2 | FAIL (as written) | A third `test:api` straight after two runs exited 1: its first call after sign-in got `429` (`check-admin-people.mjs:70`). Each run makes about 10 refused requests (wrong password, 400s, 409s) and counts toward the 20. Then 25 wrong passwords gave `429` 25 times and the correct password `429`. On a freshly restarted server (no `test:api` runs) the 25 wrong passwords gave `401` x20 then `429` x5, and the correct password was `429`. So the cap itself behaves as intended. |
| B3 | PASS | after restart, 40 correct requests to `/api/admin/delivery`: all `200` |
| B4 | PASS | back end stopped: `npm run test:api` exit 1 after 1 s, `TypeError: fetch failed ... connect ECONNREFUSED 127.0.0.1:4018` (no hang) |
| B5 | PASS | `sessions` renamed: `{"ok":false,"error":"Internal server error"} [500]`, no stack or SQL; renamed back |
| C1 | PASS | `UsersViews.tsx:7 import { statByCode } from '@/constants/adminSeedGeo'` used only at line 28 for the country name; no `SEED_` in UsersViews. `consoleData.ts` imports `adminSeedPeople` for `start(false)`; `start(true)` returns `users: [], sessions: [], bans: []`, `status: 'idle'` (live starts empty). |
| C2 | PASS (note) | one direct `fetch` in the checked folders: `UserMapView.tsx:33 fetch('/admin/world-50m.json')`, a static map file, not the API. `adminPeople.ts` calls go through `http()`. |
| C3 | PASS | `authHeader` kept in `useAdminSession` (in memory) and put in the `Authorization` header in `adminPeople.ts:13`; the only storage use is `adminTheme.ts` (theme key). Not in a URL. |
| C4 | PASS | no `console.log` or `console.error` match |
| C5 | PASS | End session, End all sessions, Enable account, Lift ban (two places) call `void report(..., 'text')`, which toasts success only after the promise resolves and the server's sentence on error (`LiveGate.tsx:11-15`); Ban address and Ban account go through `BanDialog.tsx` `submit` with `await ... try/catch` (lines 62-70). |
| C6 | PASS | `endSession`, `endAllSessions`, `setDisabled`, `banAccount`, `banIp`, `banSessionIp`, `unban`: in live mode each `await`s the server call before `set(...)`, a failure throws before any local change; `load` and `loadUser` read. The read of the client module was by reading, not by running. |
| C7 | FAIL | production build: `/admin/nope` `200` (expected 404); `/admin/users/bans` `200`; `/admin/users/sessions` `200`; `/admin/users/some-id` `200`; `/admin/users/some-id/extra` `404`; also `/admin/sales/some-id` `200` (expected 404, since only the `users` section may take an id). The bodies of `/admin/nope` and `/admin/sales/some-id` contain the framework's "could not be found" text, so `notFound()` is called but the status is 200 (same soft-404 as QA-003 B2). |
| C8 | FAIL | crawl: `200 BAD-BODY /admin 13869b` and `pages: 1`. `/admin` is only the sign-in page, so the crawl finds no links; BAD-BODY is a false positive because the page embeds the framework's not-found text (it also appears 4 times in valid `/admin/users/some-id`). Same as QA-003 B1. |
| M1 to M6 | NOT RUN (owner Part M) | |

## Anything else you noticed

- With `skipSuccessfulRequests`, every 4xx/5xx counts: a console with an expired login or a failing screen can lock itself out after 20 refused requests, for 15 minutes.
- The back end was run from the QA-007 clone (same commit `4ac4f0b`) rather than a second clone.

## Environment problems

- No Docker daemon: native PostgreSQL 16.15, database `sk_qa008` (dropped). 127.0.0.1 instead of localhost. The first `npm run build` runs in a clone with LF endings; a default Windows clone fails `format:check` (see QA-003).
