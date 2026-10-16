import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/**
 * Minimal History-API router: enough for the panel and the staff app.
 * - "Back" restores the scroll position of the page you came back to (positions kept per history entry);
 * - page changes use the View Transitions API where the browser has it (soft cross-fade), otherwise instant.
 */
const listeners = new Set<() => void>();
const scrolls = new Map<string, number>();
let entryKey = (history.state as { k?: string } | null)?.k ?? newKey();
let pendingRestore: number | null = null;

function newKey() {
  return Math.random().toString(36).slice(2, 10);
}

if (typeof history !== 'undefined') {
  try {
    history.scrollRestoration = 'manual';
  } catch {
    /* older browsers */
  }
  if (!(history.state as { k?: string } | null)?.k) history.replaceState({ k: entryKey }, '');
}

function reducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

/** Tells every listener, inside a view transition when available. */
function notify(direction: 'forward' | 'back') {
  const run = () => listeners.forEach((l) => l());
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !reducedMotion()) {
    document.documentElement.dataset.nav = direction;
    doc.startViewTransition(() => flushSync(run));
  } else run();
}

export function navigate(path: string, replace = false): void {
  if (path === location.pathname + location.search) return;
  scrolls.set(entryKey, window.scrollY);
  if (!replace) entryKey = newKey();
  if (replace) history.replaceState({ k: entryKey }, '', path);
  else history.pushState({ k: entryKey }, '', path);
  pendingRestore = 0;
  notify('forward');
  window.scrollTo(0, 0);
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (e) => {
    scrolls.set(entryKey, window.scrollY);
    entryKey = (e.state as { k?: string } | null)?.k ?? newKey();
    pendingRestore = scrolls.get(entryKey) ?? 0;
    notify('back');
  });
}

/**
 * Called by pages once their content is on screen (data loaded): puts the scroll back where it was
 * when the person left this history entry. Safe to call many times.
 */
export function restoreScroll(): void {
  if (pendingRestore === null) return;
  const y = pendingRestore;
  pendingRestore = null;
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    listeners.add(update);
    // A child may have navigated before this effect subscribed (child effects run first).
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  return path;
}

/** Matches "/panel/pracownicy/:id" against a path; returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.startsWith(':')) params[p[i]!.slice(1)] = decodeURIComponent(s[i]!);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

/** Link that navigates without reloading. */
export function onNav(path: string) {
  return (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(path);
  };
}

/** Back one step inside the app, or to `fallback` when the page was opened directly. */
export function goBack(fallback: string): void {
  // scrolls is filled only by in-app navigation: then "back" stays inside the app.
  if (scrolls.size > 0 && history.length > 1) history.back();
  else navigate(fallback);
}

/** Redirect after render (never navigate during render). */
export function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, true), [to]);
  return null;
}
