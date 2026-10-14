# Changelog

## 0.1.0 — 2026-10-14 — Stage 1: foundation

- Project: Cloudflare Worker (Hono) + React/Vite, TypeScript, production + staging config.
- Database: full MVP schema (people & access, content with versions and acknowledgements, training, menu with allergen confirmation, tests with attempt snapshots), FTS5 search index, seed: location "Senator", 14 EU allergens.
- Polish UI strings file, design tokens (D21), PWA manifest and icon.
- Security headers, noindex everywhere, robots.txt.
- Nightly cron: NDJSON backup to R2 (30 days), anonymization after 2 years (D19), login-attempt cleanup (90 days).
- Restore script from backup; smoke test covering health, headers, backup/restore, anonymization.
