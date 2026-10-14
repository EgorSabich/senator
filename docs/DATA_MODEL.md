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

Future (not created): `trusted_devices`, `time_events`, `time_corrections`.

Known detail: `content_items (location_id, slug)` is unique, but SQLite allows repeated NULL `location_id`, so slug uniqueness of shared content is enforced in the app.

Menu fields will be checked against the real sheet columns during stage 4 import; changes go in a new migration.
