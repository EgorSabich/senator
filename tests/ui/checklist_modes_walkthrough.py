"""Step 4 (D42): checklist JSON import in the panel, individual list on two phones, panel day view per person,
mode switch in the editor. Needs a fresh server (scripts/ui-server.sh). Prints NO_ERRORS."""
import os, re, time, json, tempfile
from playwright.sync_api import sync_playwright
BASE=os.environ.get("ACADEMY_URL","http://localhost:8797"); H={"Origin":BASE}; OUT=os.environ.get("SHOTS_DIR","/tmp/academy-shots"); os.makedirs(OUT,exist_ok=True); errors=[]
IGN=("ERR_TUNNEL_CONNECTION_FAILED","status of 401")
def watch(p):
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.on("console", lambda m: errors.append(f"console: {m.text}") if m.type=="error" and not any(x in m.text for x in IGN) else None)
FILE=os.path.join(tempfile.mkdtemp(),"listy.json")
json.dump({"format":"senator-checklists","checklists":[
  {"title":"Otwarcie zmiany — kelnerzy","positions":["waiter"],"mode":"individual","sections":[
    {"title":"Sala","items":["Sprawdź czystość stołów","Ustaw krzesła równo"]},{"title":"Stacja","items":["Uzupełnij serwetki","Sprawdź papier w drukarce"]}]},
  {"title":"Zamknięcie baru","positions":["bartender"],"mode":"shared","items":["Umyj shakery","Wyłącz ekspres"]}]}, open(FILE,"w"), ensure_ascii=False)
BAD=os.path.join(tempfile.mkdtemp(),"zle.json")
json.dump({"format":"senator-checklists","checklists":[{"title":"Zła","positions":["kelner"],"items":["x"]}]}, open(BAD,"w"))
with sync_playwright() as pw:
    b=pw.chromium.launch()
    o=b.new_context(viewport={"width":1280,"height":900},locale="pl-PL").new_page(); watch(o)
    o.goto(BASE+"/"); o.get_by_label("Login").fill("egor.wlasciciel"); o.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    o.get_by_role("button",name="Zaloguj się").click(); o.get_by_role("heading",name="Ustaw swoje hasło").wait_for()
    o.get_by_label("Nowe hasło").fill("NoweHasloEgora2026"); o.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    o.get_by_role("button",name="Zapisz").click(); o.get_by_role("heading",name="Dziś",exact=True).wait_for()
    r=o.request; loc=r.get(BASE+"/api/admin/locations").json()["locations"][0]["id"]
    # import
    o.goto(BASE+"/panel/materialy"); o.get_by_role("button",name="Import materiałów").click(); dlg=o.get_by_role("dialog")
    dlg.locator('input[type="file"]').set_input_files(BAD); dlg.get_by_text("nieznane stanowisko kelner").wait_for(); o.screenshot(path=f"{OUT}/c01-import-error.png")
    dlg.get_by_text("Listy kontrolne z pliku JSON — wzór").click(); o.wait_for_timeout(300)
    dlg.locator('input[type="file"]').set_input_files(FILE); dlg.get_by_text("Listy kontrolne: 2").wait_for(); o.screenshot(path=f"{OUT}/c02-import-preview.png")
    dlg.get_by_role("button",name="Importuj").click(); dlg.get_by_text(re.compile("Dodano")).wait_for(); o.keyboard.press("Escape")
    ids=[i["id"] for i in r.get(BASE+f"/api/admin/locations/{loc}/content?kind=checklist").json()["items"]]
    for i in ids: r.post(BASE+f"/api/admin/content/{i}/publish",data={},headers=H)
    open_id=[i["id"] for i in r.get(BASE+f"/api/admin/locations/{loc}/content?kind=checklist").json()["items"] if i["title"].startswith("Otwarcie")][0]
    o.goto(BASE+f"/panel/materialy/{open_id}"); o.get_by_label("Tryb listy").wait_for(); o.wait_for_timeout(500)
    assert o.get_by_label("Tryb listy").input_value()=="individual"; o.screenshot(path=f"{OUT}/c03-editor-mode.png", full_page=True)
    # people + terminal
    tt=r.post(BASE+f"/api/admin/locations/{loc}/terminals",data={"name":"Telefon sala"},headers=H).json()
    phones=[]
    for fn,ln,pin in [("Zofia","Nowak","481937"),("Adam","Wiśniewski","592048"),("Ola","Kowalska","603159")]:
        e=r.post(BASE+f"/api/admin/locations/{loc}/employees",data={"firstName":fn,"lastName":ln,"position":"waiter"},headers=H).json()
        c=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True); p=c.new_page(); watch(p)
        p.goto(BASE+"/"); p.get_by_label("Login").fill(e["login"]); p.get_by_label("PIN lub hasło").fill(e["tempSecret"]); p.get_by_role("button",name="Zaloguj się").click()
        p.get_by_label("Nowy PIN (6 cyfr)").fill(pin); p.get_by_label("Powtórz").fill(pin); p.get_by_role("button",name="Zapisz").click()
        p.get_by_role("heading",name=re.compile("Dzień dobry|Dobry wieczór|Dobranoc")).wait_for(); phones.append(p)
    tc=b.new_context(); tp=tc.new_page(); tp.goto(BASE+"/")
    tp.request.post(BASE+"/api/auth/login",data={"login":tt["login"],"secret":tt["tempSecret"]},headers=H)
    for pin in ["481937","592048","603159"]: tp.request.post(BASE+"/api/terminal/punch",data={"pin":pin,"clientId":f"ui{pin}{int(time.time())}"},headers=H)
    z,a=phones[0],phones[1]
    for p in (z,a):
        p.reload(); p.locator('a[href^="/listy/"]').first.wait_for()
    z.screenshot(path=f"{OUT}/c04-start.png", full_page=True)
    z.locator('a[href^="/listy/"]').first.click(); z.get_by_text("To Twoja lista na dziś").wait_for()
    for name in ["Sprawdź czystość stołów","Ustaw krzesła równo","Uzupełnij serwetki","Sprawdź papier w drukarce"]:
        z.get_by_role("button",name=re.compile(name)).click(); z.wait_for_timeout(350)
    z.get_by_text("Wszystko zrobione").wait_for(); z.screenshot(path=f"{OUT}/c05-zofia-done.png", full_page=True)
    assert z.get_by_role("button",name="Zamknij listę na dziś").count()==0
    a.locator('a[href^="/listy/"]').first.click(); a.get_by_text("To Twoja lista na dziś").wait_for()
    assert a.locator(".a-task.done").count()==0, "Adam sees Zofia's marks"
    a.get_by_role("button",name=re.compile("Uzupełnij serwetki")).click(); a.wait_for_timeout(400); a.screenshot(path=f"{OUT}/c06-adam.png", full_page=True)
    # panel day view
    o.goto(BASE+"/panel/listy"); o.get_by_text("Postęp osób na zmianie").first.wait_for(); o.wait_for_timeout(500)
    assert o.get_by_text("4 z 4").count()>=1 and o.get_by_text("1 z 4").count()>=1 and o.get_by_text("0 z 4").count()>=1
    o.screenshot(path=f"{OUT}/c07-panel-day.png", full_page=True)
    o.get_by_role("tab",name="Statystyka").click(); o.wait_for_timeout(900); o.screenshot(path=f"{OUT}/c08-panel-stats.png", full_page=True)
    b.close()
print("\n".join(errors) if errors else "NO_ERRORS")
