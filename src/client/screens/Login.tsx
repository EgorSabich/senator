import { useState, type FormEvent } from 'react';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { Brand, ErrorBox, Field, PrimaryButton, screen } from '../ui';

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [login, setLogin] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/login', { method: 'POST', body: { login, secret } });
      setSecret('');
      onLoggedIn();
    } catch (err) {
      setError(errorText(err instanceof ApiFailure ? err.code : 'generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ ...screen, justifyContent: 'center' }}>
      <Brand size="l" />
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }} noValidate>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 600 }}>{pl.login.title}</h1>
        <Field id="login" label={pl.login.loginLabel} hint={pl.login.loginHint} value={login} onChange={setLogin} autoComplete="username" maxLength={80} />
        <Field id="secret" label={pl.login.passwordLabel} value={secret} onChange={setSecret} type="password" autoComplete="current-password" maxLength={200} />
        <ErrorBox message={error} />
        <PrimaryButton disabled={busy || !login.trim() || !secret}>{busy ? pl.login.submitting : pl.login.submit}</PrimaryButton>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>{pl.login.forgot}</p>
      </form>
    </main>
  );
}
