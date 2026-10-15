# Deployment

## First launch (production only, dashboard + GitHub, no tokens or secrets in chat)

1. Cloudflare account → Workers & Pages → **Workers Paid** ($5/month; PBKDF2 hashing needs the paid CPU limit).
2. Storage & Databases → D1 → Create `senator-academy-prod` (location: Western Europe). Copy the **Database ID** (not a secret) into `wrangler.jsonc` → push.
3. R2 → enable → create buckets `senator-academy-photos` and `senator-academy-backups`.
4. Workers & Pages → Create → **Import a repository** → GitHub `EgorSabich/senator`. Project name `senator-academy`, build command `npm run build`, deploy command `npm run deploy:cf` (applies D1 migrations, then deploys). Branch `main`.
5. The build token created by Workers Builds has no D1 permission: Manage account → Account API Tokens → the Workers Builds token for `senator-academy` → Edit → add **Account · D1 · Edit** → Save. Retry the build.
6. Open `tools/start.html` locally in a browser (works offline, nothing is sent anywhere): "Wylosuj" → copy AUTH_SECRET → Worker → Settings → Variables and Secrets → Add → Secret `AUTH_SECRET`. Keep it in a password manager.
7. Same page, step 2 → owner SQL → D1 → `senator-academy-prod` → Console → Execute. Note the login and temporary password; change it at first login.
8. Open `https://senator-academy.<subdomain>.workers.dev`, log in, set the password, import menu and materials (Panel → Menu / Materiały → Import).
9. Later: own `.pl` domain → Worker → Settings → Domains & Routes → Custom domain; staging environment (below).

## One-time setup (owner's accounts)

1. Cloudflare account → Workers & Pages → enable **Workers Paid** ($5/month).
2. Create D1 databases `senator-academy-prod` and `senator-academy-staging`, region hint **Western Europe**; put their ids into `wrangler.jsonc` (`database_id`).
3. Create R2 buckets: `senator-academy-photos`, `senator-academy-backups`, `senator-academy-photos-staging`, `senator-academy-backups-staging`.
4. GitHub: private repository `senator-academy`, push this code.
5. Cloudflare → Workers → connect the GitHub repository (Workers Builds). Build command `npm run build`, deploy command `npx wrangler deploy` (staging: `CLOUDFLARE_ENV=staging` on a staging branch).
6. Apply migrations: `npm run db:migrate:staging`, then `npm run db:migrate:prod` (needs `wrangler login` or a CI token kept in Cloudflare/GitHub secrets — never in the repo).
7. Secret: `npx wrangler secret put AUTH_SECRET` (and `--env staging`) — a long random value, different per environment, never in the repo. Changing it later invalidates every PIN and password.
8. First owner account: `AUTH_SECRET=<same value> node scripts/create-owner.mjs "Imię" "Nazwisko" > owner.sql`, then `npx wrangler d1 execute DB --remote --file owner.sql`; delete owner.sql. The script prints a temporary password once; it must be changed at first login.
9. Domain (.pl, bought by the owner) → add to Cloudflare → Custom domain on the production worker.

## Release flow

staging branch → staging worker → check → merge to main → production. Migrations are applied to staging first.

## Restore from backup ("Odtwarzanie z kopii")

Option A — D1 Time Travel (point in time, within D1's retention):
`npx wrangler d1 time-travel restore senator-academy-prod --timestamp <ISO time>`

Option B — nightly NDJSON export (independent copy, 30 days):
1. Download `daily/<YYYY-MM-DD>/` from bucket `senator-academy-backups` into a folder.
2. `node scripts/backup-to-sql.mjs <folder> restore.sql`
3. On a database with migrations applied: `npx wrangler d1 execute DB --remote --file restore.sql`
4. Check counts against `manifest.json`.

Option B is exercised by `scripts/smoke-local.sh` on every run.
