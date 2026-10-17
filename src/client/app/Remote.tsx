/**
 * Praca zdalna (owner, 2026-10-17; mockup 18): „Rozpocznij pracę” / „Zakończ pracę” on Start for call-center people
 * working from home. No terminal; marked „zdalnie” in Czas pracy.
 */
import { useEffect, useState } from 'react';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { Problem, useAcademy, useApi } from './shared';

interface RemoteState {
  allowed: boolean;
  open: { id: string; since: number; source: string } | null;
  shift: { start: number; end: number } | null;
}

const hm = (ms: number) => new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' }).format(new Date(ms));
const dur = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;

export function RemoteCard() {
  const t = pl.academy.remote;
  const { locationId } = useAcademy();
  const { data, setData } = useApi<RemoteState>(`/api/locations/${locationId}/remote`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!data?.open) return;
    const i = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(i);
  }, [data?.open]);
  if (!data?.allowed) return null;

  async function act(kind: 'start' | 'stop') {
    if (kind === 'stop' && !window.confirm(t.stopConfirm)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<RemoteState & { minutes?: number }>(`/api/locations/${locationId}/remote/${kind}`, { method: 'POST' });
      setData(r);
      setDone(kind === 'stop' ? (r.minutes ?? 0) : null);
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    } finally {
      setBusy(false);
    }
  }
  const open = data.open;
  return (
    <section className="a-card remote-card" aria-label={t.title}>
      <span className="a-label">
        {t.title}
        {data.shift ? ` · ${t.today(hm(data.shift.start), hm(data.shift.end))}` : ''}
      </span>
      {open && open.source !== 'remote' ? (
        <p className="a-sub">{t.terminalOpen(hm(open.since))}</p>
      ) : open ? (
        <>
          <b className="remote-now">{t.working(hm(open.since), dur(Math.max(0, Math.round((Date.now() - open.since) / 60000))))}</b>
          <button className="a-btn center" disabled={busy} onClick={() => void act('stop')}>
            {t.stop}
          </button>
        </>
      ) : (
        <>
          {done !== null && <p className="a-sub">{t.ended(dur(done))}</p>}
          <button className="a-btn primary center" disabled={busy} onClick={() => void act('start')}>
            {t.start}
          </button>
        </>
      )}
      <Problem message={error} />
    </section>
  );
}
