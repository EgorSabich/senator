"""Stage 5 UI walkthrough (phone 390 px): a waiter's first day — set PIN, home, lesson read to the end,
mandatory document with checkbox + "Potwierdzam", locked module opening, Service Book, menu, search without
Polish letters, offline reading. Then the owner's program editor on desktop.
Needs a fresh server (scripts/ui-server.sh). Optional MENU_BUNDLE imports the real menu first.
Screenshots go to $SHOTS_DIR. Prints NO_ERRORS when the browser saw no page errors."""
import json
import os
import sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("ACADEMY_URL", "http://localhost:8797")
OUT = os.environ.get("SHOTS_DIR", "/tmp/academy-shots")
BUNDLE = os.environ.get("MENU_BUNDLE")
LOC = "loc_senator"
os.makedirs(OUT, exist_ok=True)
errors = []
IGNORED = ("ERR_TUNNEL_CONNECTION_FAILED", "status of 401", "ERR_INTERNET_DISCONNECTED", "Failed to fetch")


def watch(page):
    page.on("console", lambda m: errors.append(f"console {m.type}: {m.text}") if m.type == "error" and not any(x in m.text for x in IGNORED) else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))


def shot(page, name, full=False):
    page.screenshot(path=f"{OUT}/{name}.png", full_page=full)


def para(*texts):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": x}]} for x in texts]}


LONG = [
    "Gość ocenia nas od pierwszej chwili. Dlatego podchodzimy do stołu w ciągu 2 minut od posadzenia, a do gościa VIP w ciągu 1 minuty.",
] + [f"Akapit {i}: spokojny ton, kontakt wzrokowy, uśmiech. Przedstawiamy się imieniem i proponujemy wodę oraz aperitif." for i in range(1, 14)]


