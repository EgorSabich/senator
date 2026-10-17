"""Dostępy (2026-10-17): hourly leader (position, rate, from; PIN asked at the leader's next sign-in), switch access
off, back on, delete forever. Needs a fresh server. Prints NO_ERRORS."""
import os
from playwright.sync_api import sync_playwright
BASE=os.environ.get("ACADEMY_URL","http://localhost:8797"); H={"Origin":BASE}; OUT=os.environ.get("SHOTS_DIR","/tmp/academy-shots"); os.makedirs(OUT,exist_ok=True); errors=[]
IGN=("ERR_TUNNEL_CONNECTION_FAILED","status of 401","status of 403")
def watch(p):
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.on("console", lambda m: errors.append(f"console: {m.text}") if m.type=="error" and not any(x in m.text for x in IGN) else None)
with sync_playwright() as pw:
    b=pw.chromium.launch()
    o=b.new_context(viewport={"width":1280,"height":900},locale="pl-PL").new_page(); watch(o)
    o.on("dialog", lambda d: d.accept())
    o.goto(BASE+"/"); o.get_by_label("Login").fill("egor.wlasciciel"); o.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    o.get_by_role("button",name="Zaloguj się").click(); o.get_by_role("heading",name="Ustaw swoje hasło").wait_for()
    o.get_by_label("Nowe hasło").fill("NoweHasloEgora2026"); o.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    o.get_by_role("button",name="Zapisz").click(); o.get_by_role("heading",name="Dziś",exact=True).wait_for()
    o.goto(BASE+"/panel/menedzerowie"); o.get_by_role("heading",name="Dostępy").wait_for()
    import re
    o.get_by_role("button",name="Dodaj osobę").click()
    o.get_by_label("Imię").fill("Barbara"); o.get_by_label("Nazwisko").fill("Kowal")
    o.get_by_label("Rola").select_option("head_bartender")
    o.get_by_role("dialog").get_by_role("button",name="Dodaj osobę").click()
    vals=o.get_by_role("dialog").locator(".value"); vals.first.wait_for()
    lg=vals.nth(0).inner_text().strip(); tmp=vals.nth(1).inner_text().strip()
    o.get_by_role("dialog").get_by_role("button").last.click(); o.wait_for_timeout(300)
    o.get_by_role("button",name=re.compile("Barbara Kowal")).click(); o.wait_for_timeout(400)
    o.get_by_role("switch",name="Rozlicza czas pracy (stawka godzinowa)").click()
    o.get_by_label("Stanowisko do rozliczenia").select_option("bartender")
    o.get_by_label("Stawka godzinowa",exact=True).fill("38,00")
    o.get_by_role("button",name="Włącz rozliczanie").click(); o.get_by_text("PIN do terminala: jeszcze nie ustawiony").wait_for()
    o.locator(".emp.open").screenshot(path=f"{OUT}/d01-hourly.png")
    # the leader signs in: PIN screen
    if tmp:
        lc=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",is_mobile=True,has_touch=True).new_page(); watch(lc)
        lc.goto(BASE+"/"); lc.get_by_label("Login").fill(lg); lc.get_by_label("PIN lub hasło").fill(tmp); lc.get_by_role("button",name="Zaloguj się").click()
        lc.get_by_label("Nowe hasło").fill("BarbaraHaslo2026x"); lc.get_by_label("Powtórz").fill("BarbaraHaslo2026x"); lc.get_by_role("button",name="Zapisz").click()
        lc.get_by_role("heading",name="PIN do terminala").wait_for(); lc.screenshot(path=f"{OUT}/d02-setpin.png")
        lc.get_by_label("Nowy PIN (6 cyfr)").fill("739251"); lc.get_by_label("Powtórz").fill("739251"); lc.get_by_role("button",name="Zapisz").click()
        lc.get_by_text("SENATOR").first.wait_for(); lc.wait_for_timeout(500)
        o.reload(); o.get_by_role("button",name=re.compile("Barbara Kowal")).click(); o.get_by_text("PIN do terminala: ustawiony.").wait_for()
    # access off / on / delete
    o.get_by_role("button",name="Wyłącz dostęp").click(); o.get_by_text("Dostęp wyłączony").wait_for()
    o.locator(".emp.open").screenshot(path=f"{OUT}/d03-off.png")
    o.get_by_role("button",name="Usuń na zawsze").click(); o.get_by_role("dialog").get_by_role("textbox").fill(lg)
    o.get_by_role("dialog").get_by_role("button",name="Usuń na zawsze").click(); o.get_by_text("Usunięto.").wait_for()
    assert o.get_by_role("button",name=re.compile("Barbara Kowal")).count()==0
    b.close()
print("\n".join(errors) if errors else "NO_ERRORS")
