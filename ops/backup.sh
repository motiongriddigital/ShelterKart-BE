#!/usr/bin/env bash
# ShelterKart nightly backup: the database (every report, review, payment record and price book) and the server's own
# files (saved investigations, the built guide). Keeps the last 14 days. Run from cron, for example:
#   0 2 * * *  cd /opt/shelterkart && DATABASE_URL=... ./ops/backup.sh >> /var/log/shelterkart-backup.log 2>&1
# Writes to BACKUP_DIR (default ./backups). Copy that folder off the server; a backup on the same disk is not a backup.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${BACKUP_DIR:-$ROOT/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DEST"
if [ -z "${DATABASE_URL:-}" ]; then
  echo "[backup] DATABASE_URL is not set: the database is NOT backed up. Saved files only." >&2
else
  command -v pg_dump >/dev/null || { echo "[backup] pg_dump is not installed on this server" >&2; exit 1; }
  pg_dump --format=custom --no-owner --file "$DEST/db-$STAMP.dump" "$DATABASE_URL"
  echo "[backup] database: $(du -h "$DEST/db-$STAMP.dump" | cut -f1)"
fi
tar -czf "$DEST/files-$STAMP.tar.gz" -C "$ROOT/backend" data 2>/dev/null || tar -czf "$DEST/files-$STAMP.tar.gz" -T /dev/null
echo "[backup] files: $(du -h "$DEST/files-$STAMP.tar.gz" | cut -f1)"
# keep 14 days
find "$DEST" -maxdepth 1 \( -name 'db-*.dump' -o -name 'files-*.tar.gz' \) -mtime +14 -delete
echo "[backup] done $STAMP"
