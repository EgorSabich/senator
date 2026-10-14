import { useState, type FormEvent } from 'react';
import { checkSecret } from '../../shared/secret-rules';
import { api, ApiFailure, type Me } from '../api';
import { errorText, pl } from '../i18n/pl';
import { Brand, ErrorBox, Field, PrimaryButton, SecondaryButton, screen } from '../ui';

/** Forced first change (onCancel absent) or a voluntary change from the account screen. */
export function ChangeSecret({ me, onDone, onCancel }: { me: Me; onDone: () => void; onCancel?: () => void }) {
  const isPin = me.user.secretKind === 'pin';
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = checkSecret(me.user.secretKind, next);
    if (problem) return setError(errorText(problem));
    if (next !== repeat) return setError(pl.changeSecret.mismatch);
    setBusy(true);
    try {
      await api('/api/auth/change-secret', { method: 'POST', body: { current, next } });
      onDone();
    } catch (err) {
      setError(errorText(err instanceof ApiFailure ? err.code : 'generic'));
    } finally {
      setBusy(false);
    }
  }

  const digits = isPin ? { inputMode: 'numeric' as const, maxLength: 6 } : { maxLength: 200 };
  return (
    <main style={screen}>
      <Brand />
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }} noValidate>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 600 }}>
          {isPin ? pl.changeSecret.titlePin : pl.changeSecret.titlePassword}
        </h1>
        {!onCancel && (
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: 'var(--text-soft)' }}>
            {isPin ? pl.changeSecret.introPin : pl.changeSecret.introPassword}
          </p>
        )}
        <Field id="current" label={isPin ? pl.changeSecret.currentPin : pl.changeSecret.currentPassword} value={current} onChange={setCurrent} type="password" autoComplete="current-password" {...digits} />
        <Field id="next" label={isPin ? pl.changeSecret.newPin : pl.changeSecret.newPassword} hint={isPin ? pl.changeSecret.pinRules : undefined} value={next} onChange={setNext} type="password" autoComplete="new-password" {...digits} />
        <Field id="repeat" label={pl.changeSecret.repeat} value={repeat} onChange={setRepeat} type="password" autoComplete="new-password" {...digits} />
        <ErrorBox message={error} />
        <PrimaryButton disabled={busy || !current || !next || !repeat}>{pl.changeSecret.submit}</PrimaryButton>
        {onCancel && <SecondaryButton onClick={onCancel}>{pl.common.cancel}</SecondaryButton>}
      </form>
    </main>
  );
}
