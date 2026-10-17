"""Powiadomienia (2026-10-17): settings per division, list picker, own notification editor; desktop and phone.
Needs a fresh server. Prints NO_ERRORS."""
import os
from playwright.sync_api import sync_playwright
BASE=os.environ.get("ACADEMY_URL","http://localhost:8797"); H={"Origin":BASE}; OUT=os.environ.get("SHOTS_DIR","/tmp/academy-shots"); os.makedirs(OUT,exist_ok=True); errors=[]
IGN=("ERR_TUNNEL_CONNECTION_FAILED","status of 401","status of 403")
def watch(p):
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.on("console", lambda m: errors.append(f"console: {m.text}") if m.type=="error" and not any(x in m.text for x in IGN) else None)
li=lambda t:{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":t}]}]}
with sync_playwright() as pw:
    b=pw.chromium.launch()
    o=b.new_context(viewport={"width":1280,"height":900},locale="pl-PL").new_page(); watch(o)
    o.goto(BASE+"/"); o.get_by_label("Login").fill("egor.wlasciciel"); o.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    o.get_by_role("button",name="Zaloguj się").click(); o.get_by_role("heading",name="Ustaw swoje hasło").wait_for()
    o.get_by_label("Nowe hasło").fill("NoweHasloEgora2026"); o.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    o.get_by_role("button",name="Zapisz").click(); o.get_by_role("heading",name="Dziś",exact=True).wait_for()
    r=o.request; loc=r.get(BASE+"/api/admin/locations").json()["locations"][0]["id"]
    for title in ("Sala — otwarcie zmiany","Sala — zamknięcie zmiany","Sprzątanie stanowiska"):
        cid=r.post(BASE+f"/api/admin/locations/{loc}/content",data={"kind":"checklist","title":title},headers=H).json()["id"]
        r.put(BASE+f"/api/admin/content/{cid}",data={"body":{"type":"doc","content":[{"type":"bulletList","content":[li("Punkt 1"),li("Punkt 2")]}]},"positions":["waiter"]},headers=H)
        r.post(BASE+f"/api/admin/content/{cid}/publish",data={},headers=H)
    o.goto(BASE+"/panel/powiadomienia"); o.get_by_role("heading",name="Powiadomienia",exact=True).wait_for(); o.wait_for_timeout(600)
    o.screenshot(path=f"{OUT}/n01-desktop.png",full_page=True)
    row=o.locator('[data-kind="checklist_close"]')
    assert row.get_by_role("button",name="Sala — zamknięcie zmiany").get_attribute("aria-pressed")=="true"
    assert row.get_by_role("button",name="Sprzątanie stanowiska").get_attribute("aria-pressed")=="false"
    row.get_by_role("button",name="Sprzątanie stanowiska").click(); o.wait_for_timeout(500)
    assert row.get_by_role("button",name="Sprzątanie stanowiska").get_attribute("aria-pressed")=="true"
    o.locator('[data-kind="tomorrow_shift"] select').select_option("1110"); o.wait_for_timeout(400)
    o.get_by_role("switch",name="Wyjście ze zmiany").click(); o.wait_for_timeout(400)
    o.reload(); o.get_by_role("heading",name="Powiadomienia",exact=True).wait_for(); o.wait_for_timeout(500)
    assert o.locator('[data-kind="tomorrow_shift"] select').input_value()=="1110"
    assert o.get_by_role("switch",name="Wyjście ze zmiany").get_attribute("aria-checked")=="false"
    assert o.locator('[data-kind="checklist_close"]').get_by_role("button",name="Sprzątanie stanowiska").get_attribute("aria-pressed")=="true"
    # own notification
    o.get_by_role("button",name="+ Własne powiadomienie").click()
    o.get_by_label("Tytuł").fill("Odprawa przed otwarciem"); o.get_by_label("Treść").fill("O 16:45 krótka odprawa przy barze. Omawiamy rezerwacje i grupy.")
    dlg=o.get_by_role("dialog")
    dlg.get_by_role("button",name="Barmani",exact=True).click()
    dlg.get_by_role("button",name="powtarzaj").click(); dlg.get_by_role("button",name="pt",exact=True).click(); dlg.get_by_role("button",name="sob",exact=True).click()
    dlg.get_by_role("button",name="przed początkiem zmiany").click()
    dlg.locator("select").first.select_option("15")
    dlg.screenshot(path=f"{OUT}/n02-editor.png")
    dlg.get_by_role("button",name="Wyślij próbne do mnie").click(); dlg.get_by_text("nie ma włączonych powiadomień").wait_for()
    dlg.get_by_role("button",name="Zapisz").click(); o.get_by_text("pt, sob · 15 min przed zmianą").wait_for()
    # once
    o.get_by_role("button",name="+ Własne powiadomienie").click(); dlg=o.get_by_role("dialog")
    o.get_by_label("Tytuł").fill("Szkolenie z nowego menu"); o.get_by_label("Treść").fill("Jutro o 12:00 szkolenie — obecność obowiązkowa.")
    dlg.get_by_role("button",name="cały dział").click()
    dlg.get_by_role("button",name="Dzień i godzina").click()
    days=o.locator(".df-pop .df-day:not([disabled]):not(.out)")
    days.nth(days.count()-1).click(); o.get_by_role("button",name="10:00").click(); o.get_by_role("button",name="Gotowe").click()
    dlg.get_by_role("button",name="Zapisz").click(); o.get_by_text("jednorazowo ·").wait_for(); o.wait_for_timeout(300)
    o.screenshot(path=f"{OUT}/n03-desktop-own.png",full_page=True)
    # phone
    pctx=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True)
    pctx.add_cookies(o.context.cookies()); p=pctx.new_page(); watch(p)
    p.goto(BASE+"/panel/powiadomienia"); p.get_by_role("heading",name="Powiadomienia",exact=True).wait_for(); p.wait_for_timeout(600)
    p.screenshot(path=f"{OUT}/n04-phone.png",full_page=True)
    p.get_by_text("Odprawa przed otwarciem").click(); p.get_by_role("dialog").wait_for(); p.wait_for_timeout(400)
    p.screenshot(path=f"{OUT}/n05-phone-editor.png")
    b.close()
print("\n".join(errors) if errors else "NO_ERRORS")
