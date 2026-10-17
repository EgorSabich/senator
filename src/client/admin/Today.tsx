/** "Dziś" for leaders (D45): today's plan against reality, missing exits and checklists — refreshed every minute. */
import { useCallback, useEffect, useState } from 'react';
import { storageGet, storageSet } from './common';
import { formatHm, shiftColor } from '../../shared/schedule';
import { formatClock } from '../../shared/time';
import { api, ApiFailure, cached } from '../api';
import { errorText, pl } from '../i18n/pl';
import { onNav } from '../router';
import { ErrorBox, LogoLoader } from '../ui';
import { usePanel } from './Panel';

const t = pl.admin.today;
const ORDER = ['waiter', 'host', 'bartender', 'kitchen', 'hookah_master', 'call_center', 'shift_manager'];

interface Row {
  userId: string;
  name: string;
  division: string;
  startMin: number;
  endMin: number;
  status: 'on_shift' | 'done' | 'late' | 'not_yet' | 'absent';
  clockInAt: number | null;
  clockOutAt: number | null;
  lateMin: number;
}
interface TodayView {
  documents?: { userId: string; name: string; lockedSince: number | null; nextDue: number | null; overdue: number; pending: number }[];
  date: string;
  now: number;
  summary: { planned: number; onShift: number; late: number; absent: number; missingExits: number };
  rows: Row[];
  unplanned: { userId: string; name: string; division: string | null; clockInAt: number; onShift: boolean }[];
  missingExits: { id: string; userId: string; name: string; date: string; clockInAt: number }[];
  checklists: { id: string; title: string; mode: 'individual' | 'shared'; done: number; total: number; people?: number; peopleDone?: number; closed?: boolean }[];
}

const dayFmt = (ms: number) => new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Warsaw' }).format(new Date(ms));

