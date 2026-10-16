/** Staff side of Grafik (D43): my published shifts, days off for the coming weeks, my hours. */
import { useEffect, useState } from 'react';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { onNav } from '../router';
import { formatHm, shiftColor } from '../../shared/schedule';
import { addDays } from '../../shared/time';
import { MyTime } from './MyTime';
import { Icon, Loading, Problem, useAcademy, useApi } from './shared';

const t = pl.grafik;

interface MySchedule {
  week: string;
  days: string[];
  today: string;
  shifts: { id: string; date: string; division: string; startMin: number; endMin: number; note: string | null }[];
  team: { date: string; name: string; startMin: number; endMin: number }[];
  upcoming: { id: string; date: string; startMin: number; endMin: number; note: string | null }[];
}
interface Unav {
  weeks: {
    week: string;
    days: string[];
    deadline: number;
    open: boolean;
    dates: { date: string; note: string | null; fromMin: number | null; toMin: number | null; byManager?: number }[];
  }[];
}

const range = (s: { startMin: number; endMin: number }) => `${formatHm(s.startMin)}–${formatHm(s.endMin)}`;
const dayLong = (d: string) => cap(new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`)));
const dayShort = (d: string) => new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
const dm = (d: string) => new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const deadlineText = (ms: number) =>
  new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' }).format(new Date(ms));

function whenLabel(date: string, today: string) {
  if (date === today) return t.today;
  if (date === addDays(today, 1)) return t.tomorrow;
  return dayLong(date).toLowerCase();
}

/** Start card: my next shift. */
export function MyScheduleCard() {
  const { locationId, me } = useAcademy();
  const { data } = useApi<MySchedule>(me.user.role === 'employee' ? `/api/locations/${locationId}/my-schedule` : null);
  if (!data) return null;
  const next = data.upcoming[0];
  return (
    <div className="a-list">
      <a className="a-row" href="/grafik" onClick={onNav('/grafik')}>
        <Icon name="calendar" size={20} />
        <span className="grow">
          <span className="t">{t.myTitle}</span>
          <span className="s">{next ? t.next(whenLabel(next.date, data.today), range(next)) : t.noneYet}</span>
        </span>
        {next && <span className="g-dot" style={{ background: shiftColor(next.startMin) }} aria-hidden="true" />}
        <Icon name="next" size={18} />
      </a>
    </div>
  );
}

export function Grafik({ tab }: { tab: 'shifts' | 'off' | 'hours' }) {
  const tabs = [
    { key: 'shifts', path: '/grafik', label: t.tabs.shifts },
    { key: 'off', path: '/grafik/niedostepnosc', label: t.tabs.off },
    { key: 'hours', path: '/grafik/godziny', label: t.tabs.hours },
  ] as const;
  return (
    <>
      <main className="a-main" style={{ paddingBottom: 0 }}>
        <h1 className="a-title">{t.title}</h1>
        <nav className="a-chips" aria-label={t.title}>
          {tabs.map((x) => (
            <a key={x.key} href={x.path} className="a-chip" aria-current={tab === x.key ? 'page' : undefined} onClick={onNav(x.path)}>
              {x.label}
            </a>
          ))}
        </nav>
      </main>
      {tab === 'shifts' && <Shifts />}
      {tab === 'off' && <DaysOff />}
      {tab === 'hours' && <MyTime embedded />}
    </>
  );
}

function Shifts() {
  const { locationId } = useAcademy();
  const [week, setWeek] = useState<string | null>(null);
  const { data, error } = useApi<MySchedule>(`/api/locations/${locationId}/my-schedule${week ? `?week=${week}` : ''}`);
  return (
    <main className="a-main">
      <Problem message={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="mt-month">
            <button type="button" className="a-icon-btn" aria-label={t.prevWeek} onClick={() => setWeek(addDays(data.week, -7))}>
              <Icon name="back" size={20} />
            </button>
            <span className="mt-month-name">
              {dm(data.days[0]!)} – {dm(data.days[6]!)}
            </span>
            <button type="button" className="a-icon-btn" aria-label={t.nextWeek} onClick={() => setWeek(addDays(data.week, 7))}>
              <Icon name="next" size={20} />
            </button>
          </div>
          <div className="a-list">
            {data.days.map((d) => {
              const mine = data.shifts.filter((s) => s.date === d);
              const team = data.team.filter((x) => x.date === d);
              return (
                <div key={d} className={`a-row g-day${d === data.today ? ' today' : ''}${mine.length ? '' : ' free'}`}>
                  <span className="grow">
                    <span className="t">{cap(dayShort(d))}</span>
                    {mine.length ? (
                      mine.map((s) => (
                        <span key={s.id} className="g-shift" style={{ ['--c' as string]: shiftColor(s.startMin) }}>
                          <i />
                          {range(s)}
                          {s.note ? ` · ${s.note}` : ''}
                        </span>
                      ))
                    ) : (
                      <span className="s">{t.free}</span>
                    )}
                    {team.length > 0 && <span className="s">{t.with(team.map((x) => `${x.name} ${range(x)}`).join(', '))}</span>}
                  </span>
                </div>
              );
            })}
          </div>
          {!data.shifts.length && <p className="a-sub">{t.emptyWeek}</p>}
          <p className="a-sub">{t.info}</p>
        </>
      )}
    </main>
  );
}

function DaysOff() {
  const { locationId } = useAcademy();
  const { data, error, reload } = useApi<Unav>(`/api/locations/${locationId}/unavailability`);
  return (
    <main className="a-main">
      <p className="a-sub">{t.offIntro}</p>
      <Problem message={error} />
      {!data && !error && <Loading />}
      {data?.weeks.map((w) => <WeekOff key={w.week} w={w} onSaved={reload} />)}
    </main>
  );
}

type Part = { kind: 'whole' | 'until' | 'from'; time: string };
const partOf = (d: { fromMin: number | null; toMin: number | null }): Part =>
  d.fromMin === null && d.toMin === null
    ? { kind: 'whole', time: '' }
    : (d.fromMin ?? 0) === 0
      ? { kind: 'until', time: formatHm(d.toMin ?? 0) }
      : { kind: 'from', time: formatHm(d.fromMin ?? 0) };
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));

function WeekOff({ w, onSaved }: { w: Unav['weeks'][number]; onSaved: () => Promise<void> }) {
  const { locationId } = useAcademy();
  const fromServer = () => new Map(w.dates.filter((d) => !d.byManager).map((d) => [d.date, partOf(d)]));
  const [picked, setPicked] = useState<Map<string, Part>>(fromServer);
  const [note, setNote] = useState(w.dates[0]?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setPicked(fromServer());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.dates]);
  const byManager = new Map(w.dates.filter((d) => d.byManager).map((d) => [d.date, d]));
  const serial = (m: Map<string, Part>) => JSON.stringify([...m.entries()].sort());
  const dirty = serial(picked) !== serial(fromServer()) || note !== (w.dates[0]?.note ?? '');
  const valid = [...picked.values()].every((p) => p.kind === 'whole' || HM.test(p.time));
  const set = (date: string, p: Part | null) => {
    setMsg(null);
    const next = new Map(picked);
    if (p) next.set(date, p);
    else next.delete(date);
    setPicked(next);
  };

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      const items = [...picked.entries()].map(([date, p]) =>
        p.kind === 'whole' ? { date } : p.kind === 'until' ? { date, fromMin: 0, toMin: toMin(p.time) } : { date, fromMin: toMin(p.time), toMin: 1440 },
      );
      await api(`/api/locations/${locationId}/unavailability`, { method: 'PUT', body: { week: w.week, items, note } });
      setMsg(t.saved);
      await onSaved();
    } catch (e) {
      setProblem(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="a-card" style={{ gap: 12 }} aria-label={t.weekOf(dm(w.days[0]!), dm(w.days[6]!))}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong>{t.weekOf(dm(w.days[0]!), dm(w.days[6]!))}</strong>
        <span className={`a-pill${w.open ? '' : ' warn'}`}>{w.open ? t.until(deadlineText(w.deadline)) : t.closed}</span>
      </div>
      <div className="g-days">
        {w.days.map((d) => {
          const p = picked.get(d);
          const mgr = byManager.get(d);
          return (
            <button
              key={d}
              type="button"
              className={`g-daybtn${p && p.kind !== 'whole' ? ' part' : ''}${mgr ? ' mgr' : ''}`}
              aria-pressed={Boolean(p || mgr)}
              disabled={!w.open || busy || Boolean(mgr)}
              onClick={() => set(d, p ? null : { kind: 'whole', time: '' })}
            >
              {dayShort(d)}
            </button>
          );
        })}
      </div>
      {[...picked.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([d, p]) => (
          <div key={d} className="g-part">
            <span className="g-part-day">{cap(dayShort(d))}</span>
            <div className="g-seg" role="tablist">
              {(['whole', 'until', 'from'] as const).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={p.kind === k} disabled={!w.open} onClick={() => set(d, { kind: k, time: p.time })}>
                  {t.part[k]}
                </button>
              ))}
            </div>
            {p.kind !== 'whole' && (
              <input
                className="a-input g-time"
                type="time"
                aria-label={p.kind === 'until' ? t.part.until : t.part.from}
                value={p.time}
                disabled={!w.open}
                onChange={(e) => set(d, { kind: p.kind, time: e.target.value })}
              />
            )}
          </div>
        ))}
      {[...byManager.values()].map((m) => (
        <span key={m.date} className="a-sub">
          {t.byManager(cap(dayShort(m.date)))}
        </span>
      ))}
      {w.open ? (
        <>
          <input className="a-input" value={note} maxLength={200} onChange={(e) => (setMsg(null), setNote(e.target.value))} placeholder={t.notePlaceholder} aria-label={t.note} />
          <Problem message={problem} />
          <button type="button" className="a-btn primary" disabled={!dirty || busy || !valid} onClick={() => void save()}>
            {picked.size ? t.save(picked.size) : t.saveNone}
          </button>
          {msg && <span className="a-sub">{msg}</span>}
        </>
      ) : (
        <span className="a-sub">{picked.size ? t.closedWith(picked.size) : t.closedNone}</span>
      )}
    </section>
  );
}
