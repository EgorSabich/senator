"""D44/D45: add a head chef in "Kadra" with a role, chef's panel (kitchen only, whole Grafik read-only for other divisions),
owner's "Dziś". Needs a fresh server (scripts/ui-server.sh). Prints NO_ERRORS."""
import os, re, datetime, time
from playwright.sync_api import sync_playwright
BASE=os.environ.get("ACADEMY_URL","http://localhost:8797"); H={"Origin":BASE}; OUT=os.environ.get("SHOTS_DIR","/tmp/academy-shots"); os.makedirs(OUT,exist_ok=True); errors=[]
IGN=("ERR_TUNNEL_CONNECTION_FAILED","status of 401")
def watch(p):
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.on("console", lambda m: errors.append(f"console: {m.text}") if m.type=="error" and not any(x in m.text for x in IGN) else None)
today=datetime.date.today(); monday=today-datetime.timedelta(days=today.weekday())
with sync_playwright() as pw:
    b=pw.chromium.launch()
    o=b.new_context(viewport={"width":1440,"height":900},locale="pl-PL").new_page(); watch(o)
    o.goto(BASE+"/"); o.get_by_label("Login").fill("egor.wlasciciel"); o.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    o.get_by_role("button",name="Zaloguj się").click(); o.get_by_role("heading",name="Ustaw swoje hasło").wait_for()
    o.get_by_label("Nowe hasło").fill("NoweHasloEgora2026"); o.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    o.get_by_role("button",name="Zapisz").click(); o.get_by_role("heading",name="Dziś",exact=True).wait_for()
    r=o.request; loc=r.get(BASE+"/api/admin/locations").json()["locations"][0]["id"]
    emps={}
    for fn,ln,pos in [("Zofia","Nowak","waiter"),("Adam","Wiśniewski","waiter"),("Leon","Kucharz","kitchen"),("Marta","Garnek","kitchen")]:
        emps[fn]=r.post(BASE+f"/api/admin/locations/{loc}/employees",data={"firstName":fn,"lastName":ln,"position":pos},headers=H).json()
    for fn,s,e in [("Zofia","08:00","16:00"),("Adam","16:00","23:00"),("Leon","07:00","15:00"),("Marta","12:00","22:00")]:
        r.post(BASE+f"/api/admin/locations/{loc}/schedule/shifts",data={"userId":emps[fn]["id"],"date":str(today),"start":s,"end":e},headers=H)
    r.post(BASE+f"/api/admin/locations/{loc}/schedule/publish",data={"week":str(monday)},headers=H)
    tt=r.post(BASE+f"/api/admin/locations/{loc}/terminals",data={"name":"Telefon"},headers=H).json()
    # Leon activates PIN and clocks in (2 h ago, offline)
    c=b.new_context(); p=c.new_page(); p.goto(BASE+"/")
    p.request.post(BASE+"/api/auth/login",data={"login":emps["Leon"]["login"],"secret":emps["Leon"]["tempSecret"]},headers=H)
    p.request.post(BASE+"/api/auth/change-secret",data={"current":emps["Leon"]["tempSecret"],"next":"481937"},headers=H)
    p.request.post(BASE+"/api/auth/logout",headers=H)
    p.request.post(BASE+"/api/auth/login",data={"login":tt["login"],"secret":tt["tempSecret"]},headers=H)
    now=int(time.time()*1000)
    p.request.post(BASE+"/api/terminal/punch",data={"pin":"481937","clientId":f"ui{now}x","offline":True,"at":now-2*3600_000},headers=H)
    o.reload(); o.get_by_text("Grafik na dziś").wait_for(); o.wait_for_timeout(500); o.screenshot(path=f"{OUT}/r01-today.png", full_page=True)
    # add head chef with a role
    o.goto(BASE+"/panel/menedzerowie"); o.get_by_role("heading",name="Dostępy").wait_for()
    o.get_by_role("button",name="Dodaj osobę").click(); dlg=o.get_by_role("dialog")
    dlg.get_by_label("Imię").fill("Szymon"); dlg.get_by_label("Nazwisko").fill("Szef"); dlg.get_by_label("Rola").select_option("head_chef")
    o.screenshot(path=f"{OUT}/r02-add-leader.png")
    dlg.get_by_role("button",name="Dodaj osobę").click()
    card=o.get_by_role("dialog"); card.locator(".value").nth(1).wait_for(); vals=card.locator(".value").all_inner_texts(); login,pwd=vals[0],vals[1]
    card.get_by_role("button",name="Zamknij").click(); o.wait_for_timeout(500); o.screenshot(path=f"{OUT}/r03-leaders.png", full_page=True)
    # chef logs in
    ch=b.new_context(viewport={"width":1440,"height":900},locale="pl-PL").new_page(); watch(ch)
    ch.goto(BASE+"/"); ch.get_by_label("Login").fill(login); ch.get_by_label("PIN lub hasło").fill(pwd); ch.get_by_role("button",name="Zaloguj się").click()
    ch.get_by_role("heading",name="Ustaw swoje hasło").wait_for(); ch.get_by_label("Nowe hasło").fill("SzefKuchni2026!"); ch.get_by_label("Powtórz").fill("SzefKuchni2026!")
    ch.get_by_role("button",name="Zapisz").click(); ch.get_by_role("heading",name="Dziś",exact=True).wait_for(); ch.wait_for_timeout(500)
    assert ch.get_by_text("Zofia N.").count()==0, "chef sees floor in Dziś"
    ch.screenshot(path=f"{OUT}/r04-chef-today.png", full_page=True)
    ch.goto(BASE+"/panel/pracownicy"); ch.get_by_text("Leon Kucharz").wait_for(); assert ch.get_by_text("Zofia Nowak").count()==0
    ch.goto(BASE+"/panel/grafik"); ch.get_by_role("heading",name="Grafik").wait_for(); ch.get_by_role("button",name="Tydzień").click() if ch.get_by_role("tab",name="Tydzień").count()==0 else ch.get_by_role("tab",name="Tydzień").click()
    ch.get_by_role("button",name="Ten tydzień").click(); ch.wait_for_timeout(700)
    assert ch.get_by_text("Zofia N.").count()==0, "chef starts with the kitchen only"
    ch.get_by_role("button",name="Wszyscy",exact=True).first.click(); ch.wait_for_timeout(400)
    assert ch.get_by_text("Zofia N.").count()>=1, "chef should see the whole team in Grafik"
    assert ch.get_by_role("button",name=f"Zofia N., {today} — zmiany").is_disabled()
    assert not ch.get_by_role("button",name=f"Leon K., {today} — zmiany").is_disabled()
    ch.screenshot(path=f"{OUT}/r05-chef-grafik.png", full_page=True)
    assert ch.locator('a[href="/panel/menedzerowie"]').count()==0 and ch.locator('a[href="/panel/lokale"]').count()==0
    b.close()
print("\n".join(errors) if errors else "NO_ERRORS")
