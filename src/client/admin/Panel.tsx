import { disablePush } from '../push';
import { TimeTracking } from './TimeTracking';
import { Schedule } from './Schedule';
import { Recruitment } from './Recruitment';
import { Today } from './Today';
import { ChecklistStats } from './ChecklistStats';
import { createContext, useContext, useMemo, useState } from 'react';
import type { Me } from '../api';
import { api } from '../api';
import { pl } from '../i18n/pl';
import { match, onNav, Redirect, usePath } from '../router';
import { Btn, Icon, storageGet, storageSet } from './common';
import { Employees } from './Employees';
import { Managers } from './Managers';
import { Locations } from './Locations';
import { Audit } from './Audit';
import { ContentList } from './ContentList';
import { ContentEditor } from './ContentEditor';
import { Menu } from './Menu';
import { Programs } from './Programs';
import '../styles/richtext.css';
import '../styles/admin.css';

interface PanelCtx {
  me: Me;
  locationId: string;
  can: (perm: string) => boolean;
  isOwner: boolean;
  refreshMe: () => Promise<void>;
}

const Ctx = createContext<PanelCtx | null>(null);
export function usePanel(): PanelCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePanel outside Panel');
  return v;
}

const LOC_KEY = 'sa.panel.location';

export function Panel({ me, onLoggedOut, refreshMe }: { me: Me; onLoggedOut: () => void; refreshMe: () => Promise<void> }) {
  const path = usePath();
  const stored = storageGet(LOC_KEY);
  const [locationId, setLocationId] = useState(
    me.locations.find((l) => l.id === stored)?.id ?? me.locations[0]?.id ?? '',
  );
  const isOwner = me.user.role === 'owner';
  const current = me.locations.find((l) => l.id === locationId);
  const ctx = useMemo<PanelCtx>(
    () => ({ me, locationId, isOwner, can: (p) => isOwner || Boolean(current?.permissions.includes(p)), refreshMe }),
    [me, locationId, isOwner, current, refreshMe],
  );

  // Main items (bottom bar on phones) first; the rest sits under "Więcej" (D39).
  const nav = [
    { path: '/panel/dzis', label: pl.admin.nav.today, icon: 'sun', show: ctx.can('time.manage') || ctx.can('schedule.manage'), main: true },
    { path: '/panel/pracownicy', label: pl.admin.nav.employees, icon: 'people', show: ctx.can('employees.view'), main: true },
    { path: '/panel/czas', label: pl.admin.nav.time, icon: 'clock', show: ctx.can('time.manage'), main: true },
    { path: '/panel/grafik', label: pl.admin.nav.schedule, icon: 'calendar', show: ctx.can('schedule.manage'), main: true },
    { path: '/panel/rekrutacja', label: pl.admin.nav.recruitment, icon: 'recruit', show: ctx.can('recruitment.manage') },
    { path: '/panel/menu', label: pl.admin.nav.menu, icon: 'menu', show: ctx.can('menu.edit') },
    { path: '/panel/materialy', label: pl.admin.nav.content, icon: 'book', show: ctx.can('content.edit') },
    { path: '/panel/programy', label: pl.admin.nav.programs, icon: 'learn', show: ctx.can('content.edit') },
    { path: '/panel/listy', label: pl.admin.nav.checklists, icon: 'checklist', show: ctx.can('checklists.view') },
    { path: '/panel/menedzerowie', label: pl.admin.nav.managers, icon: 'key', show: ctx.can('managers.manage') },
    { path: '/panel/lokale', label: pl.admin.nav.locations, icon: 'pin', show: ctx.can('locations.manage') },
    { path: '/panel/dziennik', label: pl.admin.nav.audit, icon: 'list', show: ctx.can('audit.view') },
  ].filter((n) => n.show) as { path: string; label: string; icon: string; show: boolean; main?: boolean }[];
  const mainNav = nav.filter((n) => n.main);
  const moreNav = nav.filter((n) => !n.main);
  const inMore = moreNav.some((n) => path.startsWith(n.path)) || path === '/panel/wiecej';

  let page: React.ReactNode = null;
  let m: Record<string, string> | null;
  if ((m = match('/panel/materialy/:id', path))) page = <ContentEditor id={m.id!} />;
  else if (path.startsWith('/panel/materialy')) page = <ContentList />;
  else if ((m = match('/panel/programy/:id', path))) page = <Programs selectedId={m.id!} />;
  else if (path.startsWith('/panel/programy')) page = <Programs selectedId={null} />;
  else if ((m = match('/panel/menu/:id', path))) page = <Menu selectedId={m.id!} />;
  else if (path.startsWith('/panel/menu')) page = <Menu selectedId={null} />;
  else if ((m = match('/panel/pracownicy/:id', path))) page = <Employees selectedId={m.id!} />;
  else if (path.startsWith('/panel/pracownicy')) page = <Employees selectedId={null} />;
  else if (path === '/panel/wiecej') page = <More items={moreNav} />;
  else if (path.startsWith('/panel/czas') && ctx.can('time.manage')) page = <TimeTracking />;
  else if (path.startsWith('/panel/grafik') && ctx.can('schedule.manage')) page = <Schedule />;
  else if (path.startsWith('/panel/dzis') && (ctx.can('time.manage') || ctx.can('schedule.manage'))) page = <Today />;
  else if (path.startsWith('/panel/listy') && ctx.can('checklists.view')) page = <ChecklistStats />;
  else if (path.startsWith('/panel/menedzerowie') && ctx.can('managers.manage')) page = <Managers />;
  else if (path.startsWith('/panel/lokale') && ctx.can('locations.manage')) page = <Locations />;
  else if (path.startsWith('/panel/rekrutacja') && ctx.can('recruitment.manage')) page = <Recruitment path={path} />;
  else if (path.startsWith('/panel/dziennik') && ctx.can('audit.view')) page = <Audit />;
  else if (nav[0]) page = <Redirect to={nav[0].path} />;

  async function logout() {
    await disablePush();
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    onLoggedOut();
  }

  return (
    <Ctx.Provider value={ctx}>
      <div className="panel">
        <nav className="rail" aria-label={pl.admin.panel}>
          <span className="monogram" aria-hidden="true">
            S
          </span>
          {mainNav.map((n) => (
            <a key={n.path} href={n.path} onClick={onNav(n.path)} aria-current={path.startsWith(n.path) ? 'page' : undefined}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </a>
          ))}
          {moreNav.length > 0 && mainNav.length > 0 && <span className="rail-divider" aria-hidden="true" />}
          {moreNav.map((n) => (
            <a key={n.path} href={n.path} onClick={onNav(n.path)} aria-current={path.startsWith(n.path) ? 'page' : undefined}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </a>
          ))}
        </nav>
        <div className="panel-main">
          <header className="topbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, letterSpacing: '0.08em' }}>SENATOR</span>
              {me.locations.length > 1 ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }} className="muted">
                  {pl.admin.location}
                  <select
                    value={locationId}
                    onChange={(e) => {
                      setLocationId(e.target.value);
                      storageSet(LOC_KEY, e.target.value);
                    }}
                    style={{ minHeight: 40, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'var(--font-ui)', fontSize: 14, padding: '0 10px' }}
                  >
                    {me.locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <span className="muted topbar-name" style={{ fontSize: 13 }}>
                  {current?.name}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <a href="/nauka" onClick={onNav('/nauka')} style={{ fontSize: 13, fontWeight: 600 }}>
                {pl.admin.academyView}
              </a>
              <span className="muted topbar-name" style={{ fontSize: 13 }}>
                {me.user.firstName} {me.user.lastName}
              </span>
              <Btn onClick={() => void logout()}>{pl.home.logout}</Btn>
            </div>
          </header>
          <main className="page" key={locationId}>
            {page}
          </main>
        </div>
        <nav className="tabbar" aria-label={pl.admin.panel}>
          {mainNav.map((n) => (
            <a key={n.path} href={n.path} onClick={onNav(n.path)} aria-current={path.startsWith(n.path) ? 'page' : undefined}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </a>
          ))}
          {moreNav.length > 0 && (
            <a href="/panel/wiecej" onClick={onNav('/panel/wiecej')} aria-current={inMore ? 'page' : undefined}>
              <Icon name="more" />
              <span>{pl.admin.nav.more}</span>
            </a>
          )}
        </nav>
      </div>
    </Ctx.Provider>
  );
}

/** "Więcej": everything that is not in the bottom bar, as large tiles (phones). */
function More({ items }: { items: { path: string; label: string; icon: string }[] }) {
  return (
    <>
      <h1 className="page-title">{pl.admin.nav.more}</h1>
      <div className="more-grid">
        {items.map((n) => (
          <a key={n.path} className="more-tile" href={n.path} onClick={onNav(n.path)}>
            <Icon name={n.icon} size={26} />
            <span>{n.label}</span>
          </a>
        ))}
      </div>
    </>
  );
}