const longDate = (d: string) => {
  const s = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function Today() {
  const { locationId } = usePanel();
  const [data, setData] = useState<TodayView | null>(() => cached<TodayView>(`/api/admin/locations/${locationId}/today`));
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<TodayView>(`/api/admin/locations/${locationId}/today`));
      setError(null);
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }, [locationId]);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, [load]);

  if (!data) return error ? <ErrorBox message={error} /> : <LogoLoader />;
  const s = data.summary;
  const groups = ORDER.filter((d) => data.rows.some((r) => r.division === d));

  return (
    <div className="page">
      <div>
        <h1 className="page-title">{t.title}</h1>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          {longDate(data.date)} · {t.updated(formatClock(data.now))}
        </p>
      </div>
      <ErrorBox message={error} />
      <div className="today-tiles">
        <Tile label={t.onShift} value={s.onShift} sub={t.ofPlanned(s.planned)} tone="ok" />
        <Tile label={t.late} value={s.late} tone={s.late ? 'bad' : undefined} />
        <Tile label={t.absent} value={s.absent} tone={s.absent ? 'bad' : undefined} />
        <Tile label={t.missingExits} value={s.missingExits} tone={s.missingExits ? 'warn' : undefined} href="/panel/czas" />
      </div>

      <section className="card today-card">
        <div className="today-head">
          <h2 className="label">{t.plan}</h2>
          <a href="/panel/grafik" onClick={onNav('/panel/grafik')} className="muted">
            {t.toSchedule}
          </a>
        </div>
        {data.rows.length === 0 && <p className="muted">{t.noPlan}</p>}
        {groups.map((g) => (
          <div key={g} className="today-group">
            <div className="today-group-name">{pl.admin.divisions[g] ?? g}</div>
            {data.rows
              .filter((r) => r.division === g)
              .map((r) => (
                <div key={`${r.userId}-${r.startMin}`} className="today-row">
                  <span className="today-time" style={{ ['--c' as string]: shiftColor(r.startMin) }}>
                    {formatHm(r.startMin)}–{formatHm(r.endMin)}
                  </span>
                  <span className="today-name">{r.name}</span>
                  <Status r={r} />
                </div>
              ))}
          </div>
        ))}
        {data.unplanned.length > 0 && (
          <div className="today-group">
            <div className="today-group-name">{t.unplanned}</div>
            {data.unplanned.map((u) => (
              <div key={u.userId} className="today-row">
                <span className="today-time muted">—</span>
                <span className="today-name">{u.name}</span>
                <span className={`badge ${u.onShift ? 'ok' : 'neutral'}`}>{u.onShift ? t.since(formatClock(u.clockInAt)) : t.wasHere(formatClock(u.clockInAt))}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {(data.documents ?? []).length > 0 && <DocumentsCard docs={data.documents!} now={data.now} />}

      {data.missingExits.length > 0 && (
        <section className="card today-card">
          <div className="today-head">
            <h2 className="label">{t.missingExits}</h2>
            <a href="/panel/czas" onClick={onNav('/panel/czas')} className="muted">
              {t.fix}
            </a>
          </div>
          {data.missingExits.map((e) => (
            <div key={e.id} className="today-row">
              <span className="today-time muted">{e.date.slice(8, 10)}.{e.date.slice(5, 7)}</span>
              <span className="today-name">{e.name}</span>
              <span className="badge warn">{t.since(formatClock(e.clockInAt))}</span>
            </div>
          ))}
        </section>
      )}

      {data.checklists.length > 0 && (
        <section className="card today-card">
          <div className="today-head">
            <h2 className="label">{t.checklists}</h2>
            <a href="/panel/listy" onClick={onNav('/panel/listy')} className="muted">
              {t.details}
            </a>
          </div>
          {data.checklists.map((cl) => {
            const pct = cl.total ? Math.round((cl.done / cl.total) * 100) : 0;
            return (
              <div key={cl.id} className="today-list">
                <div className="today-list-head">
                  <span>{cl.title}</span>
                  <strong>{cl.mode === 'individual' ? t.peopleDone(cl.peopleDone ?? 0, cl.people ?? 0) : cl.closed ? t.closed : `${cl.done} / ${cl.total}`}</strong>
                </div>
                <div className="cl-bar" aria-hidden="true">
                  <div style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone, href }: { label: string; value: number; sub?: string; tone?: 'ok' | 'bad' | 'warn'; href?: string }) {
  const body = (
    <>
      <span className="today-tile-label">{label}</span>
      <span className="today-tile-value">{value}</span>
      {sub && <span className="today-tile-sub">{sub}</span>}
    </>
  );
  return href ? (
    <a className={`today-tile${tone ? ` ${tone}` : ''}`} href={href} onClick={onNav(href)}>
      {body}
    </a>
  ) : (
    <div className={`today-tile${tone ? ` ${tone}` : ''}`}>{body}</div>
  );
}

function Status({ r }: { r: Row }) {
  if (r.status === 'on_shift')
    return <span className={`badge ${r.lateMin ? 'warn' : 'ok'}`}>{r.lateMin ? t.lateCame(formatClock(r.clockInAt!), r.lateMin) : t.since(formatClock(r.clockInAt!))}</span>;
  if (r.status === 'done') return <span className="badge neutral">{t.finished(formatClock(r.clockInAt!), r.clockOutAt ? formatClock(r.clockOutAt) : '…')}</span>;
  if (r.status === 'late') return <span className="badge bad">{t.lateNow(r.lateMin)}</span>;
  if (r.status === 'absent') return <span className="badge bad">{t.absentOne}</span>;
  return <span className="badge neutral">{t.notYet}</span>;
}

const DOCS_KEY = 'sa-today-docs-open';

/** Thin line icons, same style as the panel menu */
const ClockIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);
const LockIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
  </svg>
);

/** „Dokumenty obowiązkowe”: folded by default — the header says how many people are locked or reading. */
function DocumentsCard({ docs, now }: { docs: NonNullable<TodayView['documents']>; now: number }) {
  const [open, setOpen] = useState(() => storageGet(DOCS_KEY) === '1');
  const locked = docs.filter((d) => d.lockedSince !== null).length;
  const toggle = () => {
    setOpen(!open);
    storageSet(DOCS_KEY, open ? '0' : '1');
  };
  return (
    <section className={`card today-card fold${open ? ' open' : ''}`}>
      <button type="button" className="fold-head" aria-expanded={open} onClick={toggle}>
        <span className="label" style={{ margin: 0 }}>
          {t.documents}
        </span>
        <span className="fold-sum">
          {locked > 0 && <span className="badge bad">{t.lockedCount(locked)}</span>}
          {docs.length - locked > 0 && <span className="badge warn">{t.readingCount(docs.length - locked)}</span>}
          <svg className="fold-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>
      <div className="fold-body" inert={!open}>
        <div className="fold-inner">
          <div className="today-docs">
            {docs.map((d) => (
              <a key={d.userId} className="today-doc" href={`/panel/pracownicy/${d.userId}`} onClick={onNav(`/panel/pracownicy/${d.userId}`)}>
                <span className={`today-doc-icon${d.lockedSince !== null ? ' locked' : ''}`}>{d.lockedSince !== null ? <LockIcon /> : <ClockIcon />}</span>
                <span className="today-doc-text">
                  <span className="today-doc-name">{d.name}</span>
                  <span className="muted today-doc-sub">
                    {d.lockedSince !== null ? t.docsOverdue(d.overdue, dayFmt(d.lockedSince)) : t.docsPending(d.pending, dayFmt(d.nextDue!))}
                  </span>
                </span>
                {d.lockedSince !== null ? <span className="badge bad">{t.lockedShort}</span> : <span className="badge warn">{t.daysLeft(Math.max(0, Math.ceil((d.nextDue! - now) / 86400_000)))}</span>}
              </a>
            ))}
            <a href="/panel/pracownicy" onClick={onNav('/panel/pracownicy')} className="muted today-docs-all">
              {t.toPeople} →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
