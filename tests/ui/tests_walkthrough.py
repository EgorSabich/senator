"""Testy before the shift (2026-10-17): import, editor, start for a person, phone locked to the test, result, report.
Needs a fresh server (scripts/ui-server.sh). Prints NO_ERRORS."""
import os, re, json, tempfile
from playwright.sync_api import sync_playwright
BASE=os.environ.get("ACADEMY_URL","http://localhost:8797"); H={"Origin":BASE}; OUT=os.environ.get("SHOTS_DIR","/tmp/academy-shots"); os.makedirs(OUT,exist_ok=True); errors=[]
IGN=("ERR_TUNNEL_CONNECTION_FAILED","status of 401","status of 409")
def watch(p):
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.on("console", lambda m: errors.append(f"console: {m.text}") if m.type=="error" and not any(x in m.text for x in IGN) else None)
    p.on("dialog", lambda d: d.accept())
FILE=os.path.join(tempfile.mkdtemp(),"testy.json")
json.dump({"format":"senator-tests","tests":[{"title":"Menu — przystawki","positions":["waiter"],"timeLimitMin":5,"passScore":60,"shuffle":False,"shuffleOptions":False,"questions":[
  {"text":"Z czym podajemy tatar?","options":[{"text":"Żółtko i grzanki","correct":True},{"text":"Frytki","correct":False},{"text":"Ryż","correct":False}]},
  {"text":"Które przystawki są na zimno?","options":[{"text":"Tatar","correct":True},{"text":"Carpaccio","correct":True},{"text":"Zupa dnia","correct":False}]},
  {"text":"Ile minut kuchnia potrzebuje na krewetki?","options":[{"text":"8","correct":True},{"text":"25","correct":False}]}]}]}, open(FILE,"w"), ensure_ascii=False)
