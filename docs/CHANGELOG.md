# Changelog



## 0.10.0 — 2026-10-17 (D47, iteration 2)

- Checklist photos: in the editor of an individual list the leader ticks „Zadania ze zdjęciem”; on the phone such a task opens the camera and is ticked only with the photo (shrunk to ≤1024 px JPEG). Panel day view: camera chip by the person's name opens the photo. Photos live in the private PHOTOS bucket, leave after 30 days (nightly), and go with the person / the material on permanent deletion. Migration 0012.
- Wiedza tabs: `knowledge_tabs` (migration 0013) with a built-in „Service Book” for waiters (runners see it through the division). A page of kind service_book belongs to a tab; staff see a tab only if their position matches it. Leaders add, rename and remove (empty) tabs for their own divisions in Materiały → „Zakładki Wiedzy”; the page editor has „Zakładka w Wiedzy”. The reader shows the tab name.
- Grafik export: „Eksportuj” → PNG (one image, share sheet on phones) or PDF A4 landscape (pages, heads repeated). Black, white and greys; no new libraries (own canvas + minimal PDF writer).
- Punch cards (option B): each shift is a card with entry and exit photos side by side; a tap opens the photo in a smooth lightbox (Esc closes the photo first).

## 0.9.1 — 2026-10-17

- Checklists fold by sections — on the phone (finished sections fold, a section folds by itself a moment after its last task; „Zwiń / Rozwiń wszystko”) and in the panel day view (unfinished sections open, finished folded, „brakuje N” in the header).
- Employee and Kadra cards open and close slower and evenly (content stays while folding); closing a card keeps the page where it is, opening scrolls only when the name is off screen. `navigate(path, { keepScroll })`.

## 0.9.0 — 2026-10-17 — Owner's feedback, iteration 1 of 3

- Fixes: content no longer hides under the iPhone status bar (safe areas in the panel); "Brak stawki" for shifts before the first rate (the first rate now also covers earlier shifts); the shift dialog in Czas pracy closes after saving.
- First sign-in: only the new PIN (twice) — the temporary one is not asked again (`change-secret` without `current` while the account must change its secret). Then employees on a phone see "Dodaj aplikację na ekran" (iPhone Safari / other iPhone browsers / Android Chrome with the system install button); a card on Start and a link in Konto stay until installed.
- Greeting by time: Dzień dobry / Dobry wieczór (18:00) / Dobranoc (23:00). "Widok kelnera" → "Widok pracownika". No pinch or double-tap zoom; 16 px inputs on phones (no iOS zoom on focus).
- Positions: Runner (Kelnerzy), Barback (Barmani), Pomocnik mistrza shishy (Shisha) — they see the materials and program of their division and are planned in it; leaders of the division manage them. "Instrukcje stanowiskowe" retired (existing ones archived, migration 0011).
- Kadra kierownicza: leaders are not on the staff list; the role name stays when single permissions change; cards fold like in Pracownicy; "Kopiuj dane logowania" on the login card.
- Grafik: leaders start with their own divisions ("Wszyscy" shows everyone); clear division separators; the name opens the person's card; a leader can mark a day or part of it as unavailable (with a reason, shown as "wpisał(a)…"); staff can report part of a day ("Nie mogę do / od"); visible hatching and centred labels; fade between week and month.
- Feel: skeletons instead of spinners inside pages, dialogs as bottom sheets on phones (pull down to close) with closing animations, press feedback, other tabs pre-loaded while idle.
- Tests: 117 integration (new 16-iteration-1017), UI walkthrough `tests/ui/onboarding_walkthrough.py`.

## 0.8.1 — 2026-10-16 — Old PINs on the terminal

- Fix: PINs set before the time clock (0.6.0) had no terminal link until the person signed in again, and staff stay signed in — so the terminal answered "Nieznany PIN". Now, when the quick lookup finds nobody, the PIN is checked against the location's people still without a link and linked on first use. Two people with the same old PIN: nobody is clocked in and both must choose a new PIN.
- Tests: 113 integration (new 15-legacy-pin).

## 0.8.0 — 2026-10-16 — Leadership roles, "Dziś"

- D44 roles in "Kadra kierownicza" (was Menedżerowie): Zarządzający (everything, incl. adding leaders, Lokale, the log; new permissions `managers.manage`, `locations.manage`, `audit.view`), Menedżer sali (kelnerzy, host, call center), Szef kuchni, Szef baru, Szef mistrzów shishy. A role is a preset of permissions + divisions (stored as `role:…` and `division:…`), single permissions can still be changed; nobody but the owner or another zarządzający changes one's own permissions.
- Divisions now limit: staff list and card, adding staff (only own positions), PIN/deactivation, rates, time tracking (calendar, manual shifts, punches, photos), materials (new ones get the divisions; shared "for everyone" ones are read-only; others hidden), programs, checklist results, menu editing (kitchen / bar). Grafik: everyone sees the whole team, plans and publishes only their divisions.
- D45 "Dziś" (first item of the panel): who is on shift vs plan, late arrivals, absent, missing exits, today's checklists; per divisions; refreshes every minute. On the phone: Dziś · Pracownicy · Czas pracy · Grafik · Więcej (Menu under Więcej).
- New locations stay owner-only.
- Tests: 111 integration (new 14-roles), UI walkthrough `tests/ui/roles_walkthrough.py`.

