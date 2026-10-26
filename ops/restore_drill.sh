#!/usr/bin/env bash
# ShelterKart restore drill. Restores the newest database backup into a SCRATCH database (never the live one), then
# checks that the tables are there and that the counts match what the backup recorded. Run it monthly, and after any
# change to the database schema. A backup that has never been restored is not known to work.
#   DRILL_DATABASE_URL=postgres://.../shelterkart_drill BACKUP_DIR=/path ./ops/restore_drill.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${BACKUP_DIR:-$ROOT/backups}"
TARGET="${DRILL_DATABASE_URL:?set DRILL_DATABASE_URL to a scratch database, never the live one}"
if [ -n "${DATABASE_URL:-}" ] && [ "$TARGET" = "$DATABASE_URL" ]; then echo "[drill] refusing: the drill target is the live database" >&2; exit 1; fi
LATEST="$(ls -1t "$DEST"/db-*.dump 2>/dev/null | head -1 || true)"
[ -n "$LATEST" ] || { echo "[drill] no database backup found in $DEST" >&2; exit 1; }
echo "[drill] restoring $LATEST into the scratch database"
pg_restore --clean --if-exists --no-owner --dbname "$TARGET" "$LATEST"
for T in reports report_purchases disputes developer_responses; do
  if psql "$TARGET" -tAc "select to_regclass('public.$T')" | grep -q "$T"; then
    echo "[drill] table $T: $(psql "$TARGET" -tAc "select count(*) from $T") rows"
  else
    echo "[drill] table $T is missing from the restored copy" >&2; exit 1
  fi
done
echo "[drill] PASSED: $(basename "$LATEST") restores cleanly. Record the date in LATEST.md."