with sync_playwright() as p:
    b = p.chromium.launch()

    # ── Owner prepares content through the API ──
    admin = b.new_context(viewport={"width": 1280, "height": 860}, locale="pl-PL", extra_http_headers={"Origin": BASE})
    r = admin.request
    assert r.post(f"{BASE}/api/auth/login", data={"login": "egor.wlasciciel", "secret": "TymczasoweHaslo1"}).ok
    assert r.post(f"{BASE}/api/auth/change-secret", data={"current": "TymczasoweHaslo1", "next": "NoweHasloEgora2026"}).ok

    def publish(kind, title, body, **settings):
        cid = r.post(f"{BASE}/api/admin/locations/{LOC}/content", data={"kind": kind, "title": title, "section": settings.pop("section", None)}).json()["id"]
        r.put(f"{BASE}/api/admin/content/{cid}", data={"body": body, **settings})
        assert r.post(f"{BASE}/api/admin/content/{cid}/publish", data={}).ok
        return cid

    body1 = {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Pierwsze 2 minuty"}]},
        *para(*LONG[:5])["content"],
        {"type": "callout", "attrs": {"variant": "important"}, "content": para("Gość VIP: podejście w ciągu 1 minuty.")["content"]},
        {"type": "orderedList", "attrs": {"start": 1}, "content": [
            {"type": "listItem", "content": para("Przywitaj się i przedstaw imieniem.")["content"]},
            {"type": "listItem", "content": para("Zaproponuj wodę i aperitif.")["content"]},
            {"type": "listItem", "content": para("Zapytaj o alergie przed rekomendacją.")["content"]},
        ]},
        *para(*LONG[5:])["content"],
        {"type": "callout", "attrs": {"variant": "warning"}, "content": para("Nigdy nie mówimy „chyba” o alergenach — sprawdzamy w kuchni.")["content"]},
    ]}
    l1 = publish("lesson", "Powitanie gościa", body1)
    l2 = publish("lesson", "Żurek i zupy — jak polecać", para("Żurek polecamy z jajkiem i białą kiełbasą.", "Zawsze pytamy o alergie."))
    reg = publish("regulation", "Regulamin pracy i zachowania", para(*LONG), positions=["waiter"], requiresAck=True)
    publish("service_book", "Nakrycie stołu", para("Sztućce układamy od zewnątrz do środka.", "Kieliszek na wodę stoi nad nożem."), section="Sala")
    publish("service_book", "Serwis wina", para("Butelkę prezentujemy gościowi etykietą do niego."), section="Bar")
    prog = r.post(f"{BASE}/api/admin/locations/{LOC}/programs", data={"name": "Wdrożenie kelnera", "position": "waiter"}).json()["id"]
    m1 = r.post(f"{BASE}/api/admin/programs/{prog}/modules", data={"title": "Pierwszy dzień"}).json()["id"]
    m2 = r.post(f"{BASE}/api/admin/programs/{prog}/modules", data={"title": "Menu i rekomendacje"}).json()["id"]
    r.put(f"{BASE}/api/admin/modules/{m1}/items", data={"items": [{"contentItemId": l1}, {"contentItemId": reg}]})
    r.put(f"{BASE}/api/admin/modules/{m2}/items", data={"items": [{"contentItemId": l2}]})
    r.put(f"{BASE}/api/admin/modules/{m2}", data={"title": "Menu i rekomendacje", "unlockRule": "after_module", "unlockAfterModuleId": m1})
    emp = r.post(f"{BASE}/api/admin/locations/{LOC}/employees", data={"firstName": "Anna", "lastName": "Kowalska", "position": "waiter"}).json()
    if BUNDLE:
        bundle = json.load(open(BUNDLE))
        for i in range(0, len(bundle["items"]), 8):
            assert r.post(f"{BASE}/api/admin/locations/{LOC}/menu/import", data={"format": bundle["format"], "sections": bundle["sections"], "categories": bundle["categories"], "items": bundle["items"][i:i + 8]}).ok

    # ── Waiter on a phone ──
    ctx = b.new_context(viewport={"width": 390, "height": 844}, locale="pl-PL", is_mobile=True, has_touch=True)
    page = ctx.new_page()
    watch(page)
    page.goto(BASE + "/")
    page.get_by_label("Login").fill(emp["login"])
    page.get_by_label("PIN lub hasło").fill(emp["tempSecret"])
    page.get_by_role("button", name="Zaloguj się").click()
    page.get_by_label("Nowy PIN (6 cyfr)").fill("583920")
    page.get_by_label("Powtórz").fill("583920")
    page.get_by_role("button", name="Zapisz").click()
    page.get_by_role("heading", name="Dzień dobry, Anna").wait_for()
    page.wait_for_timeout(400)
    shot(page, "a01-start")

    # lesson: button disabled until the end
    page.get_by_role("link", name="Zacznij: Powitanie gościa").click()
    page.get_by_role("heading", name="Powitanie gościa").wait_for()
    btn = page.get_by_role("button", name="Przeczytane — dalej")
    assert btn.is_disabled(), "lesson button must wait for the end"
    shot(page, "a02-lesson-top")
    page.mouse.wheel(0, 6000)
    page.wait_for_timeout(500)
    shot(page, "a03-lesson-end")
    assert btn.is_enabled()
    btn.click()

    # mandatory document
    page.get_by_role("heading", name="Regulamin pracy i zachowania").wait_for()
    assert page.get_by_role("button", name="Potwierdzam").is_disabled()
    page.mouse.wheel(0, 8000)
    page.wait_for_timeout(500)
    page.get_by_label("Zapoznałem(-am) się z dokumentem").check()
    shot(page, "a04-doc-checkbox")
    page.get_by_role("button", name="Potwierdzam").click()
    page.get_by_text("Potwierdzono").wait_for()
    shot(page, "a05-doc-confirmed")

    # program: module 2 open now
    page.goto(BASE + "/nauka")
    page.get_by_role("link", name="Żurek i zupy — jak polecać").wait_for()
    page.wait_for_timeout(300)
    shot(page, "a06-program", full=True)

    # knowledge
    page.get_by_role("link", name="Wiedza").click()
    page.get_by_role("link", name="Nakrycie stołu").wait_for()
    shot(page, "a07-service-book")
    page.get_by_role("link", name="Nakrycie stołu").click()
    page.get_by_role("heading", name="Nakrycie stołu").wait_for()
    page.go_back()
    page.get_by_role("link", name="Regulaminy i SOP").first.click()
    page.get_by_text("Potwierdzony").wait_for()
    shot(page, "a08-library")

    # menu
    page.get_by_role("link", name="Menu", exact=True).last.click()
    page.get_by_role("heading", name="Menu").wait_for()
    page.wait_for_timeout(500)
    shot(page, "a09-menu")
    if BUNDLE:
        page.get_by_role("link", name="Tatar z łososia").first.click()
        page.get_by_text("Alergeny", exact=True).wait_for()
        page.wait_for_timeout(300)
        shot(page, "a10-dish", full=True)
        page.go_back()
        page.get_by_role("tab", name="Bar").click()
        page.get_by_role("link", name="HORTUS").first.click()
        page.wait_for_timeout(600)
        shot(page, "a11-drink", full=True)
        assert page.get_by_text("Alergeny", exact=True).count() == 0, "bar must not show allergens"

    # search without Polish letters
    page.goto(BASE + "/szukaj")
    page.get_by_placeholder("Np. żurek, rachunek, VIP").fill("zurek")
    page.get_by_role("link", name="Żurek i zupy — jak polecać").wait_for()
    page.wait_for_timeout(300)
    shot(page, "a12-search")
    marks = page.locator("mark").all_inner_texts()
    assert any("Żurek" in m for m in marks), marks

    # offline: open a page read before
    page.goto(BASE + f"/m/{l1}")
    page.get_by_role("heading", name="Powitanie gościa").wait_for()
    page.wait_for_timeout(800)
    ctx.set_offline(True)
    page.goto(BASE + "/")
    page.get_by_text("Tryb offline").first.wait_for()
    page.goto(BASE + f"/m/{l1}")
    page.get_by_role("heading", name="Powitanie gościa").wait_for()
    shot(page, "a13-offline")
    ctx.set_offline(False)
    over = page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
    print("HORIZONTAL_OVERFLOW" if over else "NO_OVERFLOW")

    # ── Owner: program editor ──
    op = admin.new_page()
    watch(op)
    op.goto(BASE + f"/panel/programy/{prog}")
    op.get_by_role("heading", name="Programy szkolenia").wait_for()
    op.get_by_label("Nazwa modułu").first.wait_for()
    op.wait_for_timeout(400)
    shot(op, "a14-programs", full=True)
    b.close()

if errors:
    print("\n".join(errors))
    sys.exit(1)
print("NO_ERRORS")
