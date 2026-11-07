#!/bin/sh
# Runs everything inside the sandbox: the full test suite, the AI engine over real sockets against a stand-in server, and the new
# register connectors against the real services, then prints what the firewall counted. Usage: ops/sandbox/run.sh [--no-live-registers]
set -u
cd "$(dirname "$0")"
LOG="${TMPDIR:-/tmp}/sk-sandbox-$(date +%Y%m%d-%H%M%S).log"
dc() { docker compose -f docker-compose.yml "$@"; }
RC=0
{
echo "== build"; dc build app fw >/dev/null || exit 1
echo "== start the boundary, database and stand-in AI server"; dc up -d --wait fw pg stub || exit 1
echo "== the application container's own view of its limits"
dc run --rm app sh -c 'echo "user id: $(id -u)"; grep -E "CapEff|NoNewPrivs" /proc/self/status; touch /app/should-fail 2>&1 | head -1; echo x > /etc/should-fail 2>&1 | head -1; true'
echo "== phase 1: the full test suite"
# the stub-based tests expect a clean environment, so the sandbox's database and API settings are blanked for this phase only
dc run --rm -e DATABASE_URL= -e ANTHROPIC_API_KEY= -e ANTHROPIC_API_URL= app sh -c 'npm test > /tmp/t.log 2>&1; echo "exit=$?  failures=$(grep -c "  FAIL" /tmp/t.log)"; tail -3 /tmp/t.log' || RC=1
echo "== phase 2: the AI engine over real sockets"
dc run --rm app node ../ops/sandbox/probes/probe_engine.js || RC=1
if [ "${1:-}" != "--no-live-registers" ]; then
  echo "== phase 3: migrations, then the register connectors against the real services"
  dc run --rm app node ../tools/migrate.js | tail -2 || RC=1
  dc run --rm app node ../ops/sandbox/probes/probe_registers.js || RC=1
fi
echo "== what crossed the boundary"; dc exec -T fw /report.sh
echo "== limits Docker enforced on the application container"
CID=$(dc run -d app sleep 15); docker inspect "$CID" --format 'readonly_rootfs={{.HostConfig.ReadonlyRootfs}} cap_drop={{.HostConfig.CapDrop}} security={{.HostConfig.SecurityOpt}} memory={{.HostConfig.Memory}} cpus_nano={{.HostConfig.NanoCpus}} pids={{.HostConfig.PidsLimit}} user={{.Config.User}} network={{.HostConfig.NetworkMode}}'; docker rm -f "$CID" >/dev/null 2>&1
} 2>&1 | tee "$LOG"
dc down -v >/dev/null 2>&1
echo "log: $LOG"
