"""2026-10-17: first sign-in without retyping the temporary PIN → "add to home screen" guide (iPhone), install card,
days off for part of a day, panel on the phone (top bar, bottom sheet), Kadra cards, copy login data. Prints NO_ERRORS."""
import os, re
from playwright.sync_api import sync_playwright
BASE=os.environ.get("ACADEMY_URL","http://localhost:8797"); H={"Origin":BASE}; OUT=os.environ.get("SHOTS_DIR","/tmp/academy-shots"); os.makedirs(OUT,exist_ok=True); errors=[]
IGN=("ERR_TUNNEL_CONNECTION_FAILED","status of 401")
IPHONE="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
def watch(p):
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.on("console", lambda m: errors.append(f"console: {m.text}") if m.type=="error" and not any(x in m.text for x in IGN) else None)
with sync_playwright() as pw:
    b=pw.chromium.launch()
    oc=b.new_context(viewport={"width":1280,"height":900},locale="pl-PL",permissions=["clipboard-read","clipboard-write"]); o=oc.new_page(); watch(o)
    o.goto(BASE+"/"); o.get_by_label("Login").fill("egor.wlasciciel"); o.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    o.get_by_role("button",name="Zaloguj się").click(); o.get_by_role("heading",name="Ustaw swoje hasło").wait_for()
    o.get_by_label("Nowe hasło").fill("NoweHasloEgora2026"); o.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    o.get_by_role("button",name="Zapisz").click(); o.get_by_role("heading",name="Dziś",exact=True).wait_for()
    # add an employee in the panel → copy login data
    o.goto(BASE+"/panel/pracownicy"); o.get_by_role("button",name="Dodaj pracownika").click(); dlg=o.get_by_role("dialog")
    dlg.get_by_label("Imię").fill("Rita"); dlg.get_by_label("Nazwisko").fill("Runner"); dlg.get_by_label("Stanowisko").select_option("waiter_assistant")
    dlg.get_by_role("button",name="Dodaj pracownika").last.click()
    card=o.get_by_role("dialog"); card.locator(".value").nth(1).wait_for(); vals=card.locator(".value").all_inner_texts(); login,pin=vals[0],vals[1]
    card.get_by_role("button",name="Kopiuj dane logowania").click(); card.get_by_text("Skopiowano").wait_for()
    clip=o.evaluate("navigator.clipboard.readText()"); assert login in clip and pin in clip, clip
    o.screenshot(path=f"{OUT}/o01-card-copy.png"); card.get_by_role("button",name="Zamknij").click()
    # first sign-in on an iPhone
    c=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True,user_agent=IPHONE); p=c.new_page(); watch(p)
    p.goto(BASE+"/"); p.get_by_label("Login").fill(login); p.get_by_label("PIN lub hasło").fill(pin); p.get_by_role("button",name="Zaloguj się").click()
    p.get_by_label("Nowy PIN (6 cyfr)").wait_for(); assert p.get_by_label("Obecny PIN").count()==0
    p.screenshot(path=f"{OUT}/o02-new-pin.png")
    p.get_by_label("Nowy PIN (6 cyfr)").fill("481937"); p.get_by_label("Powtórz").fill("481937"); p.get_by_role("button",name="Zapisz").click()
    p.get_by_role("heading",name="Dodaj aplikację na ekran").wait_for(); p.wait_for_timeout(600); p.screenshot(path=f"{OUT}/o03-install-ios.png", full_page=True)
    p.get_by_role("link",name="Później").click(); p.get_by_role("heading",name=re.compile("Dzień dobry|Dobry wieczór|Dobranoc")).wait_for()
    p.get_by_text("Dodaj Senator na ekran telefonu").wait_for(); p.wait_for_timeout(500); p.screenshot(path=f"{OUT}/o04-start.png")
    # days off: part of a day
    p.goto(BASE+"/grafik/niedostepnosc"); sec=p.locator("section.a-card").first; sec.locator(".g-daybtn").nth(4).click()
    sec.get_by_role("tab",name="Nie mogę do").click(); sec.locator('input[type="time"]').fill("17:00")
    sec.locator(".g-daybtn").nth(5).click(); p.wait_for_timeout(300); p.screenshot(path=f"{OUT}/o05-days-off.png", full_page=True)
    sec.get_by_role("button",name=re.compile("Zapisz")).click(); p.get_by_text("Zapisano. Menedżer zobaczy").wait_for()
    # panel on the phone: top bar and a bottom sheet
    mc=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True,storage_state=oc.storage_state()); m=mc.new_page(); watch(m)
    m.goto(BASE+"/panel/pracownicy"); m.get_by_role("heading",name="Pracownicy").wait_for(); m.wait_for_timeout(500); m.screenshot(path=f"{OUT}/o06-panel-phone.png")
    m.get_by_role("button",name="Dodaj pracownika").click(); m.get_by_role("dialog").wait_for(); m.wait_for_timeout(500); m.screenshot(path=f"{OUT}/o07-sheet.png")
    m.keyboard.press("Escape"); m.get_by_role("dialog").wait_for(state="detached")
    # Kadra: collapsible cards
    o.goto(BASE+"/panel/menedzerowie"); o.get_by_role("button",name="Dodaj osobę").click(); dlg=o.get_by_role("dialog")
    dlg.get_by_label("Imię").fill("Bartosz"); dlg.get_by_label("Nazwisko").fill("Barowy"); dlg.get_by_label("Rola").select_option("head_bartender"); dlg.get_by_role("button",name="Dodaj osobę").click()
    o.get_by_role("dialog").locator(".value").nth(1).wait_for(); o.get_by_role("dialog").get_by_role("button",name="Zamknij").click(); o.wait_for_timeout(400)
    o.get_by_text("Szef baru").first.wait_for(); o.screenshot(path=f"{OUT}/o08-kadra-closed.png")
    o.get_by_role("button",name=re.compile("Bartosz Barowy")).click(); o.wait_for_timeout(500)
    o.get_by_text("Tworzy i edytuje testy").click(); o.wait_for_timeout(200)
    assert o.get_by_label("Rola").first.input_value()=="head_bartender", "role must stay after a single change"
    o.screenshot(path=f"{OUT}/o09-kadra-open.png")
    o.goto(BASE+"/panel/pracownicy"); o.get_by_text("Rita Runner").wait_for(); assert o.get_by_text("Bartosz Barowy").count()==0
    b.close()
print("\n".join(errors) if errors else "NO_ERRORS")
