# Admin panel: backend plan

Written 4 November 2026. The admin panel UI (frontend repository, branch `admin-console`) is built on generated seed data. This plan is the backend that replaces the seed data, in the order the owner listed the panel's items. Each slice is its own branch and pull request, with tests and an OpenAPI entry, and nothing is merged without the owner.

## Rules for every slice

1. Read-only first: a screen gets its read API before any write action.
2. Every route is behind `adminAuth`, answers `Cache-Control: no-store`, and is in `docs/api/openapi.yaml` (tag Admin).
3. Tests: the in-memory harness for the routes, and a throwaway Postgres run for any new SQL (as done for `auth_events` and `bans`).
4. Privacy: no code, no raw IP address, no e-mail body in a log. Addresses are peppered hashes. Anything personal has a retention period and is removed when an account is deleted.
5. A decision that is the owner's (key storage, retention, limits) is written down as a question, not guessed.

## Prerequisite: what has to be merged first

| What | Why |
| --- | --- |
| PR #11 (client handover) | The marketing dashboard and social desk routes that the new frontend pages call exist only there. |
| PR #12 (user accounts) | Users, sessions and everything below stack on it. |
| SHEL-35 (proxy trust) | Per-IP rate limits and IP bans read `req.ip`. If the client address can be spoofed, both can be dodged. Make the trusted-proxy count configurable and document the host setup. |

## The ten items

| # | Panel item | Screen (frontend) | Backend today | To build | Slice |
| --- | --- | --- | --- | --- | --- |
| 8 | User and session management, IP ban, account ban | Users and sessions | Accounts, sessions, audit log | `auth_events`, `bans`, admin users and sessions routes, ban enforcement. **Built 4 Nov on `feature/admin-users`.** | S1 |
| 2 | Health reports and error logs | Health and errors | Register health, delivery status | `error_log` table fed by the central error handler and the job runner, `GET /api/admin/errors`, failed jobs list and retry, health history per register | S2 |
| 1 | AI engine usage and how the engine works | AI engine | Usage since the last start, costs | Persist usage per day and per engine, `GET /api/admin/engines/history`, cost per report, routing view | S3 |
| 3 | Sales dashboard | Sales | Revenue totals, tax progress | Revenue per day, currency and country, orders list, refunds list | S4 |
| 9 | Users on a world map | User map | Visitor country counts in analytics | Users by country (`users.country` set from the edge header at sign-up), `GET /api/admin/geo/users` | S4 |
| 10 | Website traffic and graphs | Website traffic | `GET /api/admin/analytics` | Nothing new for the first version; add page-level counts if wanted | frontend only |
| 5 | Free versus premium roadmap | Free vs premium | Visit-to-payment funnel, sign-in funnel | Per-user stages (anonymous search, signed in, preview, checkout, paid) with drop-off per step, `GET /api/admin/funnel/users` | S5 |
| 4 | Marketing dashboard | Marketing dashboard, Marketing desk | Both exist in PR #11 | Nothing new; wire demo data if wanted | none |
| 7 | Insights | Insights card, Insights page | none | Rule-based generator over analytics, health, errors and disputes, `GET /api/admin/insights` | S6 |
| 6 | Database backups every two weeks, encrypted, header notices | Settings, Database backups | none | Scheduled `pg_dump`, encryption, `backups` table, status and notice API, restore runbook | S7 |

## Slice details

### S1 Users, sessions, bans (done, needs review)

- Tables `auth_events` and `bans` in `accounts.sql` (the thirteenth migration, which is unmerged, so no new migration number).
- Events: code requested, cooldown, per-e-mail and per-IP rate limits, wrong code, lock, expired code, blocked (banned address, banned account, disabled), sign-in, challenge failed, consent missing.
- Routes: `GET /api/admin/users`, `GET /api/admin/users/:id` (profile, sessions, purchases, opened reports, sign-in counts for 24 hours, 7 and 30 days, last 50 events), disable and enable, end sessions, `GET /api/admin/sessions`, end one session, ban its address by hash, `GET` and `POST /api/admin/bans`, lift, `GET /api/admin/auth/summary`.
- Enforcement: a banned address is refused on code request, verify and every guarded route; a banned account cannot sign in and its sessions end at once. A ban list is cached for 30 seconds and dropped when a ban changes.
- Safety: a range wider than /8 is refused; an admin cannot ban the address they are using; a repeat ban is a 409.
- Open: the frontend must switch the Users screens from seed data to these routes (read first, then the actions). Retention of `auth_events` is 90 days (owner to confirm).

