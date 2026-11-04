---
id: QA-005-geo-users
status: pass
tested_sha: 97f3d3d
machine: Windows 11, node v24.20.0, Git Bash, native PostgreSQL 16.15 on 127.0.0.1:5432 (no Docker daemon)
finished: 2026-11-04
---

# Result for QA-005-geo-users

## Summary

Country is taken only from the edge header, never from the address or the client body, junk values are dropped cleanly, and `GET /api/admin/geo/users` adds up, handles empty markets and refunds correctly and stays fast at 5,000 users. The only difference from the prompt is a test line count in A2 (18, not 19).

## Checks

| # | Result | Evidence |
| --- | --- | --- |
| A1 | PASS | `all 14 passing` |
| A2 | PASS (note) | last line `all passing`, no FAIL, but 18 lines start `  ok` (prompt says 19) |
| A3 | PASS | `npm test` exit 0 |
| B1 | PASS | `0 applied, 14 already applied.`; `git diff --stat origin/feature/admin-error-log origin/feature/admin-geo -- 'backend/*.sql'` empty |
| B2 | PASS | `country | text | | |` (nullable) |
| C1 | PASS | `401`, then `200` |
| C2 | PASS | 36 markets, same set as the keys of `MARKETS` in engine/markets.js; fields `code,name,iso,users,newThisWeek,paid,conversion`; `uk` iso `GB`; `other`, `unknown`, `totals` present; all zero |
| D1 | PASS | `geo1@example.com|IN`; response `"country":"IN"` |
| D2 | PASS | after 62 s with `CF-IPCountry: US`: `"isNewUser":false`, `"country":"IN"`, 200; database `IN` |
| D3 | PASS | `X-Forwarded-For: 8.8.8.8` only: 200, `"country":null`, database `NULL` |
| D4 | PASS | `gb`->`GB`; `XX`, `T1`, `India`, `IND`, 300 x `A`, `<script>` -> `NULL`; every response `[200]`, same shape |
| D5 | PASS | no header: `"country":null`; with `"country":"FR"` in the body: 200, stored `NULL`; with `?country=FR`: 200, stored `NULL` |
| D6 | PASS | PATCH `{"country":"fr"}` -> 200, `"country":"FR"`, database `FR`; `{"country":"France"}` -> `400 {"code":"invalid_country","error":"Use a two-letter country code."}`. No disagreement. |
| E1 | PASS | with 13 users (geo1 moved to FR in D6): `uk` 1, `fr` 1, `in` 0 (geo1 changed it), `other` 1 (a `KE` user), `unknown` 10 |
| E2 | PASS | sum 13 = `totals.users` 13 = `select count(*) from users` 13 |
| E3 | PASS | after moving geo1 back 10 days: `fr` `[1,1]` became `[1,0]` (users unchanged, newThisWeek -1); totals newThisWeek 13 to 12 |
| E4 | PASS | geo1 two `paid` purchases + d4u1 one `refunded`: `fr` paid 1, `uk` paid 0; `fr` conversion `1` (1/1); totals `{"users":13,"newThisWeek":12,"paid":1,"conversion":0.0769}` (1/13 to four decimals) |
| E5 | PASS | `grep -c "null\|NaN\|Infinity"` on the body: 0; empty markets are `0,0,0,0` |
| E6 | PASS | no e-mail, IP address or user id in the body (grep count 0) |
| E7 | PASS | POST `404`; `?days=abc&foo=1` `200` |
| F1 | PASS | after restart: `{"users":13,"newThisWeek":12,"paid":1,"conversion":0.0769}`, unknown the same |
| F2 | PASS | 10 users with NULL country counted in `unknown`; nothing failed |
| F3 | PASS | `EDGE_COUNTRY_HEADER=x-vercel-ip-country`: `x-vercel-ip-country: DE` -> `DE`; `CF-IPCountry: FR` -> `null`. `EDGE_COUNTRY_HEADER='bad header!'` with `CF-IPCountry: FR` -> `FR` (fell back to cf-ipcountry). |
| Perf | PASS | 5,000 added users (10 countries incl. NULL, random created_at): `GET /api/admin/geo/users` 0.050 s first call, 0.008 s and 0.006 s after (totals `{"users":5000,...}`). Well under 500 ms. |

## Anything else you noticed

- The country header is trusted as sent (as the prompt says). With the API directly reachable, a client can send `CF-IPCountry: FR` itself (I did exactly that with D1 to D4 and the server accepted it).
- The admin rate limiter (20 requests per 15 minutes per address) is close to the number of admin calls this prompt needs; I restarted the server between groups to stay under it.
- The first bulk insert of 5,000 users failed on my SQL (float interval), so the first timing was on 13 users; the figures above are from the repeated run on 5,000.

## Environment problems

- No Docker daemon: native PostgreSQL 16.15, fresh database `sk_qa005` (dropped).
- 127.0.0.1 instead of localhost.
