# Deployment

## One-time setup (owner's accounts)

1. Cloudflare account → Workers & Pages → enable **Workers Paid** ($5/month).
2. Create D1 databases `senator-academy-prod` and `senator-academy-staging`, region hint **Western Europe**; put their ids into `wrangler.jsonc` (`database_id`).
3. Create R2 buckets: `senator-academy-photos`, `senator-academy-backups`, `senator-academy-photos-staging`, `senator-academy-backups-staging`.
4. GitHub: private repository `senator-academy`, push this code.
5. Cloudflare → Workers → connect the GitHub repository (Workers Builds). Build command `npm run build`, deploy command `npx wrangler deploy` (staging: `CLOUDFLARE_ENV=staging` on a staging branch).
6. Apply migrations: `npm run db:migrate:staging`, then `npm run db:migrate:prod` (needs `wrangler login` or a CI token kept in Cloudflare/GitHub secrets — never in the repo).
7. Domain (.pl, bought by the owner) → add to Cloudflare → Custom domain on the production worker.

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
