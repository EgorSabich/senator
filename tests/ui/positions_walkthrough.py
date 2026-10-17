"""Several positions (2026-10-17): employee card positions and per-position rates, Grafik hint, position on a shift.
Needs a fresh server (scripts/ui-server.sh). Prints NO_ERRORS."""
import os, re, datetime
from playwright.sync_api import sync_playwright
BASE=os.environ.get("ACADEMY_URL","http://localhost:8797"); H={"Origin":BASE}; OUT=os.environ.get("SHOTS_DIR","/tmp/academy-shots"); os.makedirs(OUT,exist_ok=True); errors=[]
IGN=("ERR_TUNNEL_CONNECTION_FAILED","status of 401")
def watch(p):
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.on("console", lambda m: errors.append(f"console: {m.text}") if m.type=="error" and not any(x in m.text for x in IGN) else None)

def pick_date(page, label, iso, time=None):
    """DateField: open the field by its label, go to the month, click the day (and the time, then „Gotowe”)."""
    page.get_by_label(label, exact=True).click()
    want=iso[:7]
    for _ in range(36):
        if page.locator(f'.df-day[data-date="{iso}"]').count(): break
        head=page.locator(".df-pop .df-head b, .df-sheet .df-head b").first.inner_text()
        months=["Styczeń","Luty","Marzec","Kwiecień","Maj","Czerwiec","Lipiec","Sierpień","Wrzesień","Październik","Listopad","Grudzień"]
        name,year=head.split()
        cur=f"{year}-{months.index(name)+1:02d}"
        page.get_by_role("button",name="Następny miesiąc" if cur<want else "Poprzedni miesiąc").last.click()
    page.locator(f'.df-day[data-date="{iso}"]').click()
    if time:
        page.locator(".df-other input").fill(time); page.get_by_role("button",name="Gotowe").click()

with sync_playwright() as pw:
    b=pw.chromium.launch()
    o=b.new_context(viewport={"width":1280,"height":900},locale="pl-PL").new_page(); watch(o)
    o.goto(BASE+"/"); o.get_by_label("Login").fill("egor.wlasciciel"); o.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    o.get_by_role("button",name="Zaloguj się").click(); o.get_by_role("heading",name="Ustaw swoje hasło").wait_for()
    o.get_by_label("Nowe hasło").fill("NoweHasloEgora2026"); o.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    o.get_by_role("button",name="Zapisz").click(); o.get_by_role("heading",name="Dziś",exact=True).wait_for()
    r=o.request; loc=r.get(BASE+"/api/admin/locations").json()["locations"][0]["id"]
    ola=r.post(BASE+f"/api/admin/locations/{loc}/employees",data={"firstName":"Ola","lastName":"Kowalska","position":"waiter"},headers=H).json()
    r.post(BASE+f"/api/admin/locations/{loc}/employees",data={"firstName":"Ewa","lastName":"Host","position":"host"},headers=H)
    o.goto(BASE+f"/panel/pracownicy/{ola['id']}"); o.locator(".emp-positions").wait_for(); o.wait_for_timeout(500)
    o.get_by_role("button",name="+ Dodaj stanowisko").click(); o.locator("#new-pos").select_option("host")
    o.get_by_role("button",name="Dodaj",exact=True).click(); o.locator(".emp-pos",has_text="Host").wait_for(); o.wait_for_timeout(400)
    o.locator(".emp-pos",has_text="Kelner").get_by_role("button",name="Stawka").click()
    o.get_by_label(re.compile("Nowa stawka — Kelner")).fill("32,50"); pick_date(o,"Obowiązuje od","2026-01-01"); o.get_by_role("button",name="Zapisz stawkę").click()
    o.locator(".emp-pos",has_text="Kelner").get_by_text("32,50").wait_for()
    o.locator(".emp-pos",has_text="Host").get_by_role("button",name="Stawka").click()
    o.get_by_label(re.compile("Nowa stawka — Host")).fill("30"); pick_date(o,"Obowiązuje od","2026-01-01"); o.get_by_role("button",name="Zapisz stawkę").click()
    o.locator(".emp-pos",has_text="Host").get_by_text("30").first.wait_for(); o.wait_for_timeout(400)
    o.locator(".emp.open").screenshot(path=f"{OUT}/p01-card-positions.png")
    # Grafik: shifts on both positions this week
    today=datetime.date.today(); mon=today-datetime.timedelta(days=today.weekday())
    d1=mon.isoformat(); d2=(mon+datetime.timedelta(days=2)).isoformat()
    assert r.post(BASE+f"/api/admin/locations/{loc}/schedule/shifts",data={"userId":ola["id"],"date":d1,"division":"waiter","start":"16:00","end":"23:00"},headers=H).status==201
    assert r.post(BASE+f"/api/admin/locations/{loc}/schedule/shifts",data={"userId":ola["id"],"date":d2,"division":"host","start":"12:00","end":"16:00"},headers=H).status==201
    over=r.post(BASE+f"/api/admin/locations/{loc}/schedule/shifts",data={"userId":ola["id"],"date":d2,"division":"waiter","start":"14:00","end":"20:00"},headers=H)
    assert over.status==409, over.text()
    o.evaluate("localStorage.setItem('sa.panel.scheduleMode','week')"); o.goto(BASE+f"/panel/grafik"); o.get_by_role("button",name="Ten tydzień").click(); o.locator(".sch-elsewhere").first.wait_for(timeout=15000)
    o.wait_for_timeout(600); o.screenshot(path=f"{OUT}/p02-grafik.png", full_page=True)
    # Czas pracy: position select on a shift of a two-position person
    y=(today-datetime.timedelta(days=1)).isoformat()
    import time as _t
    inAt=int(datetime.datetime.fromisoformat(f"{y}T12:00:00+02:00").timestamp()*1000); outAt=inAt+4*3600_000
    assert r.post(BASE+f"/api/admin/locations/{loc}/time/entries",data={"userId":ola["id"],"clockInAt":inAt,"clockOutAt":outAt},headers=H).status==201
    o.goto(BASE+"/panel/czas"); o.locator("tr",has_text="Ola K.").first.wait_for(); o.wait_for_timeout(600)
    o.locator("tr",has_text="Ola K.").locator("button.cell.has").first.click(); o.get_by_role("dialog").wait_for()
    o.get_by_label("Stanowisko na tej zmianie").select_option("host"); o.wait_for_timeout(200); o.get_by_role("dialog").screenshot(path=f"{OUT}/p03-time-position.png")
    o.get_by_role("dialog").get_by_role("button",name="Zapisz").first.click(); o.wait_for_timeout(900)
    e=[x for x in r.get(BASE+f"/api/admin/locations/{loc}/time?from={y}&to={y}").json()["entries"] if x["userId"]==ola["id"]][0]
    assert e["position"]=="host" and e["positionSet"]=="host", e
    # list shows both positions
    o.goto(BASE+"/panel/pracownicy"); o.get_by_text("Kelner + Host").wait_for(); o.screenshot(path=f"{OUT}/p04-list.png")
    b.close()
print("\n".join(errors) if errors else "NO_ERRORS")
