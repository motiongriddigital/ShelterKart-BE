#!/usr/bin/env bash
# Run on the host, in the folder that holds docker-compose.prod.yml and .env:  TAG=<image tag> ./ops/deploy.sh
# Pulls the image, applies migrations, starts the new version, waits for it to be healthy and, if it is not, puts the previous tag back.
# There are no down-migrations: read docs/RUNBOOK.md before rolling back across a release that added a migration.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${TAG:?set TAG to the image tag to deploy}"
COMPOSE="${COMPOSE:-docker compose -f docker-compose.prod.yml}"
STATE=".deployed-tag"
HEALTH_TRIES="${HEALTH_TRIES:-30}"
HEALTH_WAIT="${HEALTH_WAIT:-5}"
previous="$(cat "$STATE" 2>/dev/null || true)"

healthy() {
  for _ in $(seq 1 "$HEALTH_TRIES"); do
    if $COMPOSE exec -T api node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then return 0; fi
    sleep "$HEALTH_WAIT"
  done
  return 1
}

echo "[deploy] pulling $TAG (was: ${previous:-none})"
TAG="$TAG" $COMPOSE pull api migrate proxy
echo "[deploy] starting $TAG"
TAG="$TAG" $COMPOSE up -d --remove-orphans
if healthy; then
  echo "$TAG" > "$STATE"
  echo "[deploy] $TAG is healthy"
  exit 0
fi
echo "[deploy] $TAG did not become healthy" >&2
$COMPOSE logs --tail 80 api >&2 || true
if [ -n "$previous" ] && [ "$previous" != "$TAG" ]; then
  echo "[deploy] putting $previous back" >&2
  TAG="$previous" $COMPOSE up -d --remove-orphans
  if healthy; then echo "[deploy] $previous is running again; $TAG is NOT deployed" >&2; else echo "[deploy] $previous is not healthy either: act now" >&2; fi
else
  echo "[deploy] no previous tag to go back to" >&2
fi
exit 1
