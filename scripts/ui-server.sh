#!/usr/bin/env bash
# Fresh local server for screen checks on :8797
cd "$(dirname "$0")/.."
S=${TMPDIR:-/tmp}
STATE=.wrangler/state-ui
# stop a previous UI server first — it would keep the deleted database open (SQLITE_CANTOPEN)
pkill -x workerd 2>/dev/null; for p in $(pgrep -f "^node .*wrangler.* dev"); do kill $p 2>/dev/null; done; sleep 2
rm -rf $STATE
npx wrangler d1 migrations apply DB --local --persist-to $STATE >/dev/null 2>&1
AUTH_SECRET=ui-secret OWNER_TEMP_PASSWORD=TymczasoweHaslo1 node scripts/create-owner.mjs "Egor" "Właściciel" egor.wlasciciel 2>/dev/null > $STATE/o.sql
npx wrangler d1 execute DB --local --persist-to $STATE --file $STATE/o.sql >/dev/null 2>&1
setsid npx wrangler dev -c dist/senator_academy/wrangler.json --persist-to $STATE --port 8797 --var AUTH_SECRET:ui-secret --var APP_ENV:development ${VAPID_PUBLIC_KEY:+--var VAPID_PUBLIC_KEY:$VAPID_PUBLIC_KEY --var VAPID_PRIVATE_KEY:$VAPID_PRIVATE_KEY} > $S/ui-dev.log 2>&1 &
for i in $(seq 1 40); do curl -sf localhost:8797/api/health >/dev/null && break; sleep 1; done
curl -s localhost:8797/api/health