## 0.7.2 — 2026-10-16 — Grafik and form fixes

- Grafik: "Tydzień / Miesiąc" switch (month = whole calendar month, compact times, publish for the month); column "Godziny" on the right with planned hours and number of shifts per person; Friday and Saturday highlighted; Enter saves a shift; notes on shifts removed; status of a shift as a badge.
- Panel forms: one style for every input, select and checkbox (custom checkbox with a tick); the "Zdjęcie przy odbiciu" checkbox in Lokale no longer stretches.
- Terminal: the "Na zmianie" list is gone (did not fit and showed names on a shared phone); the status API no longer returns who is on shift.

## 0.7.0 — 2026-10-16 — Grafik

- D43 panel **Grafik** (permission `schedule.manage`, main item on the phone): week × people grouped by division, any start and end (also after midnight), shifts coloured by start hour with a legend that highlights one start time, per-day counts by start hour and total, days off shown in the grid, plan vs real entry (came / late / absent).
- Templates are saved automatically per division from planned shifts and appear as one-tap buttons sorted by use; they can be named or deleted. "Kopiuj poprzedni tydzień" fills empty days with drafts.
- Drafts vs published: staff see only what was published; a changed or deleted shift is marked until the next "Opublikuj" (the answer lists who got changes — for notifications later). Overlapping shifts of one person are refused.
- Managers can be limited to divisions (e.g. a chef: Kuchnia only) in Menedżerowie; stored with the permissions (`division:kitchen`).
- Staff: new bottom bar Start · Nauka · Grafik · Menu · Wiedza (search moved to a header icon); Grafik tab with "Moje zmiany" (week, who works with me), "Niedostępność" (days off for the next six weeks, note, deadline) and "Moje godziny"; "Mój grafik" card on Start.
- Lokale: deadline for days off (weekday and hour of the week before, default Sunday 23:59). Czas pracy cells show the published plan and lateness.
- Migration 0010 (schedule_shifts, shift_templates, unavailability, location deadline). Deleting a person removes their shifts and days off.
- Tests: 106 integration (new 13-schedule), UI walkthrough `tests/ui/schedule_walkthrough.py`.

## 0.6.6 — 2026-10-16 — Individual and shared checklists, checklist import

- D42: checklist mode in the material settings — "Indywidualna" (default for new lists: everyone on shift does every item, own progress, nothing to close) or "Wspólna" (D36: one item, one person, close the day). Lists that existed before stay "Wspólna" (migration 0009). Panel → Listy shows each person's progress for individual lists (people who worked that day and fit the list's positions, also those who did nothing) and how many people did each item; statistics count individual lists against the people on shift.
- Import: "Import materiałów" also takes `{"format":"senator-checklists", ...}` with a sample in the dialog; lists arrive as drafts with positions, mode and without the read-and-confirm step; mistakes are listed in Polish before anything is saved.
- Material editor: positions can be set for every kind (lessons and Service Book too), not only documents.
- Tests: 101 integration (new 12-checklist-modes), unit tests for the checklist converter, UI walkthrough `tests/ui/checklist_modes_walkthrough.py`.

## 0.6.5 — 2026-10-16 — Moje godziny, materials per position

- D41 "Moje godziny" for employees: card on Start, page `/godziny` (month switch, total, previous month, shifts with from–to and hours, "trwa", "brak wyjścia", "poprawione przez menedżera") and the person's own PIN punches; link in Konto. Hours only — no rates or money.
- Materiały: "Widzi:" filter by position (incl. "Bez stanowiska"), "Wszyscy" shown on materials without a position, "Zaznacz kilka" → "Ustaw stanowiska" for many materials at once (new `POST /api/admin/content/positions`, audited). Staff already see only materials, lessons, checklists and programs of their positions; the import format already takes `positions`.
- Tests: 98 integration (new 11-my-time), UI walkthrough `tests/ui/mytime_walkthrough.py`.

## 0.6.4 — 2026-10-16 — Terminal: name check with a slider, optional punch photo

