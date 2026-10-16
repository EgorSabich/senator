"""Step 3 (D41): "Moje godziny" on Start, its page with months and punches, link in Konto; Materiały filter by position
and bulk positions. Needs a fresh server (scripts/ui-server.sh). Prints NO_ERRORS."""
import os, re, time
from playwright.sync_api import sync_playwright
BASE=os.environ.get("ACADEMY_URL","http://localhost:8797"); H={"Origin":BASE}; OUT=os.environ.get("SHOTS_DIR","/tmp/academy-shots"); os.makedirs(OUT,exist_ok=True); errors=[]
IGN=("ERR_TUNNEL_CONNECTION_FAILED","status of 401")
def watch(p):
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.on("console", lambda m: errors.append(f"console: {m.text}") if m.type=="error" and not any(x in m.text for x in IGN) else None)
para=lambda t: {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":t}]}]}
with sync_playwright() as pw:
    b=pw.chromium.launch()
    o=b.new_context(viewport={"width":1280,"height":900},locale="pl-PL").new_page(); watch(o)
    o.goto(BASE+"/"); o.get_by_label("Login").fill("egor.wlasciciel"); o.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    o.get_by_role("button",name="Zaloguj się").click(); o.get_by_role("heading",name="Ustaw swoje hasło").wait_for()
    o.get_by_label("Obecne hasło").fill("TymczasoweHaslo1"); o.get_by_label("Nowe hasło").fill("NoweHasloEgora2026"); o.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    o.get_by_role("button",name="Zapisz").click(); o.get_by_role("heading",name="Pracownicy").wait_for()
    r=o.request; loc=r.get(BASE+"/api/admin/locations").json()["locations"][0]["id"]
    tt=r.post(BASE+f"/api/admin/locations/{loc}/terminals",data={"name":"Telefon sala"},headers=H).json()
    e=r.post(BASE+f"/api/admin/locations/{loc}/employees",data={"firstName":"Zofia","lastName":"Nowak","position":"waiter"},headers=H).json()
    for title in ["Regulamin baru","Regulamin sali","Zasady wspólne"]:
        cid=r.post(BASE+f"/api/admin/locations/{loc}/content",data={"kind":"regulation","title":title},headers=H).json()["id"]
        r.put(BASE+f"/api/admin/content/{cid}",data={"body":para(title)},headers=H); r.post(BASE+f"/api/admin/content/{cid}/publish",data={},headers=H)
    c=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True); p=c.new_page(); watch(p)
    p.goto(BASE+"/"); p.get_by_label("Login").fill(e["login"]); p.get_by_label("PIN lub hasło").fill(e["tempSecret"]); p.get_by_role("button",name="Zaloguj się").click()
    p.get_by_label("Obecny PIN").fill(e["tempSecret"]); p.get_by_label("Nowy PIN (6 cyfr)").fill("481937"); p.get_by_label("Powtórz").fill("481937"); p.get_by_role("button",name="Zapisz").click()
    p.get_by_role("heading",name=re.compile("Dzień dobry")).wait_for()
    # shifts via terminal API (an earlier shift offline + one open now)
    tc=b.new_context(); tp=tc.new_page(); tp.goto(BASE+"/")
    tp.request.post(BASE+"/api/auth/login",data={"login":tt["login"],"secret":tt["tempSecret"]},headers=H)
    now=int(time.time()*1000)
    for at,off in [(now-5*3600_000,True),(now-1*3600_000,True)]:
        tp.request.post(BASE+"/api/terminal/punch",data={"pin":"481937","clientId":f"ui{at}x","offline":off,"at":at},headers=H)
    p.reload(); p.get_by_text("Moje godziny").first.wait_for(); p.wait_for_timeout(600); p.screenshot(path=f"{OUT}/t01-start.png", full_page=True)
    p.get_by_text("Moje godziny").first.click(); p.get_by_role("heading",name="Moje godziny").wait_for(); p.wait_for_timeout(500)
    assert p.get_by_text("4:00 h").count()>=1, "shift hours missing"
    p.locator(".a-module-head").first.click(); p.wait_for_timeout(400); p.screenshot(path=f"{OUT}/t02-mytime.png", full_page=True)
    p.get_by_role("button",name="Poprzedni miesiąc").click(); p.get_by_text("Brak zmian w tym miesiącu.").wait_for(); p.screenshot(path=f"{OUT}/t03-prev.png")
    p.get_by_role("button",name="Następny miesiąc").click(); p.get_by_text("4:00 h").first.wait_for()
    p.get_by_role("button",name="Wstecz").count()
    p.goto(BASE+"/konto"); p.get_by_role("link",name="Moje godziny").wait_for(); p.screenshot(path=f"{OUT}/t04-konto.png", full_page=True)
    # Materiały: bulk positions
    o.goto(BASE+"/panel/materialy"); o.get_by_role("tab",name="Regulaminy").click(); o.get_by_text("Regulamin baru").wait_for()
    o.get_by_role("button",name="Zaznacz kilka").click()
    o.get_by_role("button",name=re.compile("Regulamin baru")).click(); o.wait_for_timeout(200)
    o.get_by_role("button",name="Ustaw stanowiska").first.click(); dlg=o.get_by_role("dialog"); dlg.wait_for()
    dlg.get_by_label("Barman").check(); o.screenshot(path=f"{OUT}/t05-positions-dialog.png")
    dlg.get_by_role("button",name="Ustaw stanowiska").click(); o.get_by_text("Zapisano stanowiska dla 1 materiału.").wait_for()
    o.get_by_role("button",name="Kelner",exact=True).click(); o.wait_for_timeout(300)
    assert o.get_by_text("Regulamin baru").count()==0 and o.get_by_text("Regulamin sali").count()==1, "position filter wrong"
    o.screenshot(path=f"{OUT}/t06-filter-waiter.png", full_page=True)
    o.get_by_role("button",name="Wszystkie",exact=True).click()
    # waiter no longer sees the bar regulation
    p.goto(BASE+"/wiedza/regulaminy"); p.get_by_text("Regulamin sali").wait_for(); assert p.get_by_text("Regulamin baru").count()==0
    b.close()
print("\n".join(errors) if errors else "NO_ERRORS")
