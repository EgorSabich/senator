"""Reading period for mandatory documents (2026-10-17): Start banner, locked Grafik, Dziś list, Lokale setting.
Needs a fresh server (scripts/ui-server.sh). Prints NO_ERRORS."""
import os, re, subprocess, time
from playwright.sync_api import sync_playwright
BASE=os.environ.get("ACADEMY_URL","http://localhost:8797"); H={"Origin":BASE}; OUT=os.environ.get("SHOTS_DIR","/tmp/academy-shots"); os.makedirs(OUT,exist_ok=True); errors=[]
IGN=("ERR_TUNNEL_CONNECTION_FAILED","status of 401","status of 403")
def watch(p):
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.on("console", lambda m: errors.append(f"console: {m.text}") if m.type=="error" and not any(x in m.text for x in IGN) else None)
def sql(q): subprocess.run(["npx","wrangler","d1","execute","DB","--local","--persist-to",".wrangler/state-ui","--command",q],check=True,capture_output=True)
doc=lambda t: {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":t}]}]}
with sync_playwright() as pw:
    b=pw.chromium.launch()
    o=b.new_context(viewport={"width":1280,"height":900},locale="pl-PL").new_page(); watch(o)
    o.goto(BASE+"/"); o.get_by_label("Login").fill("egor.wlasciciel"); o.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    o.get_by_role("button",name="Zaloguj się").click(); o.get_by_role("heading",name="Ustaw swoje hasło").wait_for()
    o.get_by_label("Nowe hasło").fill("NoweHasloEgora2026"); o.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    o.get_by_role("button",name="Zapisz").click(); o.get_by_role("heading",name="Dziś",exact=True).wait_for()
    r=o.request; loc=r.get(BASE+"/api/admin/locations").json()["locations"][0]["id"]
    ids=[]
    for title in ["Regulamin rozliczeń z gościem","SOP — spotkanie gościa"]:
        i=r.post(BASE+f"/api/admin/locations/{loc}/content",data={"kind":"regulation","title":title},headers=H).json()["id"]
        r.put(BASE+f"/api/admin/content/{i}",data={"body":doc(title+" — treść."),"positions":["waiter"]},headers=H); r.post(BASE+f"/api/admin/content/{i}/publish",data={},headers=H); ids.append(i)
    e=r.post(BASE+f"/api/admin/locations/{loc}/employees",data={"firstName":"Adam","lastName":"Wiśniewski","position":"waiter"},headers=H).json()
    # Lokale setting
    o.goto(BASE+"/panel/lokale"); o.get_by_label("Dni na zapoznanie się z dokumentami obowiązkowymi").wait_for(); o.get_by_label("Dni na zapoznanie się z dokumentami obowiązkowymi").scroll_into_view_if_needed()
    o.wait_for_timeout(300); o.locator(".field",has=o.get_by_label("Dni na zapoznanie się z dokumentami obowiązkowymi")).screenshot(path=f"{OUT}/d01-lokale.png")
    c=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True); p=c.new_page(); watch(p)
    p.goto(BASE+"/"); p.get_by_label("Login").fill(e["login"]); p.get_by_label("PIN lub hasło").fill(e["tempSecret"]); p.get_by_role("button",name="Zaloguj się").click()
    p.get_by_label("Nowy PIN (6 cyfr)").fill("481937"); p.get_by_label("Powtórz").fill("481937"); p.get_by_role("button",name="Zapisz").click(); p.wait_for_timeout(1200)
    p.goto(BASE+"/"); p.get_by_text("na zapoznanie się").wait_for(); p.wait_for_timeout(500); p.screenshot(path=f"{OUT}/d02-start-pending.png", full_page=True)
    back=int(time.time()*1000)-5*86400_000
    sql(f"UPDATE users SET first_login_at = {back} WHERE id = '{e['id']}'")
    sql(f"UPDATE content_versions SET created_at = {back} WHERE content_item_id = '{ids[0]}'")
    p.reload(); p.get_by_text("Termin minął").wait_for(); p.wait_for_timeout(400); p.screenshot(path=f"{OUT}/d03-start-locked.png", full_page=True)
    p.goto(BASE+"/grafik"); p.get_by_text("Grafik jest zablokowany").wait_for(); p.wait_for_timeout(400); p.screenshot(path=f"{OUT}/d04-grafik-locked.png", full_page=True)
    p.goto(BASE+"/grafik/niedostepnosc"); p.get_by_text("Grafik jest zablokowany").wait_for()
    o.goto(BASE+"/panel/dzis"); o.get_by_text("Dokumenty obowiązkowe").wait_for(); o.wait_for_timeout(500); o.screenshot(path=f"{OUT}/d05-dzis.png", full_page=True)
    o.goto(BASE+f"/panel/pracownicy/{e['id']}"); o.locator(".emp-missing").wait_for(); o.wait_for_timeout(500); o.locator(".emp.open").screenshot(path=f"{OUT}/d06-card.png")
    # read the overdue one → unlocked
    p.goto(BASE+"/grafik"); p.get_by_role("link",name="Czytaj dokumenty").click(); p.get_by_text("treść").first.wait_for()
    p.mouse.wheel(0,4000); p.wait_for_timeout(500)
    box=p.get_by_role("checkbox"); 
    if box.count(): box.first.check()
    p.get_by_role("button",name=re.compile("Potwierdzam")).click(); p.wait_for_timeout(800)
    p.goto(BASE+"/grafik"); p.wait_for_timeout(800)
    assert p.get_by_text("Grafik jest zablokowany").count()==0, "still locked after reading"
    b.close()
print("\n".join(errors) if errors else "NO_ERRORS")
