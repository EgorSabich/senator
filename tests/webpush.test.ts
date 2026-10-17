// @ts-nocheck — test-side decryption, BufferSource typings only
import { describe, expect, it } from 'vitest';
import { b64urlToBytes, bytesToB64url, encryptPayload, vapidHeader } from '../src/worker/lib/webpush';

const enc = new TextEncoder();
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}
const cat = (...p: Uint8Array[]) => {
  const o = new Uint8Array(p.reduce((a, x) => a + x.length, 0));
  let i = 0;
  for (const x of p) (o.set(x, i), (i += x.length));
  return o;
};

describe('web push (RFC 8291 / 8292)', () => {
  it('a browser can decrypt what we send', async () => {
    // the "browser" side
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const uaPublic = new Uint8Array((await crypto.subtle.exportKey('raw', ua.publicKey)) as ArrayBuffer);
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const msg = JSON.stringify({ title: 'Senator · Grafik', body: 'Nowy grafik — zażółć gęślą jaźń', url: '/grafik' });
    const body = await encryptPayload({ p256dh: bytesToB64url(uaPublic), auth: bytesToB64url(auth) }, enc.encode(msg));

    const salt = body.slice(0, 16);
    const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
    expect(rs).toBe(4096);
    const idlen = body[20]!;
    const asPublic = body.slice(21, 21 + idlen);
    const cipher = body.slice(21 + idlen);
    const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey } as EcdhKeyDeriveParams, ua.privateKey, 256));
    const ikm = await hkdf(auth, shared, cat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
    const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
    expect(plain[plain.length - 1]).toBe(2);
    expect(new TextDecoder().decode(plain.slice(0, -1))).toBe(msg);
  });

  it('the VAPID token is signed with our key and names the push service', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const pub = bytesToB64url((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
    const d = ((await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey).d!;
    const h = await vapidHeader('https://web.push.apple.com/QAbc', { publicKey: pub, privateKey: d, subject: 'mailto:test@senator.pl' }, 1_760_000_000_000);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
    expect(m[4]).toBe(pub);
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(m[2]!)));
    expect(claims).toMatchObject({ aud: 'https://web.push.apple.com', sub: 'mailto:test@senator.pl', exp: 1_760_000_000 + 12 * 3600 });
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, b64urlToBytes(m[3]!), enc.encode(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
  });
});
