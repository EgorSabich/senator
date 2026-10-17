/**
 * Panel → Statystyki (owner, 2026-10-17; mockups 12–13): Obecność i spóźnienia, Rekrutacja.
 * Leaders see their divisions; the owner and zarządzający everything. CSV export of the visible table.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays } from '../../shared/time';
import { api, ApiFailure } from '../api';
import { DateField } from '../DateField';
import { errorText, pl } from '../i18n/pl';
import { useLiveRefresh } from '../live';
import { onNav } from '../router';
import { ErrorBox, LogoLoader } from '../ui';
import { Btn, Modal, storageGet, storageSet } from './common';
import { usePanel } from './Panel';

const t = pl.admin.stats;
const DIV = pl.admin.divisions;
const RT = pl.admin.recruitment;

type Period = 'week' | 'month' | 'quarter' | 'custom';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
const monday = (d: string) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
const ym = (d: string) => [Number(d.slice(0, 4)), Number(d.slice(5, 7))] as const;
const iso = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day)).toISOString().slice(0, 10);

/** The period containing `anchor`, moved by `shift` periods. */
function rangeOf(p: Period, anchor: string, shift: number): { from: string; to: string } {
  if (p === 'week') {
    const m = addDays(monday(anchor), 7 * shift);
    return { from: m, to: addDays(m, 6) };
  }
  const [y, mo] = ym(anchor);
  const len = p === 'quarter' ? 3 : 1;
  const first = p === 'quarter' ? Math.floor((mo - 1) / 3) * 3 + 1 : mo;
  const start = iso(y, first + shift * len, 1);
  const [sy, sm] = ym(start);
  return { from: start, to: iso(sy, sm + len, 0) };
}
const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const short = (d: string) => `${Number(d.slice(8, 10))}.${d.slice(5, 7)}`;
function label(p: Period, r: { from: string; to: string }) {
  const [y, m] = ym(r.from);
  if (p === 'month') return `${MONTHS[m - 1]} ${y}`;
  if (p === 'quarter') return `${Math.floor((m - 1) / 3) + 1} kwartał ${y}`;
  return `${short(r.from)} – ${short(r.to)}${r.to.slice(0, 4) !== today().slice(0, 4) ? ` ${r.to.slice(0, 4)}` : ''}`;
}
const hours = (min: number) => Math.round(min / 60).toLocaleString('pl-PL');
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const hm = (ms: number | null) =>
  ms === null ? '—' : new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' }).format(new Date(ms));
const dayName = (d: string) => new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));

