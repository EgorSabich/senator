import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/motion.css';
import { App } from './App';
import { registerServiceWorker } from './pwa';
import { reloadNow, watchForUpdates } from './update';

/** "Nowa wersja" bar: shown when the server already runs a newer version than this screen. */
function UpdateBar() {
  const [ready, setReady] = useState(false);
  useEffect(() => watchForUpdates(() => setReady(true)), []);
  let terminal = false;
  try {
    terminal = localStorage.getItem('sa.terminal') === '1';
  } catch {
    /* none */
  }
  if (!ready || terminal) return null;
  return (
    <button type="button" className="update-bar" onClick={reloadNow}>
      Nowa wersja — dotknij, aby odświeżyć
    </button>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
      <UpdateBar />
    </StrictMode>,
  );
}

registerServiceWorker();

/*
 * Feels like an app, not a web page: no pinch or double-tap zoom (iOS ignores user-scalable=no, so the gestures
 * are stopped here too). Text stays readable — font sizes are chosen for phones.
 */
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
// Double-tap zoom is switched off in CSS (touch-action: manipulation), which keeps fast taps working (PIN pad).
