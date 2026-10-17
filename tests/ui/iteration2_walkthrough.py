"""Iteration 2 (2026-10-17): photo items in checklists, Wiedza tabs, Grafik export PNG/PDF.
Needs a fresh server (scripts/ui-server.sh). Prints NO_ERRORS."""
import io, os, re, time, json
from playwright.sync_api import sync_playwright
from PIL import Image
BASE=os.environ.get("ACADEMY_URL","http://localhost:8797"); H={"Origin":BASE}; OUT=os.environ.get("SHOTS_DIR","/tmp/academy-shots"); os.makedirs(OUT,exist_ok=True); errors=[]
IGN=("ERR_TUNNEL_CONNECTION_FAILED","status of 401")
def watch(p):
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.on("console", lambda m: errors.append(f"console: {m.text}") if m.type=="error" and not any(x in m.text for x in IGN) else None)
PHOTO=os.path.join(OUT,"_camera.jpg")
img=Image.new("RGB",(3000,4000),(120,110,100))
for x in range(0,3000,200):
    for y in range(0,4000,200):
        Image.Image.paste(img,(200+(x*7)%55,180,160+(y*3)%60),(x,y,x+100,y+100))
img.save(PHOTO,"JPEG",quality=92)
li=lambda t: {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":t}]}]}
h2=lambda t: {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":t}]}
doc={"type":"doc","content":[h2("Sala"),{"type":"bulletList","content":[li("Ustaw stoły według planu sali"),li("Sprawdź świece na stołach")]},
                             h2("Stacja"),{"type":"bulletList","content":[li("Wypoleruj sztućce"),li("Uzupełnij serwetki")]}]}
with sync_playwright() as pw:
    b=pw.chromium.launch()
    o=b.new_context(viewport={"width":1360,"height":900},locale="pl-PL",accept_downloads=True).new_page(); watch(o)
    o.goto(BASE+"/"); o.get_by_label("Login").fill("egor.wlasciciel"); o.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    o.get_by_role("button",name="Zaloguj się").click(); o.get_by_role("heading",name="Ustaw swoje hasło").wait_for()
    o.get_by_label("Nowe hasło").fill("NoweHasloEgora2026"); o.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    o.get_by_role("button",name="Zapisz").click(); o.get_by_role("heading",name="Dziś",exact=True).wait_for()
    r=o.request; loc=r.get(BASE+"/api/admin/locations").json()["locations"][0]["id"]
    # people
    people={}
    for fn,ln,pos,pin in [("Zofia","Nowak","waiter","481937"),("Bogdan","Barowy","bartender","592048"),("Ola","Kowalska","waiter","603159")]:
        e=r.post(BASE+f"/api/admin/locations/{loc}/employees",data={"firstName":fn,"lastName":ln,"position":pos},headers=H).json(); people[fn]=e
    # checklist with a photo item
    cl=r.post(BASE+f"/api/admin/locations/{loc}/content",data={"kind":"checklist","title":"Otwarcie sali"},headers=H).json()["id"]
    r.put(BASE+f"/api/admin/content/{cl}",data={"body":doc,"positions":["waiter"]},headers=H); r.post(BASE+f"/api/admin/content/{cl}/publish",data={},headers=H)
    o.goto(BASE+f"/panel/materialy/{cl}"); o.get_by_text("Zadania ze zdjęciem").wait_for(); o.wait_for_timeout(400)
    box=o.locator(".photo-items label", has_text="Ustaw stoły").locator("input"); box.click()
    o.wait_for_function("document.querySelector('.photo-items input').checked"); o.wait_for_timeout(300)
    o.locator(".photo-items").screenshot(path=f"{OUT}/i01-editor-photo-items.png")
    # Service Book page + bar tab
    sb=r.post(BASE+f"/api/admin/locations/{loc}/content",data={"kind":"service_book","title":"Podawanie wody","section":"Napoje"},headers=H).json()["id"]
    r.put(BASE+f"/api/admin/content/{sb}",data={"body":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Woda z prawej strony gościa."}]}]}},headers=H); r.post(BASE+f"/api/admin/content/{sb}/publish",data={},headers=H)
    o.evaluate("localStorage.setItem('sa.panel.contentKind','service_book')")
    o.goto(BASE+"/panel/materialy"); o.locator(".kt-bar").wait_for(); o.get_by_role("button",name="Nowa zakładka").click()
    dlg=o.get_by_role("dialog"); dlg.get_by_label("Nazwa").fill("Bar Book"); dlg.get_by_label("Barman",exact=True).check(); o.wait_for_timeout(300); o.screenshot(path=f"{OUT}/i02-new-tab.png")
    dlg.get_by_role("button",name="Nowa zakładka").click(); o.get_by_text("Zakładka dodana").wait_for(); o.wait_for_timeout(400)
    o.get_by_role("button",name="Nowy materiał").click(); dlg=o.get_by_role("dialog"); assert dlg.get_by_label("Zakładka w Wiedzy").input_value()!=""
    dlg.get_by_label("Tytuł").fill("Negroni krok po kroku"); dlg.get_by_role("button",name="Nowy materiał").click(); o.wait_for_url(re.compile("/panel/materialy/ci"))
    bar=o.url.rsplit("/",1)[1]; o.get_by_label("Zakładka w Wiedzy").wait_for(); o.wait_for_timeout(500); o.screenshot(path=f"{OUT}/i03-bar-page-editor.png")
    r.put(BASE+f"/api/admin/content/{bar}",data={"body":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Gin, Campari, wermut — po równo."}]}]}},headers=H); r.post(BASE+f"/api/admin/content/{bar}/publish",data={},headers=H)
    o.goto(BASE+"/panel/materialy"); o.locator(".kt-bar").wait_for(); o.wait_for_timeout(600); o.screenshot(path=f"{OUT}/i04-materials-tabs.png")
    # terminal punches → waiter on shift
    tt=r.post(BASE+f"/api/admin/locations/{loc}/terminals",data={"name":"Telefon sala"},headers=H).json()
    phones={}
    for fn,pin in [("Zofia","481937"),("Bogdan","592048")]:
        e=people[fn]; c=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True); p=c.new_page(); watch(p)
        p.goto(BASE+"/"); p.get_by_label("Login").fill(e["login"]); p.get_by_label("PIN lub hasło").fill(e["tempSecret"]); p.get_by_role("button",name="Zaloguj się").click()
        p.get_by_label("Nowy PIN (6 cyfr)").fill(pin); p.get_by_label("Powtórz").fill(pin); p.get_by_role("button",name="Zapisz").click()
        p.wait_for_timeout(1200)
        if "/instaluj" in p.url: p.goto(BASE+"/")
        p.get_by_role("heading",name=re.compile("Dzień dobry|Dobry wieczór|Dobranoc")).wait_for(); phones[fn]=p
    tc=b.new_context(); tp=tc.new_page(); tp.goto(BASE+"/")
    tp.request.post(BASE+"/api/auth/login",data={"login":tt["login"],"secret":tt["tempSecret"]},headers=H)
    tp.request.post(BASE+"/api/terminal/punch",data={"pin":"481937","clientId":f"ui{int(time.time())}"},headers=H)
    z=phones["Zofia"]; z.goto(BASE+f"/listy/{cl}"); z.get_by_text("Odhacz ze zdjęciem").wait_for(); z.wait_for_timeout(400); z.screenshot(path=f"{OUT}/i05-phone-photo-item.png")
    with z.expect_file_chooser() as fc:
        z.get_by_role("button",name=re.compile("Ustaw stoły")).click()
    fc.value.set_files(PHOTO); z.get_by_text("ze zdjęciem",exact=False).first.wait_for(); z.wait_for_timeout(600)
    z.get_by_role("button",name=re.compile("Sprawdź świece")).click(); z.wait_for_timeout(1500)  # section done → folds
    z.screenshot(path=f"{OUT}/i06-phone-after-photo.png", full_page=True)
    assert z.locator(".fold").first.get_attribute("class").find("open")<0, "finished section should fold"
    # Wiedza on phones
    z.goto(BASE+"/wiedza"); z.get_by_role("link",name="Service Book").wait_for(); z.wait_for_timeout(500); z.screenshot(path=f"{OUT}/i07-waiter-wiedza.png")
    assert z.get_by_role("link",name="Bar Book").count()==0
    bp=phones["Bogdan"]; bp.goto(BASE+"/wiedza"); bp.get_by_role("link",name="Bar Book").wait_for(); bp.wait_for_timeout(500); bp.screenshot(path=f"{OUT}/i08-bartender-wiedza.png")
    assert bp.get_by_role("link",name="Service Book").count()==0
    bp.get_by_role("link",name=re.compile("Negroni")).click(); bp.get_by_text("Gin, Campari").wait_for(); bp.wait_for_timeout(400); bp.screenshot(path=f"{OUT}/i09-bar-page.png")
    # panel: checklist photo
    o.goto(BASE+"/panel/listy"); o.locator(".cl-fold").first.wait_for(); o.wait_for_timeout(400); o.screenshot(path=f"{OUT}/i10a-panel-folded.png", full_page=True)
    o.locator(".cl-fold:not(.open) .fold-head").first.click(); o.wait_for_timeout(700); o.screenshot(path=f"{OUT}/i10-panel-list-photo.png", full_page=True)
    o.locator(".cl-photo-btn").first.click(); o.locator(".lightbox img").wait_for(); o.wait_for_timeout(500)
    assert o.evaluate("document.querySelector('.lightbox img').naturalWidth")>0
    o.screenshot(path=f"{OUT}/i11-panel-photo-lightbox.png"); o.keyboard.press("Escape"); o.wait_for_timeout(300)
    # Grafik export
    import datetime
    today=datetime.date.today(); monday=today-datetime.timedelta(days=today.weekday())+datetime.timedelta(days=7)
    for i,(fn,st,en) in enumerate([("Zofia","16:00","23:00"),("Ola","12:00","20:00"),("Bogdan","18:00","02:00"),("Zofia","12:00","18:00"),("Ola","16:00","23:00")]):
        d=(monday+datetime.timedelta(days=i%7 if i<3 else 4+i%3)).isoformat()
        x=r.post(BASE+f"/api/admin/locations/{loc}/schedule/shifts",data={"userId":people[fn]["id"],"date":d,"start":st,"end":en},headers=H)
        assert x.status in (200,201), x.text()
    r.put(BASE+f"/api/admin/locations/{loc}/schedule/unavailability",data={"userId":people["Ola"]["id"],"date":(monday+datetime.timedelta(days=1)).isoformat(),"fromMin":0,"toMin":1020},headers=H)
    o.evaluate("localStorage.setItem('sa.panel.scheduleMode','week')")
    o.goto(BASE+"/panel/grafik"); o.get_by_role("button",name="Eksportuj").wait_for(); o.wait_for_timeout(700)
    o.get_by_role("button",name="Eksportuj").click(); o.get_by_role("dialog").wait_for(); o.wait_for_timeout(400); o.screenshot(path=f"{OUT}/i12-export-dialog.png")
    with o.expect_download() as dl:
        o.get_by_role("button",name=re.compile("Obraz PNG")).click()
    png=os.path.join(OUT,"i13-grafik.png"); dl.value.save_as(png)
    o.get_by_role("button",name="Eksportuj").click(); o.get_by_role("dialog").wait_for()
    with o.expect_download() as dl:
        o.get_by_role("button",name=re.compile("PDF")).click()
    pdf=os.path.join(OUT,"i14-grafik.pdf"); dl.value.save_as(pdf)
    data=open(pdf,"rb").read(); assert data.startswith(b"%PDF-1.4") and data.rstrip().endswith(b"%%EOF"), "pdf"
    im=Image.open(png); assert im.size[0]>1500, im.size
    print("png", im.size, "pdf bytes", len(data))
    o.evaluate("localStorage.setItem('sa.panel.scheduleMode','month')"); o.reload(); o.get_by_role("button",name="Eksportuj").wait_for(); o.wait_for_timeout(600)
    o.get_by_role("button",name="Eksportuj").click()
    with o.expect_download() as dl:
        o.get_by_role("button",name=re.compile("PDF")).click()
    dl.value.save_as(os.path.join(OUT,"i15-grafik-month.pdf"))
    b.close()
print("\n".join(errors) if errors else "NO_ERRORS")
