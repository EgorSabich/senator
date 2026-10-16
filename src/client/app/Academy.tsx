import { useMemo, type ReactNode } from 'react';
import type { Me } from '../api';
import { pl } from '../i18n/pl';
import { match, onNav, usePath } from '../router';
import { Brand } from '../ui';
import { Account } from './Account';
import { ChecklistDay } from './Checklist';
import { Knowledge } from './Knowledge';
import { MenuItem, MenuList } from './Menu';
import { MyTime } from './MyTime';
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
  { path: '/menu', label: pl.academy.tabs.menu, icon: 'menu' },
  { path: '/wiedza', label: pl.academy.tabs.knowledge, icon: 'book' },
  { path: '/szukaj', label: pl.academy.tabs.search, icon: 'search' },
];

export function Academy({ me, onLoggedOut, refreshMe }: { me: Me; onLoggedOut: () => void; refreshMe: () => Promise<void> }) {
  const path = usePath();
  const online = useOnline();
  const locationId = me.locations[0]?.id ?? '';
  const ctx = useMemo<AcademyCtx>(() => ({ me, locationId, online }), [me, locationId, online]);

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
  else if (path === '/wiedza/regulaminy') page = <Knowledge tab="library" />;
  else if (path === '/wiedza/lekcje') page = <Knowledge tab="lessons" />;
  else if (path === '/szukaj') page = <Search />;
  else if (path === '/godziny') page = <MyTime />;
  else if (path === '/konto') page = <Account onLoggedOut={onLoggedOut} refreshMe={refreshMe} />;
  else page = <Start />;

  const active = TABS.slice()
    .reverse()
    .find((t) => (t.path === '/' ? path === '/' : path.startsWith(t.path)));

  return (
    <Ctx.Provider value={ctx}>
      <div className="a-app">
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
