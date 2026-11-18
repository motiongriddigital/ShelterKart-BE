# Running on Supabase (managed Postgres)

The back end speaks plain SQL to Postgres through `pg`: JSONB, triggers, `pg_trgm`, `uuid-ossp`, transactions, `pg_dump`. Supabase is Postgres, so the code runs on it without a rewrite. Firebase is not a fit: Firestore is a document store (every query, transaction and trigger would be rewritten), and Firebase SQL Connect (formerly Data Connect) is Cloud SQL Postgres behind a GraphQL layer this API does not use, so it adds a bill and no benefit.

## What changed in the code

| Where | What |
| --- | --- |
| `backend/lib/dbConfig.js` | One place that turns the environment into `pg` options: TLS (automatic for Supabase hosts), pool size, timeouts, statement timeout, CA certificate. Every pool and client in the API and in `tools/` uses it. |
| `DATABASE_URL` and `DATABASE_DIRECT_URL` | The API uses `DATABASE_URL`. Migrations, the pricing seed, the bulk loader, the foreign-key check and `pg_dump` backups use `DATABASE_DIRECT_URL` when set, otherwise `DATABASE_URL`. |
| `tools/migrate.js` | After the migrations, on a database that has the `anon` and `authenticated` roles, turns row level security on for every public table and removes the API roles' rights (also for tables created later). Does nothing on plain Postgres. Runs every time, is not a recorded migration. |
| `engine/configCheck.js` | In production: refuses TLS off on a Supabase host; warns when the certificate is not verified, when `verify` has no CA, and when the pooler is in transaction mode with no direct address. |
| `docker-compose.baas.yml` | The production stack without the local `db` container. |
| `Dockerfile` | `postgresql-client-17` (was 16): `pg_dump` must not be older than the server, and a newer client dumps older servers. |

## Connection rules

- API: the transaction pooler, port 6543, user `postgres.<project ref>`. The code uses no named prepared statements, advisory locks, `LISTEN` or session `SET`, which is what transaction mode needs.
- Migrations and backups: the session pooler (port 5432 on the pooler host) or the direct address. The direct host is IPv6 only unless the IPv4 add-on is bought, so the session pooler is the simpler choice on a host without IPv6.
- Pool size: `DATABASE_POOL_MAX` per API process. Keep processes times this under the pooler's client limit for the plan.
- TLS: automatic. For certificate checking set `DATABASE_SSL=verify` and `DATABASE_SSL_CA` to the CA certificate from the Supabase dashboard (Database, SSL).

## Security

- The Data API (PostgREST) is on by default and reachable with the public `anon` key. The lockdown step above leaves it nothing to read or write. Never put the `service_role` key or the database password in the website.
- The API connects as `postgres`, which owns the tables and bypasses row level security, so no policies are needed.
- Turn the Data API off in the dashboard if nothing uses it (Settings, API). It is a second lock, not the only one.
- Region: pick the region on purpose. Where buyers' e-mail addresses and report data live is a privacy question for counsel (SHEL-56), not only a latency one.

## Not covered by this change

- Saved investigations (`LIVE_JOBS_DIR`), generated PDFs (`PDF_DIR`) and the backup folder are still files. Keep the persistent volumes in `docker-compose.baas.yml` and run one API instance until SHEL-9 (job store in Postgres) is built. PDFs could move to Supabase Storage later.
- Supabase's own daily backups are not a replacement for the encrypted offsite dumps this API makes; set `BACKUP_KEY_ID` and a key as before.
- Prices and plan limits were not read from supabase.com in this session. Check the plan's database size, egress, connection limits and compute before choosing one.

## Start order (owner)

1. Create the project, note the region, copy both connection strings and the CA certificate.
2. Put the `DATABASE_*` values in the host `.env` (see `backend/.env.example`).
3. `TAG=<tag> COMPOSE="docker compose -f docker-compose.baas.yml" ./ops/deploy.sh`.
4. `curl /api/admin/readiness` and check the start-up log for the database lines.
