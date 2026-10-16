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
  weeks: { week: string; days: string[]; deadline: number; open: boolean; dates: { date: string; note: string | null }[] }[];
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

function WeekOff({ w, onSaved }: { w: Unav['weeks'][number]; onSaved: () => Promise<void> }) {
  const { locationId } = useAcademy();
  const [picked, setPicked] = useState<string[]>(w.dates.map((d) => d.date));
  const [note, setNote] = useState(w.dates[0]?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setPicked(w.dates.map((d) => d.date));
  }, [w.dates]);
  const dirty = JSON.stringify([...picked].sort()) !== JSON.stringify(w.dates.map((d) => d.date).sort()) || note !== (w.dates[0]?.note ?? '');

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      await api(`/api/locations/${locationId}/unavailability`, { method: 'PUT', body: { week: w.week, dates: picked, note } });
      setMsg(t.saved);
      await onSaved();
    } catch (e) {
      setProblem(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="a-card" style={{ gap: 10 }} aria-label={t.weekOf(dm(w.days[0]!), dm(w.days[6]!))}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong>{t.weekOf(dm(w.days[0]!), dm(w.days[6]!))}</strong>
        <span className={`a-pill${w.open ? '' : ' warn'}`}>{w.open ? t.until(deadlineText(w.deadline)) : t.closed}</span>
      </div>
      <div className="g-days">
        {w.days.map((d) => (
          <button
            key={d}
            type="button"
            className="g-daybtn"
            aria-pressed={picked.includes(d)}
            disabled={!w.open || busy}
            onClick={() => {
              setMsg(null);
              setPicked(picked.includes(d) ? picked.filter((x) => x !== d) : [...picked, d]);
            }}
          >
            {dayShort(d)}
          </button>
        ))}
      </div>
      {w.open ? (
        <>
          <input className="a-input" value={note} maxLength={200} onChange={(e) => (setMsg(null), setNote(e.target.value))} placeholder={t.notePlaceholder} aria-label={t.note} />
          <Problem message={problem} />
          <button type="button" className="a-btn primary" disabled={!dirty || busy} onClick={() => void save()}>
            {picked.length ? t.save(picked.length) : t.saveNone}
          </button>
          {msg && <span className="a-sub">{msg}</span>}
        </>
      ) : (
        <span className="a-sub">{picked.length ? t.closedWith(picked.length) : t.closedNone}</span>
      )}
    </section>
  );
}
