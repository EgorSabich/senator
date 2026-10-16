"""Step 5 (D43): panel Grafik (add by typing, template button, publish, legend), staff Grafik tab (my shifts, days off),
Start card, panel on the phone. Needs a fresh server (scripts/ui-server.sh). Prints NO_ERRORS."""
import os, re, datetime
from playwright.sync_api import sync_playwright
BASE=os.environ.get("ACADEMY_URL","http://localhost:8797"); H={"Origin":BASE}; OUT=os.environ.get("SHOTS_DIR","/tmp/academy-shots"); os.makedirs(OUT,exist_ok=True); errors=[]
IGN=("ERR_TUNNEL_CONNECTION_FAILED","status of 401")
def watch(p):
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.on("console", lambda m: errors.append(f"console: {m.text}") if m.type=="error" and not any(x in m.text for x in IGN) else None)
today=datetime.date.today(); monday=today-datetime.timedelta(days=today.weekday()); nxt=monday+datetime.timedelta(days=7)
with sync_playwright() as pw:
    b=pw.chromium.launch()
    o=b.new_context(viewport={"width":1440,"height":900},locale="pl-PL").new_page(); watch(o)
    o.goto(BASE+"/"); o.get_by_label("Login").fill("egor.wlasciciel"); o.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    o.get_by_role("button",name="Zaloguj się").click(); o.get_by_role("heading",name="Ustaw swoje hasło").wait_for()
    o.get_by_label("Nowe hasło").fill("NoweHasloEgora2026"); o.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    o.get_by_role("button",name="Zapisz").click(); o.get_by_role("heading",name="Dziś",exact=True).wait_for()
    r=o.request; loc=r.get(BASE+"/api/admin/locations").json()["locations"][0]["id"]
    emps={}
    for fn,ln,pos in [("Zofia","Nowak","waiter"),("Adam","Wiśniewski","waiter"),("Ola","Kowalska","waiter"),("Leon","Kucharz","kitchen")]:
        emps[fn]=r.post(BASE+f"/api/admin/locations/{loc}/employees",data={"firstName":fn,"lastName":ln,"position":pos},headers=H).json()
    # some shifts via API so templates exist
    for fn,d,s,e in [("Adam",1,"16:00","00:00"),("Ola",2,"16:00","00:00"),("Leon",1,"08:00","16:00"),("Leon",2,"08:00","16:00")]:
        r.post(BASE+f"/api/admin/locations/{loc}/schedule/shifts",data={"userId":emps[fn]["id"],"date":str(nxt+datetime.timedelta(days=d)),"start":s,"end":e},headers=H)
    # staff: Zofia days off for the week after next
    c=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True); p=c.new_page(); watch(p)
    z=emps["Zofia"]
    p.goto(BASE+"/"); p.get_by_label("Login").fill(z["login"]); p.get_by_label("PIN lub hasło").fill(z["tempSecret"]); p.get_by_role("button",name="Zaloguj się").click()
    p.get_by_label("Nowy PIN (6 cyfr)").fill("481937"); p.get_by_label("Powtórz").fill("481937"); p.get_by_role("button",name="Zapisz").click()
    p.get_by_role("heading",name=re.compile("Dzień dobry|Dobry wieczór|Dobranoc")).wait_for()
    p.locator('nav.a-tabbar a[href="/grafik"]').click(); p.get_by_role("heading",name="Grafik").wait_for()
    p.get_by_role("link",name="Niedostępność").click(); p.locator(".g-daybtn").first.wait_for(); p.wait_for_timeout(300)
    sec=p.locator("section.a-card").first
    sec.locator(".g-daybtn").nth(2).click(); sec.locator(".g-daybtn").nth(5).click()
    sec.get_by_label("Uwaga do niedostępności").fill("Egzamin"); sec.get_by_role("button",name=re.compile("Zapisz")).click()
    p.get_by_text("Zapisano. Menedżer zobaczy").wait_for(); p.screenshot(path=f"{OUT}/g01-staff-off.png", full_page=True)
    # panel grafik
    o.goto(BASE+"/panel/grafik"); o.get_by_role("heading",name="Grafik").wait_for(); o.wait_for_timeout(700)
    o.get_by_role("button",name=f"Zofia N., {nxt+datetime.timedelta(days=1)} — zmiany").click()
    dlg=o.get_by_role("dialog"); dlg.wait_for(); dlg.get_by_label("Od").fill("1000"); dlg.get_by_label("Do").fill("1800"); dlg.get_by_label("Do").press("Enter"); dlg.wait_for(state="hidden")
    o.get_by_role("button",name=f"Zofia N., {nxt+datetime.timedelta(days=3)} — zmiany").click()
    dlg=o.get_by_role("dialog"); dlg.wait_for(); o.screenshot(path=f"{OUT}/g02-dialog-templates.png")
    dlg.locator(".sch-template", has_text="10:00–18:00").click(); dlg.wait_for(state="hidden")
    o.get_by_role("button",name=f"Zofia N., {nxt+datetime.timedelta(days=2)} — zmiany").click()
    dlg=o.get_by_role("dialog"); dlg.wait_for(); assert dlg.get_by_text("zgłoszone przez pracownika").count()==1; o.screenshot(path=f"{OUT}/g02b-off-dialog.png")
    # leader marks Adam unavailable until 17:00 on Friday
    o.keyboard.press("Escape"); o.wait_for_timeout(400)
    o.get_by_role("button",name=f"Adam W., {nxt+datetime.timedelta(days=4)} — zmiany").click(); dlg=o.get_by_role("dialog"); dlg.wait_for()
    dlg.get_by_role("button",name="+ Oznacz jako niedostępny").click(); dlg.get_by_role("tab",name="Niedostępny do").click(); dlg.get_by_label("Niedostępny do").fill("1700")
    dlg.get_by_label("Powód (opcjonalnie)").fill("Prosił telefonicznie"); o.screenshot(path=f"{OUT}/g02c-off-editor.png"); dlg.get_by_role("button",name="Zapisz").first.click()
    dlg.get_by_text("wpisał(a):").wait_for(); o.keyboard.press("Escape")
    o.wait_for_timeout(400); o.screenshot(path=f"{OUT}/g03-panel-draft.png", full_page=True)
    o.once("dialog", lambda d: d.accept()); o.get_by_role("button",name=re.compile("Opublikuj")).click(); o.get_by_text(re.compile("Opublikowano zmian")).wait_for()
    o.locator(".sch-legend-item").first.click(); o.wait_for_timeout(300); o.screenshot(path=f"{OUT}/g04-panel-published.png", full_page=True)
    # edit dialog with a published shift; month view; Lokale; Pracownicy checkbox
    o.get_by_role("button",name=f"Zofia N., {nxt+datetime.timedelta(days=1)} — zmiany").click(); o.get_by_role("dialog").wait_for(); o.wait_for_timeout(300)
    o.screenshot(path=f"{OUT}/g04b-edit-dialog.png"); o.keyboard.press("Escape")
    o.get_by_role("tab",name="Miesiąc").click(); o.wait_for_timeout(300)
    if nxt.month!=today.month: o.get_by_role("button",name="Następny miesiąc").click()
    o.get_by_text("Godziny",exact=True).first.wait_for(); o.wait_for_timeout(600); o.screenshot(path=f"{OUT}/g04c-month.png", full_page=True)
    o.get_by_role("tab",name="Tydzień").click()
    o.goto(BASE+"/panel/lokale"); o.get_by_text("Zdjęcie przy odbiciu").wait_for(); o.get_by_text("Zdjęcie przy odbiciu").scroll_into_view_if_needed(); o.wait_for_timeout(300); o.screenshot(path=f"{OUT}/g08-lokale.png")
    o.goto(BASE+"/panel/pracownicy"); o.get_by_text("Grupuj według stanowiska").wait_for(); o.get_by_text("Grupuj według stanowiska").click(); o.wait_for_timeout(300); o.screenshot(path=f"{OUT}/g09-employees.png")
    # staff sees it
    p.get_by_role("link",name="Moje zmiany").click(); p.locator(".g-day").first.wait_for()
    p.get_by_role("button",name="Następny tydzień").click(); p.get_by_text("10:00–18:00").first.wait_for(); p.wait_for_timeout(300)
    p.screenshot(path=f"{OUT}/g05-staff-week.png", full_page=True)
    p.goto(BASE+"/"); p.get_by_text("Mój grafik").wait_for(); p.wait_for_timeout(400); p.screenshot(path=f"{OUT}/g06-staff-start.png", full_page=True)
    # panel on the phone
    mc=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True,storage_state=o.context.storage_state()); m=mc.new_page(); watch(m)
    m.goto(BASE+"/panel/grafik"); m.get_by_role("heading",name="Grafik").wait_for(); m.wait_for_timeout(700); m.screenshot(path=f"{OUT}/g07-panel-phone.png")
    b.close()
print("\n".join(errors) if errors else "NO_ERRORS")
