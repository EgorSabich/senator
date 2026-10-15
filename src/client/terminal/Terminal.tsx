/**
 * Time clock mode of a work phone (D35). Built to stay up all day:
 * - always ready for a PIN: no navigation, no scrolling, screen kept awake (Wake Lock);
 * - works without internet: punches wait in a queue on the phone (with the real time) and are sent later;
 *   every punch has a client id, so a re-send never counts twice;
 * - heals itself: a JS error or a long uptime reloads the page (only when nothing waits in the queue).
 */
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiFailure } from '../api';
import { pl } from '../i18n/pl';
import { formatClock, formatDuration } from '../../shared/time';
import '../styles/terminal.css';

const t = pl.terminal;
const QUEUE_KEY = 'sa.terminal.queue';
const OFFSET_KEY = 'sa.terminal.offset';
export const TERMINAL_FLAG = 'sa.terminal';
const PIN_LENGTH = 6;
const REQUEST_TIMEOUT = 8000;
const HEARTBEAT_MS = 30_000;
const FLUSH_MS = 15_000;
const RESULT_MS = 4500;
const RELOAD_AFTER_MS = 12 * 3600_000;

interface Queued {
  clientId: string;
  pin: string;
  at: number;
}

interface Status {
  terminal: { name: string; location: string };
  serverTime: number;
  onShift: { name: string; since: number }[];
}

type Result =
  | { kind: 'in'; name: string; at: number; missingExit?: boolean }
  | { kind: 'out'; name: string; at: number; minutes: number }
  | { kind: 'duplicate'; name: string; at: number }
  | { kind: 'unknown_pin' | 'rejected' | 'paused' }
  | { kind: 'queued'; at: number };

function store<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the punch still goes online */
  }
}
function newClientId() {
  const a = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiFailure(0, 'network');
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiFailure(res.status, data.error ?? 'generic');
  return data as T;
}

interface PunchAnswer {
  outcome: 'in' | 'out' | 'duplicate' | 'unknown_pin' | 'rejected';
  at: number;
  firstName: string | null;
  minutes?: number;
  missingExit?: boolean;
}

