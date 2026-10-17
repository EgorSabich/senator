import { api } from './api';
/**
 * Push on this device (2026-10-17). States: not supported here, iPhone without the app on the home screen,
 * blocked in the browser settings, server without keys, off, on.
 */
export type PushState = 'unsupported' | 'ios-install' | 'denied' | 'no-key' | 'off' | 'on';

const isIos = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function supported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const r = await navigator.serviceWorker.getRegistration('/');
  if (r) return r;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

function keyBytes(b64: string): Uint8Array {
  const pad = b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return isIos() && !standalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const { publicKey } = await api<{ publicKey: string | null }>('/api/push/key');
  if (!publicKey) return 'no-key';
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

export async function enablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  const { publicKey } = await api<{ publicKey: string | null }>('/api/push/key');
  if (!publicKey) return 'no-key';
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // keys changed on the server → a fresh subscription
  const own = sub?.options.applicationServerKey;
  if (sub && own && btoa(String.fromCharCode(...new Uint8Array(own))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== publicKey) {
    await sub.unsubscribe().catch(() => undefined);
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as unknown as BufferSource });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api('/api/push/subscribe', { method: 'POST', body: { endpoint: json.endpoint, keys: json.keys } });
  return 'on';
}

/** Switch off on this device (also on logout, so the next person on a shared phone gets nothing). */
export async function disablePush(): Promise<void> {
  try {
    const reg = await registration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  } catch {
    /* nothing to switch off */
  }
}

export function sendTestPush() {
  return api<{ delivered: number; devices: number }>('/api/push/test', { method: 'POST' });
}
