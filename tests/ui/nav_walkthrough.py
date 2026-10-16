"""Step 1 (D39): back navigation keeps scroll + filters in Menu, Wiedza → Lekcje, lesson picker in programs (drafts too),
collapsible "Do zrobienia", phone tabbar with "Więcej". Needs a fresh server (scripts/ui-server.sh) and MENU_BUNDLE. Prints NO_ERRORS."""
import os, re, json
from playwright.sync_api import sync_playwright
BASE=os.environ.get("ACADEMY_URL","http://localhost:8797"); H={"Origin":BASE}; OUT=os.environ.get("SHOTS_DIR","/tmp/academy-shots"); os.makedirs(OUT,exist_ok=True)
BUNDLE=os.environ["MENU_BUNDLE"]; errors=[]
IGN=("ERR_TUNNEL_CONNECTION_FAILED","status of 401")
def watch(p):
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.on("console", lambda m: errors.append(f"console: {m.text}") if m.type=="error" and not any(x in m.text for x in IGN) else None)
para=lambda *ts: {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":t}]} for t in ts]}
with sync_playwright() as pw:
    b=pw.chromium.launch()
    o=b.new_context(viewport={"width":1280,"height":900},locale="pl-PL").new_page(); watch(o)
    o.goto(BASE+"/"); o.get_by_label("Login").fill("egor.wlasciciel"); o.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    o.get_by_role("button",name="Zaloguj się").click(); o.get_by_role("heading",name="Ustaw swoje hasło").wait_for()
    o.get_by_label("Obecne hasło").fill("TymczasoweHaslo1"); o.get_by_label("Nowe hasło").fill("NoweHasloEgora2026"); o.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    o.get_by_role("button",name="Zapisz").click(); o.get_by_role("heading",name="Pracownicy").wait_for()
    r=o.request; loc=r.get(BASE+"/api/admin/locations").json()["locations"][0]["id"]
    # menu import via panel
    o.get_by_role("link",name="Menu").first.click(); o.get_by_role("heading",name="Menu").wait_for()
    o.get_by_role("button",name="Import z pliku").click(); o.locator('input[type="file"]').set_input_files(BUNDLE)
    o.get_by_text("W pliku: kuchnia").wait_for(); o.get_by_role("dialog").get_by_role("button",name="Importuj").click(); o.get_by_text("Dodano ").wait_for(timeout=120000)
    # lessons: one published, one draft; a doc to acknowledge
    def mk(kind,title,body,publish=True,ack=False):
        cid=r.post(BASE+f"/api/admin/locations/{loc}/content",data={"kind":kind,"title":title},headers=H).json()["id"]
        r.put(BASE+f"/api/admin/content/{cid}",data={"body":body,"positions":["waiter"]},headers=H)
        if publish: r.post(BASE+f"/api/admin/content/{cid}/publish",data={},headers=H)
        return cid
    mk("lesson","Powitanie gościa",para("Witamy gościa w ciągu 30 sekund.","Uśmiech i kontakt wzrokowy."))
    mk("lesson","Wino do dań z grilla",para("Polecamy czerwone wytrawne."),publish=False)
    mk("regulation","Regulamin pracy",para("Zasady pracy w Senatorze."))
    prg=r.post(BASE+f"/api/admin/locations/{loc}/programs",data={"name":"Kelner — start","position":"waiter"},headers=H).json()["id"]
    r.post(BASE+f"/api/admin/programs/{prg}/modules",data={"title":"Pierwszy dzień"},headers=H)
    # picker
    o.goto(BASE+f"/panel/programy/{prg}"); o.get_by_role("region",name="Pierwszy dzień").wait_for(); o.wait_for_timeout(600)
    o.get_by_placeholder("Szukaj po tytule…").first.fill("wino"); o.wait_for_timeout(300)
    o.screenshot(path=f"{OUT}/n01-picker.png", full_page=True)
    row=o.locator(".picker-row", has_text="Wino do dań z grilla"); assert row.count()==1, "draft lesson must be pickable"
    assert row.get_by_text("szkic").count()==1
    row.click(); o.wait_for_timeout(800); o.screenshot(path=f"{OUT}/n02-picker-added.png", full_page=True)
    mods=r.get(BASE+f"/api/admin/programs/{prg}").json()
    assert "Wino do dań z grilla" in json.dumps(mods, ensure_ascii=False), "lesson not in module"
    # employee
    e=r.post(BASE+f"/api/admin/locations/{loc}/employees",data={"firstName":"Zofia","lastName":"Nowak","position":"waiter"},headers=H).json()
    c=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True); p=c.new_page(); watch(p)
    p.goto(BASE+"/"); p.get_by_label("Login").fill(e["login"]); p.get_by_label("PIN lub hasło").fill(e["tempSecret"]); p.get_by_role("button",name="Zaloguj się").click()
    p.get_by_label("Obecny PIN").fill(e["tempSecret"]); p.get_by_label("Nowy PIN (6 cyfr)").fill("481937"); p.get_by_label("Powtórz").fill("481937"); p.get_by_role("button",name="Zapisz").click()
    p.get_by_role("heading",name=re.compile("Dzień dobry")).wait_for(); p.wait_for_timeout(800)
    fold=p.locator(".a-module", has_text="Do zrobienia")
    assert fold.count()>=1, "todo fold missing"; assert fold.first.get_by_role("button").first.get_attribute("aria-expanded")=="false"
    p.screenshot(path=f"{OUT}/n03-start-fold-closed.png", full_page=True)
    fold.first.get_by_role("button").first.click(); p.wait_for_timeout(500); p.screenshot(path=f"{OUT}/n04-start-fold-open.png", full_page=True)
    # menu: scroll, open dish, back
    p.locator('a[href="/menu"]').first.click(); p.wait_for_timeout(1200)
    p.mouse.wheel(0,1800); p.wait_for_timeout(600); y0=p.evaluate("scrollY")
    p.screenshot(path=f"{OUT}/n05-menu-scrolled.png")
    links=p.locator('a[href^="/menu/"]'); vis=None
    for i in range(links.count()):
        bb=links.nth(i).bounding_box()
        if bb and 120<bb["y"]<600: vis=links.nth(i); break
    assert vis, "no dish visible"; vis.click(); p.wait_for_timeout(900); p.screenshot(path=f"{OUT}/n06-dish.png")
    p.get_by_role("button",name=re.compile("^(Wstecz|Wróć)$")).first.click(); p.wait_for_timeout(1200); y1=p.evaluate("scrollY")
    p.screenshot(path=f"{OUT}/n07-menu-back.png"); print("scroll before/after:",y0,y1, p.url)
    assert p.url.endswith("/menu") and abs(y1-y0)<60, f"scroll lost {y0}->{y1}"
    # search filter kept after back
    p.get_by_role("searchbox").first.fill("zupa") if p.get_by_role("searchbox").count() else None
    p.wait_for_timeout(500)
    if p.get_by_role("searchbox").count():
        p.locator('a[href^="/menu/"]').first.click(); p.wait_for_timeout(700); p.get_by_role("button",name=re.compile("^(Wstecz|Wróć)$")).first.click(); p.wait_for_timeout(800)
        assert p.get_by_role("searchbox").first.input_value()=="zupa", "query lost"
    # browser back too
    p.locator('a[href^="/menu/"]').first.click(); p.wait_for_timeout(700); p.go_back(); p.wait_for_timeout(800); assert p.url.endswith("/menu")
    # Wiedza -> Lekcje
    p.goto(BASE+"/wiedza/lekcje"); p.get_by_text("Powitanie gościa").first.wait_for(); p.wait_for_timeout(500)
    p.screenshot(path=f"{OUT}/n08-wiedza-lekcje.png", full_page=True)
    p.get_by_text("Powitanie gościa").first.click(); p.wait_for_timeout(900); p.get_by_role("button",name=re.compile("^(Wstecz|Wróć)$")).first.click(); p.wait_for_timeout(800)
    assert "/wiedza/lekcje" in p.url, p.url
    # panel phone tabbar
    mc=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True,storage_state=o.context.storage_state()); m=mc.new_page(); watch(m)
    m.goto(BASE+"/panel/pracownicy"); m.get_by_role("heading",name="Pracownicy").wait_for(); m.wait_for_timeout(600)
    m.screenshot(path=f"{OUT}/n09-panel-phone.png")
    m.get_by_role("link",name="Więcej").last.click(); m.wait_for_timeout(700); m.screenshot(path=f"{OUT}/n10-more.png", full_page=True)
    m.get_by_role("link",name="Programy").first.click(); m.wait_for_timeout(700); assert "/panel/programy" in m.url
    o.goto(BASE+"/panel/czas"); o.wait_for_timeout(900); o.screenshot(path=f"{OUT}/n11-rail.png")
    b.close()
print("\n".join(errors) if errors else "NO_ERRORS")
