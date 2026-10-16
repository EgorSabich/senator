"""Time clock + daily checklists walkthrough (D35, D36): terminal via panel, PIN pad, offline punch and reload, sync,
waiter checklist marks and close, panel calendar and checklist results, leaving terminal mode.
Needs a fresh server (scripts/ui-server.sh). Prints NO_ERRORS."""
import os, re, time
from playwright.sync_api import sync_playwright
BASE=os.environ.get("ACADEMY_URL", "http://localhost:8797"); H={"Origin":BASE}; OUT=os.environ.get("SHOTS_DIR", "/tmp/academy-shots"); os.makedirs(OUT, exist_ok=True); errors=[]
li=lambda t: {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":t}]}]}
doc={"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"22:00–02:00 — przed zamknięciem"}]},
  {"type":"bulletList","content":[li("Wypoleruj wszystkie czyste naczynia i uzupełnij stacje."),li("Złóż czarne serwetki — minimum 3 organizery."),li("Sprawdź papier w drukarkach i terminalach.")]},
  {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Ostatni obchód"}]},
  {"type":"bulletList","content":[li("Naładuj radiotelefon i telefon służbowy."),li("Zbierz i wynieś wszystkie śmieci.")]}]}
def watch(p): p.on("pageerror", lambda e: errors.append(str(e)))
def slide(p):
    k=p.locator(".t-slider-knob"); k.wait_for(); bb=k.bounding_box(); tr=p.locator(".t-slider").bounding_box()
    x,y=bb["x"]+bb["width"]/2, bb["y"]+bb["height"]/2
    p.mouse.move(x,y); p.mouse.down(); p.mouse.move(tr["x"]+tr["width"]-10, y, steps=12); p.mouse.up()
def keypad(p, pin):
    for d in pin: p.locator(".t-pad button", has_text=re.compile(f"^{d}$")).click()
with sync_playwright() as pw:
    b=pw.chromium.launch(args=["--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"])
    o=b.new_context(viewport={"width":1280,"height":900},locale="pl-PL").new_page(); watch(o)
    o.goto(BASE+"/"); o.get_by_label("Login").fill("egor.wlasciciel"); o.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    o.get_by_role("button", name="Zaloguj się").click(); o.get_by_role("heading", name="Ustaw swoje hasło").wait_for()
    o.get_by_label("Nowe hasło").fill("NoweHasloEgora2026"); o.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    o.get_by_role("button", name="Zapisz").click(); o.get_by_role("heading", name="Dziś", exact=True).wait_for()
    r=o.request; loc=r.get(BASE+"/api/admin/locations").json()["locations"][0]["id"]
    cid=r.post(BASE+f"/api/admin/locations/{loc}/content", data={"kind":"checklist","title":"Lista kontrolna zamknięcia zmiany — kelnerzy"}, headers=H).json()["id"]
    r.put(BASE+f"/api/admin/content/{cid}", data={"body":doc,"positions":["waiter"],"checklistMode":"shared"}, headers=H); r.post(BASE+f"/api/admin/content/{cid}/publish", data={}, headers=H)
    emps=[]
    for fn,ln,pin in [("Zofia","Nowak","481937"),("Adam","Wiśniewski","592048"),("Ola","Kowalska","603159")]:
        e=r.post(BASE+f"/api/admin/locations/{loc}/employees", data={"firstName":fn,"lastName":ln,"position":"waiter"}, headers=H).json(); emps.append((e,pin))
    # terminal via panel UI
    o.goto(BASE+"/panel/czas"); o.get_by_role("heading", name="Czas pracy").wait_for()
    o.get_by_label("Nazwa (np. Telefon sala)").fill("Telefon sala"); o.get_by_role("button", name="Dodaj terminal").click()
    card=o.get_by_role("dialog"); card.wait_for(); o.screenshot(path=f"{OUT}/01-terminal-card.png")
    vals=card.locator(".value").all_inner_texts(); tlogin, tpass = vals[0], vals[1]
    card.get_by_role("button", name="Zamknij").click()
    # employees activate in app (phone)
    phones=[]
    for e,pin in emps:
        c=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True); p=c.new_page(); watch(p)
        p.goto(BASE+"/"); p.get_by_label("Login").fill(e["login"]); p.get_by_label("PIN lub hasło").fill(e["tempSecret"]); p.get_by_role("button", name="Zaloguj się").click()
        p.get_by_label("Nowy PIN (6 cyfr)").fill(pin); p.get_by_label("Powtórz").fill(pin); p.get_by_role("button", name="Zapisz").click()
        p.get_by_role("heading", name=re.compile("Dzień dobry|Dobry wieczór|Dobranoc")).wait_for(); phones.append(p)
    phones[0].wait_for_timeout(800); phones[0].screenshot(path=f"{OUT}/02-start-offshift.png")
    # terminal phone
    tc=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True,permissions=["camera"]); t=tc.new_page(); watch(t)
    t.goto(BASE+"/"); t.get_by_label("Login").fill(tlogin); t.get_by_label("PIN lub hasło").fill(tpass); t.get_by_role("button", name="Zaloguj się").click()
    t.get_by_text("Wpisz swój PIN").wait_for(); t.wait_for_timeout(800); t.screenshot(path=f"{OUT}/03-terminal.png")
    keypad(t,"48"); t.screenshot(path=f"{OUT}/04-terminal-typing.png"); keypad(t,"1937")
    t.get_by_text("Rozpoczynasz zmianę").wait_for(); t.get_by_text("Zofia N.").wait_for(); t.wait_for_timeout(500); t.screenshot(path=f"{OUT}/04b-confirm.png")
    # "To nie ja" cancels, nothing saved
    t.get_by_role("button", name="To nie ja").click(); t.get_by_text("Wpisz swój PIN").wait_for()
    keypad(t,"481937"); t.get_by_text("Rozpoczynasz zmianę").wait_for(); slide(t)
    t.get_by_text("Dzień dobry, Zofia!").wait_for(); t.wait_for_timeout(700); t.screenshot(path=f"{OUT}/05-terminal-in.png")
    t.wait_for_timeout(4800); keypad(t,"111111"); t.get_by_text("Nieznany PIN").wait_for(); t.wait_for_timeout(500); t.screenshot(path=f"{OUT}/06-unknown.png")
    # photo on (Lokale setting), terminal picks it up with the next status
    r.put(BASE+f"/api/admin/locations/{loc}/settings", data={"punchPhoto": True}, headers=H); t.reload(); t.get_by_text("Wpisz swój PIN").wait_for(); t.wait_for_timeout(1500)
    keypad(t,"592048"); t.get_by_text("Adam W.").wait_for(); t.wait_for_timeout(1500); t.screenshot(path=f"{OUT}/05b-confirm-photo.png"); slide(t); t.get_by_text("Dzień dobry, Adam!").wait_for()
    # offline punch
    t.wait_for_timeout(4800); tc.set_offline(True); t.wait_for_timeout(300)
    keypad(t,"603159"); t.get_by_text("Odbicie bez internetu").wait_for(); t.screenshot(path=f"{OUT}/06b-confirm-offline.png"); slide(t); t.get_by_text("Zapisano bez internetu").wait_for(); t.wait_for_timeout(500); t.screenshot(path=f"{OUT}/07-offline.png")
    # reload while offline: terminal must come back
    t.reload(); t.get_by_text("Wpisz swój PIN").wait_for(timeout=15000); t.screenshot(path=f"{OUT}/08-offline-reload.png")
    tc.set_offline(False); t.evaluate("window.dispatchEvent(new Event('online'))")
    t.get_by_text("Do wysłania").wait_for(state="detached", timeout=40000); t.get_by_text("Online").wait_for(timeout=40000); t.screenshot(path=f"{OUT}/09-synced.png")
    # waiter checklist
    z=phones[0]; z.reload(); z.get_by_text("Jesteś na zmianie", exact=False).first.wait_for(); z.wait_for_timeout(800); z.screenshot(path=f"{OUT}/10-start-onshift.png", full_page=True)
    z.locator("a[href^=\"/listy/\"]").first.click(); z.get_by_text("Odhacz zadania").wait_for()
    z.get_by_role("button", name=re.compile("Wypoleruj")).click(); z.wait_for_timeout(500)
    z.get_by_role("button", name=re.compile("Złóż czarne")).click(); z.wait_for_timeout(700)
    a=phones[1]; a.goto(BASE+f"/listy/{cid}"); a.get_by_text("Odhacz zadania").wait_for(); a.get_by_role("button", name=re.compile("Naładuj")).click(); a.wait_for_timeout(700)
    z.reload(); z.get_by_text("Odhacz zadania").wait_for(); z.wait_for_timeout(600); z.screenshot(path=f"{OUT}/11-checklist.png", full_page=True)
    z.once("dialog", lambda d: d.accept()); z.get_by_role("button", name="Zamknij listę na dziś").click(); z.get_by_text("Lista zamknięta").wait_for(); z.screenshot(path=f"{OUT}/12-closed.png")
    # panel
    o.goto(BASE+"/panel/czas"); o.get_by_text("Teraz na zmianie").wait_for(); o.wait_for_timeout(900); o.screenshot(path=f"{OUT}/13-panel-time.png", full_page=True)
    o.locator(".time-grid td.today button.cell").first.click(); o.get_by_role("dialog").wait_for(); o.wait_for_timeout(500); o.screenshot(path=f"{OUT}/14-panel-day.png")
    o.get_by_role("dialog").get_by_label("Wyjście").first.fill("0130"); o.get_by_role("dialog").get_by_role("button", name="Zapisz").first.click(); o.wait_for_timeout(900)
    o.keyboard.press("Escape"); o.wait_for_timeout(300)
    o.locator("tr", has_text="Adam W.").locator("td.today button.cell").first.click(); o.get_by_role("dialog").wait_for(); o.locator(".pcard-photo img").first.wait_for(); o.wait_for_timeout(600)
    assert o.evaluate("[...document.querySelectorAll('.pcard-photo img')].every(i => i.naturalWidth > 0)"), "punch photo not loaded"
    o.screenshot(path=f"{OUT}/14a-punch-cards.png")
    o.locator(".pcard-photo").first.click(); o.locator(".lightbox img").wait_for(); o.wait_for_timeout(450); o.screenshot(path=f"{OUT}/14b-panel-photo.png")
    o.keyboard.press("Escape"); o.wait_for_timeout(400)
    assert o.locator(".lightbox").count()==0 and o.get_by_role("dialog").count()>=1, "Esc closes the photo first, the dialog stays"
    o.keyboard.press("Escape"); o.wait_for_timeout(300)
    # manual shift: typing 4 digits moves on to "Wyjście"
    o.locator(".time-grid td:not(.today) button.cell").first.click(); o.get_by_role("dialog").wait_for()
    o.keyboard.type("1000"); focused=o.evaluate("document.activeElement.id")
    if not focused.endswith("-out"): errors.append("focus did not move to exit: " + focused)
    o.keyboard.type("1830"); o.get_by_role("dialog").get_by_role("button", name="Dodaj zmianę").click(); o.wait_for_timeout(900)
    o.goto(BASE+"/panel/czas"); o.get_by_text("Teraz na zmianie").wait_for(); o.wait_for_timeout(900); o.screenshot(path=f"{OUT}/15-panel-after-edit.png", full_page=True)
    # rate in the employee card (opens under the name)
    zid=emps[0][0]["id"]
    o.goto(BASE+f"/panel/pracownicy/{zid}"); o.get_by_text("Lekcje przeczytane").wait_for(); o.wait_for_timeout(600)
    o.get_by_label("Nowa stawka (zł/h)").fill("32,50"); o.get_by_label("Obowiązuje od").fill("2026-01-01"); o.get_by_role("button", name="Zapisz stawkę").click()
    o.get_by_text("32,50 zł / h").wait_for(); o.wait_for_timeout(500); o.screenshot(path=f"{OUT}/15b-employee-card.png", full_page=True)
    o.goto(BASE+"/panel/czas"); o.get_by_text("Teraz na zmianie").wait_for(); o.wait_for_timeout(900); o.screenshot(path=f"{OUT}/15c-panel-costs.png", full_page=True)
    o.goto(BASE+"/panel/listy"); o.get_by_text("Lista kontrolna zamknięcia").first.wait_for(); o.wait_for_timeout(700); o.screenshot(path=f"{OUT}/16-panel-checklists.png", full_page=True)
    o.get_by_role("tab", name="Statystyka").click(); o.get_by_text("Kto ile zadań").wait_for(); o.wait_for_timeout(700); o.screenshot(path=f"{OUT}/17-panel-stats.png", full_page=True)
    # phone panel
    op=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,storage_state=o.context.storage_state()).new_page(); watch(op)
    op.goto(BASE+"/panel/czas"); op.get_by_text("Teraz na zmianie").wait_for(); op.wait_for_timeout(800); op.screenshot(path=f"{OUT}/18-phone-time.png")
    # exit terminal
    t.locator(".t-exit").click(); t.get_by_label("Hasło terminala").fill("zle"); t.get_by_role("button", name="Wyjdź", exact=True).click(); t.get_by_text("Nieprawidłowe hasło.").wait_for()
    t.get_by_label("Hasło terminala").fill(tpass); t.get_by_role("button", name="Wyjdź", exact=True).click(); t.get_by_role("button", name="Zaloguj się").wait_for(); t.screenshot(path=f"{OUT}/19-exited.png")
    b.close()
print(errors or "NO_ERRORS")
