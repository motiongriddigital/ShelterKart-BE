# Plan: 45 percent of the admin panel by the end of tonight

Written Wednesday 4 November 2026, 19:50 IST. "The project" here means the admin panel, end to end: screens, the backend behind them, and the wiring between the two. Percentages are the builder's estimate (weights below), counted in two separate columns: **Built** (code exists, tests the builder wrote pass) and **Verified** (an independent QA agent ran the prompts in `qa/INBOX` and reported pass). Only Built is the target for tonight; Verified follows the QA agent.

## The scoreboard

| Block | Item | Points | Built now | Target tonight |
| --- | --- | --- | --- | --- |
| Screens (20) | Shell: sidebar, panels, header, login, dark mode | 4 | 4 | 4 |
| | Dashboard | 3 | 3 | 3 |
| | User map (with full screen) | 2 | 2 | 2 |
| | Health and errors (five views) | 3 | 3 | 3 |
| | Users and sessions (bans, sessions, detail) | 3 | 3 | 3 |
| | Sales, Free vs premium, Insights, Website traffic, AI engine | 5 | 0 | 0 |
| Backend (60) | S1 users, sessions, bans, sign-in activity | 10 | 10 | 10 |
| | S2a error log | 6 | 6 | 6 |
| | S2b failed jobs and retry, health history per register | 5 | 0 | **5** |
| | S3 AI engine history and costs | 7 | 0 | **7** |
| | S4a users by country (geo) | 5 | 0 | **5** |
| | S4b sales series, orders, refunds | 7 | 0 | 0 |
| | S5 free-versus-premium funnel | 6 | 0 | 0 |
| | S6 insights | 4 | 0 | 0 |
| | S7 backups | 10 | 0 | 0 |
| Wiring (20) | Users screens call the API | 5 | 0 | stretch 5 |
| | Health screens | 4 | 0 | 0 |
| | Map | 3 | 0 | 0 |
| | Sales, AI engine, the rest | 8 | 0 | 0 |
| **Total** | | **100** | **31** | **48** (53 with the stretch) |

The target of 45 needs 14 more points; the plan carries 17, so one item can slip by three points and the target still holds. If S3 slips, S2b plus geo plus the stretch wiring gives 46.

## Order of work (builder), with a time box each

| # | Task | Points | Time box | Starts | Depends on | QA prompt |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | SHEL-35: configurable trusted proxies (`TRUST_PROXY`), default none, a test that a forged header changes nothing. Not scored, but bans and limits mean little without it | 0 | 45 min | 20:00 | none | QA-004 |
| 2 | S4a: record `users.country` at first sign-in from the edge country header (never from the IP address), `GET /api/admin/geo/users` for the 36 markets | 5 | 60 min | 20:45 | none | QA-005 |
| 3 | S2b: failed jobs list and retry (paid report, delivery), health history per register, routes and tests | 5 | 90 min | 21:45 | none | QA-006 |
| 4 | S3: persist AI engine usage per day and engine (calls, failures, rescues, tokens, cost, latency), `GET /api/admin/engines/history` and `/costs` | 7 | 120 min | 23:15 | none | QA-007 |
| 5 | Stretch: switch the Users screens from seed data to the new routes (frontend branch `admin-console`) | 5 | 60 min | 01:15 | PR chain deployed locally | QA-008 |

If at 23:15 task 3 is not finished, task 4 is cut to its read-only routes. Cut line for the night: 01:15.

Every task ends the same way: code, the builder's own tests, an OpenAPI entry, a commit on a stacked branch, a push, and a QA prompt written into `qa/INBOX` before the builder moves on. The builder does not run the QA prompts.

## Who does what

| | Builder (this machine) | QA agent (other machine) |
| --- | --- | --- |
| Writes code | yes | no, never |
| Writes unit and harness tests | yes | no |
| Runs the independent verification, real database, real server, browser walkthroughs | no | yes |
| Reports | updates this scoreboard | one result file per prompt in `qa/OUTBOX` |
| Fixes failures | yes, from the QA report | no |

## Testing, how it moves between the machines

See `qa/README.md`. In one line: prompts are files on the branch `ops/admin-plan-and-qa`; the QA agent pulls the branch, runs each prompt against the commit it names, and pushes a result file back to the same branch; the builder pulls and reads it.

## Prerequisites the owner controls

| What | Why |
| --- | --- |
| Review and merge PRs #11, #12, #13, #14 in that order | Everything stacks on them. The QA agent can test the branches without merging. |
| Answers to the five open questions in `docs/admin/BACKEND-PLAN.md` | Backups (S7) and the funnel (S5) wait on them. Neither is in tonight's target. |

## Risks

| Risk | What to do |
| --- | --- |
| The weights are the builder's estimate | The owner can change the points in the table; the target moves with them. |
| A task takes longer than its time box | Apply the cut line above; do not start the next task with the previous one half-built. |
| QA finds a failure in a built slice | It reopens that slice's points in the Built column until fixed. |
| The QA machine lacks Docker or a database | The prompts say what to install; a result of `blocked` with the reason is a valid result. |
