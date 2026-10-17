"""Praca zdalna (2026-10-17): toggle in the employee card (call center only), start/stop on the phone. Prints NO_ERRORS."""
import os, re
from playwright.sync_api import sync_playwright
BASE=os.environ.get("ACADEMY_URL","http://localhost:8797"); H={"Origin":BASE}; OUT=os.environ.get("SHOTS_DIR","/tmp/academy-shots"); os.makedirs(OUT,exist_ok=True); errors=[]
IGN=("ERR_TUNNEL_CONNECTION_FAILED","status of 401","status of 403")
def watch(p):
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.on("console", lambda m: errors.append(f"console: {m.text}") if m.type=="error" and not any(x in m.text for x in IGN) else None)
with sync_playwright() as pw:
    b=pw.chromium.launch()
    o=b.new_context(viewport={"width":1280,"height":900},locale="pl-PL").new_page(); watch(o)
    o.goto(BASE+"/"); o.get_by_label("Login").fill("egor.wlasciciel"); o.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    o.get_by_role("button",name="Zaloguj się").click(); o.get_by_role("heading",name="Ustaw swoje hasło").wait_for()
    o.get_by_label("Nowe hasło").fill("NoweHasloEgora2026"); o.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    o.get_by_role("button",name="Zapisz").click(); o.get_by_role("heading",name="Dziś",exact=True).wait_for()
    r=o.request; loc=r.get(BASE+"/api/admin/locations").json()["locations"][0]["id"]
    e=r.post(BASE+f"/api/admin/locations/{loc}/employees",data={"firstName":"Ida","lastName":"Zdalna","position":"call_center"},headers=H).json()
    o.goto(BASE+f"/panel/pracownicy/{e['id']}"); o.get_by_role("switch",name="Praca zdalna").wait_for()
    o.get_by_role("switch",name="Praca zdalna").click(); o.wait_for_timeout(600)
    assert o.get_by_role("switch",name="Praca zdalna").get_attribute("aria-checked")=="true"
    o.locator(".mgr-box").last.screenshot(path=f"{OUT}/z01-toggle.png")
    c=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True); p=c.new_page(); watch(p)
    p.on("dialog", lambda d: d.accept())
    c.add_init_script("Object.defineProperty(Notification, 'permission', { get: () => 'granted' })")
    p.goto(BASE+"/"); p.get_by_label("Login").fill(e["login"]); p.get_by_label("PIN lub hasło").fill(e["tempSecret"]); p.get_by_role("button",name="Zaloguj się").click()
    p.get_by_label("Nowy PIN (6 cyfr)").fill("593174"); p.get_by_label("Powtórz").fill("593174"); p.get_by_role("button",name="Zapisz").click()
    p.get_by_role("button",name="Rozpocznij pracę").click(); p.get_by_text(re.compile("Pracujesz od")).wait_for()
    p.locator(".remote-card").screenshot(path=f"{OUT}/z02-working.png")
    p.get_by_role("button",name="Zakończ pracę").click(); p.get_by_text(re.compile("Zakończono")).wait_for()
    p.screenshot(path=f"{OUT}/z03-start.png")
    b.close()
print("\n".join(errors) if errors else "NO_ERRORS")
