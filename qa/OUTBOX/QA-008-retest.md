---
id: QA-008-users-screens-wired
status: pass
tested_sha: FE 944e971 + BE 4ac4f0b
machine: Windows 11, node v24.20.0, Git Bash, native PostgreSQL 16.15 on 127.0.0.1:5432 (no Docker daemon), no browser
finished: 2026-11-05
---

# Result for QA-008-users-screens-wired (retest, corrected expectations)

## Summary

Against the corrected text every check passes: the screens' API mapping passes twice (32 checks each), the limiter caps refused requests and ignores successful ones, every button and action waits for the server, and the not-found behaviour is as described (users take an id, other sections do not).

## Checks

| # | Result | Evidence |
| --- | --- | --- |
| A1 | PASS | lint, typecheck, format:check, build all exit 0 (LF clone) |
| B1 | PASS | `npm run test:api` run 1 and run 2: exit 0, `all passing`, 32 `  ok` lines each |
| B2 | PASS | back end restarted, then 25 wrong passwords: `401` x20 then `429` x5; correct password afterwards `429` |
| B3 | PASS | back end restarted: 40 requests with the correct password to `/api/admin/delivery`: all `200` |
| B4 | PASS | back end stopped: `npm run test:api` exit 1 after 1 s, `ECONNREFUSED 127.0.0.1:4018` |
| B5 | PASS | `sessions` renamed: `{"ok":false,"error":"Internal server error"} [500]`, no stack or SQL; renamed back |
| C1 | PASS | `UsersViews.tsx:7 import { statByCode } from '@/constants/adminSeedGeo'` (used only for country names, line 28); no `SEED_` in UsersViews. `consoleData.ts:9` imports `adminSeedPeople`; `start(false)` uses the seed lists, `start(true)` gives empty `users`/`sessions`/`bans` and `status: 'idle'` (read) |
| C2 | PASS | the only match is `UserMapView.tsx:33 fetch('/admin/world-50m.json')`, a static file; nothing in `adminPeople.ts` or `src/store` |
| C3 | PASS | `authHeader` lives in `useAdminSession` (memory) and goes into the `Authorization` header in `adminPeople.ts:13`; the only storage use is the theme key in `adminTheme.ts` |
| C4 | PASS | no match |
| C5 | PASS | End session, End all sessions, Enable account and Lift ban use `report(promise, 'text')` (success toast only after the server answers, the server's sentence on error: `LiveGate.tsx:11-15`); Ban address / Ban account go through `BanDialog.tsx` `await ... try/catch` (lines 62-70) |
| C6 | PASS | `endSession`, `endAllSessions`, `setDisabled`, `banAccount`, `banIp`, `banSessionIp`, `unban` all `await` the server in live mode before `set(...)`; `load` and `loadUser` read. The client module was checked by reading, not running. |
| C7 | PASS | built app: `/admin/nope` `200`; `/admin/users/bans` `200`; `/admin/users/sessions` `200`; `/admin/users/some-id` `200`; `/admin/users/some-id/extra` `404` (title `404: This page could not be found.`); `/admin/sales/some-id` `200`. The phrase "could not be found" is in every page (the embedded template), so I told them apart by the framework marker `NEXT_HTTP_ERROR_FALLBACK;404`, which appears in the bodies of `/admin/nope` (2 times) and `/admin/sales/some-id` (1 time) and in none of `/admin/users/bans`, `/admin/users/some-id`, `/admin/sales/overview`. So the not-found text is shown for `/admin/nope` and `/admin/sales/some-id` and only `users` takes an id. |
| C8 | PASS | the crawl finds only `/admin` (0 links, the known client-app behaviour); requesting every route (`/admin`, the 11 nav routes and the panel views, same list as QA-003): 46 routes, 0 non-200, 0 bodies with `Application error` or `Internal Server Error` |
| M1 to M6 | NOT RUN (owner Part M) | |

## Anything else you noticed

- The marker `NEXT_HTTP_ERROR_FALLBACK;404` is a way to tell a real page from a "not found" page in the HTML if the owner ever wants to script this; plain text matching on "could not be found" does not work because every page embeds that text.

## Environment problems

- No Docker daemon: native PostgreSQL 16.15, database `sk_qa008r` (dropped). The back end ran from the QA-007 clone at `4ac4f0b`. 127.0.0.1 instead of localhost.
