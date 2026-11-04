---
id: QA-005-geo-users
title: Users by country from the edge header, and GET /api/admin/geo/users
repo: ShelterKart-BE
branch: feature/admin-geo
sha: 97f3d3d
created: 2026-11-04
---

# QA-005: users by country (S4a)

You are the QA agent. Your job is to verify, not to build. Read `qa/README.md` first and follow its rules.

## What is under test

ShelterKart-BE, branch `feature/admin-geo`, commit in the header (stacked on `fix/trust-proxy`). The `users.country` column already existed (it was in the accounts migration, nullable). What is new: when a NEW account is created at its first sign-in, `country` is set from the header the edge network adds (`EDGE_COUNTRY_HEADER`, default `cf-ipcountry`). It is never taken from the IP address. A user can still change their own country in their profile (`PATCH /api/me`); that is intended. `GET /api/admin/geo/users` returns one entry per market (36, keyed by market code, with the ISO code in `iso`; the United Kingdom is market `uk`, ISO `GB`), then `other` (users in countries that are not markets), `unknown` (no country) and `totals`. There is no new migration.

## What the builder did and how it was tested

Built: `backend/accounts/geo.js` (cleans the edge header, maps countries to the 36 markets, builds the table), the sign-in creating a new account with the country from the header, the store's two counting queries, the admin route and its OpenAPI entry. Tested by the builder: 13 unit checks (`test/geo.test.js`), 19 server checks through the real sign-in and route handlers on the in-memory store (`test/harness/geo.test.js`), the whole `npm test` (exit 0), and a run against a real Postgres 16 with a real server: sign-ins with `CF-IPCountry` `IN`, `gb`, none (with a forged `X-Forwarded-For`), `India`, `CN`, `XX` stored `IN`, `GB`, NULL, NULL, `CN`, NULL; a user with two paid purchases counted once as paid, a refunded purchase not counted, and moving one user's `created_at` back 10 days lowered `newThisWeek`. The first version counted purchases with status `active`, which the payment code never writes; a review of the code found it and it is fixed in `97f3d3d` (the query now uses `paid`, with a regression test). Not tested by the builder: 5,000 users, a different `EDGE_COUNTRY_HEADER`, and the profile change.

## Setup

```
git clone https://github.com/motiongriddigital/ShelterKart-BE.git sk-under-test5 && cd sk-under-test5
git checkout <sha from the header> && cd backend && npm ci && cd ..
docker run -d --name sk-qa-pg5 -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=sk -p 5495:5432 postgres:16
export DATABASE_URL=postgres://postgres:pw@localhost:5495/sk
node tools/migrate.js
```

Start the server in `backend` (sign-in codes come back in the response because of `ACCOUNTS_DEV_ECHO`):

```
NODE_ENV=development PORT=4015 ACCOUNTS_ENABLED=on AUTH_PEPPER=$(printf 'x%.0s' $(seq 1 40)) ACCOUNTS_DEV_ECHO=on ADMIN_USERNAME=qa ADMIN_PASSWORD=qa-pass-123 ACCESS_TOKEN_SECRET=x QUOTE_SECRET=x PAYMENT_WEBHOOK_SECRET=x node server.js > /tmp/sk-qa5-server.log 2>&1 &
```

`B=http://localhost:4015`, `ADM="-u qa:qa-pass-123"`. A helper to sign a NEW user in (use a different e-mail each time; wait 61 seconds before asking for a second code for the same e-mail):

```
signin() { # $1 email, $2 extra header (or empty)
  C=$(curl -s -X POST $B/api/auth/request-code -H 'content-type: application/json' ${2:+-H "$2"} -d "{\"email\":\"$1\"}" | sed -E 's/.*"devCode":"([0-9]+)".*/\1/')
  curl -s -c /tmp/sk-qa5-$1.jar -X POST $B/api/auth/verify-code -H 'content-type: application/json' ${2:+-H "$2"} -d "{\"email\":\"$1\",\"code\":\"$C\",\"termsAccepted\":true}"; echo
}
```

## Checks

