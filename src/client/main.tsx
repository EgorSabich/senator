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
const isTyping = (el: Element | null) =>
  !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|file|range)$/.test((el as HTMLInputElement).type)) || (el as HTMLElement).isContentEditable);
const root2 = document.documentElement;
const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
let frame = 0;
let fullHeight = window.innerHeight;
function syncKeyboard() {
  frame = 0;
  const vv = window.visualViewport;
  if (!vv) return;
  const hidden = window.innerHeight - vv.height; // part of the screen covered (keyboard)
  const typing = isTypingNow();
  const open = hidden > 120 && typing;
  root2.classList.toggle('kb-open', open);
  if (!open && !typing) fullHeight = Math.max(fullHeight, window.innerHeight);
  // the real bottom of the screen: in the installed app (status bar over the page) it is the screen height;
  // after the keyboard iOS sometimes leaves the page shorter — the bars are moved down to the real bottom then
  const realBottom = standalone && window.matchMedia('(orientation: portrait)').matches ? Math.max(window.screen.height, fullHeight) : fullHeight;
  const visibleBottom = vv.offsetTop + vv.height;
  let shift = open ? 0 : Math.round(visibleBottom - window.innerHeight);
  if (!open && !typing && window.innerHeight < realBottom - 2 && visibleBottom >= window.innerHeight - 2) shift = Math.round(realBottom - window.innerHeight);
  root2.style.setProperty('--vv-shift', `${Math.abs(shift) > 1 ? shift : 0}px`);
  if (diag) diag.textContent = `ih ${window.innerHeight} · vv ${Math.round(vv.height)}+${Math.round(vv.offsetTop)} · scr ${window.screen.height} · full ${fullHeight} · y ${Math.round(window.scrollY)} · ${standalone ? 'app' : 'web'} · kb ${open ? 1 : 0} · shift ${shift}`;
}
function isTypingNow() {
  return isTyping(document.activeElement);
}
const queue = () => {
  if (!frame) frame = requestAnimationFrame(syncKeyboard);
};
window.visualViewport?.addEventListener('resize', queue);
window.visualViewport?.addEventListener('scroll', queue);
window.addEventListener('resize', queue);
window.addEventListener('orientationchange', () => {
  fullHeight = 0;
  queue();
});
document.addEventListener('focusout', () => {
  // the keyboard slides down after the field is left: check again when it is gone
  for (const ms of [60, 200, 450, 900]) window.setTimeout(queue, ms);
  // iOS: a tiny scroll makes Safari recompute the page height after the keyboard
  window.setTimeout(() => {
    if (isTypingNow()) return;
    window.scrollTo(window.scrollX, window.scrollY + 1);
    window.scrollTo(window.scrollX, window.scrollY - 1);
  }, 120);
});
document.addEventListener('focusin', () => window.setTimeout(queue, 350));

/* Screen diagnostics for the iPhone keyboard (open the app once with ?diag=1, off with ?diag=0): a thin line at the top. */
let diag: HTMLElement | null = null;
try {
  const q = new URLSearchParams(location.search).get('diag');
  if (q === '1') localStorage.setItem('sa.diag', '1');
  if (q === '0') localStorage.removeItem('sa.diag');
  if (localStorage.getItem('sa.diag') === '1') {
    diag = document.createElement('div');
    diag.style.cssText = 'position:fixed;left:0;right:0;top:env(safe-area-inset-top);z-index:9999;font:11px/1.4 monospace;color:#fff;background:rgba(0,0,0,.75);padding:2px 6px;pointer-events:none';
    document.body.appendChild(diag);
  }
} catch {
  /* no storage */
}
queue();
