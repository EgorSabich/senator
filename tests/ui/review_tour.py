"""Display review (2026-10-18): seeds a realistic restaurant, then screenshots every panel and staff screen at phone and
desktop width and checks for horizontal overflow and elements sticking out of the screen.
Needs a fresh server, MENU_BUNDLE and CONTENT_BUNDLE (never committed). Optional TESTS_BUNDLE.
Prints a list of layout problems, then NO_ERRORS / errors."""
import os, re, json, datetime, random
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright
BASE=os.environ.get("ACADEMY_URL","http://localhost:8797"); H={"Origin":BASE}; OUT=os.environ.get("SHOTS_DIR","/tmp/academy-shots"); os.makedirs(OUT,exist_ok=True)
errors=[]; problems=[]
IGN=("ERR_TUNNEL_CONNECTION_FAILED","status of 401","status of 403","status of 409","fonts.g")
WAW=ZoneInfo("Europe/Warsaw")
def watch(p, tag):
    p.on("pageerror", lambda e: errors.append(f"{tag} pageerror: {e}"))
    p.on("console", lambda m: errors.append(f"{tag} console: {m.text}") if m.type=="error" and not any(x in m.text for x in IGN) else None)
    p.on("dialog", lambda d: d.dismiss())
def ms(d,hm): h,m=map(int,hm.split(":")); return int(datetime.datetime(d.year,d.month,d.day,h,m,tzinfo=WAW).timestamp()*1000)

CHECK = """() => {
  const vw = window.innerWidth, out = [];
  if (document.documentElement.scrollWidth > vw + 1) out.push('page scrolls sideways: ' + document.documentElement.scrollWidth + ' > ' + vw);
  const scrollers = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth) return true; } return false; };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.position === 'fixed') continue;
    if ((r.right > vw + 1 || r.left < -1) && !scrollers(el)) { out.push('sticks out: ' + el.tagName.toLowerCase() + '.' + [...el.classList].join('.') + ' "' + (el.textContent||'').trim().slice(0,40) + '" ' + Math.round(r.left) + '..' + Math.round(r.right)); }
    // text cut inside a box that is not meant to scroll or ellipsize
    if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 2 && s.overflow === 'hidden' && s.textOverflow !== 'ellipsis' && el.tagName !== 'SELECT' && el.tagName !== 'INPUT') out.push('text cut: ' + el.tagName.toLowerCase() + '.' + [...el.classList].join('.') + ' "' + el.textContent.trim().slice(0,40) + '"');
  }
  return [...new Set(out)].slice(0, 12);
}"""

def shoot(p, name, full=True):
    p.wait_for_timeout(700)
    for x in p.evaluate(CHECK): problems.append(f"{name}: {x}")
    p.screenshot(path=f"{OUT}/{name}.png", full_page=full)

