import { Fragment, useCallback, useEffect, useState } from 'react';
import { addDays, businessDate, formatClock } from '../../shared/time';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { ErrorBox, Fold, LogoLoader } from '../ui';
import { Btn, Icon } from './common';
import { PhotoLightbox } from './TimeTracking';
import { usePanel } from './Panel';
import { ChecklistEditor, ChecklistManager, DivisionChips, inDivision, listDivisions } from './ChecklistEditor';
import { ContentImport } from './ContentImport';
import { match, navigate, usePath } from '../router';
import { storageGet, storageSet } from './common';

const t = pl.admin.checklists;

interface DayItem {
  key: string;
  section: string | null;
  text: string;
  mark: { userId: string; name: string; at: number; photoId?: string | null } | null;
  count?: number;
  by?: { name: string; at: number; photoId?: string | null }[];
  photo?: boolean;
  shared?: boolean;
}
interface DayChecklist {
  id: string;
  positions?: string[];
  title: string;
  items: DayItem[];
  done: number;
  total: number;
  mode: 'individual' | 'shared';
  itemCount: number;
  people?: { userId: string; name: string; done: number; total: number; lastAt: number | null }[];
  closed: { closedAt: number; closedByName: string | null; doneCount: number; totalCount: number } | null;
}
interface Stats {
  days: string[];
  checklists: { id: string; title: string; total: number; shared?: number; positions?: string[] }[];
  perDay: { id: string; date: string; done: number; people?: number }[];
  closed: { id: string; date: string; done: number; total: number; closedBy: string | null }[];
  people: { userId: string; name: string; items: number; days: number }[];
}

const short = (name: string) => {
  const [first, ...rest] = name.split(' ');
  const last = rest.join(' ').trim();
  return last ? `${first} ${last.charAt(0)}.` : name;
};

/** Consecutive items with the same section heading form one foldable section. */
function sectionsOf(items: DayItem[]) {
  const out: { name: string | null; items: DayItem[] }[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last.name === it.section) last.items.push(it);
    else out.push({ name: it.section, items: [it] });
  }
  return out;
}

const dayFmt = new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });

const DIV_KEY = 'sa.panel.checklistDivision';

/** "Listy": control (Dzień, Statystyka) and — for leaders who edit materials — editing and import (owner, 2026-10-17). */
export function ChecklistStats() {
  const { can } = usePanel();
  const path = usePath();
  const [division, setDivisionState] = useState(() => storageGet(DIV_KEY) ?? 'all');
  const setDivision = (d: string) => {
    setDivisionState(d);
    storageSet(DIV_KEY, d);
  };
  const [importing, setImporting] = useState(false);
  const canEdit = can('content.edit');
  const m = match('/panel/listy/edycja/:id', path);
  const editing = canEdit && path.startsWith('/panel/listy/edycja');
  return (
    <div className="page">
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 className="page-title">{t.title}</h1>
        {canEdit && (
          <div className="btn-row">
            {editing ? (
              <Btn onClick={() => navigate('/panel/listy')}>{t.edit.toControl}</Btn>
            ) : (
              <Btn kind="primary" onClick={() => navigate('/panel/listy/edycja')}>
                {t.edit.button}
              </Btn>
            )}
            <Btn onClick={() => setImporting(true)}>{t.edit.import}</Btn>
          </div>
        )}
      </div>
      {editing ? (
        m ? (
          <ChecklistEditor key={m.id} id={m.id!} />
        ) : (
          <ChecklistManager division={division} setDivision={setDivision} />
        )
      ) : (
        <Control division={division} setDivision={setDivision} />
      )}
      {importing && (
        <ContentImport
          onClose={() => setImporting(false)}
          onDone={async () => {
            if (!path.startsWith('/panel/listy/edycja')) navigate('/panel/listy/edycja');
          }}
        />
      )}
    </div>
  );
}

