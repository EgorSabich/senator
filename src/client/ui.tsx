/** Small shared UI pieces following the approved prototype (spec section H). */
import type { CSSProperties, ReactNode } from 'react';

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
export function LogoLoader({ full = false, label }: { full?: boolean; label?: string }) {
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
