import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { TestRunner, useActiveTest, type ActiveTest } from './TestRunner';
import { startLive } from '../live';
import { LiveBar } from '../ui';
import { api } from '../api';
import { apiCache } from '../apiCache';
import type { Me } from '../api';
import { pl } from '../i18n/pl';
import { match, onNav, usePath } from '../router';
import { Brand } from '../ui';
import { Account } from './Account';
import { ChecklistDay } from './Checklist';
import { Knowledge } from './Knowledge';
import { MenuItem, MenuList } from './Menu';
import { MyTime } from './MyTime';
import { Grafik } from './Grafik';
import { InstallGuide } from './Install';
import { Program } from './Program';
import { Reader } from './Reader';
import { Search } from './Search';
import { Start } from './Start';
import { Ctx, Icon, useOnline, type AcademyCtx } from './shared';
import '../styles/richtext.css';
import '../styles/app.css';

const TABS = [
  { path: '/', label: pl.academy.tabs.start, icon: 'home' },
  { path: '/nauka', label: pl.academy.tabs.learning, icon: 'learn' },
  { path: '/grafik', label: pl.academy.tabs.schedule, icon: 'calendar' },
  { path: '/menu', label: pl.academy.tabs.menu, icon: 'menu' },
  { path: '/wiedza', label: pl.academy.tabs.knowledge, icon: 'book' },
];

