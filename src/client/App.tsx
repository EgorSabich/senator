import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { api, ApiFailure, cached, type Me } from './api';
import { errorText, pl } from './i18n/pl';
import { Redirect, usePath } from './router';
import { ChangeSecret } from './screens/ChangeSecret';
import { SetPin } from './screens/SetPin';
import { maybeShowInstallGuide } from './app/Install';
import { Login } from './screens/Login';
import { Brand, ErrorBox, LogoLoader, SecondaryButton, screen } from './ui';
import { clearPersonalCache } from './pwa';
import { updateApp } from './live';

/**
 * The app page opens from the phone (sw.js). After a new version is published, a part not loaded yet may be
 * gone from the server: then the new version is fetched and the app reloads once.
 */
function lazyPart<T>(load: () => Promise<T>): Promise<T> {
  return load().then((m) => {
    try {
      sessionStorage.removeItem('sa.chunk-reload');
    } catch {
      /* no storage */
    }
    return m;
  }, async (e) => {
    const key = 'sa.chunk-reload';
    let again = false;
    try {
      again = sessionStorage.getItem(key) === '1';
      sessionStorage.setItem(key, '1');
    } catch {
      /* no storage */
    }
    if (!again) await updateApp();
    throw e;
  });
}
// The panel (editor, admin screens) is loaded only for managers and the owner.
const Panel = lazy(() => lazyPart(() => import('./admin/Panel')).then((m) => ({ default: m.Panel })));
const Academy = lazy(() => lazyPart(() => import('./app/Academy')).then((m) => ({ default: m.Academy })));
const Terminal = lazy(() => lazyPart(() => import('./terminal/Terminal')).then((m) => ({ default: m.Terminal })));

/** Set on a phone in time-clock mode: it opens the terminal even when the network is down at start. */
function isTerminalPhone(): boolean {
  try {
    return localStorage.getItem('sa.terminal') === '1';
  } catch {
    return false;
  }
}

type State = { kind: 'loading' } | { kind: 'anonymous' } | { kind: 'error'; message: string } | { kind: 'signed-in'; me: Me } | { kind: 'terminal-offline' };

function Loading() {
  return (
    <main style={{ ...screen, justifyContent: 'center', alignItems: 'center' }} aria-busy="true">
      <LogoLoader full label={pl.app.loading} />
    </main>
  );
}

export function App() {
  // signed in on this phone before: open at once with the saved account, it is checked again right away
  const [state, setState] = useState<State>(() => {
    const me = cached<Me>('/api/auth/me');
    return me && !me.user.mustChangeSecret ? { kind: 'signed-in', me } : { kind: 'loading' };
  });
  const path = usePath();

  const refresh = useCallback(async () => {
    try {
      const me = await api<Me>('/api/auth/me');
      // same account as the one already on screen: nothing to redraw
      setState((s) => (s.kind === 'signed-in' && JSON.stringify(s.me) === JSON.stringify(me) ? s : { kind: 'signed-in', me }));
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 401) {
        void clearPersonalCache();
        setState({ kind: 'anonymous' });
      } else if (err instanceof ApiFailure && err.status === 0 && isTerminalPhone()) setState({ kind: 'terminal-offline' });
      // offline with a saved account: keep showing the app
      else if (err instanceof ApiFailure && err.status === 0 && cached<Me>('/api/auth/me')) return;
      else setState({ kind: 'error', message: errorText(err instanceof ApiFailure ? err.code : 'generic') });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state.kind === 'loading') return <Loading />;
  if (state.kind === 'terminal-offline' || (state.kind === 'signed-in' && state.me.user.role === 'terminal')) {
    return (
      <Suspense fallback={<Loading />}>
        <Terminal onSignedOut={() => setState({ kind: 'anonymous' })} />
      </Suspense>
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
  if (me.user.mustChangeSecret)
    return (
      <ChangeSecret
        me={me}
        onDone={() => {
          // first PIN of an employee: show how to add the app to the home screen (owner, 2026-10-17)
          if (me.user.role === 'employee') maybeShowInstallGuide();
          void refresh();
        }}
      />
    );

  if (me.user.needsPin) return <SetPin onDone={() => void refresh()} />;

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
