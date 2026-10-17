import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/motion.css';
import { App } from './App';
import { registerServiceWorker } from './pwa';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
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
