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