with sync_playwright() as pw:
    b=pw.chromium.launch()
    o=b.new_context(viewport={"width":1280,"height":900},locale="pl-PL").new_page(); watch(o)
    o.goto(BASE+"/"); o.get_by_label("Login").fill("egor.wlasciciel"); o.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    o.get_by_role("button",name="Zaloguj się").click(); o.get_by_role("heading",name="Ustaw swoje hasło").wait_for()
    o.get_by_label("Nowe hasło").fill("NoweHasloEgora2026"); o.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    o.get_by_role("button",name="Zapisz").click(); o.get_by_role("heading",name="Dziś",exact=True).wait_for()
    r=o.request; loc=r.get(BASE+"/api/admin/locations").json()["locations"][0]["id"]
    zofia=r.post(BASE+f"/api/admin/locations/{loc}/employees",data={"firstName":"Zofia","lastName":"Nowak","position":"waiter"},headers=H).json()
    # phone: Zofia signs in first
    c=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True); p=c.new_page(); watch(p)
    p.goto(BASE+"/"); p.get_by_label("Login").fill(zofia["login"]); p.get_by_label("PIN lub hasło").fill(zofia["tempSecret"]); p.get_by_role("button",name="Zaloguj się").click()
    p.get_by_label("Nowy PIN (6 cyfr)").fill("481937"); p.get_by_label("Powtórz").fill("481937"); p.get_by_role("button",name="Zapisz").click(); p.wait_for_timeout(1500)
    # import
    o.goto(BASE+"/panel/testy"); o.get_by_text("Nie ma jeszcze testów").wait_for(); o.screenshot(path=f"{OUT}/t01-empty.png")
    o.get_by_role("button",name="Import (JSON)").click(); dlg=o.get_by_role("dialog")
    dlg.locator('input[type="file"]').set_input_files(FILE); dlg.get_by_text("3 pytania").wait_for(); o.screenshot(path=f"{OUT}/t02-import.png")
    dlg.get_by_role("button",name="Importuj (1)").click(); o.get_by_text("Menu — przystawki").wait_for(); o.wait_for_timeout(300); o.screenshot(path=f"{OUT}/t03-list.png")
    # editor: add a question by hand
    o.get_by_text("Menu — przystawki").click(); o.get_by_role("heading",name="Pytania (3)").wait_for()
    o.get_by_role("button",name="+ Pytanie").click(); dlg=o.get_by_role("dialog")
    dlg.get_by_label("Treść pytania").fill("Jak podajemy pieczywo?"); dlg.get_by_label("Odpowiedź 1",exact=True).fill("Ciepłe, z masłem"); dlg.get_by_label("Odpowiedź 2",exact=True).fill("Zimne")
    dlg.get_by_label("Odpowiedź 3",exact=True).fill("Nie podajemy"); o.screenshot(path=f"{OUT}/t04-question.png")
    dlg.get_by_role("button",name="Zapisz pytanie").click(); o.get_by_role("heading",name="Pytania (4)").wait_for()
    o.get_by_label("Próg zaliczenia").select_option("75"); o.get_by_role("button",name="Zapisz",exact=True).click(); o.get_by_text("Zapisano.").wait_for()
    o.wait_for_timeout(300); o.screenshot(path=f"{OUT}/t05-editor.png", full_page=True)
    tid=o.url.rsplit("/",1)[1]; assert r.get(BASE+f"/api/admin/tests/{tid}").json()["test"]["passScore"]==75
    # start for Zofia
    o.get_by_role("button",name="Uruchom",exact=True).click(); dlg=o.get_by_role("dialog")
    dlg.get_by_text("Pokaż pozostałych").or_(dlg.get_by_role("button",name=re.compile("Zofia"))).first.wait_for()
    if dlg.get_by_role("button",name=re.compile("Pokaż pozostałych")).count(): dlg.get_by_role("button",name=re.compile("Pokaż pozostałych")).click()
    z=dlg.get_by_role("button",name=re.compile("Zofia Nowak"))
    if z.get_attribute("aria-pressed")!="true": z.click()
    o.screenshot(path=f"{OUT}/t06-start.png")
    dlg.get_by_role("button",name="Uruchom dla 1 os.").click(); o.wait_for_url(re.compile("/panel/testy/wyniki/")); o.get_by_text("jeszcze nie otworzył").wait_for()
    # phone: locked to the test
    p.reload(); p.get_by_text("Test od kierownika").wait_for(); assert p.locator("nav").count()==0 or not p.locator("nav").first.is_visible()
    p.screenshot(path=f"{OUT}/t07-phone-intro.png")
    p.get_by_role("button",name="Zaczynam").click(); p.get_by_text("Pytanie 1 z 4").wait_for(); p.wait_for_timeout(700); p.screenshot(path=f"{OUT}/t08-phone-q1.png")
    p.get_by_role("radio",name="Żółtko i grzanki").click(); p.get_by_role("button",name="Dalej").click()
    p.get_by_role("checkbox",name="Tatar").click(); p.wait_for_timeout(200); p.screenshot(path=f"{OUT}/t09-phone-multi.png"); p.get_by_role("button",name="Dalej").click()
    p.get_by_role("radio",name="25").click(); p.get_by_role("button",name="Dalej").click()
    # live view shows progress
    o.wait_for_timeout(4500); o.get_by_text("3 / 4").wait_for(); o.screenshot(path=f"{OUT}/t10-live.png")
    p.get_by_role("radio",name="Ciepłe, z masłem").click(); p.get_by_role("button",name="Zakończ test").click()
    p.get_by_text("50%").first.wait_for(); p.get_by_text("Twoje błędy").wait_for(); p.wait_for_timeout(400); p.screenshot(path=f"{OUT}/t11-phone-result.png", full_page=True)
    p.get_by_role("button",name="Na Start").click(); p.wait_for_timeout(1200); assert p.get_by_text("Test od kierownika").count()==0
    # report
    o.reload(); o.get_by_text("Najtrudniejsze pytanie").wait_for(); assert o.get_by_role("button",name="Zakończ dla wszystkich").count()==0; o.get_by_role("button",name=re.compile("Zofia Nowak")).click(); o.get_by_text("→ Tatar, Carpaccio").wait_for()
    o.wait_for_timeout(300); o.screenshot(path=f"{OUT}/t12-report.png", full_page=True)
    rep=r.get(BASE+f"/api/admin/test-sessions/{o.url.rsplit('/',1)[1]}").json(); assert rep["totals"]["avgScore"]==50 and rep["totals"]["passed"]==0, rep["totals"]
    o.goto(BASE+"/panel/testy/wyniki"); o.get_by_text("1 / 1").wait_for(); o.screenshot(path=f"{OUT}/t13-results.png")
    # phone width admin
    m=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",storage_state=o.context.storage_state()).new_page(); watch(m)
    m.goto(BASE+f"/panel/testy/{tid}"); m.get_by_role("heading",name="Pytania (4)").wait_for(); m.wait_for_timeout(300)
    assert m.evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"); m.screenshot(path=f"{OUT}/t14-editor-phone.png", full_page=True)
    b.close()
print("\n".join(errors) if errors else "NO_ERRORS")