function TerminalScreen({ onSignedOut }: { onSignedOut: () => void }) {
  const [pin, setPin] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [status, setStatus] = useState<Status | null>(null);
  const [queue, setQueue] = useState<Queued[]>(() => store<Queued[]>(QUEUE_KEY, []));
  const [now, setNow] = useState(Date.now());
  const [exiting, setExiting] = useState(false);
  const [shake, setShake] = useState(0);
  const offset = useRef<number>(store<number>(OFFSET_KEY, 0));
  const queueRef = useRef(queue);
  const resultTimer = useRef<number | undefined>(undefined);
  const idleTimer = useRef<number | undefined>(undefined);
  const startedAt = useRef(Date.now());
  const flushing = useRef(false);

  const setQ = useCallback((q: Queued[]) => {
    queueRef.current = q;
    setQueue(q);
    save(QUEUE_KEY, q);
  }, []);

  const lost = useCallback(() => {
    // The terminal account was signed out (password reset, disabled). Keep the queue: it is sent after the next sign-in.
    onSignedOut();
  }, [onSignedOut]);

  // Clock
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Keep the screen on
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (wl && document.visibilityState === 'visible') lock = await wl.request('screen');
      } catch {
        /* not supported or refused: the phone's own "never sleep" setting does the job */
      }
    };
    void request();
    const onVis = () => document.visibilityState === 'visible' && void request();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  const heartbeat = useCallback(async () => {
    try {
      const s = await call<Status>('/api/terminal/status');
      offset.current = s.serverTime - Date.now();
      save(OFFSET_KEY, offset.current);
      setStatus(s);
      setOnline(true);
    } catch (e) {
      if (e instanceof ApiFailure && (e.status === 401 || e.status === 403)) return lost();
      setOnline(false);
    }
  }, [lost]);

  const flush = useCallback(async () => {
    if (flushing.current || !queueRef.current.length) return;
    flushing.current = true;
    try {
      while (queueRef.current.length) {
        const item = queueRef.current[0]!;
        try {
          await call('/api/terminal/punch', { method: 'POST', body: { pin: item.pin, clientId: item.clientId, at: item.at, offline: true } });
        } catch (e) {
          if (e instanceof ApiFailure && e.status === 0) {
            setOnline(false);
            return;
          }
          if (e instanceof ApiFailure && (e.status === 401 || e.status === 403)) return lost();
          if (e instanceof ApiFailure && (e.status === 429 || e.status >= 500)) return; // try again later
          // anything else is final for this punch (the server logged it)
        }
        setQ(queueRef.current.slice(1));
        setOnline(true);
      }
      void heartbeat();
    } finally {
      flushing.current = false;
    }
  }, [heartbeat, lost, setQ]);

  // Heartbeat, queue, network events; reload after a long uptime when idle
  useEffect(() => {
    void heartbeat().then(() => flush());
    const hb = window.setInterval(() => void heartbeat(), HEARTBEAT_MS);
    const fl = window.setInterval(() => {
      void flush();
      if (Date.now() - startedAt.current > RELOAD_AFTER_MS && !queueRef.current.length && navigator.onLine) window.location.reload();
    }, FLUSH_MS);
    const on = () => {
      void heartbeat();
      void flush();
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    document.addEventListener('visibilitychange', on);
    return () => {
      clearInterval(hb);
      clearInterval(fl);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      document.removeEventListener('visibilitychange', on);
    };
  }, [heartbeat, flush]);

  const showResult = useCallback((r: Result) => {
    setResult(r);
    if (r.kind === 'unknown_pin' || r.kind === 'paused' || r.kind === 'rejected') setShake((x) => x + 1);
    try {
      navigator.vibrate?.(r.kind === 'in' || r.kind === 'out' ? 40 : [60, 40, 60]);
    } catch {
      /* no vibration */
    }
    window.clearTimeout(resultTimer.current);
    resultTimer.current = window.setTimeout(() => setResult(null), RESULT_MS);
  }, []);

  const submit = useCallback(
    async (code: string) => {
      setBusy(true);
      const item: Queued = { clientId: newClientId(), pin: code, at: Date.now() + offset.current };
      const queueOffline = () => {
        setQ([...queueRef.current, item]);
        setOnline(false);
        showResult({ kind: 'queued', at: item.at });
      };
      try {
        if (queueRef.current.length || !navigator.onLine) {
          queueOffline(); // keep the order: older punches go first
          void flush();
          return;
        }
        const r = await call<PunchAnswer>('/api/terminal/punch', { method: 'POST', body: { pin: code, clientId: item.clientId } });
        setOnline(true);
        const name = r.firstName ?? '';
        if (r.outcome === 'in') showResult({ kind: 'in', name, at: r.at, missingExit: r.missingExit });
        else if (r.outcome === 'out') showResult({ kind: 'out', name, at: r.at, minutes: r.minutes ?? 0 });
        else if (r.outcome === 'duplicate') showResult({ kind: 'duplicate', name, at: r.at });
        else showResult({ kind: r.outcome });
        void heartbeat();
      } catch (e) {
        if (e instanceof ApiFailure && e.status === 429) showResult({ kind: 'paused' });
        else if (e instanceof ApiFailure && (e.status === 401 || e.status === 403)) {
          setQ([...queueRef.current, item]);
          lost();
        } else queueOffline(); // no answer: the server may or may not have it — the client id makes the re-send safe
      } finally {
        setBusy(false);
        setPin('');
      }
    },
    [flush, heartbeat, lost, setQ, showResult],
  );

  const press = (d: string) => {
    if (busy || exiting) return;
    if (result) setResult(null);
    try {
      navigator.vibrate?.(10);
    } catch {
      /* no vibration */
    }
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setPin(''), 10_000);
    setPin((p) => {
      const next = (p + d).slice(0, PIN_LENGTH);
      if (next.length === PIN_LENGTH) void submit(next);
      return next;
    });
  };

  // Hardware / Bluetooth keyboards
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (exiting) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Escape') setPin('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const date = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Warsaw' }).format(new Date(now + offset.current));
  const clock = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' }).format(new Date(now + offset.current));

  return (
    <div className="t-screen">
      <header className="t-top">
        <div className="t-brand">
          <span className="t-word">SENATOR</span>
          <span className="t-sub">{status ? `${t.title} · ${status.terminal.location}` : t.title}</span>
        </div>
        <div className="t-top-right">
          <span className={`t-net ${online ? 'on' : 'off'}`} role="status">
            <i aria-hidden="true" />
            {online ? t.online : t.offline}
            {queue.length > 0 && ` · ${t.queued(queue.length)}`}
          </span>
          <button type="button" className="t-exit" aria-label={t.exit} onClick={() => setExiting(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          </button>
        </div>
      </header>

      <div className="t-clock">
        <div className="t-time">{clock}</div>
        <div className="t-date">{date}</div>
      </div>

      <div className="t-pin-area">
        {result ? (
          <ResultCard r={result} />
        ) : (
          <>
            <p className="t-label">{t.enterPin}</p>
            <div className={`t-dots${busy ? ' busy' : ''}`} key={shake} data-shake={shake > 0 || undefined} aria-label={`${pin.length} / ${PIN_LENGTH}`}>
              {Array.from({ length: PIN_LENGTH }, (_, i) => (
                <span key={i} className={i < pin.length ? 'filled' : ''} />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="t-pad" role="group" aria-label={t.enterPin}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" onClick={() => press(d)} disabled={busy}>
            {d}
          </button>
        ))}
        <button type="button" className="t-small" onClick={() => setPin('')} disabled={busy}>
          {t.clear}
        </button>
        <button type="button" onClick={() => press('0')} disabled={busy}>
          0
        </button>
        <button type="button" className="t-small" aria-label={t.erase} onClick={() => setPin((p) => p.slice(0, -1))} disabled={busy}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 5H9l-6 7 6 7h12z" />
            <path d="M17 9l-6 6M11 9l6 6" />
          </svg>
        </button>
      </div>

      <footer className="t-foot">
        <p className="t-hint">{t.hint}</p>
        {status && (
          <div className="t-shift">
            <span className="t-shift-label">{t.onShift(status.onShift.length)}</span>
            <div className="t-shift-names">
              {status.onShift.length === 0 ? <span className="t-muted">{t.nobody}</span> : status.onShift.map((p) => <span key={p.name + p.since}>{p.name}</span>)}
            </div>
          </div>
        )}
      </footer>

      {exiting && <ExitDialog queued={queue.length} onClose={() => setExiting(false)} onExited={() => { setQ([]); onSignedOut(); }} />}
    </div>
  );
}

function ResultCard({ r }: { r: Result }) {
  let title = '';
  let sub = '';
  let tone = 'ok';
  if (r.kind === 'in') {
    title = t.in(r.name);
    sub = t.inSub(formatClock(r.at)) + (r.missingExit ? ` ${t.inMissing}` : '');
  } else if (r.kind === 'out') {
    title = t.out(r.name);
    sub = t.outSub(formatClock(r.at), formatDuration(r.minutes));
  } else if (r.kind === 'duplicate') {
    title = t.duplicate(r.name);
    sub = t.duplicateSub(formatClock(r.at));
    tone = 'warn';
  } else if (r.kind === 'queued') {
    title = t.savedOffline;
    sub = t.savedOfflineSub(formatClock(r.at));
    tone = 'warn';
  } else if (r.kind === 'paused') {
    title = t.paused;
    sub = t.pausedSub;
    tone = 'bad';
  } else if (r.kind === 'rejected') {
    title = t.rejected;
    sub = t.rejectedSub;
    tone = 'bad';
  } else {
    title = t.unknown;
    sub = t.unknownSub;
    tone = 'bad';
  }
  return (
    <div className={`t-result ${tone}`} role="alert">
      <div className="t-result-icon" aria-hidden="true">
        {tone === 'ok' ? (
          <svg viewBox="0 0 52 52">
            <circle cx="26" cy="26" r="24" />
            <path d="M15 27l7 7 15-16" />
          </svg>
        ) : (
          <svg viewBox="0 0 52 52">
            <circle cx="26" cy="26" r="24" />
            <path d="M26 15v14M26 36v1" />
          </svg>
        )}
      </div>
      <div className="t-result-title">{title}</div>
      <div className="t-result-sub">{sub}</div>
    </div>
  );
}

function ExitDialog({ queued, onClose, onExited }: { queued: number; onClose: () => void; onExited: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await call('/api/terminal/exit', { method: 'POST', body: { password } });
      try {
        localStorage.removeItem(TERMINAL_FLAG);
      } catch {
        /* ignore */
      }
      onExited();
    } catch (e) {
      const code = e instanceof ApiFailure ? e.code : 'generic';
      setError(code === 'locked' ? t.locked : code === 'invalid_credentials' ? t.wrongPassword : pl.errors[code] ?? pl.errors.generic!);
      setBusy(false);
    }
  }
  return (
    <div className="t-modal-backdrop">
      <form
        className="t-modal"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <h2>{t.exitTitle}</h2>
        <p>{t.exitText}</p>
        {queued > 0 && <p className="t-warn">{t.exitQueued(queued)}</p>}
        <label htmlFor="t-pass">{t.password}</label>
        <input id="t-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        {error && <p className="t-error">{error}</p>}
        <div className="t-modal-row">
          <button type="button" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className="primary" disabled={!password || busy}>
            {t.exitButton}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Any render error: show the logo for a moment and start again — the terminal must not stay broken. */
class Recover extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    window.setTimeout(() => window.location.reload(), 3000);
  }
  render() {
    return this.state.failed ? <div className="t-screen t-center">SENATOR</div> : this.props.children;
  }
}

export function Terminal({ onSignedOut }: { onSignedOut: () => void }) {
  useEffect(() => {
    try {
      localStorage.setItem(TERMINAL_FLAG, '1');
    } catch {
      /* ignore */
    }
    // Errors outside React (timers, promises) also restart the terminal, unless punches wait in the queue.
    const restart = () => {
      if (!store<Queued[]>(QUEUE_KEY, []).length) window.setTimeout(() => window.location.reload(), 3000);
    };
    window.addEventListener('error', restart);
    return () => window.removeEventListener('error', restart);
  }, []);
  return (
    <Recover>
      <TerminalScreen onSignedOut={onSignedOut} />
    </Recover>
  );
}
