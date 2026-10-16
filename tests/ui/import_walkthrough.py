"""Stage 5 material import walkthrough in headless Chromium: import a content bundle into drafts, publish the imported
drafts, then read imported material in the employee view (desktop and phone).
Needs a fresh server with owner egor.wlasciciel / TymczasoweHaslo1 (see docs/TESTING.md) and CONTENT_BUNDLE pointing
to a bundle built with scripts/content/build_content_bundle.py (bundles are never committed — the repo is public).
Screenshots go to $SHOTS_DIR. Prints NO_ERRORS when the browser saw no page errors."""
import json, os, re, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("ACADEMY_URL", "http://localhost:8797")
OUT = os.environ.get("SHOTS_DIR", "/tmp/academy-shots")
BUNDLE = os.environ["CONTENT_BUNDLE"]
os.makedirs(OUT, exist_ok=True)
errors = []
IGNORED = ("ERR_TUNNEL_CONNECTION_FAILED", "fonts.googleapis", "fonts.gstatic", "401 (Unauthorized)")
n_items = len(json.load(open(BUNDLE, encoding="utf-8"))["items"])


def shot(page, name):
    page.screenshot(path=f"{OUT}/{name}.png", full_page=True)


def watch(page):
    page.on("console", lambda m: errors.append(f"console: {m.text}") if m.type == "error" and not any(s in m.text for s in IGNORED) else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 860}, locale="pl-PL")
    page = ctx.new_page()
    watch(page)
    page.goto(BASE + "/")
    page.get_by_label("Login").fill("egor.wlasciciel")
    page.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    page.get_by_role("button", name="Zaloguj się").click()
    page.get_by_role("heading", name="Ustaw swoje hasło").wait_for()
    page.get_by_label("Nowe hasło").fill("NoweHasloEgora2026")
    page.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    page.get_by_role("button", name="Zapisz").click()
    page.get_by_role("heading", name="Dziś", exact=True).wait_for()

    # import
    page.get_by_role("link", name="Materiały").first.click()
    page.get_by_role("button", name="Import materiałów").click()
    page.locator('input[type="file"]').set_input_files(BUNDLE)
    page.get_by_text(f"W pliku: {n_items} materiałów.").wait_for()
    shot(page, "imp-01-summary")
    page.get_by_role("button", name="Importuj do szkiców").click()
    page.get_by_text(re.compile(rf"Dodano {n_items} szkiców, pominięto 0")).wait_for(timeout=180_000)
    shot(page, "imp-02-result")
    # second import of the same file skips everything
    page.get_by_role("button", name="Zamknij").click()
    page.get_by_role("button", name="Import materiałów").click()
    page.locator('input[type="file"]').set_input_files(BUNDLE)
    page.get_by_role("button", name="Importuj do szkiców").click()
    page.get_by_text(re.compile(rf"Dodano 0 szkiców, pominięto {n_items}")).wait_for(timeout=180_000)
    page.get_by_role("button", name="Zamknij").click()

    # publish imported drafts, one kind (tab) after another
    page.on("dialog", lambda d: d.accept())
    published = 0
    for tab in ["Lekcje", "Service Book", "Regulaminy", "SOP", "Listy kontrolne"]:
        page.get_by_role("tab", name=re.compile(tab)).click()
        btn = page.get_by_role("button", name="Opublikuj wszystkie szkice z importu")
        btn.wait_for()
        pending = page.get_by_text(re.compile(r"Szkice z importu w tej kategorii: \d+"))
        n = int(re.search(r"kategorii: (\d+)", pending.inner_text()).group(1))
        btn.click()
        page.get_by_text(f"Opublikowano: {n}.").wait_for(timeout=60_000)
        btn.wait_for(state="detached")
        published += n
        shot(page, f"imp-03-published-{tab.replace(' ', '_')}")
    print("published", published, "of", n_items)
    if published != n_items:
        errors.append(f"published {published} != {n_items}")

    # employee view
    page.goto(BASE + "/wiedza")
    page.get_by_role("heading", name="Wiedza").first.wait_for()
    shot(page, "imp-04-knowledge")
    page.get_by_text("Złote zasady").first.click()
    page.get_by_role("heading", name=re.compile("Złote zasady")).first.wait_for()
    shot(page, "imp-05-service-book-chapter")
    page.goto(BASE + "/wiedza/regulaminy")
    page.get_by_text("Sytuacje niestandardowe").first.click()
    page.locator(".rt-table").first.wait_for()
    shot(page, "imp-06-crisis-doc")

    # phone
    ph = b.new_context(viewport={"width": 390, "height": 844}, locale="pl-PL", device_scale_factor=2, storage_state=ctx.storage_state())
    pp = ph.new_page()
    watch(pp)
    pp.goto(BASE + "/wiedza/regulaminy")
    pp.get_by_text("Zasady dla gości").first.click()
    pp.get_by_text("Metoda LAST").first.wait_for()
    shot(pp, "imp-07-phone-first-aid")
    pp.goto(BASE + "/szukaj")
    pp.get_by_role("searchbox").fill("policzek")
    pp.wait_for_timeout(1200)
    shot(pp, "imp-08-phone-search")
    if pp.locator("mark").count() == 0:
        errors.append("search: no highlighted hits for 'policzek'")
    b.close()

if errors:
    print("\n".join(errors))
    sys.exit(1)
print("NO_ERRORS")
