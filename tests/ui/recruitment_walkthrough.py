"""Rekrutacja (2026-10-17): table, new candidate with phone formatting, card with CV and comments, hire, calendar, phone view.
Needs a fresh server (scripts/ui-server.sh). Prints NO_ERRORS."""
import os, re, datetime
from playwright.sync_api import sync_playwright
BASE=os.environ.get("ACADEMY_URL","http://localhost:8797"); H={"Origin":BASE}; OUT=os.environ.get("SHOTS_DIR","/tmp/academy-shots"); os.makedirs(OUT,exist_ok=True); errors=[]
IGN=("ERR_TUNNEL_CONNECTION_FAILED","status of 401","status of 403","status of 404")
def watch(p):
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.on("console", lambda m: errors.append(f"console: {m.text}") if m.type=="error" and not any(x in m.text for x in IGN) else None)
today=datetime.date.today(); d=lambda n: str(today+datetime.timedelta(days=n))
PDF=b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"

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
    o=b.new_context(viewport={"width":1400,"height":900},locale="pl-PL").new_page(); watch(o)
    o.goto(BASE+"/"); o.get_by_label("Login").fill("egor.wlasciciel"); o.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    o.get_by_role("button",name="Zaloguj się").click(); o.get_by_role("heading",name="Ustaw swoje hasło").wait_for()
    o.get_by_label("Nowe hasło").fill("NoweHasloEgora2026"); o.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    o.get_by_role("button",name="Zapisz").click(); o.get_by_role("heading",name="Dziś",exact=True).wait_for()
    r=o.request; loc=r.get(BASE+"/api/admin/locations").json()["locations"][0]["id"]
    seed=[("Jan Nowak","bartender","512908112",None,f"{d(2)}T16:00","trial"),("Marta Lis","waiter","512345678",f"{d(1)}T11:00",None,None),
          ("Piotr Zając","kitchen","698004221",None,None,None),("Anna Biel","waiter","733120909",None,None,"hired"),("Karol Mazur","host","600700800",None,None,"rejected")]
    for name,pos,ph,i,tr,st in seed:
        c=r.post(BASE+f"/api/admin/locations/{loc}/candidates",data={"name":name,"position":pos,"phone":ph,"interviewAt":i,"trialAt":tr},headers=H).json()["candidate"]
        if st: r.put(BASE+f"/api/admin/candidates/{c['id']}",data={"stage":st},headers=H)
        r.post(BASE+f"/api/admin/candidates/{c['id']}/comments",data={"body":"Rozmowa telefoniczna — chętny do pracy w weekendy."},headers=H)
    o.goto(BASE+"/panel/rekrutacja"); o.get_by_role("heading",name="Rekrutacja").wait_for(); o.get_by_text("Marta Lis").wait_for()
    # new candidate with phone formatting
    o.get_by_role("button",name="+ Kandydat").click(); dlg=o.get_by_role("dialog")
    dlg.get_by_label("Imię i nazwisko").fill("Ewa Kot"); dlg.get_by_label("Telefon").press_sequentially("601234567")
    assert dlg.get_by_label("Telefon").input_value()=="+48 601 234 567", dlg.get_by_label("Telefon").input_value()
    dlg.get_by_label("Stanowisko").select_option("host"); pick_date(o,"Rozmowa",d(3),"14:00")
    o.wait_for_timeout(300); dlg.screenshot(path=f"{OUT}/r01-new.png")
    dlg.get_by_role("button",name="Dodaj kandydata").click(); o.wait_for_url(re.compile(r"/panel/rekrutacja/cand_"))
    o.get_by_role("heading",name="Ewa Kot").wait_for(); assert o.locator(".badge",has_text="Rozmowa").count()>=1
    # CV + comment
    # drag a PDF from the desktop onto the CV area
    o.evaluate("""(b64) => { const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'CV Ewa Kot.pdf', { type: 'application/pdf' })); const z = document.querySelector('.rec-cv');
      for (const t of ['dragenter','dragover','drop']) z.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt })); }""", __import__("base64").b64encode(PDF).decode())
    o.locator(".rec-cv iframe").wait_for()
    o.get_by_label("Dodaj komentarz…").fill("Bardzo dobra prezencja, zna polski i angielski."); o.get_by_role("button",name="Dodaj",exact=True).click()
    o.get_by_text("Bardzo dobra prezencja").wait_for(); o.wait_for_timeout(600); o.screenshot(path=f"{OUT}/r02-card.png", full_page=True)
    # stage → hired → account
    o.get_by_role("button",name="Przyjęty",exact=True).click(); o.get_by_role("button",name="Utwórz konto").click()
    dlg=o.get_by_role("dialog"); dlg.get_by_label("Nazwisko").wait_for(); dlg.get_by_role("button",name="Utwórz konto").click()
    o.get_by_text("ewa.kot").first.wait_for(); o.wait_for_timeout(400); o.screenshot(path=f"{OUT}/r03-account.png")
    o.keyboard.press("Escape"); o.wait_for_timeout(400)
    o.get_by_role("link",name=re.compile("Karta pracownika")).wait_for()
    # list
    o.goto(BASE+"/panel/rekrutacja"); o.get_by_text("Marta Lis").wait_for(); o.wait_for_timeout(500); o.screenshot(path=f"{OUT}/r04-list.png", full_page=True)
    assert o.get_by_role("button",name=re.compile("Odrzucony · 1")).count()==1
    o.get_by_label("Szukaj po nazwisku lub telefonie").fill("512 345"); o.wait_for_timeout(200)
    assert o.locator(".rec-row").count()==1, o.locator(".rec-row").count()
    o.get_by_label("Szukaj po nazwisku lub telefonie").fill("")
    # calendar + feed
    o.get_by_role("link",name="Kalendarz").click(); o.get_by_text(re.compile("Rozmowa · Marta Lis")).first.wait_for(); o.wait_for_timeout(400)
    o.screenshot(path=f"{OUT}/r05-calendar.png", full_page=True)
    o.get_by_role("button",name="Subskrybuj w Kalendarzu Google").click(); dlg=o.get_by_role("dialog"); dlg.get_by_role("button",name="Utwórz link").click()
    dlg.locator(".rec-feed-url").wait_for(); o.wait_for_timeout(300); dlg.screenshot(path=f"{OUT}/r06-feed.png")
    # phone
    c=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True); p=c.new_page(); watch(p)
    p.goto(BASE+"/"); p.get_by_label("Login").fill("egor.wlasciciel"); p.get_by_label("PIN lub hasło").fill("NoweHasloEgora2026"); p.get_by_role("button",name="Zaloguj się").click(); p.wait_for_timeout(1200)
    p.goto(BASE+"/panel/rekrutacja"); p.get_by_text("Marta Lis").wait_for(); p.wait_for_timeout(500); p.screenshot(path=f"{OUT}/r07-phone-list.png", full_page=True)
    p.goto(BASE+"/panel/rekrutacja/kalendarz"); p.locator(".rec-agenda .rec-ev").first.wait_for(); p.wait_for_timeout(400); p.screenshot(path=f"{OUT}/r08-phone-cal.png", full_page=True)
    b.close()
print("\n".join(errors) if errors else "NO_ERRORS")
