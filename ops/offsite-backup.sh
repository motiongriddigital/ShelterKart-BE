#!/usr/bin/env bash
# Copies the encrypted database backups (*.skbk) from the backups volume to an S3-compatible bucket and checks the copy.
# The files are encrypted by the server; the key (BACKUP_KEY_<id>) is NOT in the bucket and must be kept somewhere else.
# Needs rclone on the host with a remote configured (rclone config), for example:  OFFSITE_REMOTE=shelterkart-backups:bucket-name ./ops/offsite-backup.sh
# Run from cron after the server's own backup, e.g. every day at 03:30.
set -euo pipefail
: "${OFFSITE_REMOTE:?set OFFSITE_REMOTE to a configured rclone remote and bucket, for example shelterkart-backups:my-bucket}"
cd "$(dirname "$0")/.."
COMPOSE="${COMPOSE:-docker compose -f docker-compose.prod.yml}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cid="$($COMPOSE ps -q api)"
[ -n "$cid" ] || { echo "[offsite] the api container is not running" >&2; exit 1; }
docker cp "$cid:/app/backend/data/backups/." "$STAGE/"
count="$(find "$STAGE" -maxdepth 1 -name '*.skbk' | wc -l | tr -d ' ')"
[ "$count" -gt 0 ] || { echo "[offsite] no backup files yet: nothing copied" >&2; exit 1; }
rclone copy "$STAGE" "$OFFSITE_REMOTE" --include '*.skbk' --immutable
rclone check "$STAGE" "$OFFSITE_REMOTE" --include '*.skbk' --one-way
echo "[offsite] $count file(s) copied and checked"
