"""Live (2026-10-17): Start asks to switch notifications on; a published shift appears in Grafik without a reload.
Needs a fresh server with throwaway VAPID keys. Prints NO_ERRORS."""
import os, re, datetime, time
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
    e=r.post(BASE+f"/api/admin/locations/{loc}/employees",data={"firstName":"Zofia","lastName":"Nowak","position":"waiter"},headers=H).json()
    c=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True,permissions=["notifications"]); p=c.new_page(); watch(p)
    c.add_init_script("Object.defineProperty(Notification, 'permission', { get: () => 'default' })")
    p.goto(BASE+"/"); p.get_by_label("Login").fill(e["login"]); p.get_by_label("PIN lub hasło").fill(e["tempSecret"]); p.get_by_role("button",name="Zaloguj się").click()
    p.get_by_label("Nowy PIN (6 cyfr)").fill("481937"); p.get_by_label("Powtórz").fill("481937"); p.get_by_role("button",name="Zapisz").click(); p.wait_for_timeout(1200)
    p.goto(BASE+"/"); p.get_by_text("Włącz powiadomienia").first.wait_for(); p.wait_for_timeout(500)
    p.locator(".push-gate").screenshot(path=f"{OUT}/l01-gate.png"); p.screenshot(path=f"{OUT}/l02-start.png", full_page=True)
    # live: a shift published by the manager shows up in the open Grafik without touching the phone
    p.goto(BASE+"/grafik"); p.wait_for_timeout(1500)
    today=datetime.date.today()
    s=r.post(BASE+f"/api/admin/locations/{loc}/schedule/shifts",data={"userId":e["id"],"date":str(today+datetime.timedelta(days=1)),"start":"16:00","end":"23:00"},headers=H).json()
    r.post(BASE+f"/api/admin/locations/{loc}/schedule/publish",data={"week":str(today-datetime.timedelta(days=today.weekday())) if today.weekday()<6 else str(today+datetime.timedelta(days=1)),"notify":False},headers=H)
    r.post(BASE+f"/api/admin/locations/{loc}/schedule/publish",data={"week":str((today+datetime.timedelta(days=1))-datetime.timedelta(days=(today+datetime.timedelta(days=1)).weekday())),"notify":False},headers=H)
    p.get_by_text("16:00").first.wait_for(timeout=45000)
    p.screenshot(path=f"{OUT}/l03-grafik-live.png")
    b.close()
print("\n".join(errors) if errors else "NO_ERRORS")
