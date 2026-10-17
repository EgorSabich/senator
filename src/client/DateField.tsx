/**
 * Date and date+time field (owner, 2026-10-17; mockup „calendar”): replaces the browser pickers
 * (US „mm/dd/yyyy” on many phones). Polish names, week from Monday, today outlined, chosen day in the accent colour.
 * Computer: a window under the field. Phone: a panel from the bottom.
 * onChange fires only when a value is chosen (a day; with time — „Gotowe”) or cleared.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { pl } from './i18n/pl';
import './styles/datefield.css';

const t = pl.dateField;
const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const DAYS = ['pn', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd'];
const TIMES = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const dow = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0

/** „piątek, 23 października 2026” (the year only when it is not this year) */
export function longPolishDate(d: string, withYear?: boolean): string {
  const y = withYear ?? d.slice(0, 4) !== todayIso().slice(0, 4);
  return new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', ...(y ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
}

function useIsPhone() {
  const q = '(max-width: 720px)';
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setPhone(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
}

interface Props {
  id?: string;
  /** 'YYYY-MM-DD' (date) or 'YYYY-MM-DDTHH:mm' (datetime); '' = empty */
  value: string;
  onChange: (v: string) => void;
  withTime?: boolean;
  min?: string;
  max?: string;
  placeholder?: string;
  clearable?: boolean;
  /** „Dziś · Jutro” shortcuts next to the value */
  shortcuts?: boolean;
  disabled?: boolean;
}

export function DateField({ id, value, onChange, withTime = false, min, max, placeholder, clearable = false, shortcuts = false, disabled }: Props) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const date = value.slice(0, 10);
  const time = withTime ? value.slice(11, 16) : '';
  const [draftDate, setDraftDate] = useState(date);
  const [draftTime, setDraftTime] = useState(time);
  const [month, setMonth] = useState((date || todayIso()).slice(0, 7));
  const wrap = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // the window is placed over the page (portal), so a modal's scroll area cannot cut it off
  const [place, setPlace] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open || phone || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect();
    const h = withTime ? 560 : 380;
    const below = window.innerHeight - r.bottom;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 348));
    setPlace(below > h || r.top < h ? { top: r.bottom + 6, left } : { bottom: window.innerHeight - r.top + 6, left });
  }, [open, phone, withTime]);

  useEffect(() => {
    if (!open) return;
    setDraftDate(date);
    setDraftTime(time || '');
    setMonth((date || todayIso()).slice(0, 7));
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const out = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!phone && !wrap.current?.contains(n) && !pop.current?.contains(n)) setOpen(false);
    };
    const away = () => !phone && setOpen(false);
    window.addEventListener('resize', away);
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', out);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', out);
      window.removeEventListener('resize', away);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const today = todayIso();
  const cells = useMemo(() => {
    const first = `${month}-01`;
    const start = addDays(first, -dow(first));
    const daysIn = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    const weeks = Math.ceil((dow(first) + daysIn) / 7);
    return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  }, [month]);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const allowed = (d: string) => (!min || d >= min.slice(0, 10)) && (!max || d <= max.slice(0, 10));
  const validTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

  function pick(d: string) {
    if (!allowed(d)) return;
    if (!withTime) {
      onChange(d);
      setOpen(false);
    } else setDraftDate(d);
  }
  function done() {
    if (!draftDate) return;
    const tm = validTime(draftTime) ? draftTime : '12:00';
    onChange(`${draftDate}T${tm}`);
    setOpen(false);
  }
  /** „1430” → „14:30” while typing */
  function typeTime(v: string) {
    const digits = v.replace(/\D/g, '').slice(0, 4);
    setDraftTime(digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits);
  }

  const text = value ? `${longPolishDate(date)}${withTime && time ? ` · ${time}` : ''}` : placeholder ?? (withTime ? t.pickDateTime : t.pickDate);
  const label = text.charAt(0).toUpperCase() + text.slice(1);

  const panel = (
    <div ref={pop} className={phone ? 'df-sheet' : 'df-pop'} style={phone ? undefined : place} role="dialog" aria-label={withTime ? t.pickDateTime : t.pickDate}>
      {phone && <span className="df-handle" aria-hidden="true" />}
      <div className="df-head">
        <b>
          {MONTHS[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}
        </b>
        <span className="df-nav">
          <button type="button" onClick={() => shift(-1)} aria-label={t.prev}>
            ‹
          </button>
          <button type="button" onClick={() => shift(1)} aria-label={t.next}>
            ›
          </button>
        </span>
      </div>
      <div className="df-grid" role="grid">
        {DAYS.map((d) => (
          <span key={d} className="df-dow" role="columnheader">
            {d}
          </span>
        ))}
        {cells.map((d) => {
          const chosen = (withTime ? draftDate : date) === d;
          return (
            <button
              key={d}
              type="button"
              className={`df-day${d.startsWith(month) ? '' : ' out'}${d === today ? ' today' : ''}${chosen ? ' sel' : ''}`}
              disabled={!allowed(d)}
              aria-pressed={chosen}
              aria-label={longPolishDate(d, true)}
              data-date={d}
              onClick={() => pick(d)}
            >
              {Number(d.slice(8, 10))}
            </button>
          );
        })}
      </div>
      {withTime && (
        <>
          <span className="df-cap">{t.time}</span>
          <div className="df-times">
            {TIMES.map((tm) => (
              <button key={tm} type="button" className="df-time" aria-pressed={draftTime === tm} onClick={() => setDraftTime(tm)}>
                {tm}
              </button>
            ))}
          </div>
          <label className="df-other">
            {t.otherTime}
            <input value={draftTime} onChange={(e) => typeTime(e.target.value)} inputMode="numeric" placeholder="14:30" maxLength={5} aria-invalid={draftTime !== '' && !validTime(draftTime)} />
          </label>
          <div className="df-actions">
            <button type="button" className="df-btn primary" disabled={!draftDate || (draftTime !== '' && !validTime(draftTime))} onClick={done}>
              {t.done}
            </button>
            <button type="button" className="df-btn" onClick={() => setOpen(false)}>
              {t.cancel}
            </button>
          </div>
        </>
      )}
      {!withTime && phone && (
        <div className="df-actions">
          <button type="button" className="df-btn" onClick={() => setOpen(false)}>
            {t.cancel}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="df" ref={wrap}>
      <div className={`df-field${open ? ' on' : ''}${disabled ? ' disabled' : ''}`}>
        <button id={fieldId} type="button" className={`df-value${value ? '' : ' empty'}`} onClick={() => !disabled && setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} disabled={disabled}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
            <path d="M3.5 10h17M8 3v4M16 3v4" />
          </svg>
          <span>{label}</span>
        </button>
        {shortcuts && !withTime && !disabled && (
          <span className="df-quick">
            {[
              [today, t.today],
              [addDays(today, 1), t.tomorrow],
            ]
              .filter(([d]) => allowed(d!))
              .map(([d, l]) => (
                <button key={d} type="button" onClick={() => onChange(d!)} aria-pressed={date === d}>
                  {l}
                </button>
              ))}
          </span>
        )}
        {clearable && value && !disabled && (
          <button type="button" className="df-clear" onClick={() => onChange('')}>
            {t.clear}
          </button>
        )}
      </div>
      {open &&
        createPortal(
          phone ? (
            <div className="df-backdrop" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
              {panel}
            </div>
          ) : (
            panel
          ),
          document.body,
        )}
    </div>
  );
}
