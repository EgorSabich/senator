/**
 * „Live” (owner, 2026-10-17, stage 1): the app reacts to changes almost at once, without a reload.
 * - every 30 s while the app is on screen it asks /changes; a changed area → the screen refreshes itself;
 * - back to the app (from background) or internet back → refresh at once;
 * - a push arrived (service worker message) → refresh;
 * - the server runs a newer version → „Jest nowa wersja” banner.
 * Screens subscribe with useLiveRefresh(load). While someone is typing in a field, the refresh waits.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { api } from './api';

type Listener = () => void;
const listeners = new Set<Listener>();
const state = { online: typeof navigator === 'undefined' ? true : navigator.onLine, newVersion: false };
const stateListeners = new Set<Listener>();
let snapshot = { ...state };
const setState = (p: Partial<typeof state>) => {
  Object.assign(state, p);
  snapshot = { ...state };
  stateListeners.forEach((l) => l());
};

let locationId: string | null = null;
let last: Record<string, string> | null = null;
let timer: number | null = null;
let hiddenAt = 0;
let pending = false;
let started = false;

const typing = () => {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
  return tag === 'INPUT' && !/^(checkbox|radio|button|submit|file|range)$/.test((el as HTMLInputElement).type);
};

/** Tell every subscribed screen to load again (later, if someone is typing). */
export function refreshNow(): void {
  if (typing()) {
    pending = true;
    return;
  }
  pending = false;
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* a screen's own problem */
    }
  });
}

async function check() {
  if (!locationId || document.visibilityState !== 'visible' || !navigator.onLine) return;
  try {
    const r = await api<{ version: string; areas: Record<string, string> }>(`/api/locations/${locationId}/changes`);
    if (r.version && r.version !== __APP_VERSION__) setState({ newVersion: true });
    const changed = last !== null && Object.keys(r.areas).some((k) => r.areas[k] !== last![k]);
    last = r.areas;
    if (changed || pending) refreshNow();
  } catch {
    /* offline or signed out — try again later */
  }
}

function schedule() {
  if (timer !== null) window.clearInterval(timer);
  timer = window.setInterval(() => void check(), 30_000);
}

/** Start watching a location (staff app and panel call it with the current location). */
export function startLive(locId: string): void {
  if (locationId !== locId) {
    locationId = locId;
    last = null;
  }
  void check();
  if (started) return;
  started = true;
  schedule();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 15_000) {
      refreshNow();
      void check();
    }
  });
  window.addEventListener('online', () => {
    setState({ online: true });
    refreshNow();
    void check();
  });
  window.addEventListener('offline', () => setState({ online: false }));
  // a waiting refresh runs once the person leaves the field
  document.addEventListener('focusout', () => window.setTimeout(() => pending && !typing() && refreshNow(), 300));
  navigator.serviceWorker?.addEventListener('message', (e: MessageEvent) => {
    if ((e.data as { type?: string } | null)?.type === 'refresh') refreshNow();
  });
}

/** A screen reloads its data when something changed. */
export function useLiveRefresh(load: () => unknown): void {
  const ref = useRef(load);
  ref.current = load;
  useEffect(() => {
    const l = () => void ref.current();
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
}

export function useLiveState() {
  return useSyncExternalStore(
    (l) => {
      stateListeners.add(l);
      return () => stateListeners.delete(l);
    },
    () => snapshot,
  );
}

/** „Jest nowa wersja” → fetch the new app and reload. */
export async function updateApp(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/');
    await reg?.update();
  } catch {
    /* reload anyway */
  }
  window.location.reload();
}
