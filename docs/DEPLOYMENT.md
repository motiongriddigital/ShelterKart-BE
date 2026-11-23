# Deployment

## What the pipeline does today

| Trigger | Workflow | Result |
| --- | --- | --- |
| Pull request or push | `ci.yml` | tests, real-Postgres run, Docker image built and started |
| Merge to `main` | `release.yml` | image published to GitHub Container Registry as `:main` and `:sha-<commit>` |
| Tag `vX.Y.Z` | `release.yml` | image published as `:X.Y.Z` |

The image (`Dockerfile`) holds `backend/` and `tools/`, runs as the unprivileged `node` user, includes Chromium for PDF printing, and has a health check on `/api/health`. The backend serves the API and report pages only; the website is deployed separately.

## What a host must provide

- Pull and run `ghcr.io/<owner>/shelterkart-be:<tag>` with enough memory for Chromium (start with 2 GB and measure).
- A PostgreSQL 16 database, with `DATABASE_URL` set.
  A managed Postgres such as Supabase works the same way: see `docs/SUPABASE.md` and `docker-compose.baas.yml`.
- The variables in `backend/.env.example`. In production the server refuses to start until the required ones are set and long enough (`engine/configCheck.js`; it prints which, never the values), so a mistyped secret cannot silently switch the paywall off. `.env.example` marks `ALLOWED_ORIGINS` and `DATABASE_URL` as required in production, and the CI production-mode run also sets `ACCESS_TOKEN_SECRET`, `QUOTE_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` and the webhook secrets. Keep every value in the host's secret store, never in the repository.
- One instance only until saved investigations move off local files (`LIVE_JOBS_DIR`); mount a persistent volume there.
- On every release, before starting the new version: `node tools/migrate.js` (idempotent; applies only new migrations). The first time only: `node tools/seed_pricing.js`.
- `TRUST_PROXY` set to the number of proxies in front of the API (usually 1 for one load balancer) or to their addresses. Left unset the API trusts no proxy and counts every client by the address that connects, which behind a load balancer is one address for everyone. Use `loopback` for a proxy on the same machine: it covers `127.0.0.1` and `::1`, while `127.0.0.1` alone does not match a client that connects as `::1`. Never `true`; a forged `X-Forwarded-For` is only believed when it arrives through a trusted proxy, so the API must not be reachable except through it.
- Encrypted database backups (optional, off until a key is set): `pg_dump` must be installed on the API host; set `BACKUP_KEY_ID`, `BACKUP_KEY_<id>` and `BACKUP_DIR` (see `backend/.env.example`). Read `docs/admin/BACKUPS-DESIGN.md` first: where the files go and who holds the key are the owner's decisions.
- Slow-query evidence (recommended): start PostgreSQL with `shared_preload_libraries=pg_stat_statements` (`docker-compose.yml` does) and run `CREATE EXTENSION pg_stat_statements;` once. Read it before adding any index beyond the foreign-key ones.
- Indexes on a table over about 100,000 rows go in a migration whose first line is `-- migrate: no-transaction`, using `CREATE INDEX CONCURRENTLY IF NOT EXISTS`. If a concurrent build fails, the runner names the invalid index; `DROP INDEX` it and run the migration again. `node tools/check_fk_indexes.js` fails when a foreign key has no index and is not allow-listed with a reason.
- A health check on `/api/health`.

## One address or two (website and API)

Every address below is an exact origin: `https://host` with no path and no trailing slash. A wrong one fails silently in a browser, so in production the server refuses to start on a malformed one and says which (`engine/configCheck.js`).

| Setting | Job | Default |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | the websites whose pages may call the API with the session cookie (CORS and the cookie guard) | none: required in production |
| `API_PUBLIC_URL` | the API's own address; allowed to call the API without being listed above (the report pages the API serves itself call it) | none |
| `PUBLIC_BASE_URL` | the website: sitemap, robots, and the default for the next two | none |
| `REPORT_LINK_BASE` | the link e-mailed or sent by WhatsApp to the buyer (`{this}/r/{ref}`) | `PUBLIC_BASE_URL` |
| `PAYMENT_RETURN_BASE` | where the merchant checkout sends the buyer back after paying | `PUBLIC_BASE_URL` |

Same host for both: set `PUBLIC_BASE_URL` and `ALLOWED_ORIGINS` to it; nothing else. Split hosts (website `https://shelterkart.com`, API `https://api.shelterkart.com`): set `ALLOWED_ORIGINS=https://shelterkart.com`, `API_PUBLIC_URL=https://api.shelterkart.com`, `PUBLIC_BASE_URL=https://shelterkart.com`; the report link in e-mails must reach `/r/{ref}` on the API, so either the website proxies `/r/*` to the API (the front end already does) or set `REPORT_LINK_BASE` to the API's address. Not verified against a deployed split: no host exists yet.

## Not built yet: the last step

Nothing in this repository starts the image on a server, because the host is not chosen. When it is, add a `deploy` job to `release.yml` with `environment: staging` for the `main` image and `environment: production` (required reviewers) for tags. Typical options: a container host that pulls from GHCR (Render, Fly.io, Railway), or a VPS reached over SSH running `docker compose pull && docker compose up -d`.

## Rolling back

Redeploy the previous tag's image. There are no down-migrations, so check whether the release being rolled back added a migration before relying on the older image.
