import { useEffect, useState } from 'react';
import { pl } from '../i18n/pl';
import { enablePush, pushState, type PushState } from '../push';
import { onNav } from '../router';

const t = pl.academy.pushGate;

/**
 * Start: notifications are required (owner, 2026-10-17). Until they are on, this card stays at the top and says why.
 * Not shown where notifications cannot work at all (a desktop browser without support, no keys on the server).
 */
export function PushGate() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const check = () =>
      pushState()
        .then(setState)
        .catch(() => setState(null));
    void check();
    // back from the phone's settings → check again
    const vis = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, []);
  if (!state || state === 'on' || state === 'no-key' || state === 'unsupported') return null;

  async function enable() {
    setBusy(true);
    setFailed(false);
    try {
      const s = await enablePush();
      setState(s);
      if (s === 'off') setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="a-card push-gate" aria-live="polite">
      <span className="push-gate-title">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
          <path d="M10 20.5a2 2 0 0 0 4 0" />
        </svg>
        {t.title}
      </span>
      <span className="a-sub">{state === 'ios-install' ? t.ios : state === 'denied' ? t.denied : t.why}</span>
      {failed && <span className="a-sub">{t.failed}</span>}
      {state === 'off' && (
        <button className="a-btn primary center" disabled={busy} onClick={() => void enable()}>
          {t.enable}
        </button>
      )}
      {state === 'ios-install' && (
        <a className="a-btn primary center" href="/instaluj" onClick={onNav('/instaluj')}>
          {t.howToInstall}
        </a>
      )}
    </section>
  );
}
