/**
 * Grafik (D43): week × people by division. Shifts are coloured by start time; templates of the division are one tap away;
 * nothing reaches staff until "Opublikuj".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatHm, shiftColor, weekStart } from '../../shared/schedule';
import { addDays, businessDate, formatClock } from '../../shared/time';
import { api, ApiFailure } from '../api';
import { onNav } from '../router';
import { errorText, pl } from '../i18n/pl';
import { ErrorBox, LogoLoader } from '../ui';
import { Btn, Modal, storageGet, storageSet } from './common';
import { usePanel } from './Panel';
import { TimeField, VALID_TIME } from './TimeTracking';
import { deliver, schedulePdf, schedulePng, type ExportInput } from './scheduleExport';

const t = pl.admin.schedule;
const DIV_KEY = 'sa.panel.scheduleDivisions';
const ORDER = ['waiter', 'host', 'bartender', 'kitchen', 'hookah_master', 'call_center', 'shift_manager'];

interface Person {
  id: string;
  firstName: string;
  lastName: string;
  divisions: string[];
}
interface Shift {
  id: string;
  userId: string;
  date: string;
  division: string;
  startMin: number;
  endMin: number;
  note: string | null;
  deleted: boolean;
  published: boolean;
  changed: boolean;
}
interface Template {
  id: string;
  division: string;
  startMin: number;
  endMin: number;
  label: string | null;
  useCount: number;
}
interface WeekView {
  week: string;
  days: string[];
  people: Person[];
  shifts: Shift[];
  unavailability: Off[];
  templates: Template[];
  actual: { userId: string; date: string; clockInAt: number; clockOutAt: number | null }[];
  unpublished: number;
  deadline: number | null;
  divisions: string[] | null;
  /** divisions I may plan (null = all) — everyone sees the whole team (D44) */
  editable?: string[] | null;
}

interface Off {
  userId: string;
  date: string;
  note: string | null;
  fromMin: number | null;
  toMin: number | null;
  setByName: string | null;
}
/** "cały dzień" / "do 17:00" / "od 18:00" / "12:00–15:00" */
export const offPart = (o: { fromMin: number | null; toMin: number | null }) =>
  o.fromMin === null && o.toMin === null
    ? pl.admin.schedule.offWhole
    : (o.fromMin ?? 0) === 0
      ? pl.admin.schedule.offUntil(formatHm(o.toMin ?? 1440))
      : (o.toMin ?? 1440) >= 1440
        ? pl.admin.schedule.offFrom(formatHm(o.fromMin ?? 0))
        : `${formatHm(o.fromMin ?? 0)}–${formatHm(o.toMin ?? 1440)}`;
const isWhole = (o: Off) => o.fromMin === null && o.toMin === null;

