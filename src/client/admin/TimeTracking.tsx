import { createPortal } from 'react-dom';
import { useLiveRefresh } from '../live';
import { divisionOf as divisionOfPosition } from '../../shared/constants';
import { formatHm, shiftStartMs } from '../../shared/schedule';
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { addDays, businessDate, formatClock, formatDuration, warsawToMs } from '../../shared/time';
import { comparePl } from '../../shared/text';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { ErrorBox, LogoLoader } from '../ui';
import { Btn, formatDateTime, Modal, SecretCardModal, storageGet, storageSet, type SecretInfo } from './common';
import { usePanel } from './Panel';

const t = pl.admin.time;
const MODE_KEY = 'sa.panel.timeMode';
const GROUPS_KEY = 'sa.panel.timeGroups';
/** Divisions of the table, in this order (D37). */
export const DIVISIONS = ['waiter', 'host', 'bartender', 'kitchen', 'hookah_master', 'call_center', 'shift_manager'] as const;
/** "Zofia N." — first name and the initial of the last name (D39). */
export const shortName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName.trim().charAt(0)}.`;
const money0 = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "250 zł" for whole złoty, "32,50 zł" otherwise. */
export const formatMoney = (grosze: number) => (grosze % 100 === 0 ? money0 : money2).format(grosze / 100);

interface Person {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  position: string | null;
  positions?: string | null;
}
interface Entry {
  id: string;
  userId: string;
  businessDate: string;
  clockInAt: number;
  clockOutAt: number | null;
  inSource: string;
  outSource: string | null;
  note: string | null;
  editedAt: number | null;
  editedByName: string | null;
  /** position the shift was worked on (manager's choice, plan, or main) */
  position?: string | null;
  positionSet?: string | null;
}
interface Rate {
  userId: string;
  position?: string;
  rateGrosze: number;
  validFrom: string;
}
interface TimeData {
  days: string[];
  now: number;
  staleHours: number;
  dayStartHour: number;
  wages: boolean;
  rates: Rate[];
  people: Person[];
  entries: Entry[];
  openBefore: Entry[];
  plan?: { userId: string; date: string; startMin: number; endMin: number }[];
}

function mondayOf(date: string): string {
  const d = new Date(date + 'T12:00:00Z').getUTCDay(); // 0 = Sunday
  return addDays(date, -((d + 6) % 7));
}
function monthRange(date: string): [string, string] {
  const first = date.slice(0, 8) + '01';
  const next = new Date(Date.parse(first + 'T12:00:00Z'));
  next.setUTCMonth(next.getUTCMonth() + 1);
  return [first, addDays(next.toISOString().slice(0, 10), -1)];
}
const dayFmt = new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
const longFmt = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const dayLabel = (d: string) => dayFmt.format(new Date(d + 'T12:00:00Z'));
const longLabel = (d: string) => longFmt.format(new Date(d + 'T12:00:00Z'));
const minutesOf = (e: Entry) => (e.clockOutAt ? (e.clockOutAt - e.clockInAt) / 60000 : 0);

/** "HH:MM" on a business day: 00:00–05:59 is the night after that day. */
function businessTimeToMs(date: string, hhmm: string, dayStartHour: number): number {
  const hour = Number(hhmm.slice(0, 2));
  return warsawToMs(hour < dayStartHour ? addDays(date, 1) : date, hhmm);
}

export function TimeTracking() {
  const { locationId, isOwner } = usePanel();
  const [mode, setMode] = useState<'week' | 'month'>(storageGet(MODE_KEY) === 'month' ? 'month' : 'week');
  const [anchor, setAnchor] = useState(businessDate(Date.now()));
  const [data, setData] = useState<TimeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cell, setCell] = useState<{ person: Person; date: string } | null>(null);
  const [groups, setGroups] = useState<string[]>(() => {
    try {
      const v = JSON.parse(storageGet(GROUPS_KEY) ?? '[]') as string[];
      return Array.isArray(v) ? v.filter((g) => (DIVISIONS as readonly string[]).includes(g)) : [];
    } catch {
      return [];
    }
  });
  const toggleGroup = (g: string | null) => {
    const next = g === null ? [] : groups.includes(g) ? groups.filter((x) => x !== g) : [...groups, g];
    setGroups(next);
    storageSet(GROUPS_KEY, JSON.stringify(next));
  };

  const [from, to] = useMemo<[string, string]>(() => (mode === 'week' ? [mondayOf(anchor), addDays(mondayOf(anchor), 6)] : monthRange(anchor)), [mode, anchor]);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api<TimeData>(`/api/admin/locations/${locationId}/time?from=${from}&to=${to}`));
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }, [locationId, from, to]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);
  useLiveRefresh(load);

  const people = useMemo(() => [...(data?.people ?? [])].sort((a, b) => comparePl(`${a.lastName} ${a.firstName}`, `${b.lastName} ${b.firstName}`)), [data]);
  const divisionOf = (p: Person) => {
    const d = divisionOfPosition(p.position ?? '');
    return (DIVISIONS as readonly string[]).includes(d) ? d : 'waiter';
  };
  const present = DIVISIONS.filter((d) => people.some((p) => divisionOf(p) === d));
  const visibleGroups = present.filter((d) => !groups.length || groups.includes(d));
  const costOf = (e: Entry): number | null => {
    if (!data?.wages || !e.clockOutAt) return null;
    // rates come sorted by valid_from; before the first one the first one applies
    // 2026-10-17: the position's own rates, else the common ones; before the first one the first one applies
    const all = data.rates.filter((x) => x.userId === e.userId);
    const own = e.position ? all.filter((x) => x.position === e.position) : [];
    const mine = own.length ? own : all.filter((x) => !x.position);
    let r: number | null = mine[0]?.rateGrosze ?? null;
    for (const x of mine) if (x.validFrom <= e.businessDate) r = x.rateGrosze;
    return r === null ? null : Math.round((minutesOf(e) / 60) * r);
  };
  const sumCost = (es: Entry[]) => es.reduce((s, e) => s + (costOf(e) ?? 0), 0);
  const noRate = (es: Entry[]) => Boolean(data?.wages) && es.some((e) => e.clockOutAt && costOf(e) === null);
  const staleMs = (data?.staleHours ?? 16) * 3600_000;
  const isLive = (e: Entry) => !e.clockOutAt && data !== null && data.now - e.clockInAt <= staleMs;
  const isMissing = (e: Entry) => !e.clockOutAt && data !== null && data.now - e.clockInAt > staleMs;
  const all = [...(data?.entries ?? []), ...(data?.openBefore ?? [])];
  const live = all.filter(isLive);
  const missing = all.filter(isMissing);
  const nameOf = (id: string) => {
    const p = data?.people.find((x) => x.id === id);
    return p ? shortName(p) : '—';
  };
  const fullNameOf = (id: string) => {
    const p = data?.people.find((x) => x.id === id);
    return p ? `${p.firstName} ${p.lastName}` : '—';
  };

  function shift(dir: -1 | 1) {
    if (mode === 'week') setAnchor(addDays(anchor, dir * 7));
    else {
      const d = new Date(Date.parse(anchor.slice(0, 8) + '15T12:00:00Z'));
      d.setUTCMonth(d.getUTCMonth() + dir);
      setAnchor(d.toISOString().slice(0, 10));
    }
  }

  function exportCsv() {
    if (!data) return;
    const rows: string[][] = [[...t.csvHeader, ...(data.wages ? [t.csvCost] : [])]];
    const shownIds = new Set(people.filter((p) => visibleGroups.includes(divisionOf(p) as (typeof DIVISIONS)[number])).map((p) => p.id));
    const sorted = [...data.entries.filter((e) => shownIds.has(e.userId))].sort((a, b) => comparePl(fullNameOf(a.userId), fullNameOf(b.userId)) || a.clockInAt - b.clockInAt);
    for (const e of sorted) {
      rows.push([
        fullNameOf(e.userId),
        pl.admin.divisions[divisionOf(data.people.find((p) => p.id === e.userId) ?? ({ position: null } as Person))] ?? '',
        e.businessDate,
        formatDateTime(e.clockInAt),
        e.clockOutAt ? formatDateTime(e.clockOutAt) : t.missingShort,
        e.clockOutAt ? formatDuration(minutesOf(e)) : '',
        t.sources[e.inSource] ?? e.inSource,
        e.note ?? '',
        ...(data.wages ? [costOf(e) === null ? '' : (costOf(e)! / 100).toFixed(2).replace('.', ',')] : []),
      ]);
    }
    rows.push([]);
    for (const p of people) {
      const mins = data.entries.filter((e) => e.userId === p.id).reduce((s, e) => s + minutesOf(e), 0);
      if (mins && shownIds.has(p.id))
        rows.push([`${p.firstName} ${p.lastName}`, '', `${from} – ${to}`, '', '', formatDuration(mins), t.total, '', ...(data.wages ? [(sumCost(data.entries.filter((e) => e.userId === p.id)) / 100).toFixed(2).replace('.', ',')] : [])]);
    }
    const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `czas-pracy-${from}-${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 className="page-title">{t.title}</h1>
        <div className="btn-row">
          <Btn onClick={exportCsv} disabled={!data}>
            {t.export}
          </Btn>
        </div>
      </div>
      <ErrorBox message={error} />

      <div className="btn-row" style={{ alignItems: 'center' }}>
        {(['week', 'month'] as const).map((m) => (
          <button
            key={m}
            className="chip"
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              storageSet(MODE_KEY, m);
            }}
          >
            {t[m]}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <Btn onClick={() => shift(-1)}>‹ {t.prev}</Btn>
        <Btn onClick={() => setAnchor(businessDate(Date.now()))}>{t.today}</Btn>
        <Btn onClick={() => shift(1)}>
          {t.next} ›
        </Btn>
      </div>
      <div className="muted" style={{ fontSize: 14, fontWeight: 600 }}>
        {longLabel(from)} – {longLabel(to)}
      </div>

      {data && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="label">{t.nowOnShift}</div>
          {live.length === 0 ? (
            <span className="muted">{t.nobody}</span>
          ) : (
            <div className="btn-row">
              {live.map((e) => (
                <span key={e.id} className="badge ok" style={{ fontSize: 13, padding: '6px 10px' }}>
                  {nameOf(e.userId)} · {formatClock(e.clockInAt)}
                </span>
              ))}
            </div>
          )}
          {missing.length > 0 && <div className="notice warn-notice">{t.missing(missing.length)}</div>}
        </div>
      )}

      {!data && !error && <LogoLoader />}
      {data && people.length === 0 && <p className="muted">{t.empty}</p>}
      {data && present.length > 1 && (
        <div className="btn-row" role="group" aria-label={t.divisions}>
          <button className="chip" aria-pressed={groups.length === 0} onClick={() => toggleGroup(null)}>
            {t.allDivisions}
          </button>
          {present.map((d) => (
            <button key={d} className="chip" aria-pressed={groups.includes(d)} onClick={() => toggleGroup(d)}>
              {pl.admin.divisions[d] ?? d} · {people.filter((p) => divisionOf(p) === d).length}
            </button>
          ))}
        </div>
      )}
      {data && people.length > 0 && (
        <div className="time-grid-wrap">
          <table className="time-grid">
            <thead>
              <tr>
                <th className="sticky">{t.person}</th>
                {data.days.map((d) => (
                  <th key={d} className={d === businessDate(data.now, data.dayStartHour) ? 'today' : ''}>
                    {dayLabel(d)}
                  </th>
                ))}
                <th>{t.total}</th>
              </tr>
            </thead>
            {visibleGroups.map((g) => {
              const members = people.filter((p) => divisionOf(p) === g);
              const groupEntries = data.entries.filter((e) => members.some((m) => m.id === e.userId));
              const groupMinutes = groupEntries.reduce((s, e) => s + minutesOf(e), 0);
              return (
                <tbody key={g}>
                  <tr className="group-row">
                    <th className="sticky" scope="rowgroup">
                      {pl.admin.divisions[g] ?? g}
                    </th>
                    {data.days.map((d) => {
                      const es = groupEntries.filter((e) => e.businessDate === d);
                      const mins = es.reduce((s, e) => s + minutesOf(e), 0);
                      return (
                        <td key={d} className={d === businessDate(data.now, data.dayStartHour) ? 'today' : ''}>
                          {mins ? (
                            <span className="group-sum">
                              {formatDuration(mins)}
                              {data.wages && sumCost(es) > 0 && <small>{formatMoney(sumCost(es))}</small>}
                            </span>
                          ) : null}
                        </td>
                      );
                    })}
                    <td className="total">
                      <span className="group-sum">
                        {groupMinutes ? formatDuration(groupMinutes) : '—'}
                        {data.wages && sumCost(groupEntries) > 0 && <small>{formatMoney(sumCost(groupEntries))}</small>}
                      </span>
                    </td>
                  </tr>
                  {members.map((p) => {
                    const mine = data.entries.filter((e) => e.userId === p.id);
                    const total = mine.reduce((s, e) => s + minutesOf(e), 0);
                    return (
                      <tr key={p.id}>
                        <th className="sticky" scope="row">
                          <span className="name">{shortName(p)}</span>
                          <span className="pos">{p.position ? pl.admin.positions[p.position] ?? p.position : ''}</span>
                        </th>
                        {data.days.map((d) => {
                          const es = mine.filter((e) => e.businessDate === d);
                          const planned = (data.plan ?? []).filter((x) => x.userId === p.id && x.date === d);
                          return (
                            <td key={d} className={d === businessDate(data.now, data.dayStartHour) ? 'today' : ''}>
                              <button type="button" className={`cell${es.length ? ' has' : ''}`} onClick={() => setCell({ person: p, date: d })} aria-label={`${p.firstName} ${p.lastName}, ${d}`}>
                                {es.map((e) => {
                                  const cost = costOf(e);
                                  return (
                                    <span key={e.id} className={`shift${isMissing(e) ? ' miss' : isLive(e) ? ' live' : ''}`}>
                                      <span className="range">
                                        {formatClock(e.clockInAt)}–{e.clockOutAt ? formatClock(e.clockOutAt) : isMissing(e) ? '?' : '…'}
                                      </span>
                                      {data.wages && cost !== null && <small>{formatMoney(cost)}</small>}
                                      {isMissing(e) && <small>{t.missingShort}</small>}
                                    </span>
                                  );
                                })}
                                {planned.map((x) => {
                                  const startMs = shiftStartMs(d, x.startMin);
                                  const lateMin = es.length ? Math.round((Math.min(...es.map((e) => e.clockInAt)) - startMs) / 60000) : null;
                                  return (
                                    <small key={x.startMin} className={`plan${lateMin !== null && lateMin > 5 ? ' late' : !es.length && startMs < data.now ? ' absent' : ''}`}>
                                      {t.plan(formatHm(x.startMin), formatHm(x.endMin))}
                                      {lateMin !== null && lateMin > 5 ? ` · +${lateMin} min` : !es.length && startMs < data.now ? ` · ${t.absent}` : ''}
                                    </small>
                                  );
                                })}
                              </button>
                            </td>
                          );
                        })}
                        <td className="total">
                          <span className="group-sum">
                            {total ? formatDuration(total) : '—'}
                            {data.wages && total > 0 && <small>{noRate(mine) ? t.noRate : formatMoney(sumCost(mine))}</small>}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {t.legend}
      </p>

      <Terminals locationId={locationId} isOwner={isOwner} />

      {cell && data && (
        <DayDialog
          dayStartHour={data.dayStartHour}
          locationId={locationId}
          person={cell.person}
          date={cell.date}
          entries={all.filter((e) => e.userId === cell.person.id && e.businessDate === cell.date)}
          onClose={() => setCell(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

export const VALID_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:MM" typed as digits (the colon comes by itself); calls onComplete when four valid digits are in. */
export const TimeField = forwardRef<HTMLInputElement, { id: string; value: string; onChange: (v: string) => void; onComplete?: () => void; required?: boolean; autoFocus?: boolean }>(
  function TimeField({ id, value, onChange, onComplete, required, autoFocus }, ref) {
    return (
      <input
        id={id}
        ref={ref}
        inputMode="numeric"
        autoComplete="off"
        placeholder="GG:MM"
        maxLength={5}
        required={required}
        autoFocus={autoFocus}
        pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
        value={value}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
          const next = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
          onChange(next);
          if (digits.length === 4 && VALID_TIME.test(next)) onComplete?.();
        }}
      />
    );
  },
);

function EntryEditor({ entry, date, dayStartHour, positions = [], onSave, onDelete }: { entry: Entry | null; date: string; dayStartHour: number; positions?: string[]; onSave: (inAt: number, outAt: number | null, note: string, position?: string | null) => Promise<string | null>; onDelete?: () => Promise<void> }) {
  const toHHMM = (ms: number) => formatClock(ms);
  const [inT, setIn] = useState(entry ? toHHMM(entry.clockInAt) : '');
  const [outT, setOut] = useState(entry?.clockOutAt ? toHHMM(entry.clockOutAt) : '');
  const [note, setNote] = useState(entry?.note ?? '');
  const [position, setPosition] = useState(entry?.positionSet ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // the original entry may start on another business day (open shift from earlier): keep its own date
  const day = entry ? entry.businessDate : date;
  const outRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const uid = entry?.id ?? 'new';
  const valid = VALID_TIME.test(inT) && (!outT || VALID_TIME.test(outT));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const inAt = businessTimeToMs(day, inT, dayStartHour);
    let outAt = outT ? businessTimeToMs(day, outT, dayStartHour) : null;
    if (outAt !== null && outAt <= inAt) outAt += 24 * 3600_000; // e.g. 05:00 → 07:00 next morning
    setError(await onSave(inAt, outAt, note, positions.length > 1 ? position || null : undefined));
    setBusy(false);
  }
  return (
    <form onSubmit={submit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
        <div className="field">
          <label htmlFor={`${uid}-in`}>{t.in}</label>
          <TimeField id={`${uid}-in`} value={inT} onChange={setIn} onComplete={() => outRef.current?.focus()} required autoFocus={!entry} />
        </div>
        <div className="field">
          <label htmlFor={`${uid}-out`}>{t.out}</label>
          <TimeField id={`${uid}-out`} ref={outRef} value={outT} onChange={setOut} onComplete={() => noteRef.current?.focus()} />
        </div>
      </div>
      {entry && positions.length > 1 && (
        <div className="field">
          <label htmlFor={`${uid}-pos`}>{t.position}</label>
          <select id={`${uid}-pos`} value={position} onChange={(e) => setPosition(e.target.value)}>
            <option value="">{t.positionAuto(pl.admin.positions[entry.position ?? ''] ?? entry.position ?? '—')}</option>
            {positions.map((p) => (
              <option key={p} value={p}>
                {pl.admin.positions[p] ?? p}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label>{t.note}</label>
        <input ref={noteRef} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </div>
      {entry && (
        <span className="muted" style={{ fontSize: 12 }}>
          {t.sources[entry.inSource] ?? entry.inSource}
          {entry.outSource && entry.outSource !== entry.inSource ? ` / ${t.sources[entry.outSource] ?? entry.outSource}` : ''}
          {entry.editedByName && entry.editedAt ? ` · ${t.edited(entry.editedByName, formatDateTime(entry.editedAt))}` : ''}
        </span>
      )}
      {error && <div className="notice warn-notice">{error}</div>}
      <div className="btn-row">
        <Btn kind="primary" type="submit" disabled={!valid || busy}>
          {entry ? t.save : t.addEntry}
        </Btn>
        {onDelete && (
          <Btn kind="danger" onClick={() => window.confirm(t.removeConfirm) && void onDelete()}>
            {t.remove}
          </Btn>
        )}
      </div>
    </form>
  );
}

function DayDialog(props: { locationId: string; person: Person; date: string; dayStartHour: number; entries: Entry[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [adding, setAdding] = useState(props.entries.length === 0);
  const [punches, setPunches] = useState<{ id: string; at: number; outcome: string; person: string | null; offline: number; hasPhoto?: number }[] | null>(null);
  const [bigPhoto, setBigPhoto] = useState<{ id: string; caption: string } | null>(null);
  useEffect(() => {
    void api<{ punches: typeof punches }>(`/api/admin/locations/${props.locationId}/time/punches?date=${props.date}`)
      .then((r) => setPunches(r.punches))
      .catch(() => setPunches([]));
  }, [props.locationId, props.date]);
  const name = `${props.person.firstName} ${props.person.lastName}`;
  const mine = (punches ?? []).filter((p) => p.person === name);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await props.onChanged();
      return null;
    } catch (e) {
      return errorText(e instanceof ApiFailure ? e.code : 'generic');
    }
  };

  return (
    <Modal title={t.dayTitle(name, longLabel(props.date))} onClose={props.onClose}>
      {props.entries.length === 0 && !adding && <p className="muted">{t.noEntries}</p>}
      {props.entries.map((e) => (
        <EntryEditor
          dayStartHour={props.dayStartHour}
          key={`${e.id}-${e.clockInAt}-${e.clockOutAt}`}
          entry={e}
          date={props.date}
          positions={props.person.positions ? props.person.positions.split(',') : []}
          onSave={async (inAt, outAt, note, position) => {
            const err = await run(() => api(`/api/admin/time/entries/${e.id}`, { method: 'PUT', body: { clockInAt: inAt, clockOutAt: outAt, note, ...(position !== undefined ? { position } : {}) } }));
            if (!err) props.onClose(); // saved: back to the calendar (owner, 2026-10-17)
            return err;
          }}
          onDelete={async () => {
            await run(() => api(`/api/admin/time/entries/${e.id}`, { method: 'DELETE' }));
            props.onClose();
          }}
        />
      ))}
      {adding ? (
        <EntryEditor
          dayStartHour={props.dayStartHour}
          entry={null}
          date={props.date}
          onSave={async (inAt, outAt, note) => {
            const err = await run(() => api(`/api/admin/locations/${props.locationId}/time/entries`, { method: 'POST', body: { userId: props.person.id, clockInAt: inAt, clockOutAt: outAt, note } }));
            if (!err) props.onClose();
            return err;
          }}
        />
      ) : (
        <Btn onClick={() => setAdding(true)}>{t.addEntry}</Btn>
      )}
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        {t.afterMidnight(props.dayStartHour)}
      </p>
      {mine.length > 0 && <PunchCards punches={mine} onOpen={setBigPhoto} />}
      {bigPhoto && <PhotoLightbox src={`/api/admin/time/punches/${bigPhoto.id}/photo`} caption={bigPhoto.caption} onClose={() => setBigPhoto(null)} />}
    </Modal>
  );
}

type Punch = { id: string; at: number; outcome: string; person: string | null; offline: number; hasPhoto?: number };

/** Option B (owner, 2026-10-17): every shift as a card — entry and exit photos side by side, large. */
function PunchCards({ punches, onOpen }: { punches: Punch[]; onOpen: (p: { id: string; caption: string }) => void }) {
  const sorted = [...punches].sort((a, b) => a.at - b.at);
  const cards: { in: Punch | null; out: Punch | null }[] = [];
  const other: Punch[] = [];
  for (const p of sorted) {
    if (p.outcome === 'in') cards.push({ in: p, out: null });
    else if (p.outcome === 'out') {
      const open = [...cards].reverse().find((c) => !c.out);
      if (open) open.out = p;
      else cards.push({ in: null, out: p });
    } else other.push(p);
  }
  const side = (p: Punch | null, kind: 'in' | 'out') => {
    const label = kind === 'in' ? t.punchIn : t.punchOut;
    if (!p)
      return (
        <div className="pcard-side empty">
          <div className="pcard-photo none">{t.noPunch}</div>
          <div className="pcard-meta">
            <span>{label}</span>
            <strong>—</strong>
          </div>
        </div>
      );
    const caption = `${label} · ${formatClock(p.at)}`;
    return (
      <div className="pcard-side">
        {p.hasPhoto ? (
          <button type="button" className="pcard-photo" onClick={() => onOpen({ id: p.id, caption })} aria-label={`${t.punchPhoto}: ${caption}`}>
            <img src={`/api/admin/time/punches/${p.id}/photo`} alt="" loading="lazy" />
          </button>
        ) : (
          <div className="pcard-photo none">{t.noPhoto}</div>
        )}
        <div className="pcard-meta">
          <span>{label}</span>
          <strong>{formatClock(p.at)}</strong>
          {p.offline ? <em>{t.sources.offline}</em> : null}
        </div>
      </div>
    );
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="label">{t.punches}</div>
      {cards.map((c, i) => (
        <div key={i} className="pcard" style={{ animationDelay: `${i * 60}ms` }}>
          {side(c.in, 'in')}
          {side(c.out, 'out')}
        </div>
      ))}
      {other.length > 0 && (
        <div className="muted" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {other.map((p) => (
            <span key={p.id}>
              {formatClock(p.at)} · {t.outcomes[p.outcome] ?? p.outcome}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Full-size photo over the dialog: grows in smoothly, closes with a tap or Esc. */
export function PhotoLightbox({ src, caption, onClose }: { src: string; caption: string; onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const close = () => {
    setClosing(true);
    window.setTimeout(onClose, 200);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <div className={`lightbox${closing ? ' closing' : ''}`} role="dialog" aria-label={caption} onClick={close}>
      <figure>
        <img src={src} alt={caption} />
        <figcaption>{caption}</figcaption>
      </figure>
    </div>,
    document.body,
  );
}

interface TerminalRow {
  id: string;
  name: string;
  login: string;
  status: string;
  lastSeenAt: number | null;
  sessions: number;
}

function Terminals({ locationId, isOwner }: { locationId: string; isOwner: boolean }) {
  const [list, setList] = useState<TerminalRow[] | null>(null);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<SecretInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setList((await api<{ terminals: TerminalRow[] }>(`/api/admin/locations/${locationId}/terminals`)).terminals);
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }, [locationId]);
  useEffect(() => {
    void load();
  }, [load]);

  const card = (n: string, d: { login: string; tempSecret: string }): SecretInfo => ({
    name: `Terminal · ${n}`,
    login: d.login,
    tempSecret: d.tempSecret,
    secretKind: 'password',
    note: t.terminalCardNote,
    secretLabel: t.terminalPassword,
  });

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const d = await api<{ login: string; tempSecret: string }>(`/api/admin/locations/${locationId}/terminals`, { method: 'POST', body: { name } });
      setSecret(card(name, d));
      setName('');
      await load();
    } catch (err) {
      setError(errorText(err instanceof ApiFailure ? err.code : 'generic'));
    }
  }

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="label">{t.terminals}</div>
      <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
        {t.terminalsInfo}
      </p>
      <ErrorBox message={error} />
      {list?.map((r) => (
        <div key={r.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <strong>{r.name}</strong>
            <span className="muted" style={{ fontSize: 12 }}>
              {r.login} · {r.status !== 'active' ? t.disabled : r.sessions ? t.signedIn : t.signedOut} · {r.lastSeenAt ? t.lastSeen(formatDateTime(r.lastSeenAt)) : t.neverSeen}
            </span>
          </div>
          {isOwner && (
            <div className="btn-row">
              <Btn
                onClick={async () => {
                  const d = await api<{ login: string; tempSecret: string }>(`/api/admin/terminals/${r.id}/reset`, { method: 'POST' });
                  setSecret(card(r.name, d));
                  await load();
                }}
              >
                {t.resetTerminal}
              </Btn>
              {r.status === 'active' && (
                <Btn
                  kind="danger"
                  onClick={async () => {
                    if (!window.confirm(t.disableConfirm)) return;
                    await api(`/api/admin/terminals/${r.id}/disable`, { method: 'POST' });
                    await load();
                  }}
                >
                  {t.disableTerminal}
                </Btn>
              )}
            </div>
          )}
        </div>
      ))}
      {isOwner && (
        <form onSubmit={add} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 220px' }}>
            <label htmlFor="trm-name">{t.terminalName}</label>
            <input id="trm-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
          <Btn kind="primary" type="submit" disabled={!name.trim()}>
            {t.addTerminal}
          </Btn>
        </form>
      )}
      {secret && <SecretCardModal info={secret} onClose={() => setSecret(null)} />}
    </section>
  );
}
