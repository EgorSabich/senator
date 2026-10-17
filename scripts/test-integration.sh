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

# throwaway VAPID keys for this run (push tests use a fake push service on localhost)
read -r VAPID_PUB VAPID_PRIV < <(node -e "
const { generateKeyPairSync } = require('node:crypto');
const k = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const j = k.privateKey.export({ format: 'jwk' });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(j.x, 'base64url'), Buffer.from(j.y, 'base64url')]).toString('base64url');
console.log(pub, j.d);")
export VAPID_PUB

npx vite build >/dev/null 2>&1
setsid npx wrangler dev -c dist/senator_academy/wrangler.json --persist-to "$STATE" --port "$PORT" --test-scheduled \
  --var "AUTH_SECRET:$AUTH_SECRET" --var "APP_ENV:development" \
  --var "VAPID_PUBLIC_KEY:$VAPID_PUB" --var "VAPID_PRIVATE_KEY:$VAPID_PRIV" --var "VAPID_SUBJECT:mailto:test@senator.pl" >"$LOG" 2>&1 &
DEV_PID=$!
for _ in $(seq 1 60); do curl -sf "$ACADEMY_URL/api/health" >/dev/null && break; sleep 1; done
curl -sf "$ACADEMY_URL/api/health" >/dev/null || { cat "$LOG"; exit 1; }

npx vitest run -c vitest.int.config.ts ${INT_FILTER:-} || { echo "--- worker log ---"; tail -50 "$LOG"; exit 1; }
