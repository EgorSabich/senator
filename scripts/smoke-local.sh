#!/usr/bin/env bash
# Stage-1 smoke test against local workerd (no Cloudflare account needed):
#  1. migrations apply, 2. /api/health OK + headers, 3. SPA + robots.txt,
#  4. nightly cron writes a backup to local R2, 5. backup → SQL restore round-trip.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=${PORT:-8799}
STATE=.wrangler/state
WORK=$(mktemp -d)
trap 'kill $DEV_PID 2>/dev/null || true; rm -rf "$WORK"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "ok   $*"; }

rm -rf "$STATE"
npx wrangler d1 migrations apply DB --local --persist-to "$STATE" >/dev/null 2>&1 || fail "migrations"
ok "migrations applied"

npx vite build >/dev/null 2>&1 || fail "build"
npx wrangler dev -c dist/senator_academy/wrangler.json --persist-to "$STATE" --port "$PORT" --test-scheduled \
  >"$WORK/dev.log" 2>&1 &
DEV_PID=$!
for _ in $(seq 1 60); do curl -sf "http://localhost:$PORT/api/health" >/dev/null && break; sleep 1; done

H=$(curl -s -D "$WORK/h.txt" "http://localhost:$PORT/api/health")
echo "$H" | grep -q '"ok":true' || { cat "$WORK/dev.log"; fail "health: $H"; }
grep -qi 'x-robots-tag: noindex' "$WORK/h.txt" || fail "X-Robots-Tag on API"
ok "health: $H"

curl -s "http://localhost:$PORT/some/deep/link" | grep -q '<div id="root">' || fail "SPA fallback"
curl -s -D - -o /dev/null "http://localhost:$PORT/" | grep -qi 'x-robots-tag: noindex' || fail "X-Robots-Tag on HTML"
curl -s "http://localhost:$PORT/robots.txt" | grep -q 'Disallow: /' || fail "robots.txt"
[ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/nope")" = 404 ] || fail "API 404"
ok "SPA, robots.txt, noindex headers, API 404"

# Two deactivated test users: 3 years ago (must be anonymized) and 1 year ago (must stay).
NOW_MS=$(( $(date +%s) * 1000 ))
OLD=$(( NOW_MS - 3 * 365 * 86400000 )); RECENT=$(( NOW_MS - 365 * 86400000 ))
npx wrangler d1 execute DB --local --persist-to "$STATE" --command "
  INSERT INTO users (id, first_name, last_name, login, role, status, secret_hash, secret_kind, deactivated_at)
  VALUES ('u_old', 'Jan', 'Stary', 'jan.stary', 'employee', 'inactive', 'x', 'pin', $OLD),
         ('u_new', 'Ewa', 'Nowa', 'ewa.nowa', 'employee', 'inactive', 'x', 'pin', $RECENT);" >/dev/null 2>&1 || fail "insert test users"

curl -s "http://localhost:$PORT/cdn-cgi/handler/scheduled?cron=30+1+*+*+*" >/dev/null
sleep 2
ANON=$(npx wrangler d1 execute DB --local --persist-to "$STATE" --json --command "SELECT id, status, first_name, secret_hash FROM users ORDER BY id" 2>/dev/null)
echo "$ANON" | grep -q '"id":"u_old","status":"anonymized","first_name":"Anonimowy","secret_hash":null' \
  || echo "$ANON" | tr -d ' \n' | grep -q '"id":"u_old","status":"anonymized","first_name":"Anonimowy","secret_hash":null' \
  || fail "old user not anonymized: $ANON"
echo "$ANON" | tr -d ' \n' | grep -q '"id":"u_new","status":"inactive","first_name":"Ewa"' || fail "recent user changed: $ANON"
ok "anonymization: 3-year-old deactivation anonymized, 1-year-old kept"
DAY=$(date -u +%F)
npx wrangler r2 object get "senator-academy-backups/daily/$DAY/manifest.json" --local --persist-to "$STATE" \
  --file "$WORK/manifest.json" >/dev/null 2>&1 || { cat "$WORK/dev.log"; fail "backup manifest not in R2"; }
grep -q '"allergens": 14' "$WORK/manifest.json" || fail "manifest counts: $(cat "$WORK/manifest.json")"
ok "nightly backup written to R2 (daily/$DAY)"

mkdir -p "$WORK/bk"
cp "$WORK/manifest.json" "$WORK/bk/"
for t in $(node -e "console.log(Object.keys(require('$WORK/manifest.json').tables).join(' '))"); do
  npx wrangler r2 object get "senator-academy-backups/daily/$DAY/$t.ndjson" --local --persist-to "$STATE" \
    --file "$WORK/bk/$t.ndjson" >/dev/null 2>&1 || fail "download $t"
done
node scripts/backup-to-sql.mjs "$WORK/bk" "$WORK/restore.sql" >/dev/null || fail "backup-to-sql"

# Damage the data, then restore and compare.
npx wrangler d1 execute DB --local --persist-to "$STATE" --command "DELETE FROM allergens; DELETE FROM locations;" >/dev/null 2>&1
npx wrangler d1 execute DB --local --persist-to "$STATE" --file "$WORK/restore.sql" >/dev/null 2>&1 || fail "restore execute"
N=$(npx wrangler d1 execute DB --local --persist-to "$STATE" --json --command "SELECT (SELECT COUNT(*) FROM allergens) + (SELECT COUNT(*) FROM locations) AS n" 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s)[0].results[0].n))")
[ "$N" = 15 ] || fail "restore count $N"
U=$(npx wrangler d1 execute DB --local --persist-to "$STATE" --json --command "SELECT COUNT(*) AS n FROM users" 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s)[0].results[0].n))")
[ "$U" = 2 ] || fail "restore users $U"
ok "restore from backup: allergens, location and users back"

echo "SMOKE PASSED"
