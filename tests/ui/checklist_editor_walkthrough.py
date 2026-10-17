"""„Listy”: edit and import checklists right there, divisions filter, „Wymaga zdjęcia” per item (2026-10-17).
Needs a fresh server (scripts/ui-server.sh). Prints NO_ERRORS."""
import os, re, time, json, tempfile
from playwright.sync_api import sync_playwright
from PIL import Image
BASE=os.environ.get("ACADEMY_URL","http://localhost:8797"); H={"Origin":BASE}; OUT=os.environ.get("SHOTS_DIR","/tmp/academy-shots"); os.makedirs(OUT,exist_ok=True); errors=[]

def unfold(pg):
    """Checklists start folded (2026-10-17): open every section before ticking."""
    pg.locator('button.fold-head[aria-expanded="false"]').first.wait_for(timeout=10000)
    pg.wait_for_timeout(300)
    for _ in range(12):
        closed=pg.locator('button.fold-head[aria-expanded="false"]')
        if not closed.count(): break
        closed.first.click(); pg.wait_for_timeout(650)
IGN=("ERR_TUNNEL_CONNECTION_FAILED","status of 401")
def watch(p):
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.on("console", lambda m: errors.append(f"console: {m.text}") if m.type=="error" and not any(x in m.text for x in IGN) else None)
PHOTO=os.path.join(OUT,"_camera2.jpg"); Image.new("RGB",(1200,1600),(140,120,100)).save(PHOTO,"JPEG")
FILE=os.path.join(tempfile.mkdtemp(),"listy.json")
json.dump({"format":"senator-checklists","checklists":[
  {"title":"Zamknięcie baru","positions":["bartender"],"mode":"individual","sections":[{"title":"Bar","items":["Umyj shakery","Wyłącz ekspres"]}]}]}, open(FILE,"w"), ensure_ascii=False)
