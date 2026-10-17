"""Folding lists stay in place (owner, 2026-10-18): after review_tour.py on the same server (owner password already set).
Opens long sections, scrolls into them, closes them by the header and checks the header did not move."""
import os
from playwright.sync_api import sync_playwright
BASE=os.environ.get("ACADEMY_URL","http://localhost:8797"); errors=[]
def drift(p, head):
    head.scroll_into_view_if_needed(); p.evaluate("window.scrollBy(0, -120)"); p.wait_for_timeout(200)
    y0=head.bounding_box()["y"]; head.click(); p.wait_for_timeout(800); y1=head.bounding_box()["y"]
    # a page that became shorter than the screen position can only end at its bottom: that is allowed
    at_bottom=p.evaluate("Math.abs(window.scrollY + innerHeight - document.documentElement.scrollHeight) < 2")
    return 0 if at_bottom and y1>y0 else round(y1-y0)
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for w,h in ((1280,800),(390,844)):
        p=b.new_context(viewport={"width":w,"height":h},locale="pl-PL").new_page()
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(BASE+"/"); p.get_by_label("Login").fill("egor.wlasciciel"); p.get_by_label("PIN lub hasło").fill("NoweHasloEgora2026")
        p.get_by_role("button",name="Zaloguj się").click(); p.wait_for_url("**/panel/**")
        # Statystyki → Pracownicy (long table): open, go to its end, close by the header
        p.goto(BASE+"/panel/statystyki"); head=p.locator(".st-sec .disc-head",has_text="Pracownicy"); head.wait_for()
        if head.get_attribute("aria-expanded")!="true": head.click(); p.wait_for_timeout(700)
        p.evaluate("window.scrollTo(0, document.body.scrollHeight)"); p.wait_for_timeout(300)
        d=drift(p, head); print(w,"stats close drift",d)
        if abs(d)>2: errors.append(f"{w}: stats header moved {d}px")
        # Listy kontrolne: a section open and closed
        p.goto(BASE+"/panel/listy"); sec=p.locator(".cl-fold .fold-head").nth(2); sec.wait_for()
        d1=drift(p, sec); d2=drift(p, sec); print(w,"checklist open/close drift",d1,d2)
        if abs(d1)>2 or abs(d2)>2: errors.append(f"{w}: checklist header moved {d1}/{d2}px")
    b.close()
print("\n".join(errors) if errors else "NO_ERRORS")
