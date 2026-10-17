/**
 * Panel → Statystyki (owner, 2026-10-17; mockups 12–13): Obecność i spóźnienia, Rekrutacja.
 * Leaders see their divisions; the owner and zarządzający everything. CSV export of the visible table.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { addDays } from '../../shared/time';
import { api, ApiFailure } from '../api';
import { DateField } from '../DateField';
import { errorText, pl } from '../i18n/pl';
import { useLiveRefresh } from '../live';
import { navigate, onNav } from '../router';
import { Disclosure, ErrorBox, LogoLoader } from '../ui';
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

const SECTIONS = [
  ['/panel/statystyki', 'attendance', t.attendance],
  ['/panel/statystyki/czas', 'cost', t.costTitle],
  ['/panel/statystyki/listy', 'checklists', t.checklistsTitle],
  ['/panel/statystyki/szkolenia', 'training', t.trainingTitle],
  ['/panel/statystyki/rekrutacja', 'recruitment', t.recruitment],
] as const;

export function Stats({ path }: { path: string }) {
  const sub = path.replace(/^\/panel\/statystyki\/?/, '');
  const section = sub.startsWith('rekrutacja') ? 'recruitment' : sub.startsWith('czas') ? 'cost' : sub.startsWith('listy') ? 'checklists' : sub.startsWith('szkolenia') ? 'training' : 'attendance';
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
          <span className="st-wide st-chips">
            {(['week', 'month', 'quarter', 'custom'] as const).map((p) => (
              <button key={p} type="button" className="chip" aria-pressed={period === p} onClick={() => setPeriod(p)}>
                {t.periods[p]}
              </button>
            ))}
          </span>
          <label className="st-narrow st-select">
            <span>{t.period}</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
              {(['week', 'month', 'quarter', 'custom'] as const).map((p) => (
                <option key={p} value={p}>
                  {t.periods[p]}
                </option>
              ))}
            </select>
          </label>
          <Btn onClick={() => csv?.()} disabled={!csv}>
            <span className="st-csv-word">{t.csvWord} </span>CSV
          </Btn>
        </div>
      </div>
      <div className="st-layout">
        <label className="st-narrow st-select st-section">
          <span>{t.section}</span>
          <select value={section} onChange={(e) => navigate(SECTIONS.find((x) => x[1] === e.target.value)![0])}>
            {SECTIONS.map(([, key, l]) => (
              <option key={key} value={key}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <nav className="st-nav st-wide" aria-label={t.title}>
          {SECTIONS.map(([href, key, l]) => (
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
          {section === 'attendance' && <Attendance query={query} range={r} division={division} setDivision={setDivision} setCsv={setCsv} />}
          {section === 'cost' && <Cost query={query} range={r} division={division} setDivision={setDivision} setCsv={setCsv} />}
          {section === 'checklists' && <Checklists query={query} range={r} division={division} setDivision={setDivision} setCsv={setCsv} />}
          {section === 'training' && <Training query={query} range={r} division={division} setDivision={setDivision} setCsv={setCsv} />}
          {section === 'recruitment' && <Recruitment query={query} range={r} division={division} setDivision={setDivision} setCsv={setCsv} />}
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

/** Division as a dropdown (owner, 2026-10-17): one line instead of a wall of chips. */
function Divisions({ list, value, onChange }: { list: string[]; value: string; onChange: (d: string) => void }) {
  if (list.length < 2) return null;
  const v = value === 'all' || list.includes(value) ? value : 'all';
  return (
    <label className="st-select">
      <span>{t.division}</span>
      <select value={v} onChange={(e) => onChange(e.target.value)}>
        {['all', ...list].map((d) => (
          <option key={d} value={d}>
            {d === 'all' ? t.allDivisions : (DIV[d] ?? d)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A folding block (owner, 2026-10-17: no long sheets — open what you need). The open/closed state is remembered. */
function Sec({ id, title, count, aside, children }: { id: string; title: string; count?: number; aside?: ReactNode; children: ReactNode }) {
  const key = `sa-st-open-${id}`;
  const [open, setOpen] = useState(() => storageGet(key) === '1');
  return (
    <Disclosure
      className="card st-sec"
      open={open}
      lazy
      onToggle={(o) => {
        setOpen(o);
        storageSet(key, o ? '1' : '0');
      }}
      summary={
        <>
          <span className="st-sec-title">{title}</span>
          {count !== undefined && <span className="badge neutral">{count}</span>}
          {aside && <span className="st-sec-aside">{aside}</span>}
        </>
      }
    >
      <div className="st-sec-body">{children}</div>
    </Disclosure>
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
            <Sec
              id="att-weeks"
              title={t.weeks}
              aside={
                <span className="muted st-legend">
                  <i className="late" /> {t.legendLate} <i className="absent" /> {t.legendAbsent}
                </span>
              }
            >
              <span className="muted st-legend st-narrow">
                <i className="late" /> {t.legendLate} <i className="absent" /> {t.legendAbsent}
              </span>
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
            </Sec>
          )}
          <Sec id="att-people" title={t.peopleTitle} count={data.people.length}>
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
          </Sec>
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
            <Sec id="card-1" title={r.funnel}>
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
            </Sec>
            <Sec id="card-2" title={r.sources}>
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
            </Sec>
          </div>
          <Sec id="rec-div" title={r.byDivision} count={data.byDivision.length}>
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
          </Sec>
          <p className="muted st-note">{r.rodo}</p>
        </>
      )}
    </>
  );
}

/* ───────── Czas pracy i koszt (mockup 14) ───────── */

const zl = (grosze: number | null | undefined) =>
  grosze === null || grosze === undefined ? '—' : `${(grosze / 100).toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} zł`;
const zlRate = (grosze: number | null | undefined) =>
  grosze === null || grosze === undefined ? '—' : `${(grosze / 100).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
/** short money for chart labels: „5,6 tys.” */
const zlShort = (grosze: number | undefined) => {
  const v = (grosze ?? 0) / 100;
  return v >= 1000 ? `${(Math.round(v / 100) / 10).toLocaleString('pl-PL')} tys.` : `${Math.round(v)} zł`;
};
const delta = (a: number, b: number) => (b ? `${a >= b ? '+' : '−'}${Math.abs(Math.round(((a - b) / b) * 1000) / 10).toLocaleString('pl-PL')}%` : '');

interface CostData {
  divisions: string[];
  wages: boolean;
  totals: { workedMin: number; plannedMin: number; overMin: number; people: number; cost?: number; prevCost?: number; avgRate?: number | null; missingRate?: number };
  weeks: { week: string; workedMin: number; cost?: number }[];
  byDivision: { division: string; workedMin: number; plannedMin: number; cost?: number }[];
  people: { userId: string; name: string; division: string; shifts: number; plannedMin: number; workedMin: number; overMin: number; rate?: number | null; cost?: number; missingRate?: boolean }[];
}

function Bars({ items, title, legend }: { items: { label: string; value: number; text: string }[]; title: string; legend?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <Sec id={`bars-${title}`} title={title} aside={legend ? <span className="muted st-legend">{legend}</span> : undefined}>
      <div className="st-chart" role="img" aria-label={items.map((i) => `${i.label}: ${i.text}`).join('; ')}>
        {items.map((i, n) => (
          <div key={i.label} className={`st-col${items.length > 8 && n % 2 ? ' st-col-quiet' : ''}`}>
            <div className="st-bars">
              <span className="late" style={{ height: `${(i.value / max) * 100}%` }}>
                {i.value > 0 && <em>{i.text}</em>}
              </span>
            </div>
            <span className="muted st-x">{i.label}</span>
          </div>
        ))}
      </div>
    </Sec>
  );
}

function Cost({ query, range, division, setDivision, setCsv }: Common) {
  const { locationId } = usePanel();
  const c = pl.admin.stats.cost;
  const { data, error } = useStats<CostData>(`/api/admin/locations/${locationId}/stats/cost?${query}`);
  useEffect(() => {
    if (!data) return setCsv(null);
    setCsv(() => () =>
      downloadCsv(`czas_pracy_${range.from}_${range.to}.csv`, [
        [c.cols.person, c.cols.division, c.cols.shifts, c.cols.planned, c.cols.worked, c.cols.over, ...(data.wages ? [c.cols.rate, c.cols.cost] : [])],
        ...data.people.map((p) => [
          p.name,
          DIV[p.division] ?? p.division,
          p.shifts,
          (p.plannedMin / 60).toFixed(2).replace('.', ','),
          (p.workedMin / 60).toFixed(2).replace('.', ','),
          (p.overMin / 60).toFixed(2).replace('.', ','),
          ...(data.wages ? [p.rate != null ? (p.rate / 100).toFixed(2).replace('.', ',') : '', p.cost != null ? (p.cost / 100).toFixed(2).replace('.', ',') : ''] : []),
        ]),
      ]),
    );
    return () => setCsv(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, range.from, range.to, setCsv]);
  if (!data) return error ? <ErrorBox message={error} /> : <LogoLoader />;
  const k = data.totals;
  const share = (x: number | undefined) => (k.cost ? `${Math.round(((x ?? 0) / k.cost) * 100)}%` : '—');
  return (
    <>
      <Divisions list={data.divisions} value={division} onChange={setDivision} />
      <div className="st-kpis">
        <Kpi label={c.kpi.worked} value={hours(k.workedMin)} sub={k.plannedMin ? `${c.plan} ${hours(k.plannedMin)} · ${delta(k.workedMin, k.plannedMin)}` : undefined} />
        {data.wages && <Kpi label={c.kpi.cost} value={zl(k.cost)} sub={k.prevCost ? `${delta(k.cost ?? 0, k.prevCost)} ${c.vsPrev}` : undefined} />}
        {data.wages && <Kpi label={c.kpi.avgRate} value={k.avgRate ? `${zlRate(k.avgRate)}/h` : '—'} sub={c.weighted} />}
        <Kpi label={c.kpi.over} value={hours(k.overMin)} sub={c.overHint} tone={k.overMin ? 'warn' : undefined} />
        {data.wages && <Kpi label={c.kpi.noRate} value={c.persons(k.missingRate ?? 0)} sub={c.noRateHint} tone={k.missingRate ? 'bad' : undefined} />}
      </div>
      {!k.workedMin && !k.plannedMin ? (
        <p className="muted">{c.empty}</p>
      ) : (
        <>
          <div className="st-two">
            {data.weeks.length > 1 && (
              <Bars
                title={data.wages ? c.weeksCost : c.weeksHours}
                items={data.weeks.map((w) => ({ label: short(w.week), value: data.wages ? (w.cost ?? 0) : w.workedMin, text: data.wages ? zlShort(w.cost) : `${hours(w.workedMin)} h` }))}
              />
            )}
            <Sec id="card-3" title={c.divisionsTitle}>
              <div className="table-wrap st-mini">
                <table>
                  <thead>
                    <tr>
                      <th>{c.cols.division}</th>
                      <th className="c">{c.cols.worked}</th>
                      {data.wages && <th className="c">{c.cols.cost}</th>}
                      {data.wages && <th className="c">{c.cols.share}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.byDivision.map((d) => (
                      <tr key={d.division}>
                        <td>{DIV[d.division] ?? d.division}</td>
                        <td className="c">{hours(d.workedMin)}</td>
                        {data.wages && <td className="c">{zl(d.cost)}</td>}
                        {data.wages && <td className="c">{share(d.cost)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Sec>
          </div>
          <Sec id="cost-people" title={pl.admin.stats.peopleTitle} count={data.people.length}>
          <div className="table-wrap st-table">
            <table>
              <thead>
                <tr>
                  <th>{c.cols.person}</th>
                  <th>{c.cols.division}</th>
                  <th className="c">{c.cols.shifts}</th>
                  <th className="c">{c.cols.planWorked}</th>
                  <th className="c">{c.cols.over}</th>
                  {data.wages && <th className="c">{c.cols.rate}</th>}
                  {data.wages && <th className="c">{c.cols.cost}</th>}
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => (
                  <tr key={p.userId}>
                    <td data-label={c.cols.person}>
                      <b>{p.name}</b>
                    </td>
                    <td data-label={c.cols.division}>{DIV[p.division] ?? p.division}</td>
                    <td className="c" data-label={c.cols.shifts}>
                      {p.shifts}
                    </td>
                    <td className="c" data-label={c.cols.planWorked}>
                      {hours(p.plannedMin)} / {hours(p.workedMin)}
                    </td>
                    <td className="c" data-label={c.cols.over}>
                      {p.overMin >= 30 ? `+${hours(p.overMin)} h` : '—'}
                    </td>
                    {data.wages && (
                      <td className="c" data-label={c.cols.rate}>
                        {p.rate != null ? zlRate(p.rate) : <span className="badge bad">{c.noRate}</span>}
                      </td>
                    )}
                    {data.wages && (
                      <td className="c" data-label={c.cols.cost}>
                        {zl(p.cost)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </Sec>
          <p className="muted st-note">{data.wages ? c.footer : c.footerNoWages}</p>
        </>
      )}
    </>
  );
}

/* ───────── Listy kontrolne (mockup 15) ───────── */

interface ClData {
  divisions: string[];
  totals: { listDays: number; fullPct: number | null; skipped: number; topSkipped: string | null; avgMinutes: number | null; photoPct: number | null; reminders: number };
  lists: { id: string; title: string; division: string; days: number; fullPct: number; avgPct: number; topSkipped: string | null }[];
  people: { userId: string; name: string; division: string; listDays: number; complete: number; avgPct: number; afterReminder: number }[];
}

function Checklists({ query, range, division, setDivision, setCsv }: Common) {
  const { locationId } = usePanel();
  const c = pl.admin.stats.lists;
  const { data, error } = useStats<ClData>(`/api/admin/locations/${locationId}/stats/checklists?${query}`);
  useEffect(() => {
    if (!data) return setCsv(null);
    setCsv(() => () =>
      downloadCsv(`listy_${range.from}_${range.to}.csv`, [
        [c.cols.list, c.cols.division, c.cols.days, c.cols.full, c.cols.avg, c.cols.skipped],
        ...data.lists.map((l) => [l.title, DIV[l.division] ?? l.division, l.days, `${l.fullPct}%`, `${l.avgPct}%`, l.topSkipped ?? '']),
        [],
        [c.cols.person, c.cols.division, c.cols.listDays, c.cols.complete, c.cols.avg, c.cols.afterReminder],
        ...data.people.map((p) => [p.name, DIV[p.division] ?? p.division, p.listDays, p.complete, `${p.avgPct}%`, p.afterReminder]),
      ]),
    );
    return () => setCsv(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, range.from, range.to, setCsv]);
  if (!data) return error ? <ErrorBox message={error} /> : <LogoLoader />;
  const k = data.totals;
  return (
    <>
      <Divisions list={data.divisions} value={division} onChange={setDivision} />
      <div className="st-kpis">
        <Kpi label={c.kpi.full} value={k.fullPct === null ? '—' : `${k.fullPct}%`} sub={c.kpi.fullSub} tone={k.fullPct !== null && k.fullPct < 80 ? 'warn' : undefined} />
        <Kpi label={c.kpi.skipped} value={String(k.skipped)} sub={k.topSkipped ? c.kpi.most(k.topSkipped) : undefined} tone={k.skipped ? 'warn' : undefined} />
        <Kpi label={c.kpi.time} value={k.avgMinutes === null ? '—' : `${k.avgMinutes} min`} sub={c.kpi.timeSub} />
        <Kpi label={c.kpi.photos} value={k.photoPct === null ? '—' : `${k.photoPct}%`} sub={c.kpi.photosSub} />
        <Kpi label={c.kpi.reminders} value={String(k.reminders)} sub={c.kpi.remindersSub} />
      </div>
      {!data.lists.length ? (
        <p className="muted">{c.empty}</p>
      ) : (
        <>
          <Sec id="cl-lists" title={c.listsTitle} count={data.lists.length}>
          <div className="table-wrap st-table">
            <table>
              <thead>
                <tr>
                  <th>{c.cols.list}</th>
                  <th>{c.cols.division}</th>
                  <th className="c">{c.cols.days}</th>
                  <th className="c">{c.cols.full}</th>
                  <th className="c">{c.cols.avg}</th>
                  <th>{c.cols.skipped}</th>
                </tr>
              </thead>
              <tbody>
                {data.lists.map((l) => (
                  <tr key={l.id}>
                    <td data-label={c.cols.list}>
                      <b>{l.title}</b>
                    </td>
                    <td data-label={c.cols.division}>{l.division ? (DIV[l.division] ?? l.division) : c.everyone}</td>
                    <td className="c" data-label={c.cols.days}>
                      {l.days}
                    </td>
                    <td className="c" data-label={c.cols.full}>
                      {l.fullPct}%
                    </td>
                    <td className="c" data-label={c.cols.avg}>
                      {l.avgPct}%
                    </td>
                    <td data-label={c.cols.skipped}>{l.topSkipped ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </Sec>
          {data.people.length > 0 && (
            <Sec id="cl-people" title={pl.admin.stats.peopleTitle} count={data.people.length}>
            <div className="table-wrap st-table">
              <table>
                <thead>
                  <tr>
                    <th>{c.cols.person}</th>
                    <th>{c.cols.division}</th>
                    <th className="c">{c.cols.listDays}</th>
                    <th className="c">{c.cols.complete}</th>
                    <th className="c">{c.cols.avg}</th>
                    <th className="c">{c.cols.afterReminder}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.people.map((p) => (
                    <tr key={p.userId}>
                      <td data-label={c.cols.person}>
                        <b>{p.name}</b>
                      </td>
                      <td data-label={c.cols.division}>{DIV[p.division] ?? p.division}</td>
                      <td className="c" data-label={c.cols.listDays}>
                        {p.listDays}
                      </td>
                      <td className="c" data-label={c.cols.complete}>
                        {p.complete}
                      </td>
                      <td className="c" data-label={c.cols.avg}>
                        {p.avgPct}%
                      </td>
                      <td className="c" data-label={c.cols.afterReminder}>
                        {p.afterReminder}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </Sec>
          )}
          <p className="muted st-note">{c.footer}</p>
        </>
      )}
    </>
  );
}

/* ───────── Szkolenia i dokumenty (mockup 16) ───────── */

interface TrData {
  divisions: string[];
  totals: { acks: number; onTimePct: number | null; overduePeople: number; overdueDocs: number; attempts: number; passedPct: number | null; firstPassPct: number | null; avgScore: number | null; newcomers: number; newcomersDone: number };
  documents: { id: string; title: string; toRead: number; done: number; overdue: number }[];
  tests: { testId: string; title: string; attempts: number; passed: number; avgScore: number | null; hardest: string | null }[];
  people: { userId: string; name: string; division: string; acksOnTime: number; acks: number; overdue: number; testsPassed: number; tests: number; avgScore: number | null; program: number | null }[];
}

function Training({ query, range, division, setDivision, setCsv }: Common) {
  const { locationId } = usePanel();
  const c = pl.admin.stats.training;
  const { data, error } = useStats<TrData>(`/api/admin/locations/${locationId}/stats/training?${query}`);
  useEffect(() => {
    if (!data) return setCsv(null);
    setCsv(() => () =>
      downloadCsv(`szkolenia_${range.from}_${range.to}.csv`, [
        [c.cols.person, c.cols.division, c.cols.onTime, c.cols.overdue, c.cols.testsPassed, c.cols.avgScore, c.cols.program],
        ...data.people.map((p) => [p.name, DIV[p.division] ?? p.division, `${p.acksOnTime} / ${p.acks}`, p.overdue, `${p.testsPassed} / ${p.tests}`, p.avgScore ?? '', p.program === null ? '' : `${p.program}%`]),
      ]),
    );
    return () => setCsv(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, range.from, range.to, setCsv]);
  if (!data) return error ? <ErrorBox message={error} /> : <LogoLoader />;
  const k = data.totals;
  return (
    <>
      <Divisions list={data.divisions} value={division} onChange={setDivision} />
      <div className="st-kpis">
        <Kpi label={c.kpi.onTime} value={k.onTimePct === null ? '—' : `${k.onTimePct}%`} sub={c.kpi.onTimeSub(k.acks)} tone={k.onTimePct !== null && k.onTimePct < 90 ? 'warn' : undefined} />
        <Kpi label={c.kpi.overdue} value={c.kpi.people(k.overduePeople)} sub={c.kpi.overdueSub(k.overdueDocs)} tone={k.overduePeople ? 'bad' : undefined} />
        <Kpi label={c.kpi.passed} value={k.passedPct === null ? '—' : `${k.passedPct}%`} sub={k.firstPassPct === null ? undefined : c.kpi.firstPass(k.firstPassPct)} />
        <Kpi label={c.kpi.avgScore} value={k.avgScore === null ? '—' : `${k.avgScore}%`} sub={c.kpi.attempts(k.attempts)} />
        <Kpi label={c.kpi.program} value={k.newcomers ? `${k.newcomersDone} z ${k.newcomers}` : '—'} sub={c.kpi.programSub} />
      </div>
      <div className="st-two">
        <Sec id="card-4" title={c.docs}>
          {data.documents.length ? (
            <div className="table-wrap st-mini">
              <table>
                <thead>
                  <tr>
                    <th>{c.cols.doc}</th>
                    <th className="c">{c.cols.toRead}</th>
                    <th className="c">{c.cols.done}</th>
                    <th className="c">{c.cols.overdue}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.documents.map((d) => (
                    <tr key={d.id}>
                      <td>{d.title}</td>
                      <td className="c">{d.toRead}</td>
                      <td className="c">{d.done}</td>
                      <td className="c">{d.overdue ? <span className="badge bad">{d.overdue}</span> : 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              {c.noDocs}
            </p>
          )}
        </Sec>
        <Sec id="card-5" title={c.tests}>
          {data.tests.length ? (
            <div className="table-wrap st-mini">
              <table>
                <thead>
                  <tr>
                    <th>{c.cols.test}</th>
                    <th className="c">{c.cols.attempts}</th>
                    <th className="c">{c.cols.passed}</th>
                    <th className="c">{c.cols.avgScore}</th>
                    <th>{c.cols.hardest}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tests.map((x) => (
                    <tr key={x.testId}>
                      <td>{x.title}</td>
                      <td className="c">{x.attempts}</td>
                      <td className="c">{x.passed}</td>
                      <td className="c">{x.avgScore === null ? '—' : `${x.avgScore}%`}</td>
                      <td>{x.hardest ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              {c.noTests}
            </p>
          )}
        </Sec>
      </div>
      {data.people.length > 0 && (
        <Sec id="tr-people" title={pl.admin.stats.peopleTitle} count={data.people.length}>
        <div className="table-wrap st-table">
          <table>
            <thead>
              <tr>
                <th>{c.cols.person}</th>
                <th>{c.cols.division}</th>
                <th className="c">{c.cols.onTime}</th>
                <th className="c">{c.cols.overdue}</th>
                <th className="c">{c.cols.testsPassed}</th>
                <th className="c">{c.cols.avgScore}</th>
                <th className="c">{c.cols.program}</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.userId}>
                  <td data-label={c.cols.person}>
                    <b>{p.name}</b>
                  </td>
                  <td data-label={c.cols.division}>{DIV[p.division] ?? p.division}</td>
                  <td className="c" data-label={c.cols.onTime}>
                    {p.acks ? `${p.acksOnTime} / ${p.acks}` : '—'}
                  </td>
                  <td className="c" data-label={c.cols.overdue}>
                    {p.overdue ? <span className="badge bad">{p.overdue}</span> : 0}
                  </td>
                  <td className="c" data-label={c.cols.testsPassed}>
                    {p.tests ? `${p.testsPassed} / ${p.tests}` : '—'}
                  </td>
                  <td className="c" data-label={c.cols.avgScore}>
                    {p.avgScore === null ? '—' : `${p.avgScore}%`}
                  </td>
                  <td className="c" data-label={c.cols.program}>
                    {p.program === null ? '—' : `${p.program}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </Sec>
      )}
      <p className="muted st-note">{c.footer}</p>
    </>
  );
}
