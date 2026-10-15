import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';

/* ───────── Icons (inline stroke SVG, decorative) ───────── */

const paths: Record<string, ReactNode> = {
  people: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M17 14c2.5 0 4 1.5 4.5 4" />
    </>
  ),
  book: (
    <>
      <path d="M4 5h7a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4z" />
      <path d="M20 5h-7a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h7z" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M16 7l3 3" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  learn: (
    <>
      <path d="M3 7l9-4 9 4-9 4z" />
      <path d="M7 9v5c0 1.5 2.5 3 5 3s5-1.5 5-3V9" />
    </>
  ),
  up: <path d="M6 15l6-6 6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  menu: (
    <>
      <path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5" />
      <path d="M17 21V3c-2 1.5-3 4-3 7v4h3" />
    </>
  ),
  back: <path d="M15 6l-6 6 6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </>
  ),
};

export function Icon({ name, size = 22 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/* ───────── Buttons ───────── */

export function Btn(props: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const kind = props.kind ?? 'secondary';
  const style: React.CSSProperties = {
    minHeight: 44,
    padding: '0 16px',
    borderRadius: 10,
    fontFamily: 'var(--font-ui)',
    fontSize: 14,
    fontWeight: kind === 'primary' ? 700 : 600,
    cursor: props.disabled ? 'default' : 'pointer',
    border: kind === 'primary' ? 'none' : `1px solid ${kind === 'danger' ? 'var(--bad-border)' : 'var(--border)'}`,
    background: kind === 'primary' ? (props.disabled ? 'var(--border)' : 'var(--accent)') : 'none',
    color: kind === 'primary' ? (props.disabled ? 'var(--text-disabled)' : 'var(--on-accent)') : kind === 'danger' ? 'var(--bad-fg)' : 'var(--text)',
  };
  return (
    <button type={props.type ?? 'button'} onClick={props.onClick} disabled={props.disabled} style={style}>
      {props.children}
    </button>
  );
}

/* ───────── Modal ───────── */

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}>
        <h2 id="modal-title" style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600 }}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/* ───────── Permanent deletion (D30) ───────── */

/**
 * "Usuń na zawsze": the user sees what goes with it and must type the name (login / title) exactly.
 * `impactPath` returns { confirmText, ...counts }; `lines` turns the counts into sentences.
 */
export function DeleteForeverModal(props: {
  title: string;
  impactPath: string | null;
  confirmText?: string;
  lines?: (impact: Record<string, number>) => string[];
  deletePath: string;
  onDeleted: () => void | Promise<void>;
  onClose: () => void;
}) {
  const d = pl.admin.deleteForever;
  const [impact, setImpact] = useState<Record<string, any> | null>(props.impactPath ? null : {});
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!props.impactPath) return;
    api<Record<string, any>>(props.impactPath)
      .then(setImpact)
      .catch((e) => setError(errorText(e instanceof ApiFailure ? e.code : 'generic')));
  }, [props.impactPath]);
  const expected: string = (impact?.confirmText as string | undefined) ?? props.confirmText ?? '';
  const norm = (v: string) => v.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pl');
  const ok = expected !== '' && norm(typed) === norm(expected);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api(props.deletePath, { method: 'DELETE', body: { confirm: typed } });
      await props.onDeleted();
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
      setBusy(false);
    }
  }

  return (
    <Modal title={props.title} onClose={props.onClose}>
      <p style={{ margin: 0 }}>{d.intro}</p>
      {impact && props.lines && props.lines(impact as Record<string, number>).length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {props.lines(impact as Record<string, number>).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{d.backups}</p>
      <div className="field">
        <label htmlFor="delete-confirm">{d.typeToConfirm(expected)}</label>
        <input id="delete-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} disabled={!impact} />
      </div>
      {error && <div className="notice warn-notice" role="alert">{error}</div>}
      <div className="btn-row">
        <Btn kind="danger" onClick={() => void run()} disabled={!ok || busy}>
          {busy ? d.deleting : d.button}
        </Btn>
        <Btn onClick={props.onClose}>{d.cancel}</Btn>
      </div>
    </Modal>
  );
}

/* ───────── One-time login card ───────── */

export interface SecretInfo {
  name: string;
  login: string;
  tempSecret: string;
  secretKind: 'pin' | 'password';
}

export function SecretCardModal({ info, onClose }: { info: SecretInfo; onClose: () => void }) {
  const isPin = info.secretKind === 'pin';
  return (
    <Modal title={pl.admin.card.title} onClose={onClose}>
      <div className="secret-card">
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600 }}>SENATOR Academy</div>
        <div>{info.name}</div>
        <div>
          <div className="label">{pl.admin.card.address}</div>
          <div>{location.origin}</div>
        </div>
        <div>
          <div className="label">{pl.admin.card.login}</div>
          <div className="value">{info.login}</div>
        </div>
        <div>
          <div className="label">{isPin ? pl.admin.card.pin : pl.admin.card.password}</div>
          <div className="value">{info.tempSecret}</div>
        </div>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
        {isPin ? pl.admin.card.note : pl.admin.card.notePassword}
      </p>
      <div className="btn-row">
        <Btn kind="primary" onClick={() => window.print()}>
          {pl.admin.card.print}
        </Btn>
        <Btn onClick={onClose}>{pl.admin.card.close}</Btn>
      </div>
    </Modal>
  );
}

/* ───────── Formatting ───────── */

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return '—';
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Warsaw' }).format(new Date(ms));
}

export function formatTime(ms: number): string {
  return new Intl.DateTimeFormat('pl-PL', { timeStyle: 'short', timeZone: 'Europe/Warsaw' }).format(new Date(ms));
}

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — fine */
  }
}