export function Academy({ me, onLoggedOut, refreshMe }: { me: Me; onLoggedOut: () => void; refreshMe: () => Promise<void> }) {
  const path = usePath();
  const online = useOnline();
  const locationId = me.locations[0]?.id ?? '';
  const ctx = useMemo<AcademyCtx>(() => ({ me, locationId, online }), [me, locationId, online]);

  // live: refresh what is on screen when something changes (live.ts)
  useEffect(() => {
    if (locationId && me.user.role !== 'terminal') startLive(locationId);
  }, [locationId, me.user.role]);

  // Warm up the other tabs while the phone is idle, so switching shows content at once (it refreshes anyway).
  useEffect(() => {
    if (!locationId) return;
    const paths = ['home', 'program', 'my-schedule', 'menu', 'service-book', 'library', 'lessons', ...(me.user.role === 'employee' ? ['my-time'] : [])].map(
      (p) => `/api/locations/${locationId}/${p}`,
    );
    const idle = (cb: () => void) => ((window as Window & { requestIdleCallback?: (f: () => void) => number }).requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 800)))(cb);
    let cancelled = false;
    // a few at a time, only what is not on the phone yet (answers are kept between launches — apiCache.ts)
    const fetchAll = async (list: string[], each: (p: string) => Promise<unknown>) => {
      const todo = list.filter((p) => !apiCache.has(p));
      const worker = async () => {
        for (let p = todo.shift(); p && !cancelled; p = todo.shift()) await each(p).catch(() => undefined);
      };
      await Promise.all([worker(), worker(), worker()]);
    };
    idle(async () => {
      await fetchAll(paths, async (p) => apiCache.set(p, await api(p)));
      if (cancelled) return;
      // then the inside of the tabs: every dish card, every document and lesson
      const menu = apiCache.get(`/api/locations/${locationId}/menu`) as { items?: { id: string; photoSrc: string | null }[] } | undefined;
      const sb = apiCache.get(`/api/locations/${locationId}/service-book`) as { items?: { id: string }[] } | undefined;
      const lib = apiCache.get(`/api/locations/${locationId}/library`) as { items?: { id: string; external?: boolean }[] } | undefined;
      const les = apiCache.get(`/api/locations/${locationId}/lessons`) as { items?: { id: string; locked?: boolean }[] } | undefined;
      const inner = [
        ...(sb?.items ?? []).map((i) => `/api/content/${i.id}`),
        ...(lib?.items ?? []).filter((i) => !i.external).map((i) => `/api/content/${i.id}`),
        ...(les?.items ?? []).filter((i) => !i.locked).map((i) => `/api/content/${i.id}`),
        ...(menu?.items ?? []).map((i) => `/api/menu/items/${i.id}`),
      ];
      await fetchAll(inner, async (p) => apiCache.set(p, await api(p)));
      // dish photos into the offline cache (service worker), unless the phone asks to save data
      const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
      if (cancelled || saveData) return;
      const seen = new Set<string>();
      for (const i of menu?.items ?? []) {
        if (cancelled) return;
        if (!i.photoSrc || seen.has(i.photoSrc)) continue;
        seen.add(i.photoSrc);
        const img = new Image();
        img.decoding = 'async';
        img.src = i.photoSrc;
        await new Promise((r) => {
          img.onload = img.onerror = r;
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [locationId, me.user.role]);

  // a test started by a leader: until it is handed in the app shows only the test (owner, 2026-10-17)
  const test = useActiveTest(me.user.role === 'employee');
  // the test stays on screen after it is handed in (result) until „Na Start”
  const [shown, setShown] = useState<ActiveTest | null>(null);
  if (test.active && shown?.attemptId !== test.active.attemptId) setShown(test.active);
  if (shown) {
    return (
      <Ctx.Provider value={ctx}>
        <div className="a-app a-test-lock">
          <TestRunner
            key={shown.attemptId}
            test={shown}
            onDone={() => {
              setShown(null);
              test.clear();
              void test.check();
            }}
          />
        </div>
      </Ctx.Provider>
    );
  }

  let page: ReactNode;
  let full = false; // full-screen pages bring their own top bar and footer
  let m: Record<string, string> | null;
  if ((m = match('/m/:id', path))) {
    page = <Reader key={m.id} id={m.id!} />;
    full = true;
  } else if ((m = match('/listy/:id', path))) {
    page = <ChecklistDay key={m.id} id={m.id!} />;
    full = true;
  } else if ((m = match('/menu/:id', path))) {
    page = <MenuItem key={m.id} id={m.id!} />;
    full = true;
  } else if (path === '/menu') page = <MenuList />;
  else if (path === '/nauka') page = <Program />;
  else if (path === '/wiedza') page = <Knowledge tab="sb" />;
  else if ((m = match('/wiedza/k/:id', path))) page = <Knowledge tab="sb" tabId={m.id!} />;
  else if (path === '/wiedza/regulaminy') page = <Knowledge tab="library" />;
  else if (path === '/wiedza/lekcje') page = <Knowledge tab="lessons" />;
  else if (path === '/szukaj') page = <Search />;
  else if (path === '/godziny') page = <MyTime />;
  else if (path === '/instaluj') page = <InstallGuide />;
  else if (path === '/grafik') page = <Grafik tab="shifts" />;
  else if (path === '/grafik/niedostepnosc') page = <Grafik tab="off" />;
  else if (path === '/grafik/godziny') page = <Grafik tab="hours" />;
  else if (path === '/konto') page = <Account onLoggedOut={onLoggedOut} refreshMe={refreshMe} />;
  else page = <Start />;

  const active = TABS.slice()
    .reverse()
    .find((t) => (t.path === '/' ? path === '/' : path.startsWith(t.path)));

  return (
    <Ctx.Provider value={ctx}>
      <div className="a-app">
        <LiveBar />
        {!full && (
          <header className="a-header">
            <Brand />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {!online && <span className="a-offline">{pl.app.offline}</span>}
              {me.user.role !== 'employee' && (
                <a className="a-chip" href="/panel" onClick={onNav('/panel')}>
                  {pl.academy.panel}
                </a>
              )}
              <a className="a-icon-btn" href="/szukaj" onClick={onNav('/szukaj')} aria-label={pl.academy.tabs.search} aria-current={path === '/szukaj' ? 'page' : undefined}>
                <Icon name="search" size={20} />
              </a>
              <a className="a-icon-btn" href="/konto" onClick={onNav('/konto')} aria-label={pl.academy.account}>
                <Icon name="user" size={20} />
              </a>
            </div>
          </header>
        )}
        {page}
        {!full && (
          <nav className="a-tabbar" aria-label={pl.academy.tabs.start}>
            {TABS.map((t) => (
              <a key={t.path} href={t.path} onClick={onNav(t.path)} aria-current={active?.path === t.path ? 'page' : undefined}>
                <Icon name={t.icon} />
                <span>{t.label}</span>
              </a>
            ))}
          </nav>
        )}
      </div>
    </Ctx.Provider>
  );
}

