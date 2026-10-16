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
const PHOTO_KEY = 'sa.terminal.photo';
export const TERMINAL_FLAG = 'sa.terminal';
const PIN_LENGTH = 6;
const REQUEST_TIMEOUT = 8000;
const HEARTBEAT_MS = 30_000;
const FLUSH_MS = 15_000;
const RESULT_MS = 4500;
const CONFIRM_MS = 10_000;
const MAX_QUEUED_PHOTOS = 20;
const RELOAD_AFTER_MS = 12 * 3600_000;

interface Queued {
  clientId: string;
  pin: string;
  at: number;
  photo?: string;
}

/** Answer of /api/terminal/preview (D40): whose PIN it is and what the slider will save. */
interface Preview {
  outcome: 'in' | 'out' | 'duplicate' | 'unknown_pin';
  name?: string;
  since?: number;
  missingExit?: boolean;
}

interface Confirming {
  pin: string;
  /** null = no connection: a generic confirmation, the punch is queued */
  preview: Preview | null;
  key: number;
}

interface Status {
  terminal: { name: string; location: string };
  serverTime: number;
  photo?: boolean;
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

/** Front camera for the optional punch photo (D40): opened only on the confirmation screen, closed right after. */
function useCamera() {
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const token = useRef(0);
  const [state, setState] = useState<'off' | 'starting' | 'on' | 'failed'>('off');

  const attach = useCallback((el: HTMLVideoElement | null) => {
    video.current = el;
    if (el && stream.current && el.srcObject !== stream.current) {
      el.srcObject = stream.current;
      void el.play().catch(() => undefined);
    }
  }, []);

  const stop = useCallback(() => {
    token.current += 1;
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setState('off');
  }, []);

  const start = useCallback(async () => {
    const my = ++token.current;
    setState('starting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } }, audio: false });
      if (my !== token.current) {
        s.getTracks().forEach((tr) => tr.stop());
        return;
      }
      stream.current = s;
      attach(video.current);
      setState('on');
    } catch {
      if (my === token.current) setState('failed');
    }
  }, [attach]);

  /** Small JPEG (240 px wide, ~10–30 KB) or null when there is no picture yet. */
  const capture = useCallback((): string | null => {
    const v = video.current;
    if (!v || !stream.current || v.readyState < 2 || !v.videoWidth) return null;
    const w = 240;
    const h = Math.round((v.videoHeight / v.videoWidth) * w);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, w, h);
    const url = canvas.toDataURL('image/jpeg', 0.6);
    return url.length < 100_000 ? url : canvas.toDataURL('image/jpeg', 0.4);
  }, []);

  useEffect(() => stop, [stop]);
  return { attach, start, stop, capture, state };
}