### S2 Health and error log (part 1, the error log, built 4 Nov on `feature/admin-error-log`; part 2 below is still to do)

- Built: `error_log` and `error_hits` tables (the fourteenth migration, `error_log.sql`), `backend/engine/errorlog.js`: every `console.error` and `console.warn` is mirrored into a grouped, scrubbed log (a `[tag]` becomes the source; the central error handler now tags its line), flood-throttled, kept 30 days, switch off with `ERROR_LOG=off`. Routes `GET /api/admin/errors`, `/errors/summary`, `/errors/:id`. 17 unit checks, 5 server checks, real-Postgres run.
- Not built yet: failed-jobs list and retry, health history per register (below).

- `error_log(id, at, level, source, message, detail, fingerprint, count, first_at, last_at)`, grouped by fingerprint so a flood is one row with a count.
- Feed it from: the central Express error handler, the investigation job runner, the delivery layer, the payment webhooks, engine failures.
- Routes: `GET /api/admin/errors?level=&q=&since=`, `GET /api/admin/errors/:id`, `GET /api/admin/jobs/failed`, `POST /api/admin/jobs/:id/retry`, `GET /api/admin/health/registers/history`.
- No personal data in `detail`; cap its length; keep 30 days.

### S3 AI engine history

- Today usage is in memory and resets on restart. Persist a daily row per engine and role: calls, failures, rescues, tokens, cost estimate, p50 and p95 latency.
- Routes: `GET /api/admin/engines/history?days=`, `GET /api/admin/engines/costs?days=` (cost per paid report).

### S4 Sales and geography

- Sales: `GET /api/admin/sales/series?days=&by=currency|country`, `GET /api/admin/sales/orders`, `GET /api/admin/sales/refunds`.
- Geography: set `users.country` at first sign-in from the edge country header (never from the IP address itself), `GET /api/admin/geo/users` returning users, new this week, paid and conversion per country for the 36 markets.

### S5 Free versus premium

- Define the stages with the owner first (open question 1 below), then derive per-user stages from `report_purchases`, `user_reports` and the funnel events.
- Routes: `GET /api/admin/funnel/users?days=`, with counts per stage and the largest drop-off.

### S6 Insights

- A pure function over the other slices' numbers, with each insight carrying a tone, a sentence, and the page to open. Tested with fixed inputs, like `engine/analytics.js aggregate`.

### S7 Backups

- A scheduler job (every 14 days, plus a manual trigger) runs `pg_dump`, compresses, encrypts, writes to the chosen destination, verifies the checksum, and records the result in `backups`.
- Routes: `GET /api/admin/backups`, `POST /api/admin/backups/run`, `GET /api/admin/backups/notice` (what the header shows: last result, next due, a failure or overdue warning), `GET /api/admin/backups/keys` (key ids and ages only, never key material).
- The restore path is a documented runbook and is rehearsed once on a throwaway database before the first real backup counts.

## Open questions for the owner

1. What does "free" and "premium" mean per user: preview only versus paid report, or is a membership planned?
2. Where do backups go (an object store, the host's disk, another machine), and who holds the encryption key? A key kept on the same host as the database does not protect against losing the host.
3. How long may sign-in activity be kept? The plan assumes 90 days.
4. Do admins stay a single shared login, or should each admin have an account and an audit trail of their own?
5. Is the client's number 33 markets or the code's 36? The map and the lists use 36.

## Order of work

S1 review and merge, then SHEL-35, then S2, S4 (geo), S3, S5, S6, S7 (S7 waits for question 2). The frontend switches each screen from seed data to its routes as the slice lands.
