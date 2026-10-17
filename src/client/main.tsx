import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/motion.css';
import { App } from './App';
import { registerServiceWorker } from './pwa';
import { hydrateCache } from './apiCache';

const root = document.getElementById('root');
// the answers saved on the phone first (a few ms): the app opens with them instead of a loader
void hydrateCache().then(() => {
  if (root)
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
});

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
 * iPhone keyboard (2026-10-17, second fix). Whether the keyboard is open is read from the visible area itself
 * (visualViewport), not from the focused field: „Gotowe” on the keyboard closes it without leaving the field.
 * - keyboard open → the bottom bars hide (they would ride on top of the keyboard);
 * - keyboard closed → if Safari left the page shifted, the bars are moved to the real bottom of the screen
 *   (--vv-shift), so they never stay hanging in the middle.
 */
const root2 = document.documentElement;
let frame = 0;
function syncKeyboard() {
  frame = 0;
  const vv = window.visualViewport;
  if (!vv) return;
  const hidden = window.innerHeight - vv.height; // part of the screen covered (keyboard)
  const open = hidden > 120;
  root2.classList.toggle('kb-open', open);
  // bottom of what is visible vs bottom of the layout the bars are pinned to
  const shift = open ? 0 : Math.round(vv.offsetTop + vv.height - window.innerHeight);
  root2.style.setProperty('--vv-shift', `${Math.abs(shift) > 1 ? shift : 0}px`);
}
const queue = () => {
  if (!frame) frame = requestAnimationFrame(syncKeyboard);
};
window.visualViewport?.addEventListener('resize', queue);
window.visualViewport?.addEventListener('scroll', queue);
window.addEventListener('orientationchange', queue);
document.addEventListener('focusout', () => {
  // the keyboard slides down after the field is left: check again when it is gone
  window.setTimeout(queue, 100);
  window.setTimeout(queue, 400);
});
document.addEventListener('focusin', () => window.setTimeout(queue, 350));
queue();
