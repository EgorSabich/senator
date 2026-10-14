import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { api, ApiFailure, type Me } from './api';
import { errorText, pl } from './i18n/pl';
import { Redirect, usePath } from './router';
import { ChangeSecret } from './screens/ChangeSecret';
import { Login } from './screens/Login';
import { Brand, ErrorBox, SecondaryButton, screen } from './ui';

// The panel (editor, admin screens) is loaded only for managers and the owner.
const Panel = lazy(() => import('./admin/Panel').then((m) => ({ default: m.Panel })));

type State = { kind: 'loading' } | { kind: 'anonymous' } | { kind: 'error'; message: string } | { kind: 'signed-in'; me: Me };

function Loading() {
  return (
    <main style={{ ...screen, justifyContent: 'center', alignItems: 'center' }} aria-busy="true">
      <Brand size="l" />
      <p style={{ color: 'var(--text-muted)' }}>{pl.app.loading}</p>
    </main>
  );
}

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const path = usePath();

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

  if (state.kind === 'loading') return <Loading />;
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
  const me = state.me;
  if (me.user.mustChangeSecret) return <ChangeSecret me={me} onDone={() => void refresh()} />;

  const isStaff = me.user.role === 'owner' || me.user.role === 'manager';
  if (isStaff) {
    if (!path.startsWith('/panel')) return <Redirect to="/panel" />;
    return (
      <Suspense fallback={<Loading />}>
        <Panel me={me} onLoggedOut={() => setState({ kind: 'anonymous' })} refreshMe={refresh} />
      </Suspense>
    );
  }
  if (path.startsWith('/panel')) return <Redirect to="/" />;
  return <Home me={me} onLoggedOut={() => setState({ kind: 'anonymous' })} />;
}

function Home({ me, onLoggedOut }: { me: Me; onLoggedOut: () => void }) {
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
          {pl.home.roleEmployee} · {me.locations.map((l) => l.name).join(', ')}
        </p>
      </div>
      <p style={{ margin: 0, color: 'var(--text-soft)', fontSize: 15, lineHeight: 1.6 }}>{pl.home.stageNote}</p>
    </main>
  );
}
