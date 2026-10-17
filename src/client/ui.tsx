/** Small shared UI pieces following the approved prototype (spec section H). */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useLiveState, updateApp } from './live';
import { pl } from './i18n/pl';

export function Brand({ size = 'm' }: { size?: 'm' | 'l' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: size === 'l' ? 'center' : 'flex-start' }}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: size === 'l' ? 40 : 22, fontWeight: 600, letterSpacing: '0.08em' }}>
        SENATOR
      </span>
      <span style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Academy</span>
    </div>
  );
}

/** Loading state with the Senator mark: a ring drawn around the "S", the word lighting up letter by letter. */
/** Skeleton rows: the page keeps its shape while data arrives (no jump, no spinner). */
export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton" role="status" aria-live="polite">
      <span className="sk-title" />
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="sk-row" style={{ animationDelay: `${i * 60}ms` }} />
      ))}
      <span className="sr-only">Ładowanie…</span>
    </div>
  );
}

export function LogoLoader({ full = false, label }: { full?: boolean; label?: string }) {
  // inside pages a skeleton feels faster; the animated logo stays for starting the app
  if (!full) return <Skeleton />;
  return (
    <div className={`logo-loader${full ? ' full' : ''}`} role="status" aria-live="polite">
      <svg className="logo-mark" viewBox="0 0 64 64" aria-hidden="true">
        <circle className="track" cx="32" cy="32" r="29" />
        <circle className="arc" cx="32" cy="32" r="29" />
        <text x="32" y="43" textAnchor="middle">
          S
        </text>
      </svg>
      <span className="logo-word" aria-hidden="true">
        {'SENATOR'.split('').map((ch, i) => (
          <span key={i} style={{ animationDelay: `${i * 90}ms` }}>
            {ch}
          </span>
        ))}
      </span>
      <span className="sr-only">{label ?? 'Ładowanie…'}</span>
    </div>
  );
}

export function Field(props: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'password';
  inputMode?: 'text' | 'numeric';
  autoComplete?: string;
  maxLength?: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={props.id} style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-soft)' }}>
        {props.label}
      </label>
      <input
        id={props.id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        type={props.type ?? 'text'}
        inputMode={props.inputMode}
        autoComplete={props.autoComplete}
        autoCapitalize="none"
        spellCheck={false}
        maxLength={props.maxLength}
        aria-describedby={props.hint ? `${props.id}-hint` : undefined}
        style={inputStyle}
      />
      {props.hint && (
        <span id={`${props.id}-hint`} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {props.hint}
        </span>
      )}
    </div>
  );
}

export function PrimaryButton({ children, disabled, type = 'submit', onClick }: { children: ReactNode; disabled?: boolean; type?: 'submit' | 'button'; onClick?: () => void }) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        minHeight: 50,
        borderRadius: 12,
        border: 'none',
        fontFamily: 'var(--font-ui)',
        fontSize: 16,
        fontWeight: 700,
        background: disabled ? 'var(--border)' : 'var(--accent)',
        color: disabled ? 'var(--text-disabled)' : 'var(--on-accent)',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minHeight: 44,
        padding: '0 16px',
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'none',
        color: 'var(--text)',
        fontFamily: 'var(--font-ui)',
        fontSize: 14,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" style={{ borderRadius: 12, background: 'var(--bad-bg)', border: '1px solid var(--bad-border)', color: 'var(--bad-fg)', padding: '12px 14px', fontSize: 14, lineHeight: 1.5 }}>
      {message}
    </div>
  );
}

export const inputStyle: CSSProperties = {
  minHeight: 50,
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontFamily: 'var(--font-ui)',
  fontSize: 17,
  padding: '0 14px',
};

export const screen: CSSProperties = {
  minHeight: '100dvh',
  maxWidth: 440,
  margin: '0 auto',
  padding: '32px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
};

/**
 * A section that folds and unfolds smoothly (checklist sections, long lists).
 * The header is a button; the body keeps its content while folded so the height animates evenly.
 */
export function Fold(props: { open: boolean; onToggle: () => void; head: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; id: string }) {
  return (
    <section className={`fold${props.open ? ' open' : ''}${props.className ? ` ${props.className}` : ''}`}>
      <button type="button" className="fold-head" aria-expanded={props.open} aria-controls={props.id} onClick={props.onToggle}>
        <span className="fold-title">{props.head}</span>
        {props.aside && <span className="fold-aside">{props.aside}</span>}
        <svg className="fold-chev" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="fold-body" id={props.id} inert={!props.open}>
        <div className="fold-inner">{props.children}</div>
      </div>
    </section>
  );
}

/** Thin bars at the top: no internet (panel) and „Jest nowa wersja” (everywhere). */
export function LiveBar({ showOffline = false }: { showOffline?: boolean }) {
  const st = useLiveState();
  if (st.newVersion)
    return (
      <div className="live-bar" role="status">
        <span>{pl.live.newVersion}</span>
        <button type="button" onClick={() => void updateApp()}>
          {pl.live.update}
        </button>
      </div>
    );
  if (showOffline && !st.online)
    return (
      <div className="live-bar off" role="status">
        <span>{pl.live.offline}</span>
      </div>
    );
  return null;
}

/** The one chevron of the app (owner, 2026-10-18: no text triangles); turns over when `up`. */
export function Chevron({ up = false, size = 16 }: { up?: boolean; size?: number }) {
  return (
    <svg className={`chev-ic${up ? ' up' : ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Height that opens and closes smoothly (grid rows 0fr → 1fr); the content stays put while it folds. */
export function Reveal({ open, children, lazy = false }: { open: boolean; children: ReactNode; lazy?: boolean }) {
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);
  return (
    <div className={`reveal${open ? ' open' : ''}`}>
      <div className="reveal-inner" inert={!open}>
        {!lazy || seen ? children : null}
      </div>
    </div>
  );
}

/** A heading that folds its content out (replaces <details>, which cannot animate). */
export function Disclosure(props: {
  summary: ReactNode;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  className?: string;
  lazy?: boolean;
}) {
  const [own, setOwn] = useState(props.defaultOpen ?? false);
  const open = props.open ?? own;
  return (
    <div className={`disc${open ? ' open' : ''}${props.className ? ` ${props.className}` : ''}`}>
      <button
        type="button"
        className="disc-head"
        aria-expanded={open}
        onClick={() => {
          setOwn(!open);
          props.onToggle?.(!open);
        }}
      >
        {props.summary}
        <Chevron up={open} />
      </button>
      <Reveal open={open} lazy={props.lazy}>
        {props.children}
      </Reveal>
    </div>
  );
}
