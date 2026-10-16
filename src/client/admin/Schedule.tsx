/**
 * Grafik (D43): week × people by division. Shifts are coloured by start time; templates of the division are one tap away;
 * nothing reaches staff until "Opublikuj".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatHm, shiftColor, weekStart } from '../../shared/schedule';
import { addDays, businessDate, formatClock } from '../../shared/time';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { ErrorBox, LogoLoader } from '../ui';
import { Btn, Modal, storageGet, storageSet } from './common';
import { usePanel } from './Panel';
import { TimeField, VALID_TIME } from './TimeTracking';

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
  unavailability: { userId: string; date: string; note: string | null }[];
  templates: Template[];
  actual: { userId: string; date: string; clockInAt: number; clockOutAt: number | null }[];
  unpublished: number;
  deadline: number;
  divisions: string[] | null;
}

const short = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName.trim().charAt(0)}.`;
const range = (s: { startMin: number; endMin: number }) => `${formatHm(s.startMin)}–${formatHm(s.endMin)}`;
const dayHead = new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
const longDay = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const LATE_MIN = 5;

export function Schedule() {
  const { locationId } = usePanel();
  const today = businessDate(Date.now());
  const [week, setWeek] = useState(() => weekStart(addDays(today, 7)));
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
      setData(await api<WeekView>(`/api/admin/locations/${locationId}/schedule?week=${week}`));
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }, [locationId, week]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

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
      const r = await api<{ published: number; people: number }>(`/api/admin/locations/${locationId}/schedule/publish`, { method: 'POST', body: { week } });
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
          <Btn onClick={() => void copyWeek()} disabled={busy || !data}>
            {t.copyWeek}
          </Btn>
          <Btn kind="primary" onClick={() => void publish()} disabled={busy || !data?.unpublished}>
            {data?.unpublished ? t.publish(data.unpublished) : t.allPublished}
          </Btn>
        </div>
      </div>
      <div className="btn-row" style={{ alignItems: 'center' }}>
        <Btn onClick={() => setWeek(addDays(week, -7))} aria-label={t.prevWeek}>
          ‹
        </Btn>
        <Btn onClick={() => setWeek(weekStart(today))}>{t.thisWeek}</Btn>
        <Btn onClick={() => setWeek(addDays(week, 7))} aria-label={t.nextWeek}>
          ›
        </Btn>
        <strong style={{ fontSize: 15 }}>{t.weekLabel(longDay.format(new Date(`${week}T12:00:00Z`)), longDay.format(new Date(`${addDays(week, 6)}T12:00:00Z`)))}</strong>
      </div>
      {data && (
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
        <div className="time-grid-wrap">
          <table className={`time-grid sch-grid${highlight !== null ? ' dim' : ''}`}>
            <thead>
              <tr>
                <th className="sticky">{t.person}</th>
                {data.days.map((d) => {
                  const day = live.filter((s) => s.date === d);
                  const byStart = [...new Set(day.map((s) => s.startMin))].sort((a, b) => a - b);
                  return (
                    <th key={d} className={d === today ? 'today' : undefined}>
                      <div>{dayHead.format(new Date(`${d}T12:00:00Z`))}</div>
                      <div className="sch-counts">
                        {byStart.map((m) => (
                          <span key={m} style={{ color: shiftColor(m) }}>
                            {formatHm(m)}×{day.filter((s) => s.startMin === m).length}
                          </span>
                        ))}
                        <strong>{t.total(day.length)}</strong>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((g) => {
                const members = data.people.filter((p) => p.divisions.includes(g));
                if (!members.length) return null;
                return [
                  <tr key={`h-${g}`} className="group-row">
                    <th className="sticky" colSpan={1}>
                      {pl.admin.divisions[g] ?? g} · {members.length}
                    </th>
                    <td colSpan={7} />
                  </tr>,
                  ...members.map((p) => (
                    <tr key={`${g}-${p.id}`}>
                      <th className="sticky" scope="row">
                        <span className="name">{short(p)}</span>
                      </th>
                      {data.days.map((d) => {
                        const own = data.shifts.filter((s) => s.userId === p.id && s.date === d && s.division === g);
                        const off = data.unavailability.find((u) => u.userId === p.id && u.date === d);
                        const act = data.actual.filter((a) => a.userId === p.id && a.date === d);
                        return (
                          <td key={d} className={`${d === today ? 'today' : ''}${off ? ' sch-off' : ''}`}>
                            <button type="button" className="sch-cell" onClick={() => setCell({ person: p, division: g, date: d })} aria-label={t.cellLabel(short(p), d)}>
                              {own.map((s) => (
                                <span
                                  key={s.id}
                                  className={`sch-shift${s.deleted ? ' deleted' : ''}${s.changed ? ' changed' : ''}${highlight === s.startMin ? ' hl' : ''}`}
                                  style={{ ['--c' as string]: shiftColor(s.startMin) }}
                                  title={s.note ?? undefined}
                                >
                                  {range(s)}
                                </span>
                              ))}
                              {off && !own.length && <span className="sch-off-label">{t.unavailable}</span>}
                              {off && own.length > 0 && <span className="sch-warn">{t.unavailableShort}</span>}
                              <PlanVsActual shifts={own.filter((s) => !s.deleted)} actual={act} date={d} today={today} />
                            </button>
                          </td>
                        );
                      })}
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
  off: { note: string | null } | null;
  templates: Template[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [note, setNote] = useState('');
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
          body: { userId: props.person.id, date: props.date, division: props.division, start: s, end: e, note: note || undefined },
        }),
      true,
    );

  return (
    <Modal title={`${short(props.person)} · ${longDay.format(new Date(`${props.date}T12:00:00Z`))}`} onClose={props.onClose}>
      <span className="muted" style={{ fontSize: 13 }}>
        {pl.admin.divisions[props.division] ?? props.division}
      </span>
      {props.off && (
        <div className="notice warn-notice">
          {t.unavailableInfo}
          {props.off.note ? ` „${props.off.note}”` : ''}
        </div>
      )}
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
      <div className="field">
        <label htmlFor="sh-note">{t.note}</label>
        <input id="sh-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={t.notePlaceholder} />
      </div>
      <ErrorBox message={error} />
      <div className="btn-row">
        <Btn kind="primary" disabled={!valid} onClick={() => void add(start, end)}>
          {t.addShift}
        </Btn>
        <Btn onClick={props.onClose}>{pl.admin.card.close}</Btn>
      </div>
    </Modal>
  );
}

function ShiftEditor({ shift, onRun }: { shift: Shift; onRun: (fn: () => Promise<unknown>, close?: boolean) => Promise<void> }) {
  const [start, setStart] = useState(formatHm(shift.startMin));
  const [end, setEnd] = useState(formatHm(shift.endMin));
  const [note, setNote] = useState(shift.note ?? '');
  const endRef = useRef<HTMLInputElement>(null);
  const dirty = start !== formatHm(shift.startMin) || end !== formatHm(shift.endMin) || note !== (shift.note ?? '');
  if (shift.deleted) {
    return (
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: 12 }}>
        <span>
          <s>{range(shift)}</s> · {t.deletedPending}
        </span>
        <Btn onClick={() => void onRun(() => api(`/api/admin/schedule/shifts/${shift.id}/restore`, { method: 'POST' }))}>{t.restore}</Btn>
      </div>
    );
  }
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderLeft: `4px solid ${shiftColor(shift.startMin)}` }}>
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
      <input aria-label={t.note} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={t.notePlaceholder} />
      <span className="muted" style={{ fontSize: 12 }}>
        {!shift.published ? t.notPublished : shift.changed ? t.changedSincePublish : t.isPublished}
      </span>
      <div className="btn-row">
        <Btn
          kind="primary"
          disabled={!dirty || !VALID_TIME.test(start) || !VALID_TIME.test(end)}
          onClick={() => void onRun(() => api(`/api/admin/schedule/shifts/${shift.id}`, { method: 'PUT', body: { start, end, note } }))}
        >
          {t.save}
        </Btn>
        <Btn kind="danger" onClick={() => void onRun(() => api(`/api/admin/schedule/shifts/${shift.id}`, { method: 'DELETE' }))}>
          {t.remove}
        </Btn>
      </div>
    </div>
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
