---
id: QA-009-user-map-wired
status: fail
tested_sha: FE e8ca5cd + BE 4ac4f0b
machine: Windows 11, node v24.20.0, Git Bash, native PostgreSQL 16.15 on 127.0.0.1:5432 (no Docker daemon), no browser
finished: 2026-11-04
---

# Result for QA-009-user-map-wired

## Summary

The map's wiring is as described: live mode starts empty, the data comes from `GET /api/admin/geo/users`, the gate returns before the map is drawn with no hook after it, and 41 API checks pass twice. One check fails: an unknown country (`/admin/map/zz`) answers 200, not 404 (the same soft-404 seen in QA-003 and QA-008).

## Checks

| # | Result | Evidence |
| --- | --- | --- |
| A1 | PASS | lint, typecheck, format:check, build all exit 0 |
| B1 | PASS | `npm run test:api` exit 0, `all passing`, 41 lines `  ok`; section `the user map` has 9 `  ok` lines (route 200, 36 markets with fixed facts, India and UK counted, not-placed counted, total adds up, no NaN, nothing personal, wrong login 401, and the 36-row line) |
| B2 | PASS | second run: exit 0, `all passing`, 41 `  ok` |
| B3 | PASS | back end stopped: exit 1 after 1 s, `ECONNREFUSED 127.0.0.1:4018` |
| C1 | PASS | `UsersViews.tsx:7` and `:28` (country names), `adminPanels.ts:1,14` (static `SEED_COUNTRIES`), `adminSeedGeo.ts:126,138` (definitions), `geoData.ts:3,28` (demo start state). `UserMapView.tsx` only has `import type { CountryStat } from '@/constants/adminSeedGeo'` (a type, no data). |
| C2 | PASS | `UserMapView.tsx`: `useGeoGate` (line 116), `useGeoData` selectors (117-119) with `stats` in the memo lists (`byNumeric`, `max`, `ranked`); the only `if (gate) return gate;` is line 200; no hook call after it (grep of lines 200 on: none) |
| C3 | PASS | `SecondaryPanel.tsx`: for `/admin/map` the Countries group is built from `useGeoData` `stats`, `.sort((a, b) => b.users - a.users)` (line 44); `/admin/users` branch separate (line 25) |
| C4 | PASS (note) | `geoData.ts`: live start is `stats: geoStatsFromApi([], MARKET_LIST)` (zero rows), `status: 'idle'`; demo start is `COUNTRY_STATS`, `'ready'`; `useAdminSession.subscribe` resets on mode change; an error sets `status: 'error'` and `error`. A failed *reload* after a successful load leaves the previously loaded numbers in the store (the gate shows the error screen, not the numbers). |
| C5 | PASS | no `fetch(` in `geoData.ts` or `adminGeo.ts` |
| D1 | FAIL | crawl: `200 /admin`, `pages: 1` (the console is behind the client-side sign-in, so no links are in the HTML); `/admin/map` 200, `/admin/map/in` 200 by direct request |
| D2 | FAIL | `/admin/map/uk` `200`, `/admin/map/world` `200`, `/admin/map/zz` `200` (expected 404 for the unknown country); the bodies carry the "could not be found" text with status 200 |
| M1 to M4 | NOT RUN (owner Part M) | |

## Anything else you noticed

- Same soft-404 as QA-003 B2 and QA-008 C7; the cause looks the same (status 200 even though `notFound()` renders).
- The back end ran from the QA-007/008 clone at `4ac4f0b`.

## Environment problems

- No Docker daemon: native PostgreSQL 16.15, database `sk_qa009` (dropped). 127.0.0.1 instead of localhost.
