import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiFailure, type Me } from '../api';
import { errorText, pl } from '../i18n/pl';

export interface AcademyCtx {
  me: Me;
  locationId: string;
  online: boolean;
}
export const Ctx = createContext<AcademyCtx | null>(null);
export function useAcademy(): AcademyCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAcademy outside Academy');
  return v;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/** GET with loading/error state. The service worker answers from cache when offline. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    setError(null);
    setCode(null);
    try {
      setData(await api<T>(path));
    } catch (e) {
      const c = e instanceof ApiFailure ? e.code : 'generic';
      setCode(c);
      setError(c === 'network' ? pl.academy.offlineMissing : errorText(c));
    }
  }, [path]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);
  return { data, error, code, reload: load, setData };
}

const ICONS: Record<string, ReactNode> = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  learn: (
    <>
      <path d="M3 7l9-4 9 4-9 4z" />
      <path d="M7 9v5c0 1.5 2.5 3 5 3s5-1.5 5-3V9" />
    </>
  ),
  menu: (
    <>
      <path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5" />
      <path d="M17 21V3c-2 1.5-3 4-3 7v4h3" />
    </>
  ),
  book: (
    <>
      <path d="M4 5h7a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4z" />
      <path d="M20 5h-7a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h7z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </>
  ),
  back: <path d="M15 6l-6 6 6 6" />,
  next: <path d="M9 6l6 6-6 6" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  check: <path d="M5 12l5 5 9-10" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </>
  ),
  photo: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 16l-5-5-8 8" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </>
  ),
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />,
};

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

export function StatusPill({ status, updated }: { status: 'new' | 'done' | 'review'; updated?: boolean }) {
  const t = pl.academy;
  if (status === 'review') return <span className="a-pill bad">{t.statusReview}</span>;
  if (status === 'done' && updated) return <span className="a-pill warn">{t.updated}</span>;
  if (status === 'done') return <span className="a-pill ok">{t.statusDone}</span>;
  return <span className="a-pill">{t.statusNew}</span>;
}

export function Loading() {
  return (
    <p className="a-sub" aria-busy="true">
      {pl.app.loading}
    </p>
  );
}

export function Problem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="a-note bad" role="alert">
      {message}
    </div>
  );
}

export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Warsaw' }).format(new Date(ms));
}

export const contentHref = (id: string) => `/m/${id}`;
