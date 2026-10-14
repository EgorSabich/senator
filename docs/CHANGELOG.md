# Changelog

## 0.3.0 — 2026-10-14 — Stage 3: admin panel & content

- Panel for owner/managers: dark rail on desktop, bottom bar on phones; location switcher.
- People: employee list with search and filters (active / locked / inactive), detail, add employee with printable one-time login card, new PIN, unlock, log out everywhere, deactivate, reactivate.
- Managers and per-location permissions (owner), locations (owner), audit log in Polish.
- Content (lessons, Service Book, regulations, SOP, job descriptions, checklists): draft with autosave, publish with change level (kosmetyczna / doprecyzowanie / istotna) and note, version history, line diff between versions, archive/restore, shared content (owner only).
- Editor: headings, bold/italic, lists, steps, "Ważne" / "Uwaga" / "Informacja" blocks, photos (resized in the browser, max 1600 px), links.
- Documents: positions, mandatory read flag, external https link, original PDF/DOCX attachment.
- Server-side rich-text sanitizer (whitelist), FTS search index updated on publish.
- Private media: photos and files only through `/media/*` after login and location check; type checked by MIME and magic bytes.
- Tests: 17 unit, 34 integration, UI walkthrough in headless Chromium (desktop + phone).

## 0.2.0 — 2026-10-14 — Stage 2: users & access

- Login + 6-digit PIN (staff) / password (managers, owner); PBKDF2 with server pepper; PIN rules shared by server and UI.
- Lockout (5 failures, 15 min doubling), IP limit, no account enumeration, login-attempt log.
- Sessions in HttpOnly/Secure/SameSite=Lax cookie, hashed tokens, sliding expiry, revocation on reset/deactivation.
- Forced change of temporary PIN/password at first login.
- Access layer: location + permission on every request; owner / manager (per-location permissions) / employee.
- Admin API: locations, employees (create with proposed login + temporary PIN, reset, unlock, log out everywhere, deactivate, reactivate), managers and permissions, audit log.
- CSRF protection by Origin check.
- Polish UI: login, set your own PIN/password, signed-in shell with logout.
- `scripts/create-owner.mjs` for the first owner; integration test suite (19 tests).

## 0.1.0 — 2026-10-14 — Stage 1: foundation

- Project: Cloudflare Worker (Hono) + React/Vite, TypeScript, production + staging config.
- Database: full MVP schema (people & access, content with versions and acknowledgements, training, menu with allergen confirmation, tests with attempt snapshots), FTS5 search index, seed: location "Senator", 14 EU allergens.
- Polish UI strings file, design tokens (D21), PWA manifest and icon.
- Security headers, noindex everywhere, robots.txt.
- Nightly cron: NDJSON backup to R2 (30 days), anonymization after 2 years (D19), login-attempt cleanup (90 days).
- Restore script from backup; smoke test covering health, headers, backup/restore, anonymization.
