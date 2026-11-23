#!/usr/bin/env bash
set -euo pipefail

export NODE_ENV=production
export PORT=3000
export ALLOWED_ORIGINS=https://ci.shelterkart.invalid
export ADMIN_USERNAME=ci-admin
export ADMIN_PASSWORD=ci-admin-password-not-secret
export ACCESS_TOKEN_SECRET=ci-access-token-secret-0123456789abcdef
export QUOTE_SECRET=ci-quote-secret-ghijklmnopqrstuvwxyz0123
export PAYMENT_WEBHOOK_SECRET=ci-webhook-secret
export RAZORPAY_WEBHOOK_SECRET=ci-webhook-secret
export SMOKE_WEBHOOK_SECRET=ci-webhook-secret

wait_health() {
  local port="$1"
  for _ in $(seq 1 30); do
    if node -e "fetch('http://localhost:$port/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
      printf '\n'
      return 0
    fi
    sleep 1
  done
  return 1
}

step() { printf '\n-- %s\n' "$1"; }

step "npm ci"
(cd backend && npm ci)

step "Apply the migrations"
node tools/migrate.js

step "Re-run the migrations: nothing may apply twice"
node tools/migrate.js | tee /tmp/second.txt
grep -q "$MIGRATIONS_LINE" /tmp/second.txt

step "Every foreign key is indexed or allow-listed"
node tools/check_fk_indexes.js

step "The Postgres job store holds up with two instances"
node tools/check_job_store.js

step "Seed the pricing reference tables"
node tools/seed_pricing.js

on_failure() {
  printf '\n-- server logs\n'
  cat /tmp/server.log /tmp/server-accounts.log 2>/dev/null || true
}
trap on_failure ERR

step "Start the real server"
(node backend/server.js > /tmp/server.log 2>&1 &)
wait_health 3000

step "Smoke test the real server"
node tools/smoke.js http://localhost:3000

step "Start a second server with user accounts on"
(
  NODE_ENV=development PORT=3001 ACCOUNTS_ENABLED=on \
  AUTH_PEPPER=ci-pepper-not-a-secret-0123456789abcdef \
  ACCOUNTS_DEV_ECHO=on ACCOUNTS_CSRF=on API_VALIDATION=enforce \
  API_VALIDATION_ENFORCE=/api/auth,/api/me ALLOWED_ORIGINS=http://localhost:5173 \
  node backend/server.js > /tmp/server-accounts.log 2>&1 &
)
wait_health 3001

step "Smoke test sign-in, sessions and the wall against the real database"
node tools/smoke_accounts.js http://localhost:3001