function Control({ division, setDivision }: { division: string; setDivision: (d: string) => void }) {
  const { locationId } = usePanel();
  const [tab, setTab] = useState<'day' | 'stats'>('day');
  const [date, setDate] = useState(businessDate(Date.now()));
  const [range, setRange] = useState<7 | 30>(7);
  const [day, setDay] = useState<DayChecklist[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Sections: unfinished ones open, finished ones folded — until the leader toggles them.
  const [foldState, setFoldState] = useState<Record<string, boolean>>({});
  const [photo, setPhoto] = useState<{ id: string; title: string } | null>(null);

  const loadDay = useCallback(async () => {
    try {
      setError(null);
      setDay((await api<{ checklists: DayChecklist[] }>(`/api/admin/locations/${locationId}/checklists/day?date=${date}`)).checklists);
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }, [locationId, date]);
  const loadStats = useCallback(async () => {
    const to = businessDate(Date.now());
    try {
      setError(null);
      setStats(await api<Stats>(`/api/admin/locations/${locationId}/checklists/stats?from=${addDays(to, -(range - 1))}&to=${to}`));
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }, [locationId, range]);

  useEffect(() => {
    if (tab === 'day') {
      setDay(null);
      setFoldState({});
      void loadDay();
    } else {
      setStats(null);
      void loadStats();
    }
  }, [tab, loadDay, loadStats]);

  const present = [...new Set([...(day ?? []), ...(stats?.checklists ?? [])].flatMap((c) => listDivisions(c.positions ?? [])))];
  const dayShown = day?.filter((c) => inDivision(c.positions ?? [], division)) ?? null;
  const statsLists = stats?.checklists.filter((c) => inDivision(c.positions ?? [], division)) ?? [];
  return (
    <>
      {photo && <PhotoLightbox src={`/api/admin/checklists/marks/${photo.id}/photo`} caption={photo.title} onClose={() => setPhoto(null)} />}
      <div className="btn-row" role="tablist">
        {(['day', 'stats'] as const).map((x) => (
          <button key={x} role="tab" className="chip" aria-selected={tab === x} aria-pressed={tab === x} onClick={() => setTab(x)}>
            {x === 'day' ? t.day : t.stats}
          </button>
        ))}
      </div>
      <DivisionChips value={division} onChange={setDivision} present={present} />
      <ErrorBox message={error} />

      {tab === 'day' && (
        <>
          <div className="btn-row" style={{ alignItems: 'flex-end' }}>
            <Btn onClick={() => setDate(addDays(date, -1))}>‹</Btn>
            <div className="field">
              <label htmlFor="cl-date">{t.date}</label>
              <input id="cl-date" type="date" value={date} max={businessDate(Date.now())} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </div>
            <Btn onClick={() => setDate(addDays(date, 1))}>›</Btn>
          </div>
          {!day && !error && <LogoLoader />}
          {dayShown && dayShown.length === 0 && <p className="muted">{t.none}</p>}
          {dayShown?.map((cl) => {
            const pct = cl.total ? Math.round((cl.done / cl.total) * 100) : 0;
            return (
              <section key={cl.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 17 }}>{cl.title}</strong>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 700 }}>{t.average(pct)}</span>
                    {cl.closed && <span className="badge ok">{t.closedBy(cl.closed.closedByName ?? '—', formatClock(cl.closed.closedAt))}</span>}
                  </span>
                </div>
                <div className="cl-bar" aria-hidden="true">
                  <div style={{ width: `${pct}%` }} />
                </div>
                {(
                  <div className="cl-people">
                    <div className="label">{t.peopleToday}</div>
                    {(cl.people ?? []).length === 0 ? (
                      <p className="muted" style={{ margin: 0 }}>
                        {t.nobodyToday}
                      </p>
                    ) : (
                      (cl.people ?? []).map((p) => (
                        <div key={p.userId} className="cl-person">
                          <span className="cl-person-name">{short(p.name)}</span>
                          <span className="cl-person-bar">
                            <span style={{ width: `${p.total ? Math.round((p.done / p.total) * 100) : 0}%` }} />
                          </span>
                          <span className="cl-person-num">
                            {t.done(p.done, p.total)}
                            {p.done === p.total && p.total > 0 ? ' ✓' : ''}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
                {sectionsOf(cl.items).map((sec, si) => {
                  const key = `${cl.id}:${si}`;
                  const crowd = cl.people?.length ?? 0;
                  const isDone = (it: DayItem) => (it.shared ? (it.count ?? 0) > 0 : crowd > 0 && (it.count ?? 0) >= crowd);
                  const done = sec.items.filter(isDone).length;
                  const all = done === sec.items.length;
                  const open = foldState[key] ?? !all;
                  return (
                    <Fold
                      key={key}
                      id={`cls-${key}`}
                      className="cl-fold"
                      open={open}
                      onToggle={() => setFoldState((f) => ({ ...f, [key]: !open }))}
                      head={sec.name ?? pl.checklists.otherItems}
                      aside={<span className={all ? 'ok' : undefined}>{all ? `✓ ${done}/${sec.items.length}` : t.sectionLeft(sec.items.length - done, done, sec.items.length)}</span>}
                    >
                      <div className="cl-items">
                        {sec.items.map((it) =>
                          !it.shared ? (
                            <div key={it.key} className={`cl-item${isDone(it) ? ' done' : ''}`}>
                              <span className="cl-dot" aria-hidden="true" />
                              <span className="cl-text">
                                {it.text}
                                {it.photo && <span className="muted"> · {t.photoNeeded}</span>}
                              </span>
                              <span className="cl-who" title={(it.by ?? []).map((b) => `${b.name} · ${formatClock(b.at)}`).join('\n')}>
                                {t.peopleDid(it.count ?? 0, crowd)}
                                {(it.by ?? []).length > 0 && ' · '}
                                {(it.by ?? []).map((b, bi) => (
                                  <Fragment key={bi}>
                                    {bi > 0 && ', '}
                                    {b.photoId ? (
                                      <button type="button" className="cl-photo-btn" onClick={() => setPhoto({ id: b.photoId!, title: `${b.name} · ${formatClock(b.at)}` })}>
                                        <Icon name="camera" size={13} /> {short(b.name)}
                                      </button>
                                    ) : (
                                      short(b.name)
                                    )}
                                  </Fragment>
                                ))}
                              </span>
                            </div>
                          ) : (
                            <div key={it.key} className={`cl-item${isDone(it) ? ' done' : ''}`}>
                              <span className="cl-dot" aria-hidden="true" />
                              <span className="cl-text">
                                {it.text}
                                <span className="muted"> · {t.sharedItem}{it.photo ? `, ${t.photoNeeded}` : ''}</span>
                              </span>
                              <span className="cl-who">
                                {(() => {
                                  const b = it.by?.[0];
                                  if (!b) return t.notDone;
                                  return b.photoId ? (
                                    <button type="button" className="cl-photo-btn" onClick={() => setPhoto({ id: b.photoId!, title: `${b.name} · ${formatClock(b.at)}` })}>
                                      <Icon name="camera" size={13} /> {short(b.name)} · {formatClock(b.at)}
                                    </button>
                                  ) : (
                                    `${short(b.name)} · ${formatClock(b.at)}`
                                  );
                                })()}
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                    </Fold>
                  );
                })}
                {cl.closed && (
                  <div>
                    <Btn
                      onClick={async () => {
                        await api(`/api/admin/locations/${locationId}/checklists/${cl.id}/days/${date}`, { method: 'DELETE' });
                        await loadDay();
                      }}
                    >
                      {t.reopen}
                    </Btn>
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}

      {tab === 'stats' && (
        <>
          <div className="btn-row">
            {([7, 30] as const).map((r) => (
              <button key={r} className="chip" aria-pressed={range === r} onClick={() => setRange(r)}>
                {r === 7 ? t.range7 : t.range30}
              </button>
            ))}
          </div>
          {!stats && !error && <LogoLoader />}
          {stats && (
            <>
              <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="label">{t.people}</div>
                {stats.people.length === 0 ? (
                  <p className="muted">{t.noData}</p>
                ) : (
                  stats.people.map((p) => {
                    const max = stats.people[0]!.items || 1;
                    return (
                      <div key={p.userId} className="cl-person">
                        <span className="cl-person-name">{p.name}</span>
                        <span className="cl-person-bar">
                          <span style={{ width: `${Math.round((p.items / max) * 100)}%` }} />
                        </span>
                        <span className="cl-person-num">
                          {p.items} · {t.days.toLowerCase()}: {p.days}
                        </span>
                      </div>
                    );
                  })
                )}
              </section>
              <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="label">{t.perDay}</div>
                <div className="time-grid-wrap">
                  <table className="time-grid">
                    <thead>
                      <tr>
                        <th className="sticky">{t.title}</th>
                        {stats.days.map((d) => (
                          <th key={d}>{dayFmt.format(new Date(d + 'T12:00:00Z'))}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {statsLists.map((c) => (
                        <tr key={c.id}>
                          <th className="sticky" scope="row">
                            <span className="name" style={{ whiteSpace: 'normal' }}>{c.title}</span>
                          </th>
                          {stats.days.map((d) => {
                            const row = stats.perDay.find((x) => x.id === c.id && x.date === d);
                            const done = row?.done ?? 0;
                            const base = (c.total - (c.shared ?? 0)) * Math.max(row?.people ?? 1, 1) + (c.shared ?? 0);
                            const closed = stats.closed.find((x) => x.id === c.id && x.date === d);
                            return (
                              <td key={d}>
                                <button
                                  type="button"
                                  className={`cell${done ? ' has' : ''}${closed ? ' live' : ''}`}
                                  title={closed?.closedBy ? t.closedBy(closed.closedBy, '') : undefined}
                                  onClick={() => {
                                    setDate(d);
                                    setTab('day');
                                  }}
                                >
                                  {done ? `${Math.round((done / base) * 100)}%` : '—'}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
