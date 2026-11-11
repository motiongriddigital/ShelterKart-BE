# Runbook: first deploy, release, rollback, restore

Files: `docker-compose.prod.yml`, `ops/Caddyfile`, `ops/deploy.sh`, `ops/offsite-backup.sh`, `.github/workflows/deploy.yml`. Nothing here has been run against a real host. What was checked on 11 Nov 2026: `ops/deploy.sh` against a stub of docker (healthy release, rollback, first release, no tag); the compose file's database, migrate and api services started on a developer machine from the built image with a throwaway database (19 migrations applied, `/api/health` healthy, one encrypted backup written by the app inside the container, decrypted and restored into a scratch database with equal row counts); the Caddyfile with `caddy validate`; the deploy workflow with actionlint; both scripts with shellcheck. Not checked: the proxy serving HTTPS, `ops/offsite-backup.sh` against a real bucket (only its `docker cp` step), `docker compose pull` from the registry, and the workflow itself.

## One-time host setup

1. A Linux server (Debian or Ubuntu) with Docker Engine and the compose plugin, a non-root user in the `docker` group, and SSH by key only.
2. A DNS A record for the API host name (for example `api.shelterkart.com`) pointing at the server. Ports 80 and 443 open; nothing else, and the database port is never published.
3. A folder for the deployment, for example `/srv/shelterkart`, owned by that user.
4. In that folder a file `.env` (mode 600) that holds every secret and setting the server needs: `POSTGRES_PASSWORD`, `API_DOMAIN`, and the names listed in `backend/.env.example` (admin login, `ACCESS_TOKEN_SECRET`, `QUOTE_SECRET`, `ALLOWED_ORIGINS`, payment and mail settings, backup key). In production the server refuses to start until the required ones are strong enough. Put secrets there or in the host's secret settings; never in chat or e-mail.
5. If the package is private, `docker login ghcr.io` once on the host with a read-only token.
6. In GitHub (Settings, Environments): create `staging` and `production`; require a reviewer on `production`. Set the variables `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH` and the secrets `DEPLOY_SSH_KEY` (a key made only for this) and `DEPLOY_KNOWN_HOSTS` (output of `ssh-keyscan` for the host, checked by eye). The deploy job does nothing while `DEPLOY_HOST` is unset.

## First deploy

1. Actions, deploy, run workflow: tag `sha-<commit>` (or a version tag), environment staging.
2. The workflow copies the compose file and scripts, then `ops/deploy.sh` pulls the image, applies migrations, starts the stack and waits for `/api/health`.
3. Check: `https://<API_DOMAIN>/api/health`; sign in to the admin pages; `GET /api/admin/readiness` lists what is still missing (GSTIN, payment keys, mail); `GET /api/admin/tax` lists the countries that sell.
4. Cron on the host, as the deploy user: the server writes its encrypted backup by itself (set `BACKUP_KEY_ID` and `BACKUP_KEY_<id>`); then `30 3 * * * cd /srv/shelterkart && OFFSITE_REMOTE=<rclone remote:bucket> ./ops/offsite-backup.sh >> offsite.log 2>&1`. Keep the backup key somewhere other than this server.

## Release

Run the deploy workflow with the new tag. Production asks for the reviewer's approval first. If the new tag is not healthy within about two and a half minutes, the script puts the previous tag back and the workflow fails.

## Rollback

Run the deploy workflow with the previous tag. There are no down-migrations: if the release you are leaving added a migration, the older code runs on the newer schema. Migrations here are additive, but read the release's migration list first, and if it dropped or renamed anything restore the database from a backup instead.

## Restore (rehearse it before the first real customer)

Follow `docs/admin/BACKUPS-DESIGN.md`: fetch a `.skbk` file and the key, decrypt with `tools/backup-decrypt.js`, restore into a scratch database, compare row counts, drop it. Never restore over the live database.

## Reading logs

`docker compose -f docker-compose.prod.yml logs --tail 200 api`. Start-up prints `[config]` warnings and, in production, `[readiness]` lines naming (never printing) what is missing.

## When something is wrong

Health fails after a deploy: read the log above; the script has already rolled back if it could. Payments do not confirm: check the webhook secret names in `GET /api/admin/readiness` and the admin payments pages. No e-mail arrives: `GET /api/admin/delivery`. Disk full: the `backups` and `livejobs` volumes grow; saved investigations are deleted after 30 days by design.
