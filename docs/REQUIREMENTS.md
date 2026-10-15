# Requirements — owner decisions (2026-10-14)

Source of truth for scope: the approved spec (Claude Docs, Russian). This file lists the binding decisions.

| # | Decision |
| --- | --- |
| D1 | Current kitchen menu = Google Sheet "Menu Kuchnia szkolenie i sprzedaz" (12.10.2026). Old Menu Kuchnia.xlsx is not imported. |
| D2 | First approach to a table: 2 min; VIP: 1 min. |
| D3 | Guest languages: Polish and English only. |
| D4 | Serious issues → shift manager; minor remarks handled by the waiter. |
| D5 | Serving side: whichever is convenient; no strict rule. |
| D6 | The team uses radios. |
| D7 | Terms: "menedżer zmiany" (not "kierownik zmiany"), "rewir" (not "pozycja"). |
| D8 | No tests about allergens. |
| D9 | Regulations get a Polish language edit before import. |
| D10 | Only confirmed allergens are shown; per item×allergen status contains / not_contains / unconfirmed; constant reminder "O skład i alergeny zawsze pytaj kuchnię". |
| D11 | Bar menu (Kelnerzy Bar.xlsx, 49 items) is current; both names stored (guest menu, GoPOS). |
| D12 | No wine list in MVP. |
| D13 | Staff use personal phones, also outside the restaurant. |
| D14 | One location now; architecture multi-location. |
| D15 | Future time tracking only on the work phone. |
| D16 | Not hosted as Claude artifacts; standalone web app. |
| D17 | Hosting: Cloudflare Workers Paid + D1 + R2. |
| D18 | Login + 6-digit PIN for staff; managers/owner use a 10+ char password. |
| D19 | After deactivation: access off immediately; data kept 2 years, then anonymized automatically. |
| D20 | Own .pl domain; owner buys it. |
| D21 | Dark theme, copper-orange accent #E07B32, Cormorant Garamond + Manrope. |
| D22 | "Regulaminy i SOP" inside the app; mandatory documents confirmed after scrolling to the end; confirmation per version replaces paper sign-off lists. MVP: waiter + general documents. |
| D23 | Menu import through a bundle file built from the source sheets (kitchen Google Sheet 12.10.2026 + Kelnerzy Bar.xlsx); texts copied without rewriting; re-import skips existing items. The bundle is not stored in the (public) repository. |
| D24 | ~~Imported allergens and diets are never confirmed; a person with `allergens.confirm` confirms them.~~ Superseded by D26. |
| D25 | Kitchen sheets "Ściąga", "Słowniczek", "Zwroty" are training material, not menu items — they become lessons in stage 5. |
| D26 | No allergen confirmation step. Waiters see kitchen allergens with status "contains" ("X"/"tak" in the sheet) and diets "yes" directly; "?" and "tak*" stay hidden; the card says when the allergen list is incomplete. Allergens are edited by `menu.edit` (kitchen only); every change is audited and stored as a significant version. The bar has no allergens. Permission `allergens.confirm` removed. Replaces D10's "only confirmed" and D24. |
| D27 | Stage 5 materials (waiter regulations, general documents, Service Book, Podręcznik kelnera, Kuchnia i napoje, FAQ, kitchen sheets) are imported as drafts through a content bundle (`scripts/content/build_content_bundle.py`); the owner reviews and publishes. Bundles and edited texts are not stored in the public repository. Chapter 9 of "Kuchnia i napoje" is not imported — it describes the old menu (D1). |
| D33 | The full kitchen card is 93 dishes (owner, 15.10.2026; revises D1). Menu_Kuchnia (a sheet per category) adds composition, description, taste and photos; dishes of the 12.10 sheet keep their card and allergen matrix. Free-text allergens: a listed EU allergen → "contains" (the kitchen's line kept), the rest unconfirmed; non-EU lines go to "Uprzedź gościa". Re-importing a bundle adds new items and fills only empty fields (texts, composition, photo) of existing ones — never overwrites, never touches allergens. |
| D34 | Permanent deletion of employees, menu items and materials (owner and managers with the matching edit permission). Only a deactivated person / archived item; the login or name must be typed. A person goes with all their history (acknowledgements, attempts, sessions); where they were only the actor the link is cleared and the audit log keeps the action without the name. A material is removed from programs together with acknowledgements. Owner and own account can't be deleted. Data stays in nightly backups until they expire (30 days). Complements D19. |
| D35 | Time clock: a work phone signs in with a terminal account (role `terminal`, owner creates it in Czas pracy) and becomes a PIN pad; leaving the mode needs the terminal password. Staff use their own app PIN only (owner's choice) — PINs are therefore unique: a PIN someone tried to take is burned for its holder too (both set new ones). Managers/owner set a separate terminal PIN in Konto. First PIN = clock-in, next = clock-out; double tap within 60 s ignored; an open shift older than 16 h is "missing exit" for the manager and the next PIN starts a new shift. Offline: punches queue on the phone with their time and are sent later (idempotent client id, max 72 h back). Business day 06:00–06:00 Warsaw. Panel: people × days calendar, corrections and manual shifts (audited), PIN log per day, CSV export. Permission `time.manage`. |
| D36 | Daily checklists: every list item of a published checklist is a task per business day. A waiter marks the items he did on his phone, only while clocked in; one item = one person (others see who); own marks can be undone. Anyone on shift can close the day with items left (shown as not done); a manager can reopen. Panel "Listy": per day who did what and when, per person counts, per checklist completion by day. Permission `checklists.view`. |
| D37 | Time is tracked only for employees (role `employee`); managers and the owner are not timed and the terminal ignores them (no terminal PIN). The calendar is split by division (kelnerzy, hostessy, barmani, kuchnia, mistrzowie shishy, menedżerowie zmiany) with a filter for one, several or all; cells show from–to times. Hourly rates per person and location with a valid-from date (`pay_rates`); shift cost = hours × rate valid on its business day. Rates and costs only with permission `wages.manage` (owner always). Employee card (Pracownicy) opens under the name and shows lessons read, mandatory documents confirmed (with the missing ones), hours this and last month (+ cost and rate with `wages.manage`). |
| D38 | "Do zapoznania się" replaces "Do potwierdzenia". The Service Book is mandatory to read and confirm (existing chapters switched by migration 0007, new ones default to it); it counts in "Do zapoznania się" and in the employee card. Training programs can be deleted (typed name; modules go, materials and reading progress stay; default passes to the oldest other program of the position). Lokale: details for staff (address, phone, e-mail, opening hours, note — shown in Konto), summary counts, business-day start hour (0–12) and missing-exit hours (8–24) per location, used by time tracking and daily checklists for new records. Pracownicy: filter by position (one or several) and grouping by position. |
