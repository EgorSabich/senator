"""Push notifications (2026-10-17): Konto → Powiadomienia, Grafik → „Opublikuj” dialog with and without notification.
Needs a fresh server with throwaway VAPID keys (VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… scripts/ui-server.sh). Prints NO_ERRORS."""
import os, re, datetime
from playwright.sync_api import sync_playwright
BASE=os.environ.get("ACADEMY_URL","http://localhost:8797"); H={"Origin":BASE}; OUT=os.environ.get("SHOTS_DIR","/tmp/academy-shots"); os.makedirs(OUT,exist_ok=True); errors=[]
IGN=("ERR_TUNNEL_CONNECTION_FAILED","status of 401","status of 403")
def watch(p):
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.on("console", lambda m: errors.append(f"console: {m.text}") if m.type=="error" and not any(x in m.text for x in IGN) else None)
today=datetime.date.today(); mon=today+datetime.timedelta(days=7-today.weekday())
with sync_playwright() as pw:
    b=pw.chromium.launch()
    o=b.new_context(viewport={"width":1280,"height":900},locale="pl-PL").new_page(); watch(o)
    o.goto(BASE+"/"); o.get_by_label("Login").fill("egor.wlasciciel"); o.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    o.get_by_role("button",name="Zaloguj się").click(); o.get_by_role("heading",name="Ustaw swoje hasło").wait_for()
    o.get_by_label("Nowe hasło").fill("NoweHasloEgora2026"); o.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    o.get_by_role("button",name="Zapisz").click(); o.get_by_role("heading",name="Dziś",exact=True).wait_for()
    r=o.request; loc=r.get(BASE+"/api/admin/locations").json()["locations"][0]["id"]
    people=[]
    for f,l in [("Zofia","Nowak"),("Adam","Wiśniewski"),("Marta","Kowalska")]:
        people.append(r.post(BASE+f"/api/admin/locations/{loc}/employees",data={"firstName":f,"lastName":l,"position":"waiter"},headers=H).json())
    for i,e in enumerate(people):
        for d in range(i+1):
            assert r.post(BASE+f"/api/admin/locations/{loc}/schedule/shifts",data={"userId":e["id"],"date":str(mon+datetime.timedelta(days=d)),"start":"16:00","end":"23:00"},headers=H).status==201
    # Konto on a phone: notifications card
    c=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True,permissions=["notifications"]); p=c.new_page(); watch(p)
    # headless Chromium always reports „denied”; a real phone starts at „default”
    c.add_init_script("Object.defineProperty(Notification, 'permission', { get: () => 'default' })")
    e=people[0]
    p.goto(BASE+"/"); p.get_by_label("Login").fill(e["login"]); p.get_by_label("PIN lub hasło").fill(e["tempSecret"]); p.get_by_role("button",name="Zaloguj się").click()
    p.get_by_label("Nowy PIN (6 cyfr)").fill("481937"); p.get_by_label("Powtórz").fill("481937"); p.get_by_role("button",name="Zapisz").click(); p.wait_for_timeout(1200)
    p.goto(BASE+"/konto"); p.get_by_text("Powiadomienia",exact=True).wait_for(); p.wait_for_timeout(600)
    card=p.locator(".a-card",has=p.get_by_text("Powiadomienia",exact=True))
    assert card.get_by_role("button",name="Włącz").count()==1 or card.get_by_text("nie obsługuje").count()==1, card.inner_text()
    card.screenshot(path=f"{OUT}/p01-konto.png"); p.screenshot(path=f"{OUT}/p02-konto-full.png", full_page=True)
    # publish dialog
    o.goto(BASE+f"/panel/grafik"); o.get_by_role("button",name="›").first.wait_for(); o.wait_for_timeout(500)
    if o.get_by_role("button",name="Opublikuj (6)").count()==0: o.get_by_role("button",name="›").first.click(); o.wait_for_timeout(800)
    o.get_by_role("button",name="Opublikuj (6)").click()
    o.get_by_role("heading",name="Opublikować grafik?").wait_for(); o.get_by_text("Wiśniewski").wait_for(); o.wait_for_timeout(500)
    dlg=o.locator(".modal"); dlg.screenshot(path=f"{OUT}/p03-publish-dialog.png")
    assert dlg.get_by_role("button",name=re.compile("Opublikuj i powiadom 3 osoby")).count()==1, dlg.inner_text()
    assert "(0 z 3)" in dlg.inner_text(), dlg.inner_text()
    dlg.get_by_role("button",name="Opublikuj bez powiadomienia").click(); o.get_by_text("Opublikowano zmian").wait_for()
    o.wait_for_timeout(400); o.screenshot(path=f"{OUT}/p04-published.png")
    # phone Grafik shows the shift
    p.goto(BASE+"/grafik"); p.wait_for_timeout(1000)
    b.close()
print("\n".join(errors) if errors else "NO_ERRORS")