with sync_playwright() as pw:
    b=pw.chromium.launch()
    o=b.new_context(viewport={"width":1280,"height":900},locale="pl-PL").new_page(); watch(o)
    o.goto(BASE+"/"); o.get_by_label("Login").fill("egor.wlasciciel"); o.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    o.get_by_role("button",name="Zaloguj się").click(); o.get_by_role("heading",name="Ustaw swoje hasło").wait_for()
    o.get_by_label("Nowe hasło").fill("NoweHasloEgora2026"); o.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    o.get_by_role("button",name="Zapisz").click(); o.get_by_role("heading",name="Dziś",exact=True).wait_for()
    r=o.request; loc=r.get(BASE+"/api/admin/locations").json()["locations"][0]["id"]
    zofia=r.post(BASE+f"/api/admin/locations/{loc}/employees",data={"firstName":"Zofia","lastName":"Nowak","position":"waiter"},headers=H).json()
    # Materiały has no checklist tab any more
    o.goto(BASE+"/panel/materialy"); o.get_by_role("tab",name="SOP").wait_for(); assert o.get_by_role("tab",name="Listy kontrolne").count()==0
    # import in Listy
    o.goto(BASE+"/panel/listy"); o.get_by_role("button",name="Edytuj listy").wait_for(); o.wait_for_timeout(400); o.screenshot(path=f"{OUT}/e01-listy-buttons.png")
    o.get_by_role("button",name="Importuj (JSON)").click(); dlg=o.get_by_role("dialog")
    dlg.locator('input[type="file"]').set_input_files(FILE); dlg.get_by_text("Listy kontrolne: 1").wait_for()
    dlg.get_by_role("button",name="Importuj").click(); dlg.get_by_text(re.compile("Dodano")).wait_for(); o.keyboard.press("Escape"); o.wait_for_timeout(400)
    o.goto(BASE+"/panel/listy/edycja"); o.get_by_text("Zamknięcie baru").wait_for(); o.wait_for_timeout(300)
    # new list for waiters
    o.get_by_role("button",name="Nowa lista").click(); o.get_by_label("Nazwa listy").fill("Otwarcie sali"); o.get_by_role("button",name="Utwórz").click()
    o.wait_for_url(re.compile("/panel/listy/edycja/ci")); o.get_by_label("Nazwa sekcji").first.wait_for()
    o.get_by_role("button",name="Kelner",exact=True).click()
    o.get_by_label("Nazwa sekcji").first.fill("Sala")
    o.get_by_role("button",name="+ Dodaj punkt").first.click(); o.get_by_label("Punkt 1").fill("Ustaw stoły według planu sali")
    o.get_by_role("button",name="+ Dodaj punkt").first.click(); o.get_by_label("Punkt 2").fill("Sprawdź świece")
    o.get_by_role("button",name="Bez zdjęcia").first.click()
    o.locator(".cle-section").first.locator(".cle-item").nth(1).get_by_role("button",name="Jeden za zmianę").click()
    o.get_by_role("button",name="+ Dodaj sekcję").click(); o.get_by_label("Nazwa sekcji").nth(1).fill("Stacja")
    o.locator(".cle-section").nth(1).get_by_label("Punkt 1").fill("Wypoleruj sztućce")
    o.wait_for_timeout(300); o.screenshot(path=f"{OUT}/e02-editor.png", full_page=True)
    o.get_by_role("button",name="Zapisz",exact=True).click(); o.get_by_text("Zapisano. Lista jest już na telefonach.").wait_for()
    cid=o.url.rsplit("/",1)[1]
    d=r.get(BASE+f"/api/admin/content/{cid}").json()["item"]; assert d["status"]=="published" and len(d["checklistPhotoKeys"])==1 and d["positions"]==["waiter"], d
    # change text of the photo item: photo stays
    o.get_by_label("Punkt 1").first.fill("Ustaw stoły według planu sali na dziś"); o.get_by_text("dzisiejsze odhaczenia").wait_for()
    o.get_by_role("button",name="Zapisz",exact=True).click(); o.get_by_text("Zapisano.").wait_for(); o.wait_for_timeout(500)
    assert o.get_by_role("button",name="Wymaga zdjęcia").count()==1
    # divisions filter in edit mode
    o.goto(BASE+"/panel/listy/edycja"); o.get_by_role("button",name="Barmani").click(); o.wait_for_timeout(300)
    assert o.get_by_text("Otwarcie sali").count()==0 and o.get_by_text("Zamknięcie baru").count()==1
    o.screenshot(path=f"{OUT}/e03-manager-bar.png")
    o.get_by_role("button",name="Kelnerzy").click(); o.wait_for_timeout(300)
    # phone
    tt=r.post(BASE+f"/api/admin/locations/{loc}/terminals",data={"name":"Telefon"},headers=H).json()
    c=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True); p=c.new_page(); watch(p)
    p.goto(BASE+"/"); p.get_by_label("Login").fill(zofia["login"]); p.get_by_label("PIN lub hasło").fill(zofia["tempSecret"]); p.get_by_role("button",name="Zaloguj się").click()
    p.get_by_label("Nowy PIN (6 cyfr)").fill("481937"); p.get_by_label("Powtórz").fill("481937"); p.get_by_role("button",name="Zapisz").click(); p.wait_for_timeout(1200)
    tc=b.new_context(); tp=tc.new_page(); tp.goto(BASE+"/")
    tp.request.post(BASE+"/api/auth/login",data={"login":tt["login"],"secret":tt["tempSecret"]},headers=H)
    tp.request.post(BASE+"/api/terminal/punch",data={"pin":"481937","clientId":f"ui{int(time.time())}"},headers=H)
    p.goto(BASE+f"/listy/{cid}"); unfold(p); p.get_by_text("Odhacz ze zdjęciem").wait_for()
    with p.expect_file_chooser() as fc:
        p.get_by_role("button",name=re.compile("Ustaw stoły")).click()
    fc.value.set_files(PHOTO); p.get_by_text("ze zdjęciem",exact=False).first.wait_for(); p.wait_for_timeout(600); p.screenshot(path=f"{OUT}/e04-phone.png", full_page=True)
    # control with division filter (publish the imported bar list first)
    for it in r.get(BASE+f"/api/admin/locations/{loc}/content?kind=checklist").json()["items"]:
        if it["status"]=="draft": r.post(BASE+f"/api/admin/content/{it['id']}/publish",data={},headers=H)
    o.goto(BASE+"/panel/listy"); o.locator(".cl-fold").first.wait_for(); o.get_by_role("button",name="Kelnerzy").click(); unfold(o)
    assert o.get_by_text("Zamknięcie baru").count()==0
    o.wait_for_timeout(600); o.screenshot(path=f"{OUT}/e05-control-waiters.png", full_page=True)
    o.locator(".cl-photo-btn").first.click(); o.locator(".lightbox img").wait_for(); o.wait_for_timeout(500)
    assert o.evaluate("document.querySelector('.lightbox img').naturalWidth")>0
    d=r.get(BASE+f"/api/admin/content/{cid}").json()["item"]; assert len(d["checklistSharedKeys"])==1, d
    # archive and restore
    o.goto(BASE+f"/panel/listy/edycja/{cid}"); o.get_by_role("button",name="Do archiwum").wait_for()
    o.once("dialog", lambda dl: dl.accept()); o.get_by_role("button",name="Do archiwum").click(); o.wait_for_url(re.compile("/panel/listy/edycja$"))
    o.get_by_role("button",name=re.compile("Archiwum")).click(); o.get_by_text("Otwarcie sali").wait_for(); o.wait_for_timeout(300); o.screenshot(path=f"{OUT}/e07-archive.png")
    o.get_by_role("button",name="Przywróć").click(); o.wait_for_timeout(600)
    o.get_by_role("button",name="Aktywne").click(); o.get_by_text("Otwarcie sali").wait_for()
    # phone width panel editor
    m=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True).new_page(); watch(m)
    m.goto(BASE+"/"); m.get_by_label("Login").fill("egor.wlasciciel"); m.get_by_label("PIN lub hasło").fill("NoweHasloEgora2026"); m.get_by_role("button",name="Zaloguj się").click()
    m.get_by_role("heading",name="Dziś",exact=True).wait_for(); m.goto(BASE+f"/panel/listy/edycja/{cid}"); m.get_by_label("Nazwa sekcji").first.wait_for(); m.wait_for_timeout(500)
    m.screenshot(path=f"{OUT}/e06-phone-editor.png", full_page=True)
    b.close()
print("\n".join(errors) if errors else "NO_ERRORS")
