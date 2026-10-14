"""Stage 4 UI walkthrough in headless Chromium: import the real menu bundle, browse kitchen/bar,
edit an item with a change level, change an allergen, phone layout.
Needs a fresh server (scripts/ui-server.sh) and MENU_BUNDLE = path to the bundle built by
scripts/menu/build_menu_bundle.py. Screenshots go to $SHOTS_DIR. Prints NO_ERRORS when the browser saw no page errors."""
import os
import sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("ACADEMY_URL", "http://localhost:8797")
OUT = os.environ.get("SHOTS_DIR", "/tmp/academy-shots")
BUNDLE = os.environ["MENU_BUNDLE"]
os.makedirs(OUT, exist_ok=True)
errors = []


def shot(page, name):
    page.screenshot(path=f"{OUT}/{name}.png", full_page=True)


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 860}, locale="pl-PL")
    page = ctx.new_page()
    # Known, harmless in the sandbox: Google Fonts blocked by the proxy; /api/auth/me answers 401 before login.
    IGNORED = ("ERR_TUNNEL_CONNECTION_FAILED", "status of 401")
    page.on("console", lambda m: errors.append(f"console {m.type}: {m.text}") if m.type == "error" and not any(x in m.text for x in IGNORED) else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

    page.goto(BASE + "/")
    page.get_by_label("Login").fill("egor.wlasciciel")
    page.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    page.get_by_role("button", name="Zaloguj się").click()
    page.get_by_role("heading", name="Ustaw swoje hasło").wait_for()
    page.get_by_label("Obecne hasło").fill("TymczasoweHaslo1")
    page.get_by_label("Nowe hasło").fill("NoweHasloEgora2026")
    page.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    page.get_by_role("button", name="Zapisz").click()
    page.get_by_role("heading", name="Pracownicy").wait_for()

    page.get_by_role("link", name="Menu").first.click()
    page.get_by_role("heading", name="Menu").wait_for()
    shot(page, "m01-empty")

    page.get_by_role("button", name="Import z pliku").click()
    page.locator('input[type="file"]').set_input_files(BUNDLE)
    page.get_by_text("W pliku: kuchnia").wait_for()
    shot(page, "m02-import-preview")
    page.get_by_role("dialog").get_by_role("button", name="Importuj").click()
    page.get_by_text("Dodano ").wait_for(timeout=120000)
    print(page.get_by_role("status").last.inner_text())
    shot(page, "m03-import-done")
    page.get_by_role("dialog").get_by_role("button", name="Zamknij").click()

    page.get_by_role("button", name="Tom yum z owocami morza").click()
    page.get_by_label("Jak sprzedać").wait_for()
    page.wait_for_timeout(300)
    shot(page, "m04-kitchen-item")

    # edit with change level
    page.get_by_label("Warto wiedzieć").fill(page.get_by_label("Warto wiedzieć").input_value() + " ")
    page.get_by_label("Uprzedź gościa").fill("Test edycji — usunąć.")
    page.get_by_role("button", name="Zapisz zmiany").click()
    page.get_by_role("dialog").get_by_text("Doprecyzowanie").click()
    page.get_by_role("dialog").get_by_role("button", name="Zapisz zmiany").click()
    page.get_by_text("Zapisano.").wait_for()

    # change one allergen (kitchen only; no confirmation step — D26)
    page.get_by_label("Łubin").select_option("unconfirmed")
    page.get_by_role("button", name="Zapisz alergeny i diety").click()
    page.get_by_text("Alergeny i diety zapisane.").wait_for()
    page.wait_for_timeout(300)
    shot(page, "m05-confirmed")

    # bar with photos
    page.get_by_role("tab", name="Bar").click()
    page.get_by_role("button", name="HORTUS").first.click()
    page.get_by_label("Nazwa w GoPOS").wait_for()
    page.wait_for_timeout(600)
    shot(page, "m06-bar-item")

    # phone
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(BASE + "/panel/menu")
    page.get_by_role("heading", name="Menu").wait_for()
    page.wait_for_timeout(600)
    shot(page, "m07-phone-list")
    page.get_by_role("button", name="Classic Lemonade").click()
    page.get_by_label("Nazwa w GoPOS").wait_for()
    page.wait_for_timeout(400)
    page.screenshot(path=f"{OUT}/m08-phone-item.png")
    page.get_by_role("button", name="Lista").click()
    page.get_by_role("button", name="Classic Lemonade").wait_for()
    overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
    print("HORIZONTAL_OVERFLOW" if overflow else "NO_OVERFLOW")

    b.close()

if errors:
    print("\n".join(errors))
    sys.exit(1)
print("NO_ERRORS")
