# Index audit, 7 November 2026

What was checked: the hot queries listed in the SHEL-64 design, run under `EXPLAIN` on PostgreSQL 16 after all 18 migrations, with this seeded data and `ANALYZE`:

| Table | Rows |
| --- | --- |
| `users` | 20,000 |
| `sessions` | 50,000 |
| `auth_events` | 100,000 |
| `auth_codes` | 100,000 |
| `analytics_events` | 200,000 |
| `error_log` / `error_hits` | 5,000 / 200,000 |
| `report_purchases` | 50,000 |
| `research_briefs` | 10,000 |

Synthetic data: row counts and key spread are realistic, the real distribution is not. Re-run when there is traffic, using `pg_stat_statements` (see `docs/DEPLOYMENT.md`).

## Result

Every hot query uses an index except the three below. No new index is needed now.

| Query | Plan | Verdict |
| --- | --- | --- |
| Session by token hash, joined to the user | primary keys on both | fine |
| A user's paid purchase of a report; a user's purchases newest first | `idx_report_purchases_user`, then a sort of the user's own rows | fine |
| Brief by ref | primary key | fine |
| Analytics events since a time | `idx_analytics_events_at` | fine |
| Auth events by address; latest and open sign-in code by address | `idx_auth_events_email`, `idx_auth_codes_email` | fine |
| Active sessions per user in the admin list | partial `idx_sessions_user` | fine |
| Error log and hit prunes | `idx_error_log_last`, `idx_error_hits_at` | fine |
| Deleting one `error_log` row (cascade to its hits) | uses the new `idx_error_hits_error`: 0.39 ms; without it 7.4 ms with 200,000 hits (about 19 times slower, and it grows with the table) | the migration-18 index earns its place |
| Admin users list, newest first, 50 rows | sequential scan and sort of `users` (no index on `created_at`) | fine at 20,000 users (about 1,000 cost units); add `users (created_at DESC)` if the list gets slow past roughly 100,000 users |
| Briefs created in the last 7 days (startup load) | sequential scan | expected: the window covers the whole table |
| Six-hourly delete of sign-in codes older than 24 hours | sequential scan of `auth_codes` | accepted: the table only ever holds about a day of rows, and an index on `created_at` would slow every sign-in insert |

## Not covered

- Queries behind the evidence tables (no code path uses them yet; their foreign keys are allow-listed in `tools/fk-index-allowlist.json`).
- Source health by market, engine usage per day and failed jobs (small tables; not seeded).
- Lock behaviour of index builds on a live table: use `-- migrate: no-transaction` and `CREATE INDEX CONCURRENTLY` (documented in `docs/DEPLOYMENT.md`).