const short = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName.trim().charAt(0)}.`;
const range = (s: { startMin: number; endMin: number }) => `${formatHm(s.startMin)}–${formatHm(s.endMin)}`;
const dayHead = new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
const longDay = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const LATE_MIN = 5;
const MODE_KEY = 'sa.panel.scheduleMode';
const monthName = (m: string) => {
  const v = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-15T12:00:00Z`));
  return v.charAt(0).toUpperCase() + v.slice(1);
};
const shiftMonth = (m: string, d: number) => {
  const x = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + d, 1));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`;
};
/** Friday and Saturday stand out — the busiest days. */
const isWeekend = (d: string) => {
  const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
  return dow === 5 || dow === 6;
};
const hours = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
const compact = (m: number) => (m % 60 ? formatHm(m) : String(Math.floor((m % 1440) / 60)));

export function Schedule() {
  const { locationId, can, me } = usePanel();
  const [exporting, setExporting] = useState(false);
  const today = businessDate(Date.now());
  const [week, setWeek] = useState(() => weekStart(addDays(today, 7)));
  const [mode, setMode] = useState<'week' | 'month'>(() => (storageGet(MODE_KEY) === 'month' ? 'month' : 'week'));
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [data, setData] = useState<WeekView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [groups, setGroups] = useState<string[]>(() => {
    try {
      const v = JSON.parse(storageGet(DIV_KEY) ?? '[]') as unknown;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });
  const [highlight, setHighlight] = useState<number | null>(null);
  const [cell, setCell] = useState<{ person: Person; division: string; date: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api<WeekView>(`/api/admin/locations/${locationId}/schedule?${mode === 'month' ? `month=${month}` : `week=${week}`}`));
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }, [locationId, week, month, mode]);
  useEffect(() => {
    void load();
  }, [load]);
  // a leader starts with their own divisions (owner, 2026-10-17); "Wszyscy" shows everyone
  const defaulted = useRef(false);
  useEffect(() => {
    if (!data || defaulted.current) return;
    defaulted.current = true;
    if (data.editable && storageGet(DIV_KEY) === null) setGroups(data.editable.filter((d) => data.people.some((p) => p.divisions.includes(d))));
  }, [data]);

  const present = useMemo(() => ORDER.filter((d) => data?.people.some((p) => p.divisions.includes(d))), [data]);
  const shown = groups.length ? present.filter((d) => groups.includes(d)) : present;
  const toggleGroup = (d: string) => {
    const next = groups.includes(d) ? groups.filter((x) => x !== d) : [...groups, d];
    setGroups(next);
    storageSet(DIV_KEY, JSON.stringify(next));
  };

  const live = (data?.shifts ?? []).filter((s) => !s.deleted && shown.includes(s.division));
  const starts = [...new Set(live.map((s) => s.startMin))].sort((a, b) => a - b);

  async function publish() {
    if (!data) return;
    if (!window.confirm(t.publishConfirm(data.unpublished))) return;
    setBusy(true);
    try {
      const r = await api<{ published: number; people: number }>(`/api/admin/locations/${locationId}/schedule/publish`, {
        method: 'POST',
        body: mode === 'month' ? { month } : { week },
      });
      setNotice(t.published(r.published, r.people));
      await load();
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    } finally {
      setBusy(false);
    }
  }
  async function copyWeek() {
    if (!window.confirm(t.copyConfirm)) return;
    setBusy(true);
    try {
      const r = await api<{ created: number }>(`/api/admin/locations/${locationId}/schedule/copy-week`, { method: 'POST', body: { week } });
      setNotice(t.copied(r.created));
      await load();
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 className="page-title">{t.title}</h1>
        <div className="btn-row">
          <Btn onClick={() => setExporting(true)} disabled={!data || !present.length}>
            {t.export.button}
          </Btn>
          {mode === 'week' && (
            <Btn onClick={() => void copyWeek()} disabled={busy || !data}>
              {t.copyWeek}
            </Btn>
          )}
          <Btn kind="primary" onClick={() => void publish()} disabled={busy || !data?.unpublished}>
            {data?.unpublished ? t.publish(data.unpublished) : t.allPublished}
          </Btn>
        </div>
      </div>
      <div className="btn-row" style={{ alignItems: 'center' }}>
        <div className="seg" role="tablist" aria-label={t.view}>
          {(['week', 'month'] as const).map((x) => (
            <button
              key={x}
              type="button"
              role="tab"
              aria-selected={mode === x}
              onClick={() => {
                setMode(x);
                storageSet(MODE_KEY, x);
              }}
            >
              {x === 'week' ? t.weekView : t.monthView}
            </button>
          ))}
        </div>
        {mode === 'week' ? (
          <>
            <Btn onClick={() => setWeek(addDays(week, -7))} aria-label={t.prevWeek}>
              ‹
            </Btn>
            <Btn onClick={() => setWeek(weekStart(today))}>{t.thisWeek}</Btn>
            <Btn onClick={() => setWeek(addDays(week, 7))} aria-label={t.nextWeek}>
              ›
            </Btn>
            <strong style={{ fontSize: 15 }}>{t.weekLabel(longDay.format(new Date(`${week}T12:00:00Z`)), longDay.format(new Date(`${addDays(week, 6)}T12:00:00Z`)))}</strong>
          </>
        ) : (
          <>
            <Btn onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t.prevMonth}>
              ‹
            </Btn>
            <Btn onClick={() => setMonth(today.slice(0, 7))}>{t.thisMonth}</Btn>
            <Btn onClick={() => setMonth(shiftMonth(month, 1))} aria-label={t.nextMonth}>
              ›
            </Btn>
            <strong style={{ fontSize: 15 }}>{monthName(month)}</strong>
          </>
        )}
      </div>
      {data && data.deadline !== null && (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {Date.now() <= data.deadline ? t.deadlineOpen(formatDeadline(data.deadline)) : t.deadlineClosed(formatDeadline(data.deadline))}
        </p>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <ErrorBox message={error} />
      {present.length > 1 && (
        <div className="btn-row">
          <button className="chip" aria-pressed={!groups.length} onClick={() => (setGroups([]), storageSet(DIV_KEY, '[]'))}>
            {pl.admin.time.allDivisions}
          </button>
          {present.map((d) => (
            <button key={d} className="chip" aria-pressed={groups.includes(d)} onClick={() => toggleGroup(d)}>
              {pl.admin.divisions[d] ?? d}
            </button>
          ))}
        </div>
      )}
      {starts.length > 0 && (
        <div className="sch-legend" aria-label={t.legend}>
          <span className="muted">{t.legend}:</span>
          {starts.map((m) => (
            <button
              key={m}
              type="button"
              className="sch-legend-item"
              aria-pressed={highlight === m}
              style={{ ['--c' as string]: shiftColor(m) }}
              onClick={() => setHighlight(highlight === m ? null : m)}
            >
              <i />
              {formatHm(m)} · {live.filter((s) => s.startMin === m).length}
            </button>
          ))}
        </div>
      )}
      {!data && !error && <LogoLoader />}
      {data && present.length === 0 && <p className="muted">{t.noPeople}</p>}
      {data && present.length > 0 && (
        <div className="time-grid-wrap sch-fade" key={`${mode}-${mode === 'month' ? month : week}`}>
          <table className={`time-grid sch-grid${mode === 'month' ? ' month' : ''}${highlight !== null ? ' dim' : ''}`} style={{ ['--days' as string]: data.days.length }}>
            <thead>
              <tr>
                <th className="sticky">{t.person}</th>
                {data.days.map((d) => {
                  const day = live.filter((s) => s.date === d);
                  const byStart = [...new Set(day.map((s) => s.startMin))].sort((a, b) => a - b);
                  return (
                    <th key={d} className={`${d === today ? 'today' : ''}${isWeekend(d) ? ' weekend' : ''}`}>
                      <div>{mode === 'month' ? monthHead(d) : dayHead.format(new Date(`${d}T12:00:00Z`))}</div>
                      <div className="sch-counts">
                        {mode === 'week' &&
                          byStart.map((m) => (
                            <span key={m} style={{ color: shiftColor(m) }}>
                              {formatHm(m)}×{day.filter((s) => s.startMin === m).length}
                            </span>
                          ))}
                        <strong>{mode === 'week' ? t.total(day.length) : day.length || ''}</strong>
                      </div>
                    </th>
                  );
                })}
                <th className="sch-hours-col">{t.hoursCol}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((g) => {
                const members = data.people.filter((p) => p.divisions.includes(g));
                if (!members.length) return null;
                return [
                  <tr key={`h-${g}`} className="group-row sch-division">
                    <th className="sticky" colSpan={1}>
                      <span className="sch-division-name">{pl.admin.divisions[g] ?? g}</span>
                      <span className="sch-division-count">{members.length}</span>
                    </th>
                    <td colSpan={data.days.length + 1} />
                  </tr>,
                  ...members.map((p) => (
                    <tr key={`${g}-${p.id}`}>
                      <th className="sticky" scope="row">
                        {can('employees.view') && (!data.editable || data.editable.includes(g)) ? (
                          <a className="name sch-person" href={`/panel/pracownicy/${p.id}`} onClick={onNav(`/panel/pracownicy/${p.id}`)}>
                            {short(p)}
                          </a>
                        ) : (
                          <span className="name">{short(p)}</span>
                        )}
                      </th>
                      {data.days.map((d) => {
                        const own = data.shifts.filter((s) => s.userId === p.id && s.date === d && s.division === g);
                        const off = data.unavailability.find((u) => u.userId === p.id && u.date === d);
                        const act = data.actual.filter((a) => a.userId === p.id && a.date === d);
                        return (
                          <td key={d} className={`${d === today ? 'today' : ''}${isWeekend(d) ? ' weekend' : ''}${off ? (isWhole(off) ? ' sch-off' : ' sch-off part') : ''}`}>
                            <button
                              type="button"
                              className="sch-cell"
                              disabled={Boolean(data.editable && !data.editable.includes(g))}
                              onClick={() => setCell({ person: p, division: g, date: d })}
                              aria-label={t.cellLabel(short(p), d)}
                            >
                              {own.map((s) => (
                                <span
                                  key={s.id}
                                  className={`sch-shift${s.deleted ? ' deleted' : ''}${s.changed ? ' changed' : ''}${highlight === s.startMin ? ' hl' : ''}`}
                                  style={{ ['--c' as string]: shiftColor(s.startMin) }}
                                                >
                                  {mode === 'month' ? `${compact(s.startMin)}–${compact(s.endMin)}` : range(s)}
                                </span>
                              ))}
                              {off && !own.length && (
                                <span className="sch-off-label" title={off.note ?? undefined}>
                                  {mode === 'month' ? (isWhole(off) ? '✕' : '◐') : isWhole(off) ? t.unavailable : offPart(off)}
                                </span>
                              )}
                              {off && own.length > 0 && <span className="sch-warn">{mode === 'month' ? '⚠' : `⚠ ${offPart(off)}`}</span>}
                              {mode === 'week' && <PlanVsActual shifts={own.filter((s) => !s.deleted)} actual={act} date={d} today={today} />}
                            </button>
                          </td>
                        );
                      })}
                      <td className="sch-hours-col">
                        {(() => {
                          const mine = data.shifts.filter((s) => s.userId === p.id && s.division === g && !s.deleted);
                          const min = mine.reduce((a, s) => a + (s.endMin - s.startMin), 0);
                          return min ? (
                            <span title={t.shiftsCount(mine.length)}>
                              <strong>{hours(min)}</strong>
                              <small>{t.shiftsCount(mine.length)}</small>
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          );
                        })()}
                      </td>
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        {t.help}
      </p>
      {data && <Templates templates={data.templates.filter((x) => shown.includes(x.division))} onChanged={load} onError={setError} />}
      {exporting && data && (
        <ExportDialog
          onClose={() => setExporting(false)}
          input={() => exportInput(data, shown, mode, me.locations.find((l) => l.id === locationId)?.name ?? 'Senator', mode === 'month' ? monthName(month) : t.weekLabel(longDay.format(new Date(`${week}T12:00:00Z`)), longDay.format(new Date(`${addDays(week, 6)}T12:00:00Z`))))}
          fileBase={`grafik-${mode === 'month' ? month : week}`}
        />
      )}
      {cell && data && (
        <ShiftDialog
          locationId={locationId}
          person={cell.person}
          division={cell.division}
          date={cell.date}
          shifts={data.shifts.filter((s) => s.userId === cell.person.id && s.date === cell.date && s.division === cell.division)}
          off={data.unavailability.find((u) => u.userId === cell.person.id && u.date === cell.date) ?? null}
          templates={data.templates.filter((x) => x.division === cell.division)}
          onClose={() => setCell(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

/** What goes on paper: the divisions on screen, every non-removed shift, days off in grey. */
function exportInput(data: WeekView, shown: string[], mode: 'week' | 'month', location: string, period: string): ExportInput {
  const x = t.export;
  const groups = shown.map((g) => ({
    name: pl.admin.divisions[g] ?? g,
    rows: data.people
      .filter((p) => p.divisions.includes(g))
      .map((p) => {
        const mine = data.shifts.filter((s) => s.userId === p.id && s.division === g && !s.deleted);
        const min = mine.reduce((a, s) => a + (s.endMin - s.startMin), 0);
        return {
          name: `${p.firstName} ${p.lastName}`,
          hours: min ? hours(min) : '—',
          cells: data.days.map((d) => {
            const own = mine.filter((s) => s.date === d).sort((a, b) => a.startMin - b.startMin);
            if (own.length) return { lines: own.map((s) => (mode === 'month' ? `${compact(s.startMin)}–${compact(s.endMin)}` : range(s))) };
            const off = data.unavailability.find((u) => u.userId === p.id && u.date === d);
            if (off) return { lines: [mode === 'month' ? (isWhole(off) ? '✕' : '½') : isWhole(off) ? x.off : offPart(off)], muted: true };
            return { lines: [] };
          }),
        };
      }),
  }));
  const stamp = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' }).format(new Date());
  return {
    title: `${t.title} · ${location}`,
    subtitle: period,
    note: data.unpublished ? x.draft(data.unpublished) : undefined,
    footer: x.footer(stamp),
    days: data.days.map((d) => {
      const date = new Date(`${d}T12:00:00Z`);
      return mode === 'month'
        ? { label: String(date.getUTCDate()), sub: ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'][date.getUTCDay()], weekend: isWeekend(d) }
        : {
            label: new Intl.DateTimeFormat('pl-PL', { weekday: 'long', timeZone: 'UTC' }).format(date).replace(/^./, (c) => c.toUpperCase()),
            sub: new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(date),
            weekend: isWeekend(d),
          };
    }),
    hoursLabel: t.hoursCol,
    personLabel: t.person,
    groups,
    compact: mode === 'month',
  };
}

function ExportDialog({ onClose, input, fileBase }: { onClose: () => void; input: () => ExportInput; fileBase: string }) {
  const x = t.export;
  const [busy, setBusy] = useState<'png' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(kind: 'png' | 'pdf') {
    setBusy(kind);
    setError(null);
    try {
      await new Promise((r) => setTimeout(r, 30)); // let the button show "Przygotowuję…"
      const data = input();
      const blob = kind === 'png' ? await schedulePng(data) : schedulePdf(data);
      await deliver(blob, `${fileBase}.${kind}`);
      onClose();
    } catch {
      setError(x.failed);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Modal title={x.title} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {x.intro}
        </p>
        <button type="button" className="row-btn" disabled={busy !== null} onClick={() => void run('png')}>
          <strong>{busy === 'png' ? x.working : x.png}</strong>
          <span className="muted" style={{ fontSize: 12 }}>
            {x.pngHint}
          </span>
        </button>
        <button type="button" className="row-btn" disabled={busy !== null} onClick={() => void run('pdf')}>
          <strong>{busy === 'pdf' ? x.working : x.pdf}</strong>
          <span className="muted" style={{ fontSize: 12 }}>
            {x.pdfHint}
          </span>
        </button>
        <ErrorBox message={error} />
      </div>
    </Modal>
  );
}

const monthHead = (d: string) => {
  const x = new Date(`${d}T12:00:00Z`);
  return `${['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'][x.getUTCDay()]} ${x.getUTCDate()}`;
};

function formatDeadline(ms: number) {
  return new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' }).format(new Date(ms));
}

/** Small line under past shifts: when the person really came, late or absent. */
function PlanVsActual({ shifts, actual, date, today }: { shifts: Shift[]; actual: WeekView['actual']; date: string; today: string }) {
  if (!shifts.length || date > today) return null;
  if (!actual.length) return date < today ? <span className="sch-actual bad">{t.absent}</span> : null;
  const first = Math.min(...actual.map((a) => a.clockInAt));
  const planned = Math.min(...shifts.map((s) => s.startMin));
  const [h, m] = formatClock(first).split(':').map(Number) as [number, number];
  const late = h * 60 + m - planned;
  return <span className={`sch-actual${late > LATE_MIN ? ' bad' : ''}`}>{late > LATE_MIN ? t.late(formatClock(first), late) : t.came(formatClock(first))}</span>;
}

function ShiftDialog(props: {
  locationId: string;
  person: Person;
  division: string;
  date: string;
  shifts: Shift[];
  off: Off | null;
  templates: Template[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const endRef = useRef<HTMLInputElement>(null);
  const valid = VALID_TIME.test(start) && VALID_TIME.test(end);

  const run = async (fn: () => Promise<unknown>, close = false) => {
    setError(null);
    try {
      await fn();
      await props.onChanged();
      if (close) props.onClose();
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  };
  const add = (s: string, e: string) =>
    run(
      () =>
        api(`/api/admin/locations/${props.locationId}/schedule/shifts`, {
          method: 'POST',
          body: { userId: props.person.id, date: props.date, division: props.division, start: s, end: e },
        }),
      true,
    );

  return (
    <Modal title={`${short(props.person)} · ${longDay.format(new Date(`${props.date}T12:00:00Z`))}`} onClose={props.onClose}>
      <span className="muted" style={{ fontSize: 13 }}>
        {pl.admin.divisions[props.division] ?? props.division}
      </span>
      <OffEditor locationId={props.locationId} userId={props.person.id} date={props.date} off={props.off} onRun={run} />
      {props.shifts.map((s) => (
        <ShiftEditor key={`${s.id}-${s.startMin}-${s.endMin}-${s.deleted}`} shift={s} onRun={run} />
      ))}
      <div className="label">{t.addShift}</div>
      {props.templates.length > 0 && (
        <div className="btn-row">
          {props.templates.slice(0, 8).map((tp) => (
            <button key={tp.id} type="button" className="sch-template" style={{ ['--c' as string]: shiftColor(tp.startMin) }} onClick={() => void add(formatHm(tp.startMin), formatHm(tp.endMin))}>
              <i />
              {tp.label ? `${tp.label} · ` : ''}
              {range(tp)}
            </button>
          ))}
        </div>
      )}
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void add(start, end);
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
          <div className="field">
            <label htmlFor="sh-start">{t.start}</label>
            <TimeField id="sh-start" value={start} onChange={setStart} onComplete={() => endRef.current?.focus()} autoFocus={!props.templates.length} />
          </div>
          <div className="field">
            <label htmlFor="sh-end">{t.end}</label>
            <TimeField id="sh-end" ref={endRef} value={end} onChange={setEnd} />
          </div>
        </div>
        <ErrorBox message={error} />
        <div className="btn-row">
          <Btn kind="primary" type="submit" disabled={!valid}>
            {t.addShift}
          </Btn>
          <Btn onClick={props.onClose}>{pl.admin.card.close}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function ShiftEditor({ shift, onRun }: { shift: Shift; onRun: (fn: () => Promise<unknown>, close?: boolean) => Promise<void> }) {
  const [start, setStart] = useState(formatHm(shift.startMin));
  const [end, setEnd] = useState(formatHm(shift.endMin));
  const endRef = useRef<HTMLInputElement>(null);
  const dirty = start !== formatHm(shift.startMin) || end !== formatHm(shift.endMin);
  const ok = dirty && VALID_TIME.test(start) && VALID_TIME.test(end);
  if (shift.deleted) {
    return (
      <div className="sch-editor deleted">
        <span>
          <s>{range(shift)}</s> <span className="badge warn">{t.deletedPending}</span>
        </span>
        <Btn onClick={() => void onRun(() => api(`/api/admin/schedule/shifts/${shift.id}/restore`, { method: 'POST' }))}>{t.restore}</Btn>
      </div>
    );
  }
  return (
    <form
      className="sch-editor"
      style={{ ['--c' as string]: shiftColor(shift.startMin) }}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) void onRun(() => api(`/api/admin/schedule/shifts/${shift.id}`, { method: 'PUT', body: { start, end } }));
      }}
    >
      <div className="sch-editor-head">
        <strong>{range(shift)}</strong>
        {!shift.published ? (
          <span className="badge neutral">{t.badgeDraft}</span>
        ) : shift.changed ? (
          <span className="badge warn">{t.badgeChanged}</span>
        ) : (
          <span className="badge ok">{t.badgePublished}</span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
        <div className="field">
          <label htmlFor={`${shift.id}-s`}>{t.start}</label>
          <TimeField id={`${shift.id}-s`} value={start} onChange={setStart} onComplete={() => endRef.current?.focus()} />
        </div>
        <div className="field">
          <label htmlFor={`${shift.id}-e`}>{t.end}</label>
          <TimeField id={`${shift.id}-e`} ref={endRef} value={end} onChange={setEnd} />
        </div>
      </div>
      <div className="btn-row">
        <Btn kind="primary" type="submit" disabled={!ok}>
          {t.save}
        </Btn>
        <Btn kind="danger" onClick={() => void onRun(() => api(`/api/admin/schedule/shifts/${shift.id}`, { method: 'DELETE' }))}>
          {t.remove}
        </Btn>
      </div>
    </form>
  );
}

function Templates({ templates, onChanged, onError }: { templates: Template[]; onChanged: () => Promise<void>; onError: (e: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!templates.length) return null;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await onChanged();
    } catch (e) {
      onError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  };
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button type="button" className="sch-fold" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="label">{t.templates}</span>
        <span className="muted">
          {templates.length} {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            {t.templatesHint}
          </p>
          {templates.map((tp) => (
            <div key={tp.id} className="sch-tpl-row">
              <span className="sch-template static" style={{ ['--c' as string]: shiftColor(tp.startMin) }}>
                <i />
                {range(tp)}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {pl.admin.divisions[tp.division] ?? tp.division} · {t.used(tp.useCount)}
              </span>
              <input
                aria-label={t.templateName}
                defaultValue={tp.label ?? ''}
                placeholder={t.templateName}
                maxLength={40}
                onBlur={(e) => e.target.value !== (tp.label ?? '') && void run(() => api(`/api/admin/schedule/templates/${tp.id}`, { method: 'PUT', body: { label: e.target.value } }))}
              />
              <Btn kind="danger" onClick={() => void run(() => api(`/api/admin/schedule/templates/${tp.id}`, { method: 'DELETE' }))}>
                {t.remove}
              </Btn>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

/** Leader marks the day (or part of it) as unavailable — e.g. the person asked in person (owner, 2026-10-17). */
function OffEditor(props: { locationId: string; userId: string; date: string; off: Off | null; onRun: (fn: () => Promise<unknown>, close?: boolean) => Promise<void> }) {
  const o = props.off;
  const initialKind = !o ? 'none' : isWhole(o) ? 'whole' : (o.fromMin ?? 0) === 0 ? 'until' : 'from';
  const [kind, setKind] = useState<'none' | 'whole' | 'until' | 'from'>(initialKind);
  const [time, setTime] = useState(o && !isWhole(o) ? formatHm((o.fromMin ?? 0) === 0 ? (o.toMin ?? 0) : (o.fromMin ?? 0)) : '');
  const [note, setNote] = useState(o?.note ?? '');
  const [editing, setEditing] = useState(false);
  const save = () => {
    const m = time && VALID_TIME.test(time) ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : null;
    const body =
      kind === 'whole' ? {} : kind === 'until' ? { fromMin: 0, toMin: m } : { fromMin: m, toMin: 1440 };
    return props.onRun(() =>
      api(`/api/admin/locations/${props.locationId}/schedule/unavailability`, { method: 'PUT', body: { userId: props.userId, date: props.date, note, ...body } }),
    );
  };
  if (!editing) {
    return o ? (
      <div className="sch-offbox">
        <span>
          <strong>{t.unavailable}</strong> · {offPart(o)}
          {o.note ? ` · „${o.note}”` : ''}
          <span className="muted" style={{ display: 'block', fontSize: 12 }}>
            {o.setByName ? t.offSetBy(o.setByName) : t.offByPerson}
          </span>
        </span>
        <span className="btn-row">
          <Btn onClick={() => setEditing(true)}>{t.offChange}</Btn>
          <Btn
            kind="danger"
            onClick={() => void props.onRun(() => api(`/api/admin/locations/${props.locationId}/schedule/unavailability?userId=${props.userId}&date=${props.date}`, { method: 'DELETE' }))}
          >
            {t.remove}
          </Btn>
        </span>
      </div>
    ) : (
      <button type="button" className="sch-offlink" onClick={() => (setKind('whole'), setEditing(true))}>
        {t.offMark}
      </button>
    );
  }
  return (
    <form
      className="sch-offbox editing"
      onSubmit={(e) => {
        e.preventDefault();
        void save().then(() => setEditing(false));
      }}
    >
      <div className="seg" role="tablist">
        {(['whole', 'until', 'from'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)}>
            {k === 'whole' ? t.offWholeLabel : k === 'until' ? t.offUntilLabel : t.offFromLabel}
          </button>
        ))}
      </div>
      {kind !== 'whole' && (
        <div className="field">
          <label htmlFor="off-time">{kind === 'until' ? t.offUntilLabel : t.offFromLabel}</label>
          <TimeField id="off-time" value={time} onChange={setTime} />
        </div>
      )}
      <input aria-label={t.offNote} placeholder={t.offNote} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      <div className="btn-row">
        <Btn kind="primary" type="submit" disabled={kind !== 'whole' && !VALID_TIME.test(time)}>
          {t.save}
        </Btn>
        <Btn onClick={() => setEditing(false)}>{pl.common.cancel}</Btn>
      </div>
    </form>
  );
}
