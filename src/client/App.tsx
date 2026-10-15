import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { api, ApiFailure, type Me } from './api';
import { errorText, pl } from './i18n/pl';
import { Redirect, usePath } from './router';
import { ChangeSecret } from './screens/ChangeSecret';
import { Login } from './screens/Login';
import { Brand, ErrorBox, LogoLoader, SecondaryButton, screen } from './ui';
import { clearPersonalCache } from './pwa';

// The panel (editor, admin screens) is loaded only for managers and the owner.
const Panel = lazy(() => import('./admin/Panel').then((m) => ({ default: m.Panel })));
const Academy = lazy(() => import('./app/Academy').then((m) => ({ default: m.Academy })));

type State = { kind: 'loading' } | { kind: 'anonymous' } | { kind: 'error'; message: string } | { kind: 'signed-in'; me: Me };

function Loading() {
  return (
    <main style={{ ...screen, justifyContent: 'center', alignItems: 'center' }} aria-busy="true">
      <LogoLoader full label={pl.app.loading} />
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
  if (state.kind === 'anonymous')
    return (
      <Login
        onLoggedIn={async () => {
          await clearPersonalCache(); // another person may have used this phone
          void refresh();
        }}
      />
    );
  const me = state.me;
  if (me.user.mustChangeSecret) return <ChangeSecret me={me} onDone={() => void refresh()} />;

  const loggedOut = () => {
    void clearPersonalCache();
    setState({ kind: 'anonymous' });
  };
  const isStaff = me.user.role === 'owner' || me.user.role === 'manager';
  if (isStaff && (path === '/' || path.startsWith('/panel'))) {
    if (path === '/') return <Redirect to="/panel" />;
    return (
      <Suspense fallback={<Loading />}>
        <Panel me={me} onLoggedOut={loggedOut} refreshMe={refresh} />
      </Suspense>
    );
  }
  if (path.startsWith('/panel')) return <Redirect to="/" />;
  return (
    <Suspense fallback={<Loading />}>
      <Academy me={me} onLoggedOut={loggedOut} refreshMe={refresh} />
    </Suspense>
  );
}