/** Horizontal "slide to confirm" (D40): a deliberate gesture, so a wrong PIN or a pocket tap never saves anything. */
function Slider({ label, onDone }: { label: string; onDone: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: number; max: number } | null>(null);
  const xRef = useRef(0);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const done = useRef(false);
  const move = (v: number) => {
    xRef.current = v;
    setX(v);
  };
  const finish = () => {
    if (done.current) return;
    done.current = true;
    try {
      navigator.vibrate?.(30);
    } catch {
      /* none */
    }
    onDone();
  };
  return (
    <div className="t-slider" ref={track}>
      <span className="t-slider-text" style={{ opacity: Math.max(0, 1 - x / 160) }}>
        {label}
      </span>
      <button
        type="button"
        className={`t-slider-knob${dragging ? '' : ' snap'}`}
        style={{ transform: `translateX(${x}px)` }}
        aria-label={pl.terminal.slideLabel}
        onPointerDown={(e) => {
          const r = track.current!.getBoundingClientRect();
          drag.current = { start: e.clientX - xRef.current, max: r.width - e.currentTarget.offsetWidth - 12 };
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          move(Math.min(Math.max(e.clientX - drag.current.start, 0), drag.current.max));
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          setDragging(false);
          if (!d) return;
          if (xRef.current >= d.max * 0.85) {
            move(d.max);
            finish();
          } else move(0);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
          move(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            finish();
          }
        }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>
    </div>
  );
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
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const camera = useCamera();
  // remembered, so a terminal restarted without internet still takes the photo
  const photoOn = status ? Boolean(status.photo) : store<boolean>(PHOTO_KEY, false);
  const confirmTimer = useRef<number | undefined>(undefined);
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
      save(PHOTO_KEY, Boolean(s.photo));
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
          await call('/api/terminal/punch', { method: 'POST', body: { pin: item.pin, clientId: item.clientId, at: item.at, offline: true, photo: item.photo } });
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
    async (code: string, photo: string | null = null) => {
      setBusy(true);
      const item: Queued = { clientId: newClientId(), pin: code, at: Date.now() + offset.current };
      if (photo) item.photo = photo;
      const queueOffline = () => {
        // photos are small, but the phone's storage is not endless: a long offline spell keeps the times, not the pictures
        if (queueRef.current.filter((q) => q.photo).length >= MAX_QUEUED_PHOTOS) delete item.photo;
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
        const r = await call<PunchAnswer>('/api/terminal/punch', { method: 'POST', body: { pin: code, clientId: item.clientId, photo: item.photo } });
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

  const closeConfirm = useCallback(() => {
    window.clearTimeout(confirmTimer.current);
    camera.stop();
    setConfirming(null);
  }, [camera]);

  const openConfirm = useCallback(
    (code: string, preview: Preview | null) => {
      setConfirming({ pin: code, preview, key: Date.now() });
      if (photoOn) void camera.start();
      window.clearTimeout(confirmTimer.current);
      confirmTimer.current = window.setTimeout(() => {
        camera.stop();
        setConfirming(null);
      }, CONFIRM_MS);
    },
    [camera, photoOn],
  );

  const confirmed = useCallback(() => {
    if (!confirming) return;
    const photo = photoOn ? camera.capture() : null;
    const code = confirming.pin;
    closeConfirm();
    void submit(code, photo);
  }, [camera, closeConfirm, confirming, photoOn, submit]);

  /** Full PIN typed: ask the server whose it is, then show the slider (D40). Without internet: a generic slider. */
  const check = useCallback(
    async (code: string) => {
      setBusy(true);
      try {
        if (queueRef.current.length || !navigator.onLine) return openConfirm(code, null);
        const p = await call<Preview>('/api/terminal/preview', { method: 'POST', body: { pin: code } });
        setOnline(true);
        if (p.outcome === 'unknown_pin') showResult({ kind: 'unknown_pin' });
        else if (p.outcome === 'duplicate') showResult({ kind: 'duplicate', name: p.name ?? '', at: p.since ?? Date.now() });
        else openConfirm(code, p);
      } catch (e) {
        if (e instanceof ApiFailure && e.status === 429) showResult({ kind: 'paused' });
        else if (e instanceof ApiFailure && (e.status === 401 || e.status === 403)) lost();
        else {
          setOnline(false);
          openConfirm(code, null);
        }
      } finally {
        setBusy(false);
        setPin('');
      }
    },
    [lost, openConfirm, showResult],
  );

  const press = (d: string) => {
    if (busy || exiting || confirming) return;
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
      if (next.length === PIN_LENGTH) void check(next);
      return next;
    });
  };

  // Hardware / Bluetooth keyboards
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (exiting) return;
      if (confirming) {
        if (e.key === 'Escape') closeConfirm();
        else if (e.key === 'Enter') confirmed();
        return;
      }
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
        {confirming ? (
          <ConfirmCard c={confirming} />
        ) : result ? (
          <ResultCard r={result} />
        ) : (
          <>
            <p className="t-label">{busy ? t.checking : t.enterPin}</p>
            <div className={`t-dots${busy ? ' busy' : ''}`} key={shake} data-shake={shake > 0 || undefined} aria-label={`${pin.length} / ${PIN_LENGTH}`}>
              {Array.from({ length: PIN_LENGTH }, (_, i) => (
                <span key={i} className={i < pin.length ? 'filled' : ''} />
              ))}
            </div>
          </>
        )}
      </div>

      {confirming ? (
        <div className="t-confirm" key={confirming.key}>
          {photoOn && (
            <div className={`t-cam ${camera.state}`}>
              {camera.state === 'failed' ? (
                <span>{t.photoOff}</span>
              ) : (
                <>
                  <video ref={camera.attach} muted playsInline autoPlay aria-hidden="true" />
                  <span>{t.photoOn}</span>
                </>
              )}
            </div>
          )}
          <Slider label={t.slide} onDone={confirmed} />
          <button type="button" className="t-notme" onClick={closeConfirm}>
            {t.notMe}
          </button>
          <div className="t-countdown" aria-hidden="true">
            <i />
          </div>
        </div>
      ) : (
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
      )}

      <footer className="t-foot">
        <p className="t-hint">{t.hint}</p>
      </footer>

      {exiting && <ExitDialog queued={queue.length} onClose={() => setExiting(false)} onExited={() => { setQ([]); onSignedOut(); }} />}
    </div>
  );
}

function ConfirmCard({ c }: { c: Confirming }) {
  const p = c.preview;
  let title: string = t.confirmOffline;
  let sub: string = t.confirmOfflineSub;
  if (p?.outcome === 'in') {
    title = p.name ?? '';
    sub = t.confirmIn + (p.missingExit ? `. ${t.confirmInMissing}` : '');
  } else if (p?.outcome === 'out' && p.since) {
    title = p.name ?? '';
    sub = t.confirmOut(formatClock(p.since), formatDuration(Math.round((Date.now() - p.since) / 60000)));
  }
  return (
    <div className={`t-result t-confirm-card ${p ? (p.outcome === 'out' ? 'out' : 'ok') : 'warn'}`} role="status">
      <div className="t-result-title">{title}</div>
      <div className="t-result-sub">{sub}</div>
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
