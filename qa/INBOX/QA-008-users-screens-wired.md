---
id: QA-008-users-screens-wired
title: Users, Sessions and Bans screens call the real admin API (no browser)
repo: ShelterKart-FE
branch: admin-wire-users
sha: 0493c88
created: 2026-11-04
---

# QA-008: the Users screens use the API (wiring)

You are the QA agent. Your job is to verify, not to build. Read `qa/README.md` first and follow its rules. You do not drive a browser: everything runs in a terminal. What needs eyes is in Part M for the owner; leave it as `NOT RUN (owner)`.

## What is under test

Two repositories. Front end: ShelterKart-FE, branch `admin-wire-users`, commit in the header (stacked on `admin-console`, which QA-003 tested). Back end: the tip of the ShelterKart-BE stack, `feature/admin-engines`, commit `ff2238c` (it contains the admin limiter fix SHEL-34); it is needed because the old limiter locked an admin out after 20 successful requests. The Users, Sessions and Bans screens used generated seed data. Signed in with the real admin login they now load from `GET /api/admin/users`, `/sessions`, `/bans` and `/users/:id`, and their buttons call the matching `POST` routes (end a session, end all, disable or enable, ban an account or an address, ban a session's address, lift a ban). In the demo they still use seed data and change memory only. Every other screen still uses seed data on purpose.

## What the builder did and how it was tested

Built: `src/app/_api/adminPeople.ts` (the calls, with the operator's login; a 401 signs the operator out), `src/utils/adminPeople.ts` (answers to screen rows, pure, no imports), `src/store/consoleData.ts` (live or demo, loads once, sends each action to the server first), `src/components/console/views/LiveGate.tsx` (loading and error screens with Try again, and a toast for what the server said), the three views and the ban dialog, the user page for any user id, and the clock in `ago` (the demo pinned it to one day; a real server uses the real time). Tested by the builder: lint, typecheck, format and `next build` all pass; `npm run test:api` (`scripts/check-admin-people.mjs`) runs the screens' mapping against a real back end with Postgres: 32 checks, all passing (login refused, three real users and sessions listed and mapped, a user in detail, ending one and all sessions, banning an account and the sign-in refused, a repeat ban refused with a sentence, a too-short reason refused, the self-ban refused, a range ban and its lifting, nothing leaking). That script found two things before this prompt: the old admin limiter (fixed on the back end) and that the user page needs a database. Not tested by the builder: the screens themselves in a browser (the tool could not drive one), the route status of unknown paths in the production build, and anything on a narrow screen or in dark theme.

The script calls the back end with its own `fetch` and runs the answers through the same mapping the screens use; it does not import the screens' API module (that file uses the `@/` alias). Say in your result that the client module itself was checked by reading, not by running.

## Setup

```
git clone https://github.com/motiongriddigital/ShelterKart-BE.git sk-be8 && cd sk-be8
git checkout ff2238c && cd backend && npm ci && cd ..
docker run -d --name sk-qa-pg8 -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=sk -p 5492:5432 postgres:16
export DATABASE_URL=postgres://postgres:pw@127.0.0.1:5492/sk
node tools/migrate.js
cd backend
NODE_ENV=development PORT=4018 ACCOUNTS_ENABLED=on AUTH_PEPPER=$(printf 'x%.0s' $(seq 1 40)) ACCOUNTS_DEV_ECHO=on ADMIN_USERNAME=qa ADMIN_PASSWORD=qa-pass-123 ACCESS_TOKEN_SECRET=x QUOTE_SECRET=x PAYMENT_WEBHOOK_SECRET=x node server.js > /tmp/sk-qa8-be.log 2>&1 &
```

Front end in another folder:

```
cd .. && git clone https://github.com/motiongriddigital/ShelterKart-FE.git sk-fe8 && cd sk-fe8
git checkout <sha from the header> && npm ci
```

Node 23.6 or newer is needed for `test:api` (it runs one TypeScript file directly). With an older Node, say so and mark B1 BLOCKED.

## Checks

| # | Do this | Expect |
| --- | --- | --- |
| A1 | `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build` | all four exit 0 |
| B1 | with the back end running: `npm run test:api` (it uses `http://127.0.0.1:4018`, user `qa`, password `qa-pass-123`; override with `ADMIN_API`, `ADMIN_USER`, `ADMIN_PASS`) | ends `all passing`; 32 lines start `  ok` (ignore the Node experimental warnings). Run it twice in a row: it creates new users each time, so the second run must pass too. |
| B2 | Run it a third time quickly, then 25 wrong admin passwords: `for i in $(seq 1 25); do curl -s -o /dev/null -w '%{http_code} ' -u qa:wrong http://127.0.0.1:4018/api/admin/stats; done` | `401` 20 times then `429`. Then wait: a correct password is refused (`429`) for up to 15 minutes. That is the intended cap on guessing. |
| B3 | Restart the back end (new limiter window). 40 requests with the correct password: `for i in $(seq 1 40); do curl -s -o /dev/null -w '%{http_code} ' -u qa:qa-pass-123 http://127.0.0.1:4018/api/admin/delivery; done` | all `200`: successful requests are not counted |
| B4 | With the back end stopped, run `npm run test:api` | it fails with a connection error, not a hang (report how long it took) |
| B5 | Rename the sessions table (`docker exec sk-qa-pg8 psql -U postgres -d sk -c "alter table sessions rename to s_x"`), `curl -s -u qa:qa-pass-123 http://127.0.0.1:4018/api/admin/sessions`, rename it back | a clean JSON error with status 500, no stack trace and no SQL text |
| C1 | `grep -rn "adminSeed" src/components/console/views/UsersViews.tsx src/store/consoleData.ts` and `grep -rn "SEED_" src/components/console/views/UsersViews.tsx` | `UsersViews.tsx` imports `statByCode` from `adminSeedGeo` only for country names (read it and say if that is all). `consoleData.ts` uses the seed lists only for the demo start state (`start(false)`); read it and confirm live mode starts empty. |
| C2 | `grep -rn "fetch(\|XMLHttpRequest\|axios" src/app/_api/adminPeople.ts src/store src/components/console/views` | no direct calls: the only network path is `http()` from `src/app/_api/http.ts`, with paths starting `/api/admin/` |
| C3 | `grep -n "Authorization\|authHeader" -r src/app/_api/adminPeople.ts src/store` and `grep -rn "localStorage\|sessionStorage\|document.cookie" src/store src/app/_api` | the login header is read from the in-memory session store only; it is not written to storage or to a URL. Report anything else you find. |
| C4 | `grep -rn "console\.\(log\|error\)" src/store src/app/_api src/components/console/views` | no match |
| C5 | Read `UsersViews.tsx` for each button (End, End all sessions, Enable account, Lift ban, Ban address, Ban account) | each one goes through `report(...)` or the ban dialog's `await ... try/catch`: the screen shows success only after the server answered, and the server's own sentence on a refusal. Name any button that does not. |
| C6 | Read `consoleData.ts`: for each action, does live mode call the server before changing local state? | yes for all nine (`load` and `loadUser` read; the seven actions write after the call succeeded). Name any that does not. |
| C7 | `src/app/(admin)/admin/[section]/[view]/page.tsx` | a user id is allowed as the view only for the `users` section; other unknown sections or views still call `notFound()`. Check with the built app: `npm run build && npm run start -- -p 3100 &` then `curl -s -o /dev/null -w '%{http_code}\n'` for `/admin/nope`, `/admin/users/bans`, `/admin/users/sessions`, `/admin/users/some-id`, `/admin/users/some-id/extra` | `404`, `200`, `200`, `200`, and `404` or the framework's not-found answer (report each) |
| C8 | The crawl from QA-003 Part B against the built app | every page `200`; the number of pages is the same as in QA-003 plus nothing broken |

## Part M: for the owner, not for the QA AI

| # | Do this | Expect |
| --- | --- | --- |
| M1 | Run the front end with `API_ORIGIN=http://127.0.0.1:4018 npm run dev -- -p 3100`, open `/admin`, sign in with the real login (wrong password first) | the wrong one shows a message; the right one opens the console |
| M2 | Users, Active sessions, Bans, and one user | the real accounts (create some with the sign-in routes first), none of the old seed names; the last-seen times are sensible, not 0 min on every row |
| M3 | Ban an account, then lift it, from the user page and from Bans | the screen and the database agree; a toast confirms; a banned user's page offers Lift ban |
| M4 | Ban the address of one of your own sessions from Active sessions | the dialog shows the session's address as a short code and cannot be edited; the ban appears in Bans |
| M5 | Stop the back end and press refresh on Users | an error with Try again, not a blank page, not seed names |
| M6 | Dark theme and 390 pixels wide on these three screens | readable, no sideways scroll |

## Look hardest at

- A screen that still shows seed data in live mode (C1, M2).
- C5 and C6: success shown before the server answered.
- C7: a user page for any id must not make unknown sections reachable.
- The login header: where it is kept (C3).

## Teardown

Stop both servers; `docker rm -f sk-qa-pg8`; remove the clones if you like.

## Report

Write `qa/OUTBOX/QA-008-users-screens-wired.md` from `qa/RESULT-TEMPLATE.md`, then commit and push as in `qa/README.md`. Leave Part M as `NOT RUN (owner)`.