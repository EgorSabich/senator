/**
 * "Add to home screen" guide (owner, 2026-10-17): shown once after the first sign-in and kept in Konto.
 * Installed, the app opens full screen like a native one — and only then can iPhones receive notifications.
 */
import { useEffect, useState } from 'react';
import { pl } from '../i18n/pl';
import { navigate, onNav } from '../router';
import { Icon } from './shared';

const t = pl.install;
const SEEN_KEY = 'sa.install.seen';

type Platform = 'ios-safari' | 'ios-other' | 'android' | 'other';

export function platform(): Platform {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? 'ios-other' : 'ios-safari';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

export function isInstalled(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** Android/Chrome offers its own install dialog; we keep the event to open it from our button. */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: InstallEvent | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
  });
}

export function markInstallSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* ignore */
  }
}
export function installSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

/** After the first PIN is set: open the guide once (not when the app already runs installed). */
export function maybeShowInstallGuide() {
  if (!isInstalled() && !installSeen() && platform() !== 'other') navigate('/instaluj', true);
}

export function InstallGuide() {
  const p = platform();
  const [canPrompt, setCanPrompt] = useState(Boolean(deferred));
  const [done, setDone] = useState(isInstalled());
  useEffect(() => {
    markInstallSeen();
    const on = () => setCanPrompt(Boolean(deferred));
    window.addEventListener('beforeinstallprompt', on);
    const installed = () => setDone(true);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', on);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  const steps =
    p === 'ios-safari' ? t.ios : p === 'ios-other' ? t.iosOther : p === 'android' ? t.android : t.desktop;

  return (
    <main className="a-main">
      <h1 className="a-title">{t.title}</h1>
      <p className="a-sub">{t.why}</p>
      {done ? (
        <div className="a-note">
          <Icon name="check" size={18} />
          <span>{t.done}</span>
        </div>
      ) : (
        <>
          {p === 'android' && canPrompt && (
            <button
              type="button"
              className="a-btn primary"
              onClick={async () => {
                if (!deferred) return;
                await deferred.prompt();
                const r = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
                deferred = null;
                setCanPrompt(false);
                if (r.outcome === 'accepted') setDone(true);
              }}
            >
              {t.installButton}
            </button>
          )}
          <ol className="inst-steps">
            {steps.map((s, i) => (
              <li key={i} className="inst-step" style={{ animationDelay: `${i * 70}ms` }}>
                <span className="inst-num">{i + 1}</span>
                <span className="inst-text">
                  {s.text}
                  {s.icon && <span className={`inst-icon ${s.icon}`} aria-hidden="true" />}
                </span>
              </li>
            ))}
          </ol>
          <p className="a-sub">{p.startsWith('ios') ? t.iosNote : t.androidNote}</p>
        </>
      )}
      <a className="a-btn" href="/" onClick={onNav('/')}>
        {t.later}
      </a>
    </main>
  );
}

/** Small card on Start while the app is not installed (can be hidden). */
export function InstallCard() {
  const [hidden, setHidden] = useState(() => {
    try {
      return isInstalled() || platform() === 'other' || localStorage.getItem('sa.install.card') === 'hidden';
    } catch {
      return true;
    }
  });
  if (hidden) return null;
  return (
    <div className="a-list">
      <a className="a-row" href="/instaluj" onClick={onNav('/instaluj')}>
        <Icon name="download" size={20} />
        <span className="grow">
          <span className="t">{t.cardTitle}</span>
          <span className="s">{t.cardSub}</span>
        </span>
        <button
          type="button"
          className="a-icon-btn"
          aria-label={t.hide}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
              localStorage.setItem('sa.install.card', 'hidden');
            } catch {
              /* ignore */
            }
            setHidden(true);
          }}
        >
          ✕
        </button>
      </a>
    </div>
  );
}
