# Changelog

## 0.5.0 — 2026-10-15 — Stage 5: employee app, documents, import of materials

- Employee app (phone first): Start (program progress, next step, documents to confirm, "Do powtórki", "Zaktualizowano"), Nauka (program → modules → lessons with unlock rules), Menu (cards, kitchen allergens per D26, reminder), Wiedza (Service Book, Regulaminy i SOP), Szukaj (FTS5 with Polish folding, highlighted snippets), Konto (PIN change, logout).
- Reader: lessons "Przeczytane — dalej"; documents confirmed only after scrolling to the end ("Potwierdzam"), one confirmation per version; significant changes send items back to review.
- Panel: Programy (programs per position, modules, unlock rules, lesson order), "Widok kelnera".
- Rich text: tables (editor toolbar + reader), callouts, numbered steps.
- Import of materials: content bundle → drafts (chunked, re-import skips existing `import_key`), "Opublikuj wszystkie szkice z importu"; migration 0004 (`content_items.import_key`).
- D26: no allergen confirmation; waiters see kitchen "contains" allergens directly; no bar allergens; `allergens.confirm` removed.
- PWA: service worker, offline reading of previously opened content, personal cache cleared on logout.
- Tests: 73 integration, unit tests for progress/snippets/tables, UI walkthroughs: academy (phone, offline) and import of 66 real materials.

## 0.4.0 — 2026-10-14 — Stage 4: menu catalog & import

- Menu in the panel: Kuchnia / Bar tabs, categories as in the source sheets, search, category filter, archived items on demand; phone layout list → item.
- Item card: guest-menu and GoPOS names, photo, description, ingredients, key ingredient, taste, serving, how to sell, good to know, upsell, guest questions, "Uprzedź gościa", alcohol, diet remarks; every save asks for the change level and creates a version (preview of each version).
- Allergens (14 EU) and diets with confirmation: shows the original value from the sheet and who confirmed when; only `allergens.confirm` confirms; status change = significant version.
- Staff API: waiters get only active items, confirmed "Zawiera" allergens and confirmed diets.
- Import: `scripts/menu/build_menu_bundle.py` (kitchen sheet 12.10.2026 + Kelnerzy Bar.xlsx, bar photos from the sheet) → upload in the panel, chunked, re-import skips existing items, data issues listed before import.
- Migration 0003: `warn_guest`, `diet_note`, `import_key`, diet `source_note`, `menu_sections`.
- Tests: 55 integration (21 new), menu UI walkthrough with the real data.

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
