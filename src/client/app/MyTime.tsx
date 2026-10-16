/** "Moje godziny" (D41): the person's own shifts and PIN punches — hours only, never money. */
import { useState } from 'react';
import { pl } from '../i18n/pl';
import { onNav } from '../router';
import { formatClock, formatDuration } from '../../shared/time';
import { Fold, Icon, Loading, Problem, useAcademy, useApi } from './shared';

const t = pl.myTime;

export interface MyTimeView {
  month: string;
  prevMonth: string;
  nextMonth: string | null;
  totalMinutes: number;
  shifts: number;
  prevTotalMinutes: number;
  entries: { date: string; clockInAt: number; clockOutAt: number | null; minutes: number; open: boolean; missingExit: boolean; byManager: boolean }[];
  punches: { at: number; outcome: string; offline: boolean }[];
}

const monthName = (m: string) => {
  const s = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-15T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const dayName = (d: string) =>
  new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
const punchDay = (ms: number) =>
  new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Warsaw' }).format(new Date(ms));

/** Small card on Start (employees only). */
export function MyTimeCard() {
  const { locationId, me } = useAcademy();
  const { data } = useApi<MyTimeView>(me.user.role === 'employee' ? `/api/locations/${locationId}/my-time` : null);
  if (!data) return null;
  return (
    <div className="a-list">
      <a className="a-row" href="/godziny" onClick={onNav('/godziny')}>
        <Icon name="clock" size={20} />
        <span className="grow">
          <span className="t">{t.title}</span>
          <span className="s">{t.card(formatDuration(data.totalMinutes), t.shifts(data.shifts))}</span>
        </span>
        <Icon name="next" size={18} />
      </a>
    </div>
  );
}

export function MyTime({ embedded = false }: { embedded?: boolean }) {
  const { locationId } = useAcademy();
  const [month, setMonth] = useState<string | null>(null);
  const { data, error } = useApi<MyTimeView>(`/api/locations/${locationId}/my-time${month ? `?month=${month}` : ''}`);
  return (
    <main className="a-main">
      {!embedded && <h1 className="a-title">{t.title}</h1>}
      <Problem message={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="a-card" style={{ gap: 10 }}>
            <div className="mt-month">
              <button type="button" className="a-icon-btn" aria-label={t.prev} onClick={() => setMonth(data.prevMonth)}>
                <Icon name="back" size={20} />
              </button>
              <span className="mt-month-name">{monthName(data.month)}</span>
              <button
                type="button"
                className="a-icon-btn"
                aria-label={t.next}
                disabled={!data.nextMonth}
                onClick={() => data.nextMonth && setMonth(data.nextMonth)}
              >
                <Icon name="next" size={20} />
              </button>
            </div>
            <div className="mt-total">
              <span className="mt-total-h">{formatDuration(data.totalMinutes)} h</span>
              <span className="a-sub">{t.shifts(data.shifts)}</span>
            </div>
            <span className="a-sub">{t.prevTotal(formatDuration(data.prevTotalMinutes))}</span>
          </div>
          {data.entries.length === 0 ? (
            <p className="a-sub">{t.noShifts}</p>
          ) : (
            <div className="a-list">
              {data.entries.map((e) => (
                <div key={e.clockInAt} className="a-row">
                  <span className="grow">
                    <span className="t">{dayName(e.date)}</span>
                    <span className="s">
                      {formatClock(e.clockInAt)}–{e.clockOutAt ? formatClock(e.clockOutAt) : '…'}
                      {e.byManager ? ` · ${t.byManager}` : ''}
                    </span>
                  </span>
                  {e.open ? (
                    <span className="a-pill ok">{t.ongoing}</span>
                  ) : e.missingExit ? (
                    <span className="a-pill warn">{t.missingExit}</span>
                  ) : (
                    <span className="mt-hours">{formatDuration(e.minutes)} h</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {data.punches.length > 0 && (
            <Fold title={t.punches} count={data.punches.length} sub={t.punchesSub}>
              {data.punches.map((p) => (
                <div key={p.at + p.outcome} className="a-row">
                  <span className="grow">
                    <span className="t">{punchDay(p.at)}</span>
                    <span className="s">
                      {formatClock(p.at)} · {t.outcomes[p.outcome] ?? p.outcome}
                      {p.offline ? ` · ${t.offline}` : ''}
                    </span>
                  </span>
                </div>
              ))}
            </Fold>
          )}
          <p className="a-sub">{t.info}</p>
        </>
      )}
    </main>
  );
}
