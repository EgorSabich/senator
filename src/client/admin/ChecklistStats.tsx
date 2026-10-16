import { useCallback, useEffect, useState } from 'react';
import { addDays, businessDate, formatClock } from '../../shared/time';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { ErrorBox, LogoLoader } from '../ui';
import { Btn } from './common';
import { usePanel } from './Panel';

const t = pl.admin.checklists;

interface DayItem {
  key: string;
  section: string | null;
  text: string;
  mark: { userId: string; name: string; at: number } | null;
  count?: number;
  by?: { name: string; at: number }[];
}
interface DayChecklist {
  id: string;
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
  checklists: { id: string; title: string; total: number; mode: 'individual' | 'shared' }[];
  perDay: { id: string; date: string; done: number; people?: number }[];
  closed: { id: string; date: string; done: number; total: number; closedBy: string | null }[];
  people: { userId: string; name: string; items: number; days: number }[];
}

const short = (name: string) => {
  const [first, ...rest] = name.split(' ');
  const last = rest.join(' ').trim();
  return last ? `${first} ${last.charAt(0)}.` : name;
};

const dayFmt = new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });

export function ChecklistStats() {
  const { locationId } = usePanel();
  const [tab, setTab] = useState<'day' | 'stats'>('day');
  const [date, setDate] = useState(businessDate(Date.now()));
  const [range, setRange] = useState<7 | 30>(7);
  const [day, setDay] = useState<DayChecklist[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      void loadDay();
    } else {
      setStats(null);
      void loadStats();
    }
  }, [tab, loadDay, loadStats]);

  return (
    <div className="page">
      <h1 className="page-title">{t.title}</h1>
      <div className="btn-row" role="tablist">
        {(['day', 'stats'] as const).map((x) => (
          <button key={x} role="tab" className="chip" aria-selected={tab === x} aria-pressed={tab === x} onClick={() => setTab(x)}>
            {x === 'day' ? t.day : t.stats}
          </button>
        ))}
      </div>
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
          {day && day.length === 0 && <p className="muted">{t.none}</p>}
          {day?.map((cl) => {
            const pct = cl.total ? Math.round((cl.done / cl.total) * 100) : 0;
            let section: string | null | undefined;
            return (
              <section key={cl.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 17 }}>{cl.title}</strong>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 700 }}>{cl.mode === 'individual' ? t.average(pct) : t.done(cl.done, cl.total)}</span>
                    {cl.mode === 'individual' ? (
                      <span className="badge neutral">{t.individual}</span>
                    ) : cl.closed ? (
                      <span className="badge ok">{t.closedBy(cl.closed.closedByName ?? '—', formatClock(cl.closed.closedAt))}</span>
                    ) : (
                      <span className="badge neutral">{t.open}</span>
                    )}
                  </span>
                </div>
                <div className="cl-bar" aria-hidden="true">
                  <div style={{ width: `${pct}%` }} />
                </div>
                {cl.mode === 'individual' && (
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
                <div className="cl-items">
                  {cl.items.map((it) => {
                    const head = it.section !== section ? it.section : undefined;
                    section = it.section;
                    return (
                      <div key={it.key}>
                        {head && <div className="label" style={{ margin: '10px 0 4px' }}>{head}</div>}
                        {cl.mode === 'individual' ? (
                          <div className={`cl-item${it.count && it.count >= (cl.people?.length ?? 0) && it.count > 0 ? ' done' : ''}`}>
                            <span className="cl-dot" aria-hidden="true" />
                            <span className="cl-text">{it.text}</span>
                            <span className="cl-who" title={(it.by ?? []).map((b) => `${b.name} · ${formatClock(b.at)}`).join('\n')}>
                              {t.peopleDid(it.count ?? 0, cl.people?.length ?? 0)}
                              {(it.by ?? []).length > 0 && ` · ${(it.by ?? []).map((b) => short(b.name)).join(', ')}`}
                            </span>
                          </div>
                        ) : (
                          <div className={`cl-item${it.mark ? ' done' : ''}`}>
                            <span className="cl-dot" aria-hidden="true" />
                            <span className="cl-text">{it.text}</span>
                            <span className="cl-who">{it.mark ? `${it.mark.name} · ${formatClock(it.mark.at)}` : t.notDone}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
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
                      {stats.checklists.map((c) => (
                        <tr key={c.id}>
                          <th className="sticky" scope="row">
                            <span className="name" style={{ whiteSpace: 'normal' }}>{c.title}</span>
                          </th>
                          {stats.days.map((d) => {
                            const row = stats.perDay.find((x) => x.id === c.id && x.date === d);
                            const done = row?.done ?? 0;
                            const base = c.mode === 'individual' ? c.total * Math.max(row?.people ?? 1, 1) : c.total;
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
    </div>
  );
}
