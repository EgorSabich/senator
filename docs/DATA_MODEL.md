# Data model

Schema: `src/worker/db/schema.ts`. Migrations: `migrations/0000_init.sql` (tables), `0001_search_and_seed.sql` (FTS5 index, location "Senator", 14 EU allergens). IDs are text (UUID); timestamps unix ms.

Shared across locations: `users`, `allergens`, content with `location_id IS NULL`. Everything else carries `location_id`.

| Group | Tables | Notes |
| --- | --- | --- |
| People & access | `locations`, `users`, `user_locations`, `manager_permissions`, `sessions`, `login_attempts`, `audit_log` | Login stored normalized; PIN/password only as PBKDF2 hash; status active / inactive / anonymized |
| Content | `content_items`, `content_item_positions`, `content_versions`, `content_acknowledgements` | One content model for lessons, Service Book, regulations, SOP, job descriptions, checklists. Each edit = new version with change level cosmetic / clarification / significant. Acknowledgement per user per version (+ scrolled_to_end) |
| Training | `programs`, `modules`, `module_items`, `assignments` | Program per position; modules with unlock rule open / after_module / after_all_mandatory |
| Menu | `menu_categories`, `menu_items`, `menu_item_versions`, `allergens`, `menu_item_allergens`, `menu_item_diets` | Item has guest-menu name + GoPOS name; allergens/diets carry status + who confirmed; import keeps original wording in `source_note` |
| Tests | `tests`, `test_review_content`, `questions`, `answer_options`, `test_attempts`, `attempt_answers`, `extra_attempt_grants` | Attempt = separate row; each answer stores a snapshot of question + options + correct id |
| Search | `search_index` (FTS5) | entity_type, entity_id, location_id, folded title/body |

Migration `0002_content_drafts_media.sql`: `content_items` gets a working copy (`draft_title`, `draft_body_json`, `draft_updated_at/by`) and `attachment_name`; new table `media` (every uploaded photo/file: key, location, type, size, original name, uploader).

Rich text is TipTap JSON, sanitized on save by `src/shared/richtext.ts` (allowed: paragraph, heading 2/3, bullet/ordered list, callout important/warning/info, table/tableRow/tableHeader/tableCell (colspan/rowspan 1–20), image from `/media/` only, hard break, rule; marks bold, italic, underline, link http(s)/mailto/tel).

Future (not created): `trusted_devices`, `time_events`, `time_corrections`.

Known detail: `content_items (location_id, slug)` is unique, but SQLite allows repeated NULL `location_id`, so slug uniqueness of shared content is enforced in the app.

Migration `0003_menu_import.sql` (stage 4, after checking the real sheets):
- `menu_items` + `warn_guest` ("Uprzedź gościa"), `diet_note` (remarks under "Dla kogo"), `import_key` (unique per location; `kitchen:<folded name>` / `bar:<folded name>`, so a re-import never duplicates).
- `menu_item_diets` + `source_note` (original "tak*", "?").
- New `menu_sections` (location, section kitchen/bar, note shown above the list — e.g. the remark under the kitchen allergen sheet).

Migration `0004_content_import.sql` (stage 5): `content_items.import_key` + unique index `(location_id, import_key)` — material import never duplicates.

Progress (stage 5): `content_acknowledgements` (one row per user per version) = done; a later significant version → "review" (Do powtórki), a clarification → "updated"; program = default program of `user_locations.position`.

Allergens (D26): kitchen "X"/"tak" → `contains` shown to waiters directly; "?" and "tak*" → `unconfirmed`, hidden; the bar has no allergens. `confirmed_by/at` now mean "last changed by/at".

Menu field mapping:

| Source | Field |
| --- | --- |
| Kitchen "Karty dań": title "N. Name" | `name_guest` (no GoPOS name in the sheet) |
| Jak sprzedać / Warto wiedzieć / Sprzedaż dodatkowa / Pytania gości / Kluczowy składnik / Uprzedź gościa | `how_to_sell` / `good_to_know` / `upsell` / `guest_questions` / `key_ingredient` / `warn_guest` |
| Dla kogo (first line) | diets — taken from the "Alergeny" sheet; lines after the first → `diet_note` |
| Alkohol ("-" = none) | `alcohol_note` |
| "Alergeny" sheet: X / ? / empty | `contains` / `unconfirmed` / `not_contains` (D26: `contains` visible to waiters right away) |
| Wege / Wegańskie / Bez glutenu / Bez nabiału: tak / nie / tak* / ? | `yes` / `no` / `unconfirmed` / `unconfirmed` |
| Bar: Rozdział, Nazwa "CHOICE OR", Nazwa "GO POS", Skład, Opis, Sposób podania, picture in "Foto" | category, `name_guest`, `name_pos`, `ingredients_json`, `description`, `serving`, `photo_key` |

Version snapshot (`menu_item_versions.snapshot_json`): category, all texts, ingredients, allergen and diet statuses.
