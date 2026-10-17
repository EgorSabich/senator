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

/*
 * iPhone keyboard (2026-10-17): while typing, the bottom bars hide (they would ride on top of the keyboard);
 * when the keyboard closes, Safari sometimes leaves fixed bars shifted — a 1px nudge puts them back.
 */
const isTyping = (el: Element | null) =>
  !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|file|range)$/.test((el as HTMLInputElement).type)) || (el as HTMLElement).isContentEditable);
document.addEventListener('focusin', (e) => {
  if (isTyping(e.target as Element)) document.documentElement.classList.add('kb-open');
});
document.addEventListener('focusout', () => {
  window.setTimeout(() => {
    if (isTyping(document.activeElement)) return;
    document.documentElement.classList.remove('kb-open');
    window.scrollBy(0, 1);
    window.scrollBy(0, -1);
  }, 80);
});
window.visualViewport?.addEventListener('resize', () => {
  const vv = window.visualViewport!;
  // keyboard gone (viewport back to full height) — make sure nothing stays shifted
  if (vv.height >= window.innerHeight - 2 && !isTyping(document.activeElement)) {
    document.documentElement.classList.remove('kb-open');
    window.scrollBy(0, 1);
    window.scrollBy(0, -1);
  }
});