with sync_playwright() as pw:
    b=pw.chromium.launch()
    oc=b.new_context(viewport={"width":1280,"height":900},locale="pl-PL"); o=oc.new_page(); watch(o,"owner")
    o.goto(BASE+"/"); o.get_by_label("Login").fill("egor.wlasciciel"); o.get_by_label("PIN lub hasło").fill("TymczasoweHaslo1")
    o.get_by_role("button",name="Zaloguj się").click(); o.get_by_role("heading",name="Ustaw swoje hasło").wait_for()
    o.get_by_label("Nowe hasło").fill("NoweHasloEgora2026"); o.get_by_label("Powtórz").fill("NoweHasloEgora2026")
    o.get_by_role("button",name="Zapisz").click(); o.get_by_role("heading",name="Dziś",exact=True).wait_for()
    r=o.request; loc=r.get(BASE+"/api/admin/locations").json()["locations"][0]["id"]
    # menu and materials through the import screens
    o.goto(BASE+"/panel/menu"); o.get_by_role("button",name="Import z pliku").click()
    o.locator('input[type="file"]').set_input_files(os.environ["MENU_BUNDLE"]); o.get_by_text("W pliku: kuchnia").wait_for()
    o.get_by_role("dialog").get_by_role("button",name="Importuj").click(); o.get_by_text("Dodano ").wait_for(timeout=180000)
    o.get_by_role("dialog").get_by_role("button",name="Zamknij").click()
    o.goto(BASE+"/panel/materialy"); o.get_by_role("button",name="Import materiałów").click()
    o.locator('input[type="file"]').set_input_files(os.environ["CONTENT_BUNDLE"]); o.get_by_role("button",name="Importuj do szkiców").click()
    o.get_by_text(re.compile(r"Dodano \d+ szkiców")).wait_for(timeout=240000); o.get_by_role("button",name="Zamknij").click()
    ids=[]
    for kind in ["lesson","service_book","regulation","sop","checklist"]:
        for it in r.get(BASE+f"/api/admin/locations/{loc}/content?kind={kind}").json().get("items",[]):
            if it.get("status")=="draft": ids.append(it["id"])
    for i in range(0,len(ids),20): r.post(BASE+f"/api/admin/locations/{loc}/content/import/publish",data={"ids":ids[i:i+20]},headers=H)
    if os.environ.get("TESTS_BUNDLE"):
        r.post(BASE+f"/api/admin/locations/{loc}/tests/import",data=json.load(open(os.environ["TESTS_BUNDLE"])),headers=H)
    # people
    today=datetime.datetime.now(WAW).date(); random.seed(7); ppl={}
    staff=[("Zofia","Nowak","waiter"),("Marek","Zieliński","waiter"),("Ola","Wiśniewska","waiter_assistant"),("Anna","Kowalska","host"),("Piotr","Lis","bartender"),
           ("Igor","Sowa","bartender_assistant"),("Kamil","Garnek","kitchen_hot"),("Ewa","Mak","kitchen_cold"),("Jan","Kos","kitchen_sushi"),("Lena","Wilk","hookah_master"),("Rafał","Bąk","call_center")]
    for f,l,pos in staff:
        ppl[f]=r.post(BASE+f"/api/admin/locations/{loc}/employees",data={"firstName":f,"lastName":l,"position":pos,"rate":str(28+len(f)),"startDate":"2026-01-01"},headers=H).json()
    start=today-datetime.timedelta(days=today.weekday()+14)
    for i in range(28):
        d=start+datetime.timedelta(days=i)
        for f in ppl:
            if random.random()<0.4: continue
            st,en=("10:00","18:00") if ppl[f].get("position","").startswith("kitchen") or f in("Kamil","Ewa","Jan") else ("16:00","23:00")
            r.post(BASE+f"/api/admin/locations/{loc}/schedule/shifts",data={"userId":ppl[f]["id"],"date":str(d),"start":st,"end":en},headers=H)
            if d<today and random.random()>0.08:
                late=random.choice([0,0,0,3,7,15])
                h,m=map(int,st.split(":")); tin=f"{h+(m+late)//60:02d}:{(m+late)%60:02d}"
                r.post(BASE+f"/api/admin/locations/{loc}/time/entries",data={"userId":ppl[f]["id"],"clockInAt":ms(d,tin),"clockOutAt":ms(d,en)},headers=H)
    for k in range(4): r.post(BASE+f"/api/admin/locations/{loc}/schedule/publish",data={"week":str(start+datetime.timedelta(days=7*k)),"notify":False},headers=H)
    for n,pos,src in [("Nina Lis","waiter","pracuj"),("Tomasz Ryś","kitchen","olx"),("Zosia Lin","bartender","referral")]:
        r.post(BASE+f"/api/admin/locations/{loc}/candidates",data={"name":n,"position":pos,"source":src},headers=H)
    # staff phone: Zofia, on shift now
    sc=b.new_context(viewport={"width":390,"height":844},locale="pl-PL",device_scale_factor=2,is_mobile=True,has_touch=True); s=sc.new_page(); watch(s,"staff")
    z=ppl["Zofia"]; s.goto(BASE+"/"); s.get_by_label("Login").fill(z["login"]); s.get_by_label("PIN lub hasło").fill(z["tempSecret"]); s.get_by_role("button",name="Zaloguj się").click()
    s.get_by_label("Nowy PIN (6 cyfr)").fill("481937"); s.get_by_label("Powtórz").fill("481937"); s.get_by_role("button",name="Zapisz").click(); s.wait_for_timeout(1500)
    r.post(BASE+f"/api/admin/locations/{loc}/time/entries",data={"userId":z["id"],"clockInAt":int(datetime.datetime.now(WAW).timestamp()*1000)-3600_000,"clockOutAt":None},headers=H)
    # acknowledge onboarding prompts if any
    for _ in range(3):
        btn=s.get_by_role("button",name=re.compile("Później|Pomiń|Nie teraz"))
        if btn.count(): btn.first.click(); s.wait_for_timeout(400)
    staff_paths=["/","/nauka","/grafik","/grafik/niedostepnosc","/grafik/godziny","/menu","/wiedza","/wiedza/regulaminy","/wiedza/lekcje","/szukaj","/godziny","/konto"]
    menu_items=r.get(BASE+f"/api/admin/locations/{loc}/menu").json().get("items",[])
    if menu_items: staff_paths.append(f"/menu/{menu_items[0]['id']}")
    lists=r.get(BASE+f"/api/admin/locations/{loc}/content?kind=checklist").json().get("items",[])
    if lists: staff_paths.append(f"/listy/{lists[0]['id']}")
    reg=r.get(BASE+f"/api/admin/locations/{loc}/content?kind=regulation").json().get("items",[])
    if reg: staff_paths.append(f"/m/{reg[0]['id']}")
    for w,ctx in [(390,sc),(1280,None)]:
        page=s if w==390 else b.new_context(viewport={"width":1280,"height":900},locale="pl-PL",storage_state=sc.storage_state()).new_page()
        if w==1280: watch(page,"staff-desk")
        for pth in staff_paths:
            page.goto(BASE+pth); page.wait_for_load_state("networkidle")
            shoot(page, f"rv-staff-{w}-{pth.strip('/').replace('/','_') or 'start'}")
    panel_paths=["/panel/dzis","/panel/pracownicy","/panel/czas","/panel/grafik","/panel/rekrutacja","/panel/statystyki","/panel/powiadomienia","/panel/menu","/panel/materialy","/panel/programy","/panel/testy","/panel/testy/wyniki","/panel/listy","/panel/listy/edycja","/panel/menedzerowie","/panel/lokale","/panel/dziennik"]
    tests=r.get(BASE+f"/api/admin/locations/{loc}/tests").json().get("tests",[])
    if tests: panel_paths.append(f"/panel/testy/{tests[0]['id']}")
    panel_paths.append(f"/panel/pracownicy/{z['id']}")
    for w in (1280,390):
        page=o if w==1280 else b.new_context(viewport={"width":390,"height":844},locale="pl-PL",is_mobile=True,has_touch=True,device_scale_factor=2,storage_state=oc.storage_state()).new_page()
        if w==390: watch(page,"owner-phone")
        for pth in panel_paths:
            page.goto(BASE+pth); page.wait_for_load_state("networkidle")
            shoot(page, f"rv-panel-{w}-{pth.replace('/panel/','').replace('/','_')}")
    b.close()
print("\n".join(problems) if problems else "NO_LAYOUT_PROBLEMS")
print("\n".join(errors) if errors else "NO_ERRORS")
