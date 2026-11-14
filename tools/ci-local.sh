#!/usr/bin/env bash
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
REF="${CI_LOCAL_REF:-HEAD}"
STAGES=()
KEEP=0
WORKTREE=0
for arg in "$@"; do
  case "$arg" in
    logic|real-run|image) STAGES+=("$arg") ;;
    all) ;;
    --keep) KEEP=1 ;;
    --worktree) WORKTREE=1 ;;
    -h|--help)
      printf 'usage: tools/ci-local.sh [logic] [real-run] [image] [--keep] [--worktree]\n'
      printf 'runs the jobs of .github/workflows/ci.yml in Docker against the committed tree (CI_LOCAL_REF, default HEAD); --worktree exports the working tree (tracked and new, not ignored files) instead\n'
      exit 0 ;;
    *) printf 'unknown argument: %s\n' "$arg" >&2; exit 2 ;;
  esac
done
[ ${#STAGES[@]} -eq 0 ] && STAGES=(logic real-run image)

command -v docker >/dev/null || { printf 'docker is not installed\n' >&2; exit 2; }
docker info >/dev/null 2>&1 || { printf 'the Docker daemon is not running\n' >&2; exit 2; }

RUN_ID="skci-$$"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/${RUN_ID}.XXXXXX")"
NET="${RUN_ID}-net"
PG="${RUN_ID}-pg"
API="${RUN_ID}-api"
NODE_IMAGE="node:22-slim"
PG_IMAGE="postgres:16"
RESULTS=()

cleanup() {
  docker rm -f "$PG" "$API" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  if [ "$KEEP" -eq 0 ]; then
    docker run --rm -v "$WORK:/work" "$NODE_IMAGE" chown -R "$(id -u):$(id -g)" /work >/dev/null 2>&1
    /bin/rm -rf "$WORK"
  else
    printf 'kept the exported tree at %s\n' "$WORK"
  fi
}
trap cleanup EXIT

if [ "$WORKTREE" -eq 1 ]; then
  printf '== exporting the working tree (tracked and new files)\n'
  (cd "$ROOT" && git ls-files -z --cached --others --exclude-standard | tar --null -T - -cf -) | tar -x -C "$WORK"
else
  printf '== exporting %s (%s)\n' "$REF" "$(git rev-parse --short "$REF")"
  git archive "$REF" | tar -x -C "$WORK"
fi
/bin/rm -f "$WORK/backend/node_modules"

CI_YML="$WORK/.github/workflows/ci.yml"
MIGRATIONS_LINE="$(grep -o '0 applied, [0-9]* already applied' "$CI_YML" | head -1)"
MIGRATIONS_LINE="${MIGRATIONS_LINE:-0 applied}"

docker volume create shelterkart-ci-npm >/dev/null
docker volume create shelterkart-ci-playwright >/dev/null

stage_logic() {
  docker run --rm \
    -v "$WORK:/work" -w /work/backend \
    -v shelterkart-ci-npm:/root/.npm \
    -v shelterkart-ci-playwright:/root/.cache/ms-playwright \
    "$NODE_IMAGE" bash /work/tools/ci-local/logic.sh
}

stage_real_run() {
  docker network create "$NET" >/dev/null || return 1
  docker run -d --name "$PG" --network "$NET" \
    -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=shelterkart \
    --health-cmd "pg_isready -U postgres" --health-interval 2s --health-timeout 5s --health-retries 30 \
    "$PG_IMAGE" >/dev/null || return 1
  for _ in $(seq 1 60); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$PG" 2>/dev/null)" = "healthy" ] && break
    sleep 1
  done
  docker run --rm --network "$NET" \
    -v "$WORK:/work" -w /work \
    -v shelterkart-ci-npm:/root/.npm \
    -e "MIGRATIONS_LINE=$MIGRATIONS_LINE" \
    -e DATABASE_URL=postgres://postgres:ci@"$PG":5432/shelterkart \
    "$NODE_IMAGE" bash /work/tools/ci-local/real-run.sh
}

pull_with_limit() {
  local image="$1" limit="${CI_LOCAL_PULL_SECONDS:-90}"
  docker pull "$image" >/dev/null 2>&1 &
  local pid=$!
  for _ in $(seq 1 "$limit"); do
    kill -0 "$pid" 2>/dev/null || { wait "$pid"; return $?; }
    sleep 1
  done
  kill "$pid" 2>/dev/null
  return 1
}

prepare_base_images() {
  local base
  for base in $(grep -i '^FROM ' "$WORK/Dockerfile" | awk '{print $2}' | sort -u); do
    docker image inspect "$base" >/dev/null 2>&1 && continue
    printf 'pulling %s\n' "$base"
    pull_with_limit "$base" && continue
    if [ "$base" = "node:22-bookworm-slim" ] && docker run --rm node:22-slim grep -q bookworm /etc/os-release 2>/dev/null; then
      printf 'WARNING: could not pull %s; tagging the local node:22-slim (Debian bookworm) as %s\n' "$base" "$base"
      docker tag node:22-slim "$base"
    else
      printf 'could not pull %s\n' "$base" >&2
      return 1
    fi
  done
}

stage_image() {
  prepare_base_images || return 1
  docker build -t shelterkart-be:ci "$WORK" || return 1
  local port="${CI_LOCAL_IMAGE_PORT:-14000}"
  docker run -d --name "$API" -p "$port:4000" -e NODE_ENV=development shelterkart-be:ci >/dev/null || return 1
  for _ in $(seq 1 30); do
    if curl -sf "localhost:$port/api/health"; then
      printf '\n'
      return 0
    fi
    sleep 1
  done
  docker logs "$API"
  return 1
}

failed=0
logic_ok=1
for stage in "${STAGES[@]}"; do
  printf '\n== job: %s\n' "$stage"
  started=$SECONDS
  case "$stage" in
    logic) stage_logic; rc=$? ; [ $rc -ne 0 ] && logic_ok=0 ;;
    real-run)
      if [ "$logic_ok" -eq 0 ]; then
        printf 'skipped: logic failed (CI skips it too)\n'
        RESULTS+=("real-run  skipped")
        continue
      fi
      stage_real_run; rc=$? ;;
    image) stage_image; rc=$? ;;
  esac
  took=$((SECONDS - started))
  if [ $rc -eq 0 ]; then
    RESULTS+=("$(printf '%-9s pass  %ss' "$stage" "$took")")
  else
    RESULTS+=("$(printf '%-9s FAIL  %ss' "$stage" "$took")")
    failed=1
  fi
done

printf '\n== local CI result\n'
for line in "${RESULTS[@]}"; do printf '%s\n' "$line"; done
exit $failed
