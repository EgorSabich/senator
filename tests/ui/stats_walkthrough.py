"""Statystyki (2026-10-17): attendance with person days and „Usprawiedliw”, recruitment funnel and sources,
candidate card fields (source, no-show, rejection reason); desktop and phone. Needs a fresh server. Prints NO_ERRORS."""
import os, datetime
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright
BASE=os.environ.get("ACADEMY_URL","http://localhost:8797"); H={"Origin":BASE}; OUT=os.environ.get("SHOTS_DIR","/tmp/academy-shots"); os.makedirs(OUT,exist_ok=True); errors=[]
IGN=("ERR_TUNNEL_CONNECTION_FAILED","status of 401","status of 403")
WAW=ZoneInfo("Europe/Warsaw")
def watch(p):
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.on("console", lambda m: errors.append(f"console: {m.text}") if m.type=="error" and not any(x in m.text for x in IGN) else None)
def ms(d,hm): h,m=map(int,hm.split(":")); return int(datetime.datetime(d.year,d.month,d.day,h,m,tzinfo=WAW).timestamp()*1000)
with sync_playwright() as pw:
    b=pw.chromium.launch()
    o=b.new_context(viewport={"width":1280,"height":900},locale="pl-PL",accept_downloads=True).new_page(); watch(o)
    o.goto(BASE+"/"); o.get_by_label("Login").fill("egor.wlasciciel"); o.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    o.get_by_role("button",name="Zaloguj się").click(); o.get_by_role("heading",name="Ustaw swoje hasło").wait_for()
    o.get_by_label("Nowe hasło").fill("NoweHasloEgora2026"); o.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    o.get_by_role("button",name="Zapisz").click(); o.get_by_role("heading",name="Dziś",exact=True).wait_for()
    r=o.request; loc=r.get(BASE+"/api/admin/locations").json()["locations"][0]["id"]
    today=datetime.datetime.now(WAW).date()
    ppl={}
    for first,last,pos in [("Marek","Zieliński","waiter"),("Anna","Kowalska","host"),("Piotr","Lis","bartender"),("Ola","Nowak","waiter"),("Kamil","Garnek","kitchen")]:
        ppl[first]=r.post(BASE+f"/api/admin/locations/{loc}/employees",data={"firstName":first,"lastName":last,"position":pos,"rate":str(26+len(first)),"startDate":"2026-01-01"},headers=H).json()["id"]
    # 3 past weeks of shifts, with some lateness and absences
    import random; random.seed(4)
    start=today-datetime.timedelta(days=today.weekday()+21)
    for i in range(28):
        d=start+datetime.timedelta(days=i)
        if d>=today: break
        for who in ppl:
            if random.random()<0.35: continue
            st,en=("10:00","18:00") if who=="Kamil" else ("16:00","23:00")
            r.post(BASE+f"/api/admin/locations/{loc}/schedule/shifts",data={"userId":ppl[who],"date":str(d),"start":st,"end":en},headers=H)
            x=random.random()
            if x<0.08: continue  # absence
            late=random.choice([0,0,0,2,6,12,25]) if x<0.6 else random.choice([0,1,3])
            h,m=map(int,st.split(":")); tin=f"{h+(m+late)//60:02d}:{(m+late)%60:02d}"
            r.post(BASE+f"/api/admin/locations/{loc}/time/entries",data={"userId":ppl[who],"clockInAt":ms(d,tin),"clockOutAt":None if random.random()<0.05 else ms(d,en)},headers=H)
    for k in range(4): r.post(BASE+f"/api/admin/locations/{loc}/schedule/publish",data={"week":str(start+datetime.timedelta(days=7*k)),"notify":False},headers=H)
    # candidates
    C=BASE+f"/api/admin/locations/{loc}/candidates"
    cands=[("Jan Kos","waiter","pracuj","hired"),("Ewa Wrona","waiter","olx","rejected:experience"),("Igor Sowa","kitchen","referral","trial"),("Lena Mak","host","instagram","interview"),
           ("Rafał Bąk","waiter","pracuj","rejected:no_show"),("Zosia Lin","bartender",None,"new"),("Tomasz Ryś","kitchen","pracuj","rejected:availability"),("Nina Wilk","waiter","referral","hired")]
    first_id=None
    for n,pos,src,st in cands:
        cid=r.post(C,data={"name":n,"position":pos,"source":src},headers=H).json()["candidate"]["id"]; first_id=first_id or cid
        if st!="new": r.put(BASE+f"/api/admin/candidates/{cid}",data={"interviewAt":f"{today+datetime.timedelta(days=2)}T12:00"},headers=H)
        if st in("trial","hired"): r.put(BASE+f"/api/admin/candidates/{cid}",data={"trialAt":f"{today+datetime.timedelta(days=4)}T16:00"},headers=H)
        if st=="hired": r.put(BASE+f"/api/admin/candidates/{cid}",data={"stage":"hired"},headers=H)
        if st.startswith("rejected"): r.put(BASE+f"/api/admin/candidates/{cid}",data={"stage":"rejected","rejectReason":st.split(":")[1],"noShowInterview":st.endswith("no_show")},headers=H)
    # attendance
    o.goto(BASE+"/panel/statystyki"); o.get_by_role("heading",name="Statystyki").wait_for()
    o.get_by_role("button",name="Kwartał").click(); o.locator(".st-kpi").first.wait_for(); o.wait_for_timeout(800)
    o.screenshot(path=f"{OUT}/s00-collapsed.png",full_page=True)
    # folding blocks: open the chart and the people table (remembered)
    o.locator(".disc-head",has_text="Tydzień po tygodniu").click(); o.locator(".disc-head",has_text="Pracownicy").click(); o.wait_for_timeout(400)
    o.screenshot(path=f"{OUT}/s01-attendance.png",full_page=True)
    o.get_by_role("button",name="Miesiąc").click(); o.wait_for_timeout(600)
    o.get_by_role("button",name="Poprzedni okres").click(); o.wait_for_timeout(600)
    o.get_by_role("button",name="Następny okres").click(); o.wait_for_timeout(600)
    with o.expect_download() as dl: o.get_by_role("button",name="Eksport CSV").click()
    path=dl.value.path(); txt=open(path,encoding="utf-8-sig").read(); assert txt.startswith("Pracownik;Dział;"), txt[:60]
    o.get_by_role("button",name="Tydzień",exact=True).click(); o.wait_for_timeout(500)
    o.get_by_role("button",name="Kwartał").click(); o.wait_for_timeout(700)
    o.locator(".st-row").first.click(); dlg=o.get_by_role("dialog"); dlg.locator(".st-day").first.wait_for(); o.wait_for_timeout(300)
    btn=dlg.get_by_role("button",name="Usprawiedliw")
    if btn.count():
        btn.first.click(); dlg.get_by_role("button",name="zamiana").click(); dlg.get_by_label("Notatka (opcjonalnie)").fill("zamiana z Olą")
        dlg.screenshot(path=f"{OUT}/s02-person-excuse.png")
        dlg.get_by_role("button",name="Zapisz").click(); dlg.get_by_text("zamiana — zamiana z Olą").wait_for()
        dlg.get_by_role("button",name="Cofnij").first.wait_for()
    dlg.screenshot(path=f"{OUT}/s03-person.png")
    o.keyboard.press("Escape"); o.wait_for_timeout(300)
    # time and cost, checklists, training (mockups 14–16)
    o.get_by_role("link",name="Czas pracy i koszt").click(); o.locator(".disc-head",has_text="Działy").click(); o.wait_for_timeout(500)
    o.screenshot(path=f"{OUT}/s08-cost.png",full_page=True)
    o.get_by_role("link",name="Listy kontrolne").last.click(); o.locator(".st-kpi").first.wait_for(); o.wait_for_timeout(500)
    o.screenshot(path=f"{OUT}/s09-lists.png",full_page=True)
    o.get_by_role("link",name="Szkolenia i dokumenty").click(); o.locator(".disc-head",has_text="Testy").click(); o.wait_for_timeout(500)
    o.screenshot(path=f"{OUT}/s10-training.png",full_page=True)
    # recruitment
    o.get_by_role("link",name="Rekrutacja").last.click(); o.locator(".disc-head",has_text="Lejek").click(); o.locator(".disc-head",has_text="Skąd przychodzą").click(); o.wait_for_timeout(500)
    o.screenshot(path=f"{OUT}/s04-recruitment.png",full_page=True)
    # candidate card
    o.goto(BASE+f"/panel/rekrutacja/{first_id}"); o.get_by_label("Źródło").wait_for(); o.wait_for_timeout(400)
    assert o.get_by_label("Źródło").input_value()=="pracuj"
    o.screenshot(path=f"{OUT}/s05-card.png",full_page=True)
    # phone
    pctx=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True)
    pctx.add_cookies(o.context.cookies()); p=pctx.new_page(); watch(p)
    p.goto(BASE+"/panel/statystyki"); p.locator(".st-kpi").first.wait_for(); p.wait_for_timeout(800)
    p.screenshot(path=f"{OUT}/s06-phone.png",full_page=True)
    p.goto(BASE+"/panel/statystyki/rekrutacja"); p.locator(".disc-head",has_text="Lejek").wait_for(); p.wait_for_timeout(500)
    p.screenshot(path=f"{OUT}/s07-phone-rec.png",full_page=True)
    b.close()
print("\n".join(errors) if errors else "NO_ERRORS")
