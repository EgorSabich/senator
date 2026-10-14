import { useEffect, useRef, type ReactNode } from 'react';
import { pl } from '../i18n/pl';

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
