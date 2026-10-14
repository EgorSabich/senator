import { useCallback, useEffect, useState } from 'react';
import { api, ApiFailure, type Me } from './api';
import { errorText, pl } from './i18n/pl';
import { ChangeSecret } from './screens/ChangeSecret';
import { Login } from './screens/Login';
import { Brand, ErrorBox, SecondaryButton, screen } from './ui';

type State = { kind: 'loading' } | { kind: 'anonymous' } | { kind: 'error'; message: string } | { kind: 'signed-in'; me: Me };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const refresh = useCallback(async () => {
    try {
      setState({ kind: 'signed-in', me: await api<Me>('/api/auth/me') });
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 401) setState({ kind: 'anonymous' });
      else setState({ kind: 'error', message: errorText(err instanceof ApiFailure ? err.code : 'generic') });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state.kind === 'loading') {
    return (
      <main style={{ ...screen, justifyContent: 'center', alignItems: 'center' }} aria-busy="true">
        <Brand size="l" />
        <p style={{ color: 'var(--text-muted)' }}>{pl.app.loading}</p>
      </main>
    );
  }
  if (state.kind === 'error') {
    return (
      <main style={{ ...screen, justifyContent: 'center' }}>
        <Brand size="l" />
        <ErrorBox message={state.message} />
        <SecondaryButton onClick={() => void refresh()}>{pl.common.continue}</SecondaryButton>
      </main>
    );
  }
  if (state.kind === 'anonymous') return <Login onLoggedIn={() => void refresh()} />;
  if (state.me.user.mustChangeSecret) return <ChangeSecret me={state.me} onDone={() => void refresh()} />;
  return <Home me={state.me} onLoggedOut={() => setState({ kind: 'anonymous' })} />;
}

function Home({ me, onLoggedOut }: { me: Me; onLoggedOut: () => void }) {
  const role = me.user.role === 'owner' ? pl.home.roleOwner : me.user.role === 'manager' ? pl.home.roleManager : pl.home.roleEmployee;
  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    onLoggedOut();
  }
  return (
    <main style={screen}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Brand />
        <SecondaryButton onClick={() => void logout()}>{pl.home.logout}</SecondaryButton>
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 600 }}>{pl.home.hello(me.user.firstName)}</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>
          {role} · {me.locations.map((l) => l.name).join(', ')}
        </p>
      </div>
      <p style={{ margin: 0, color: 'var(--text-soft)', fontSize: 15, lineHeight: 1.6 }}>{pl.home.stageNote}</p>
    </main>
  );
}
