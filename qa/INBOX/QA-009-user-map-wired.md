---
id: QA-009-user-map-wired
title: The user map uses the real geo route (no browser)
repo: ShelterKart-FE
branch: admin-wire-map
sha: a79e024
created: 2026-11-04
---

# QA-009: the user map on the real API

You are the QA agent. Your job is to verify, not to build. Read `qa/README.md` first and follow its rules. You do not drive a browser: everything runs in a terminal. What needs eyes is in Part M for the owner; leave it as `NOT RUN (owner)`. This prompt builds on QA-008 (same two repositories, same set-up); if QA-008 was BLOCKED for a reason that also blocks this, say so and mark this BLOCKED the same way.

## What is under test

Front end: ShelterKart-FE, branch `admin-wire-map`, commit `a79e024` (stacked on `admin-wire-users`, commit `0493c88`, QA-008). Back end: `feature/admin-engines`, commit `ff2238c`. Signed in with the real admin login, the user map, the country list beside it and the totals load from `GET /api/admin/geo/users` (QA-005 tests that route). The map's fixed facts (names, numeric ids for the shapes, currency, language) stay in the front end; the server supplies users, new this week, paid and conversion per market. Users the map cannot place (in a country that is not a market, or with no country) are counted in a note. The demo keeps seed data.

## What the builder did and how it was tested

Built: `src/utils/adminGeo.ts` (answer to map rows, pure), `src/store/geoData.ts` (live or demo, loads once), `useGeoGate` in `LiveGate.tsx` (loading and error screen with Try again), `fetchGeo` in `src/app/_api/adminPeople.ts`, the map view, and the country list in `SecondaryPanel.tsx`. Tested by the builder: lint, typecheck, format and `next build` pass; `npm run test:api` now runs 41 checks against a real back end with Postgres (the 32 from QA-008 plus 9 for the map: three users signed in with the edge header `IN`, `gb` and `CN`, 36 rows with their fixed facts, India and the United Kingdom counted, the others not placed, totals adding up, no NaN, nothing personal, a wrong login refused). Not tested by the builder: the map in a browser (hover, full screen, colours), and the production route status of unknown countries.

## Setup

As in QA-008: back end `ff2238c` with Postgres 16 (container `sk-qa-pg9`, port 5491, server on port 4018, admin `qa` / `qa-pass-123`, `ACCOUNTS_ENABLED=on`, `ACCOUNTS_DEV_ECHO=on`, an `AUTH_PEPPER` of 40 characters, `DATABASE_URL` set, `node tools/migrate.js` run first), and the front end:

```
git clone https://github.com/motiongriddigital/ShelterKart-FE.git sk-fe9 && cd sk-fe9
git checkout a79e024 && npm ci
```

Node 23.6 or newer for `test:api`.

## Checks

| # | Do this | Expect |
| --- | --- | --- |
| A1 | `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build` | all four exit 0 |
| B1 | `npm run test:api` with the back end running | ends `all passing`; 41 lines start `  ok` (ignore the Node experimental warnings); the section `the user map` has 9 lines |
| B2 | Run it again straight away | passes again (it makes new users each time) |
| B3 | Stop the back end, `npm run test:api` | fails with a connection error, not a hang |
| C1 | `grep -rn "COUNTRY_STATS\|statByCode" src` | only `src/constants/adminSeedGeo.ts` (the definitions), `src/constants/adminPanels.ts` (the static panel list, replaced at run time in the panel) and `src/store/geoData.ts` (the demo start state) and `UsersViews.tsx` (country names). `UserMapView.tsx` must not import them. Paste the list. |
| C2 | Read `src/components/console/views/UserMapView.tsx` | the data comes from `useGeoData`; the gate returns before the map is drawn; the memo dependency lists include `stats`; no hook is called after the early return |
| C3 | Read `src/components/console/SecondaryPanel.tsx` | for `/admin/map` the Countries group is built from the store, sorted by users; for `/admin/users` unchanged |
| C4 | Read `src/store/geoData.ts` | live mode starts empty and idle, demo mode starts with seed data, switching mode resets it, an error sets `error` and does not keep stale numbers |
| C5 | `grep -rn "fetch(" src/store/geoData.ts src/utils/adminGeo.ts` | no match: the only network path is `fetchGeo` through `http()` |
| D1 | `npm run start -- -p 3100 &` after the build; the crawl from QA-003 Part B | every page `200`, including `/admin/map` and `/admin/map/in` |
| D2 | `curl -s -o /dev/null -w '%{http_code}\n'` for `/admin/map/uk`, `/admin/map/world`, `/admin/map/zz` | `200`, `200` and `404` (an unknown country); report what you get |

## Part M: for the owner, not for the QA AI

| # | Do this | Expect |
| --- | --- | --- |
| M1 | Run the front end against the back end (`API_ORIGIN=http://127.0.0.1:4018 npm run dev -- -p 3100`), sign in, open User map | the map is shaded by the real numbers: countries with real users are darker; the Users tile says how many more are in other or unknown countries |
| M2 | Hover a shaded country, open full screen, click a country | the tooltip and the card show the real numbers; Esc leaves full screen |
| M3 | Stop the back end and refresh the map | an error with Try again, not a blank map and not seed numbers |
| M4 | Dark theme and 390 pixels wide | readable, no sideways scroll |

## Look hardest at

- Seed numbers on the map while signed in to a real server (C1, C2, M1).
- The early return before the map is drawn: a hook after it would break the page (C2).
- The country list beside the map showing seed numbers (C3).

## Teardown

Stop both servers; `docker rm -f sk-qa-pg9`.

## Report

Write `qa/OUTBOX/QA-009-user-map-wired.md` from `qa/RESULT-TEMPLATE.md`, then commit and push as in `qa/README.md`. Leave Part M as `NOT RUN (owner)`.