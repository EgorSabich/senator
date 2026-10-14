#!/usr/bin/env bash
# Integration tests (spec section L) against local workerd with a fresh database.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=${PORT:-8798}
STATE=.wrangler/state-int
LOG=$(mktemp)
export AUTH_SECRET=test-secret-not-for-production
export OWNER_TEMP_PASSWORD=TymczasoweHaslo1
export OWNER_LOGIN=test.wlasciciel
export ACADEMY_URL="http://localhost:$PORT"
trap 'kill -- -$DEV_PID 2>/dev/null || true' EXIT

rm -rf "$STATE"
npx wrangler d1 migrations apply DB --local --persist-to "$STATE" >/dev/null 2>&1
node scripts/create-owner.mjs "Test" "Właściciel" "$OWNER_LOGIN" 2>/dev/null >"$STATE/owner.sql"
npx wrangler d1 execute DB --local --persist-to "$STATE" --file "$STATE/owner.sql" >/dev/null 2>&1

npx vite build >/dev/null 2>&1
setsid npx wrangler dev -c dist/senator_academy/wrangler.json --persist-to "$STATE" --port "$PORT" \
  --var "AUTH_SECRET:$AUTH_SECRET" --var "APP_ENV:development" >"$LOG" 2>&1 &
DEV_PID=$!
for _ in $(seq 1 60); do curl -sf "$ACADEMY_URL/api/health" >/dev/null && break; sleep 1; done
curl -sf "$ACADEMY_URL/api/health" >/dev/null || { cat "$LOG"; exit 1; }

npx vitest run -c vitest.int.config.ts || { echo "--- worker log ---"; tail -50 "$LOG"; exit 1; }