function downloadCsv(name: string, rows: (string | number)[][]) {
  const text = rows.map((r) => r.map((v) => (/[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(';')).join('\r\n');
  // BOM: Excel opens Polish letters correctly; „;” is the separator Polish Excel expects
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const P_KEY = 'sa-stats-period';
const D_KEY = 'sa-stats-div';

export function Stats({ path }: { path: string }) {
  const section = path.startsWith('/panel/statystyki/rekrutacja') ? 'recruitment' : 'attendance';
  const [period, setPeriodRaw] = useState<Period>(() => (storageGet(P_KEY) as Period | null) ?? 'month');
  const [shift, setShift] = useState(0);
  const [custom, setCustom] = useState(() => rangeOf('month', today(), 0));
  const [division, setDivisionRaw] = useState(() => storageGet(D_KEY) ?? 'all');
  const [csv, setCsv] = useState<(() => void) | null>(null);
  const r = period === 'custom' ? custom : rangeOf(period, today(), shift);
  const setPeriod = (p: Period) => {
    setPeriodRaw(p);
    setShift(0);
    storageSet(P_KEY, p);
  };
  const setDivision = (d: string) => {
    setDivisionRaw(d);
    storageSet(D_KEY, d);
  };
  const query = `from=${r.from}&to=${r.to}${division !== 'all' ? `&division=${division}` : ''}`;

  return (
    <div className="page st">
      <div className="st-head">
        <h1 className="page-title">{t.title}</h1>
        <div className="st-periods">
          {(['week', 'month', 'quarter', 'custom'] as const).map((p) => (
            <button key={p} type="button" className="chip" aria-pressed={period === p} onClick={() => setPeriod(p)}>
              {t.periods[p]}
            </button>
          ))}
          <Btn onClick={() => csv?.()} disabled={!csv}>
            {t.csv}
          </Btn>
        </div>
      </div>
      <div className="st-layout">
        <nav className="st-nav" aria-label={t.title}>
          {(
            [
              ['/panel/statystyki', 'attendance', t.attendance],
              ['/panel/statystyki/rekrutacja', 'recruitment', t.recruitment],
            ] as const
          ).map(([href, key, l]) => (
            <a key={key} href={href} onClick={onNav(href)} aria-current={section === key ? 'page' : undefined}>
              {l}
            </a>
          ))}
        </nav>
        <div className="st-main">
          <div className="st-range">
            {period === 'custom' ? (
              <>
                <label className="st-date">
                  <span>{t.from}</span>
                  <DateField value={custom.from} max={custom.to} onChange={(v) => v && setCustom({ ...custom, from: v })} />
                </label>
                <label className="st-date">
                  <span>{t.to}</span>
                  <DateField value={custom.to} min={custom.from} onChange={(v) => v && setCustom({ ...custom, to: v })} />
                </label>
              </>
            ) : (
              <>
                <button type="button" className="st-arrow" onClick={() => setShift(shift - 1)} aria-label={t.prev}>
                  ‹
                </button>
                <b className="st-label">{label(period, r)}</b>
                <button type="button" className="st-arrow" onClick={() => setShift(shift + 1)} aria-label={t.next} disabled={shift >= 0}>
                  ›
                </button>
              </>
            )}
          </div>
          {section === 'attendance' ? (
            <Attendance query={query} range={r} division={division} setDivision={setDivision} setCsv={setCsv} />
          ) : (
            <Recruitment query={query} range={r} division={division} setDivision={setDivision} setCsv={setCsv} />
          )}
        </div>
      </div>
    </div>
  );
}

function useStats<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api<T>(url)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((x) => setError(errorText(x instanceof ApiFailure ? x.code : 'generic'))),
    [url],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(load);
  return { data, error, load };
}

function Divisions({ list, value, onChange }: { list: string[]; value: string; onChange: (d: string) => void }) {
  if (list.length < 2) return null;
  const v = value === 'all' || list.includes(value) ? value : 'all';
  return (
    <div className="st-chips">
      {['all', ...list].map((d) => (
        <button key={d} type="button" className="chip" aria-pressed={v === d} onClick={() => onChange(d)}>
          {d === 'all' ? t.allDivisions : (DIV[d] ?? d)}
        </button>
      ))}
    </div>
  );
}

function Kpi({ label: l, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' | 'warn' | 'ok' }) {
  return (
    <div className="st-kpi">
      <span className="muted">{l}</span>
      <b>{value}</b>
      {sub && <span className={`st-sub${tone ? ` ${tone}` : ''}`}>{sub}</span>}
    </div>
  );
}

/* ───────── Obecność i spóźnienia (mockup 12) ───────── */

interface Totals {
  shifts: number;
  absences: number;
  excused: number;
  late: number;
  lateAvgMin: number;
  missingExit: number;
  fixedExit: number;
  plannedMin: number;
  workedMin: number;
}
interface AttData {
  divisions: string[];
  canExcuse: boolean;
  totals: Totals;
  previous: Totals;
  weeks: { week: string; late: number; absences: number }[];
  people: (Totals & { userId: string; name: string; division: string })[];
}

interface Common {
  query: string;
  range: { from: string; to: string };
  division: string;
  setDivision: (d: string) => void;
  setCsv: (f: (() => void) | null) => void;
}

function Attendance({ query, range, division, setDivision, setCsv }: Common) {
  const { locationId } = usePanel();
  const { data, error, load } = useStats<AttData>(`/api/admin/locations/${locationId}/stats/attendance?${query}`);
  const [person, setPerson] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!data) return setCsv(null);
    const c = t.cols;
    setCsv(() => () =>
      downloadCsv(`obecnosc_${range.from}_${range.to}.csv`, [
        [c.person, c.division, c.shifts, c.absences, c.excused, c.late, `${c.avgLate} (min)`, c.missingExit],
        ...data.people.map((p) => [p.name, DIV[p.division] ?? p.division, p.shifts, p.absences, p.excused, p.late, p.lateAvgMin, p.missingExit]),
      ]),
    );
    return () => setCsv(null);
  }, [data, range.from, range.to, setCsv]);
  if (!data) return error ? <ErrorBox message={error} /> : <LogoLoader />;
  const k = data.totals;
  const max = Math.max(1, ...data.weeks.map((w) => Math.max(w.late, w.absences)));
  return (
    <>
      <Divisions list={data.divisions} value={division} onChange={setDivision} />
      <ErrorBox message={error} />
      <div className="st-kpis">
        <Kpi label={t.kpi.shifts} value={k.shifts.toLocaleString('pl-PL')} />
        <Kpi label={t.kpi.absences} value={String(k.absences)} sub={`${pct(k.absences, k.shifts)}% · ${t.vsPrev(k.absences - data.previous.absences)}`} tone={k.absences ? 'bad' : undefined} />
        <Kpi label={t.kpi.late} value={String(k.late)} sub={`${pct(k.late, k.shifts)}% · ${t.avgLate(k.lateAvgMin)}`} tone={k.late ? 'warn' : undefined} />
        <Kpi label={t.kpi.missingExit} value={String(k.missingExit)} sub={t.fixedN(k.fixedExit)} />
        <Kpi label={t.kpi.hours} value={`${hours(k.plannedMin)} / ${hours(k.workedMin)}`} sub={k.plannedMin ? `${k.workedMin >= k.plannedMin ? '+' : '−'}${Math.abs(Math.round(((k.workedMin - k.plannedMin) / k.plannedMin) * 1000) / 10).toLocaleString('pl-PL')}%` : undefined} />
      </div>
      {k.excused > 0 && <p className="muted st-note">{t.excusedN(k.excused)}</p>}
      {!k.shifts ? (
        <p className="muted">{t.empty}</p>
      ) : (
        <>
          {data.weeks.length > 1 && (
            <section className="card st-chart-card">
              <div className="st-chart-head">
                <h2 className="ntf-h">{t.weeks}</h2>
                <span className="muted st-legend">
                  <i className="late" /> {t.legendLate} <i className="absent" /> {t.legendAbsent}
                </span>
              </div>
              <div className="st-chart" role="img" aria-label={data.weeks.map((w) => `${short(w.week)}: ${w.late} ${t.legendLate}, ${w.absences} ${t.legendAbsent}`).join('; ')}>
                {data.weeks.map((w) => (
                  <div key={w.week} className="st-col">
                    <div className="st-bars">
                      <span className="late" style={{ height: `${(w.late / max) * 100}%` }} title={`${w.late}`}>
                        {w.late > 0 && <em>{w.late}</em>}
                      </span>
                      <span className="absent" style={{ height: `${(w.absences / max) * 100}%` }} title={`${w.absences}`}>
                        {w.absences > 0 && <em>{w.absences}</em>}
                      </span>
                    </div>
                    <span className="muted st-x">{short(w.week)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          <div className="table-wrap st-table">
            <table>
              <thead>
                <tr>
                  <th>{t.cols.person}</th>
                  <th>{t.cols.division}</th>
                  <th className="c">{t.cols.shifts}</th>
                  <th className="c">{t.cols.absences}</th>
                  <th className="c">{t.cols.late}</th>
                  <th className="c">{t.cols.avgLate}</th>
                  <th className="c">{t.cols.missingExit}</th>
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => (
                  <tr key={p.userId} className="st-row" tabIndex={0} onClick={() => setPerson({ id: p.userId, name: p.name })} onKeyDown={(e) => e.key === 'Enter' && setPerson({ id: p.userId, name: p.name })}>
                    <td data-label={t.cols.person}>
                      <b>{p.name}</b>
                    </td>
                    <td data-label={t.cols.division}>{DIV[p.division] ?? p.division}</td>
                    <td className="c" data-label={t.cols.shifts}>
                      {p.shifts}
                    </td>
                    <td className="c" data-label={t.cols.absences}>
                      {p.absences}
                      {p.excused > 0 && <span className="muted st-ex"> +{p.excused} uspr.</span>}
                    </td>
                    <td className="c" data-label={t.cols.late}>
                      {p.late}
                    </td>
                    <td className="c" data-label={t.cols.avgLate}>
                      {p.late ? `${p.lateAvgMin} min` : '—'}
                    </td>
                    <td className="c" data-label={t.cols.missingExit}>
                      {p.missingExit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted st-note">{t.footer}</p>
        </>
      )}
      {person && <PersonModal person={person} query={query} canExcuse={data.canExcuse} onClose={() => setPerson(null)} onChanged={() => void load()} />}
    </>
  );
}

interface Day {
  shiftId: string;
  date: string;
  division: string;
  plannedStart: number;
  plannedEnd: number;
  clockInAt: number | null;
  clockOutAt: number | null;
  lateMin: number;
  status: 'ok' | 'late' | 'absent' | 'pending' | 'excused';
  missingExit: 'open' | 'fixed' | null;
  excuse: { reason: string; note: string | null } | null;
}

const statusClass: Record<string, string> = { ok: 'ok', late: 'warn', absent: 'bad', pending: 'neutral', excused: 'neutral' };

function PersonModal({ person, query, canExcuse, onClose, onChanged }: { person: { id: string; name: string }; query: string; canExcuse: boolean; onClose: () => void; onChanged: () => void }) {
  const { locationId } = usePanel();
  const { data, error, load } = useStats<{ name: string; days: Day[] }>(`/api/admin/locations/${locationId}/stats/attendance/${person.id}?${query}`);
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState('sick');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  async function excuse(d: Day) {
    setErr(null);
    try {
      await api(`/api/admin/locations/${locationId}/stats/excuses/${d.shiftId}`, { method: 'PUT', body: { reason, note: note.trim() || null } });
      setOpen(null);
      setNote('');
      await load();
      onChanged();
    } catch (x) {
      setErr(errorText(x instanceof ApiFailure ? x.code : 'generic'));
    }
  }
  async function undo(d: Day) {
    await api(`/api/admin/locations/${locationId}/stats/excuses/${d.shiftId}`, { method: 'DELETE' }).catch(() => undefined);
    await load();
    onChanged();
  }
  return (
    <Modal title={person.name} onClose={onClose}>
      <ErrorBox message={error ?? err} />
      {!data ? (
        <LogoLoader />
      ) : !data.days.length ? (
        <p className="muted">{t.noDays}</p>
      ) : (
        <div className="st-days">
          {data.days.map((d) => (
            <div key={d.shiftId} className="st-day" data-status={d.status}>
              <div className="st-day-main">
                <b>{dayName(d.date)}</b>
                <span className="muted">
                  {t.day.plan} {hm(d.plannedStart)}–{hm(d.plannedEnd)} · {DIV[d.division] ?? d.division}
                </span>
                <span>
                  {t.day.in} {hm(d.clockInAt)} · {t.day.out} {hm(d.clockOutAt)}
                  {d.missingExit === 'open' && <span className="muted"> · {t.noExit}</span>}
                  {d.missingExit === 'fixed' && <span className="muted"> · {t.fixedExit}</span>}
                </span>
                {d.excuse && (
                  <span className="muted">
                    {t.reasons[d.excuse.reason] ?? d.excuse.reason}
                    {d.excuse.note ? ` — ${d.excuse.note}` : ''}
                  </span>
                )}
              </div>
              <div className="st-day-side">
                <span className={`badge ${statusClass[d.status]}`}>
                  {t.status[d.status]}
                  {d.status === 'late' ? ` ${d.lateMin} min` : ''}
                </span>
                {canExcuse && (d.status === 'absent' || d.status === 'late') && open !== d.shiftId && (
                  <button type="button" className="link-btn" onClick={() => setOpen(d.shiftId)}>
                    {t.excuse}
                  </button>
                )}
                {canExcuse && d.status === 'excused' && (
                  <button type="button" className="link-btn" onClick={() => void undo(d)}>
                    {t.excuseUndo}
                  </button>
                )}
              </div>
              {open === d.shiftId && (
                <div className="st-excuse">
                  <div className="st-chips" role="radiogroup" aria-label={t.excuseReason}>
                    {Object.entries(t.reasons).map(([k, l]) => (
                      <button key={k} type="button" className="chip" aria-pressed={reason === k} onClick={() => setReason(k)}>
                        {l}
                      </button>
                    ))}
                  </div>
                  <div className="field">
                    <label htmlFor={`ex-${d.shiftId}`}>{t.excuseNote}</label>
                    <input id={`ex-${d.shiftId}`} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
                  </div>
                  <div className="btn-row">
                    <Btn kind="primary" onClick={() => void excuse(d)}>
                      {t.excuseSave}
                    </Btn>
                    <Btn onClick={() => setOpen(null)}>{pl.common.cancel}</Btn>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* ───────── Rekrutacja (mockup 13) ───────── */

interface RecData {
  divisions: string[];
  totals: {
    candidates: number;
    interviews: number;
    trials: number;
    hired: number;
    rejected: number;
    medianDaysToHire: number | null;
    interviewsBooked: number;
    noShowInterview: number;
    trialsBooked: number;
    noShowTrial: number;
    leftIn30: number;
    noSource: number;
  };
  sources: { source: string | null; candidates: number; hired: number }[];
  reasons: { reason: string; count: number }[];
  byDivision: { division: string; candidates: number; interviews: number; trials: number; hired: number; rejected: number; topReason: string | null }[];
}

function Recruitment({ query, range, division, setDivision, setCsv }: Common) {
  const { locationId } = usePanel();
  const { data, error } = useStats<RecData>(`/api/admin/locations/${locationId}/stats/recruitment?${query}`);
  const r = pl.admin.stats.rec;
  const srcLabel = (s: string | null) => (s ? (RT.sources[s] ?? s) : r.noSource);
  useEffect(() => {
    if (!data) return setCsv(null);
    setCsv(() => () =>
      downloadCsv(`rekrutacja_${range.from}_${range.to}.csv`, [
        [r.byDivision, r.candidates, r.interviews, r.trials, r.hiredCol, r.rejected, r.topReason],
        ...data.byDivision.map((d) => [DIV[d.division] ?? d.division, d.candidates, d.interviews, d.trials, d.hired, d.rejected, d.topReason ? RT.rejectReasons[d.topReason] ?? d.topReason : '']),
        [],
        [r.source, r.candidates, r.hiredCol],
        ...data.sources.map((s) => [srcLabel(s.source), s.candidates, s.hired]),
      ]),
    );
    return () => setCsv(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, range.from, range.to, setCsv]);
  const funnel = useMemo(() => {
    if (!data) return [];
    const k = data.totals;
    return [
      [r.stageNew, k.candidates, null],
      [r.stageInterview, k.interviews, pct(k.interviews, k.candidates)],
      [r.stageTrial, k.trials, pct(k.trials, k.interviews)],
      [r.stageHired, k.hired, pct(k.hired, k.trials || k.interviews)],
    ] as const;
  }, [data, r]);
  if (!data) return error ? <ErrorBox message={error} /> : <LogoLoader />;
  const k = data.totals;
  return (
    <>
      <Divisions list={data.divisions} value={division} onChange={setDivision} />
      <ErrorBox message={error} />
      <div className="st-kpis">
        <Kpi label={r.newCandidates} value={String(k.candidates)} />
        <Kpi label={r.hired} value={String(k.hired)} sub={r.hiredShare(pct(k.hired, k.candidates))} tone={k.hired ? 'ok' : undefined} />
        <Kpi label={r.timeToHire} value={k.medianDaysToHire === null ? '—' : r.days(k.medianDaysToHire)} sub={r.median} />
        <Kpi label={r.noShow} value={String(k.noShowInterview + k.noShowTrial)} sub={r.noShowSub(k.noShowInterview, k.interviewsBooked, k.noShowTrial, k.trialsBooked)} tone={k.noShowInterview + k.noShowTrial ? 'bad' : undefined} />
        <Kpi label={r.left30} value={String(k.leftIn30)} sub={r.left30Sub(k.hired)} />
      </div>
      {!k.candidates ? (
        <p className="muted">{r.empty}</p>
      ) : (
        <>
          <div className="st-two">
            <section className="card">
              <h2 className="ntf-h">{r.funnel}</h2>
              <div className="st-funnel">
                {funnel.map(([l, n, p]) => (
                  <div key={l} className="st-funnel-row">
                    <span>{l}</span>
                    <span className="st-funnel-bar">
                      <i style={{ width: `${Math.max(2, (n / Math.max(1, k.candidates)) * 100)}%` }} />
                    </span>
                    <b>
                      {n}
                      {p !== null && <span className="muted"> · {p}%</span>}
                    </b>
                  </div>
                ))}
              </div>
              {data.reasons.length > 0 && (
                <>
                  <h3 className="st-h3">{r.reasons}</h3>
                  <div className="st-chips">
                    {data.reasons.map((x) => (
                      <span key={x.reason} className="ntf-tag">
                        {RT.rejectReasons[x.reason] ?? x.reason} · {x.count}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </section>
            <section className="card">
              <h2 className="ntf-h">{r.sources}</h2>
              <div className="table-wrap st-mini">
                <table>
                  <thead>
                    <tr>
                      <th>{r.source}</th>
                      <th className="c">{r.candidates}</th>
                      <th className="c">{r.hiredCol}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sources.map((s) => (
                      <tr key={s.source ?? 'none'}>
                        <td>{srcLabel(s.source)}</td>
                        <td className="c">{s.candidates}</td>
                        <td className="c">{s.hired}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {k.noSource > 0 && <p className="muted st-note">{r.noSourceHint(k.noSource)}</p>}
            </section>
          </div>
          <div className="table-wrap st-table">
            <table>
              <thead>
                <tr>
                  <th>{r.byDivision}</th>
                  <th className="c">{r.candidates}</th>
                  <th className="c">{r.interviews}</th>
                  <th className="c">{r.trials}</th>
                  <th className="c">{r.hiredCol}</th>
                  <th className="c">{r.rejected}</th>
                  <th>{r.topReason}</th>
                </tr>
              </thead>
              <tbody>
                {data.byDivision.map((d) => (
                  <tr key={d.division}>
                    <td data-label={r.byDivision}>
                      <b>{DIV[d.division] ?? d.division}</b>
                    </td>
                    <td className="c" data-label={r.candidates}>
                      {d.candidates}
                    </td>
                    <td className="c" data-label={r.interviews}>
                      {d.interviews}
                    </td>
                    <td className="c" data-label={r.trials}>
                      {d.trials}
                    </td>
                    <td className="c" data-label={r.hiredCol}>
                      {d.hired}
                    </td>
                    <td className="c" data-label={r.rejected}>
                      {d.rejected}
                    </td>
                    <td data-label={r.topReason}>{d.topReason ? (RT.rejectReasons[d.topReason] ?? d.topReason) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted st-note">{r.rodo}</p>
        </>
      )}
    </>
  );
}