- D40: after the PIN the terminal shows "Imię N." and what will happen (start / end of shift with hours so far); the person slides to confirm or taps "To nie ja"; it closes itself after 10 s. Without internet the slider shows a generic text and the punch goes to the queue as before. Wrong PINs at this step count towards the terminal pause.
- Lokale → "Zdjęcie przy odbiciu" (off by default): the front camera opens only on the confirmation screen, a 240 px JPEG is sent with the punch (offline too), stored privately in R2 and shown as a thumbnail in the day's punches in Czas pracy (only with `time.manage`); deleted after 60 days by the nightly job and together with the person. Staff see in Konto that photos are taken. Migration 0008. A missing camera never blocks a punch.
- Security headers: camera allowed for the app's own origin only.
- Clock and date on the terminal sit lower; shift editor fields no longer overflow the dialog.
- Tests: 96 integration (new 10-terminal-confirm); time walkthrough covers the slider, "To nie ja", photo (fake camera) and offline confirm.

## 0.6.3 — 2026-10-16 — Navigation, lessons in Wiedza, compact panel menu

- D39: "Wstecz" returns to the same place (scroll per history entry, Menu keeps category and search); soft page transitions (View Transitions, off with reduced motion); pages show the last loaded data at once and refresh in the background.
- Wiedza → Lekcje: all lessons of the person's position, locked ones marked. Programs: material picker with search and type chips, drafts can be added (staff see them after publishing); modules with nothing readable are hidden from staff.
- Start: "Do zrobienia" folds like modules. Panel on the phone: Pracownicy · Czas pracy · Menu · Więcej (other sections as tiles); the rail on the computer is split the same way.
- Position "Call center"; "Hostessa" renamed "Host"; names in Czas pracy shown as "Imię N." (CSV keeps full names).
- Tests: 93 integration (new 09-lessons), UI walkthrough `tests/ui/nav_walkthrough.py`.

## 0.6.2 — 2026-10-16 — Location settings, Service Book mandatory, program deletion

- D38: Lokale page with details, opening hours, note for the team, summary and time rules (migration 0007); staff see the details in Konto.
- Service Book chapters are mandatory to read ("Do zapoznania się"); program deletion; Pracownicy filter and grouping by position.
- Tests: 92 integration (new 08-settings).

## 0.6.1 — 2026-10-15 — Divisions, rates, employee card

- D37: only employees are timed (managers/owner not; their terminal PIN removed). Czas pracy split by division with a multi-select filter; cells show "10:00–18:30" and the shift cost; division and person totals; CSV with division and cost.
- Hourly rates with valid-from dates (migration 0006 `pay_rates`), permission `wages.manage`.
- Manual shift: times typed as four digits, the cursor moves on to "Wyjście" and then "Uwaga".
- Pracownicy: the card opens under the name with an animation; lessons read, mandatory documents, hours this/last month, rate history and new rate.

## 0.6.0 — 2026-10-15 — Time clock and daily checklists

- D35 time clock: terminal accounts (panel → Czas pracy → Terminale), terminal mode on the phone (PIN pad, clock, who is on shift, connection state, Wake Lock, offline queue with idempotent re-send, self-restart after errors, exit only with the terminal password); unique PINs (`users.pin_lookup` = HMAC with AUTH_SECRET, linked at the next sign-in or PIN change); terminal PIN for managers/owner in Konto.
- Panel Czas pracy: week/month calendar per person, live "now on shift", missing exits, edit/add/delete shifts with audit, PIN log of the day, CSV export.
- D36 daily checklists: tasks from list items, marks only while on shift, one item = one person, close the day; Start shows "Dziś" (shift status + lists); panel Listy (day view, stats, reopen).
- Migration 0005 (terminals, time_entries, time_punches, checklist_marks, checklist_days, users.pin_lookup); permissions `time.manage`, `checklists.view`; deleting a person/material also removes its time and checklist records.
- Tests: 88 integration (new 07-time), unit tests for business day and checklist items, UI walkthrough `tests/ui/time_walkthrough.py`.

## 0.5.1 — 2026-10-15 — Full kitchen card, permanent deletion

- D33: menu builder reads the Menu_Kuchnia workbook (`--kitchen-cards`): 93 dishes with composition, description, taste, photos; re-import fills empty fields of existing items without overwriting.
- Menu panel: "Przywróć wszystkie archiwalne" restores every archived item of a section.
- D34: "Usuń na zawsze" for deactivated employees, archived menu items and archived materials — impact shown first, name typed to confirm, one transaction, audited without personal data.
- Content editor: no error when the page is left before the text loads.
- Tests: 78 integration (new: 06-delete), UI walkthrough of the three deletions.
- Staff app: modules as an accordion — all modules on Start and in Nauka at once, the current one open; thinner translucent top bar, lower bottom bar (iPhone home indicator), iOS status bar blends in.
- Loading: Senator mark (drawn ring around the "S", letters lighting up) in the app, panel and before the app starts; calm entrance and touch animations; all motion off with "reduce motion".

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
