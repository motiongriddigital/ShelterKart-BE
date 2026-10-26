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
- The variables in `backend/.env.example`. `.env.example` marks `ALLOWED_ORIGINS` and `DATABASE_URL` as required in production, and the CI production-mode run also sets `ACCESS_TOKEN_SECRET`, `QUOTE_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` and the webhook secrets. Keep every value in the host's secret store, never in the repository.
- One instance only until saved investigations move off local files (`LIVE_JOBS_DIR`); mount a persistent volume there.
- On every release, before starting the new version: `node tools/migrate.js` (idempotent; applies only new migrations). The first time only: `node tools/seed_pricing.js`.
- A health check on `/api/health`.

## Not built yet: the last step

Nothing in this repository starts the image on a server, because the host is not chosen. When it is, add a `deploy` job to `release.yml` with `environment: staging` for the `main` image and `environment: production` (required reviewers) for tags. Typical options: a container host that pulls from GHCR (Render, Fly.io, Railway), or a VPS reached over SSH running `docker compose pull && docker compose up -d`.

## Rolling back

Redeploy the previous tag's image. There are no down-migrations, so check whether the release being rolled back added a migration before relying on the older image.
