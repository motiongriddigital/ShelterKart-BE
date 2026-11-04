---
id: QA-009-user-map-wired
status: pass
tested_sha: FE e8ca5cd + BE 4ac4f0b
machine: Windows 11, node v24.20.0, Git Bash, native PostgreSQL 16.15 on 127.0.0.1:5432 (no Docker daemon), no browser
finished: 2026-11-05
---

# Result for QA-009-user-map-wired (retest, corrected expectations)

## Summary

Against the corrected text every check passes: 41 API checks pass twice (9 in the map section), the map reads from the live store with the gate before the drawing and no hook after it, all 47 admin routes answer 200, and the unknown country `zz` answers 200 with the not-found page.

## Checks

| # | Result | Evidence |
| --- | --- | --- |
| A1 | PASS | lint, typecheck, format:check, build all exit 0 |
| B1 | PASS | `npm run test:api` exit 0, `all passing`, 41 `  ok` lines; the section `the user map` has 9 `  ok` lines |
| B2 | PASS | second run straight away: exit 0, `all passing`, 41 `  ok` |
| B3 | PASS | back end stopped: exit 1 after 1 s, `ECONNREFUSED 127.0.0.1:4018` |
| C1 | PASS | `UsersViews.tsx:7,28` (country names), `adminPanels.ts:1,14` (static `SEED_COUNTRIES`), `adminSeedGeo.ts:126,138` (definitions), `geoData.ts:3,28` (demo start state). `UserMapView.tsx` only has `import type { CountryStat }` (no data import, and no match in the grep). |
| C2 | PASS | `useGeoData` selectors for `stats`, `notPlaced`, `live`; `if (gate) return gate;` at line 200; memo lists include `stats` (lines 123, 175, 176, 189); 0 hook calls after line 200 |
| C3 | PASS | `SecondaryPanel.tsx:44 .sort((a, b) => b.users - a.users)` in the `/admin/map` branch built from `useGeoData`; the `/admin/users` branch is separate |
| C4 | PASS (note) | `geoData.ts`: live start `stats: geoStatsFromApi([], MARKET_LIST)` (zero rows), `status: 'idle'`; demo start `COUNTRY_STATS`, `'ready'`; mode change resets it; an error sets `status: 'error'` and `error`. A failed *reload* keeps the previously loaded numbers in the store (the gate shows the error screen, not the numbers). |
| C5 | PASS | no `fetch(` in `geoData.ts` or `adminGeo.ts` |
| D1 | PASS | built app: 47 routes requested directly (`/admin`, the 11 nav routes, the panel views, plus `/admin/map/in`): 0 non-200, 0 bodies with `Application error` or `Internal Server Error`; `/admin/map` 200 and `/admin/map/in` 200. The crawl itself finds only `/admin` (known). |
| D2 | PASS | `/admin/map/uk` 200, `/admin/map/world` 200, `/admin/map/zz` 200. The phrase "could not be found" is in every page, so I used the framework marker `NEXT_HTTP_ERROR_FALLBACK;404`: present in the `zz` body (1) and absent from `/uk`, `/world` and `/in`, so `zz` is the not-found page and the others are real pages. |
| M1 to M4 | NOT RUN (owner Part M) | |

## Anything else you noticed

- Nothing fails against the corrected text.

## Environment problems

- No Docker daemon: native PostgreSQL 16.15, database `sk_qa009r` (dropped). Back end from the QA-007 clone at `4ac4f0b`. 127.0.0.1 instead of localhost.
