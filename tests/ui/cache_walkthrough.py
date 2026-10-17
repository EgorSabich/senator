"""Instant start (2026-10-17): the staff app opens from what is saved on the phone — even with no network at all —
then refreshes; logout removes the saved data. Needs a fresh server. Prints NO_ERRORS."""
import os, time
from playwright.sync_api import sync_playwright
BASE=os.environ.get("ACADEMY_URL","http://localhost:8797"); H={"Origin":BASE}; OUT=os.environ.get("SHOTS_DIR","/tmp/academy-shots"); os.makedirs(OUT,exist_ok=True); errors=[]
IGN=("ERR_TUNNEL_CONNECTION_FAILED","status of 401","status of 403","ERR_FAILED","ERR_INTERNET_DISCONNECTED","Failed to fetch")
def watch(p):
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.on("console", lambda m: errors.append(f"console: {m.text}") if m.type=="error" and not any(x in m.text for x in IGN) else None)
with sync_playwright() as pw:
    b=pw.chromium.launch()
    o=b.new_context(viewport={"width":1280,"height":900},locale="pl-PL").new_page(); watch(o)
    o.goto(BASE+"/"); o.get_by_label("Login").fill("egor.wlasciciel"); o.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    o.get_by_role("button",name="Zaloguj się").click(); o.get_by_role("heading",name="Ustaw swoje hasło").wait_for()
    o.get_by_label("Nowe hasło").fill("NoweHasloEgora2026"); o.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    o.get_by_role("button",name="Zapisz").click(); o.get_by_role("heading",name="Dziś",exact=True).wait_for()
    r=o.request; loc=r.get(BASE+"/api/admin/locations").json()["locations"][0]["id"]
    e=r.post(BASE+f"/api/admin/locations/{loc}/employees",data={"firstName":"Zofia","lastName":"Nowak","position":"waiter"},headers=H).json()
    doc=r.post(BASE+f"/api/admin/locations/{loc}/content",data={"kind":"regulation","title":"Standard powitania"},headers=H).json()["id"]
    r.put(BASE+f"/api/admin/content/{doc}",data={"body":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Witamy gościa w ciągu 10 sekund."}]}]},"positions":["waiter"]},headers=H)
    r.post(BASE+f"/api/admin/content/{doc}/publish",data={},headers=H)
    c=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True); p=c.new_page(); watch(p)
    c.add_init_script("Object.defineProperty(Notification, 'permission', { get: () => 'granted' })")
    p.goto(BASE+"/"); p.get_by_label("Login").fill(e["login"]); p.get_by_label("PIN lub hasło").fill(e["tempSecret"]); p.get_by_role("button",name="Zaloguj się").click()
    p.get_by_label("Nowy PIN (6 cyfr)").fill("481937"); p.get_by_label("Powtórz").fill("481937"); p.get_by_role("button",name="Zapisz").click()
    p.get_by_text("Standard powitania").first.wait_for()
    p.wait_for_timeout(4000)  # idle warm-up of the other tabs and documents
    # 1) reopen with the network down for the API: content is there from the phone
    c.route("**/api/**", lambda route: route.abort())
    t0=time.time(); p.reload(); p.get_by_text("Standard powitania").first.wait_for(timeout=5000); first=time.time()-t0
    assert p.locator(".logo-loader").count()==0 or not p.locator(".logo-loader").first.is_visible()
    p.goto(BASE+f"/m/{doc}"); p.get_by_text("Witamy gościa w ciągu 10 sekund.").wait_for(timeout=5000)
    p.screenshot(path=f"{OUT}/c01-offline-doc.png")
    p.goto(BASE+"/menu"); p.wait_for_timeout(500)
    c.unroute("**/api/**")
    print("reopen to content (s):", round(first,2))
    # 2) after reading the last document: „Na Start”
    p.goto(BASE+f"/m/{doc}"); p.get_by_text("Witamy gościa w ciągu 10 sekund.").wait_for()
    p.mouse.wheel(0,3000); p.wait_for_timeout(600)
    p.locator(".a-check input").check(); p.get_by_role("button",name="Potwierdzam").click()
    p.get_by_role("button",name="Na Start").click(); p.wait_for_url(BASE+"/")
    p.screenshot(path=f"{OUT}/c02-start.png")
    # 3) logout removes what was saved
    p.goto(BASE+"/konto"); p.get_by_role("button",name="Wyloguj").click(); p.get_by_label("Login").wait_for()
    left=p.evaluate("""() => new Promise(r => { const q = indexedDB.open('sa-cache', 1); q.onsuccess = () => { const g = q.result.transaction('answers').objectStore('answers').get('snapshot'); g.onsuccess = () => r(g.result ? g.result.entries.length : 0); }; q.onerror = () => r(-1); })""")
    assert left==0, left
    b.close()
print("\n".join(errors) if errors else "NO_ERRORS")
