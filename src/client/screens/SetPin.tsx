import { useState, type FormEvent } from 'react';
import { checkSecret } from '../../shared/secret-rules';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { Brand, ErrorBox, Field, PrimaryButton, screen } from '../ui';

/** A leader paid by the hour (Dostępy, 2026-10-17): the 6-digit PIN for the time clock. His password stays for the panel. */
export function SetPin({ onDone }: { onDone: () => void }) {
  const t = pl.setPin;
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = checkSecret('pin', pin);
    if (problem) return setError(errorText(problem));
    if (pin !== repeat) return setError(pl.changeSecret.mismatch);
    setBusy(true);
    try {
      await api('/api/auth/set-pin', { method: 'POST', body: { pin } });
      onDone();
    } catch (err) {
      setError(errorText(err instanceof ApiFailure ? err.code : 'generic'));
      setBusy(false);
    }
  }
  const digits = { inputMode: 'numeric' as const, maxLength: 6 };
  return (
    <main style={screen}>
      <Brand />
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }} noValidate>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 600 }}>{t.title}</h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: 'var(--text-soft)' }}>{t.intro}</p>
        <Field id="pin" label={pl.changeSecret.newPin} hint={pl.changeSecret.pinRules} value={pin} onChange={setPin} type="password" autoComplete="new-password" {...digits} />
        <Field id="pin2" label={pl.changeSecret.repeat} value={repeat} onChange={setRepeat} type="password" autoComplete="new-password" {...digits} />
        <ErrorBox message={error} />
        <PrimaryButton disabled={busy || !pin || !repeat}>{pl.changeSecret.submit}</PrimaryButton>
      </form>
    </main>
  );
}
