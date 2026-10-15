/**
 * Hashing for PINs, passwords, session tokens and IPs. WebCrypto only (Workers + Node 20+).
 *
 * Secrets: HMAC-SHA256(AUTH_SECRET, secret) → PBKDF2-SHA256, 100 000 iterations (Workers maximum), per-user salt.
 * The server-side pepper (AUTH_SECRET) means a leaked database alone is not enough to test PINs offline.
 */
import { checkPin } from '../../shared/secret-rules';

const enc = new TextEncoder();
export const PBKDF2_ITERATIONS = 100_000;

function toB64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32): string {
  return toB64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function hmac(secret: string, data: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(data));
}

export async function sha256(data: string): Promise<string> {
  return toB64Url(await crypto.subtle.digest('SHA-256', enc.encode(data)));
}

export async function hashSecret(secret: string, pepper: string, saltB64?: string): Promise<{ hash: string; salt: string }> {
  const salt: Uint8Array<ArrayBuffer> = saltB64 ? fromB64Url(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const peppered = await hmac(pepper, secret);
  const key = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return { hash: toB64Url(bits), salt: toB64Url(salt) };
}

export async function verifySecret(secret: string, pepper: string, hash: string, salt: string): Promise<boolean> {
  const { hash: candidate } = await hashSecret(secret, pepper, salt);
  if (candidate.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

/** IPs are stored only as HMAC, never in clear text. */
export async function hashIp(ip: string, pepper: string): Promise<string> {
  return toB64Url(await hmac(pepper, `ip:${ip}`)).slice(0, 32);
}

/** Temporary 6-digit PIN that passes the PIN rules. */
export function generateTempPin(): string {
  for (;;) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
    const pin = n.toString().padStart(6, '0');
    if (!checkPin(pin)) return pin;
  }
}

/** Temporary password for managers/owner: 12 chars, no look-alike characters. */
export function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Terminal lookup of a PIN (D35): deterministic HMAC with the server pepper, so the time clock finds a person
 * by PIN alone. Without AUTH_SECRET a leaked value cannot be tested; PINs are unique per active person.
 */
export async function pinLookup(pin: string, pepper: string): Promise<string> {
  return toB64Url(await hmac(pepper, `terminal-pin:${pin}`));
}