| # | Do this | Expect |
| --- | --- | --- |
| A1 | in `backend`: `node test/geo.test.js` | ends `all 14 passing` |
| A2 | `node -r ./test/harness/stub-loader.js test/harness/geo.test.js` | ends `all passing`; 18 lines starting `  ok` |
| A3 | `npm test` (needs Playwright and python3; mark BLOCKED with the reason if missing) | exit code 0 |
| B1 | `node tools/migrate.js` a second time | `0 applied`; no error. `git diff --stat feature/admin-error-log feature/admin-geo -- backend/*.sql` is empty (no migration added). |
| B2 | `docker exec sk-qa-pg5 psql -U postgres -d sk -c "\d users"` | `country` is a nullable text column |
| C1 | `curl -s -o /dev/null -w '%{http_code}' $B/api/admin/geo/users`, then with `$ADM` | `401`, then `200` |
| C2 | the body on an empty database | `markets` has exactly 36 entries; each has `code`, `name`, `iso`, `users`, `newThisWeek`, `paid`, `conversion`; plus `other`, `unknown`, `totals`; all numbers are 0. Compare the 36 codes with the keys of `MARKETS` in `backend/engine/markets.js`; `uk` has `iso` `GB`. |
| D1 | `signin geo1@example.com 'CF-IPCountry: IN'` then `docker exec ... psql -c "select email, country from users order by created_at"` | `geo1` has `IN`; the sign-in response's `user.country` is `IN` |
| D2 | Wait 61 seconds. Sign `geo1@example.com` in again with `CF-IPCountry: US` | `200`; `country` is still `IN` |
| D3 | `signin geo2@example.com 'X-Forwarded-For: 8.8.8.8'` (no country header) | `200`; `country` is NULL. It must not be guessed from the address. |
| D4 | One new user each with `CF-IPCountry` set to: `gb`, `XX`, `T1`, `India`, `IND`, 300 x `A`, `<script>` | `gb` is stored `GB`; every other one is NULL; none returns 500; the sign-in response has the same shape as D1 |
| D5 | A new user with no header at all, once with `"country":"FR"` added to the verify-code JSON body and once with `?country=FR` on the URL | NULL both times: the client cannot set it at sign-in |
| D6 | Profile change: `curl -s -b /tmp/sk-qa5-geo1@example.com.jar -X PATCH $B/api/me -H 'content-type: application/json' -d '{"country":"fr"}'` | `200` and the user's country is `FR`. (The user may change their own country; the map then counts them in France. Say if you disagree.) `{"country":"France"}` gives `400` |
| E1 | `GET $B/api/admin/geo/users` after D1 to D6 | `in` users 1 (or 0 if you changed it in D6, report which); `uk` has the `gb` user; `other` counts any non-market country you used; `unknown` counts the NULL users |
| E2 | Add up every `markets[].users`, `other.users` and `unknown.users` | equals `totals.users` and `select count(*) from users` |
| E3 | `newThisWeek`: `update users set created_at = now() - interval '10 days' where email = 'geo1@example.com'`, call again | that user's market `newThisWeek` is 1 lower, `users` unchanged |
| E4 | `paid`: `insert` a row into `report_purchases` for one user with status `paid` (that is what the payment code writes), and one with status `refunded` for another (look at `backend/schema.sql` for the required columns; use throwaway values), call again | only the user with the `paid` purchase counts in `paid`; `conversion` is `paid / users` to four decimals. A user with two paid purchases counts once. |
| E5 | A market with no users | `users` 0, `paid` 0, `conversion` 0; never `null`, `NaN` or `Infinity` anywhere in the JSON |
| E6 | Search the body for an e-mail address, an IP address or a user id | none |
| E7 | `curl -s -X POST $B/api/admin/geo/users $ADM`, and `$B/api/admin/geo/users?days=abc&foo=1` | `404` for POST; `200` for the query (ignored), never `500` |
| F1 | Stop and restart the server, call the route again | the same numbers (they are in the database) |
| F2 | The accounts that existed before this change, if any, and any user created without the header | NULL `country`, counted in `unknown`; nothing fails |
| F3 | `EDGE_COUNTRY_HEADER=x-vercel-ip-country` on a restart; sign a new user in with `x-vercel-ip-country: DE` and with `CF-IPCountry: FR` | `DE`, and the second user NULL (only the named header is read). `EDGE_COUNTRY_HEADER='bad header!'` falls back to `cf-ipcountry` |

## Look hardest at

- Anything that fills `country` from the address instead of the header (D3).
- A client being able to choose its country at sign-in (D5). Note the header itself can be forged if the API is reachable without the edge in front; that is the same exposure as `TRUST_PROXY`, not a bug of this slice, but say what you saw.
- A conversion that divides by zero (E5), and a refunded purchase counted as paid (E4).
- Response time with 5,000 users: insert 5,000 rows into `users` with random countries and time `GET /api/admin/geo/users`. Report the time; over 500 ms is worth a note.

## Teardown

Stop the server; `docker rm -f sk-qa-pg5`.

## Report

Write `qa/OUTBOX/QA-005-geo-users.md` from `qa/RESULT-TEMPLATE.md`, then commit and push as in `qa/README.md`.