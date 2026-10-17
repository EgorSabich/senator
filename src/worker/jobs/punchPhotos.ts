/** Punch photos (D40): small JPEGs in the private PHOTOS bucket, deleted after PUNCH_PHOTO_DAYS. */
export const PUNCH_PHOTO_DAYS = 60;
export const PUNCH_PHOTO_MAX_BYTES = 80_000;

/** Checklist photos (2026-10-17): a bit larger than punch photos, kept 30 days. */
export const CHECKLIST_PHOTO_DAYS = 30;
export const CHECKLIST_PHOTO_MAX_BYTES = 220_000;

/** Decodes a "data:image/jpeg;base64,..." string; null when it is not a small JPEG. */
export function decodePunchPhoto(v: unknown): Uint8Array | null {
  return decodeJpeg(v, PUNCH_PHOTO_MAX_BYTES);
}

export function decodeJpeg(v: unknown, maxBytes: number): Uint8Array | null {
  if (typeof v !== 'string' || !v.startsWith('data:image/jpeg;base64,')) return null;
  const b64 = v.slice('data:image/jpeg;base64,'.length);
  if (b64.length > Math.ceil((maxBytes * 4) / 3) + 4) return null;
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  // JPEG magic bytes
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  return bytes;
}

/** Deletes R2 objects in chunks (R2 delete takes up to 1000 keys). */
export async function deleteKeys(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
}

/** Nightly: photos older than 60 days leave R2 and the punch log. */
export async function expirePunchPhotos(db: D1Database, bucket: R2Bucket, now: Date): Promise<number> {
  const cutoff = now.getTime() - PUNCH_PHOTO_DAYS * 86400_000;
  let total = 0;
  for (let round = 0; round < 20; round++) {
    const { results } = await db
      .prepare(`SELECT id, photo_key AS photoKey FROM time_punches WHERE photo_key IS NOT NULL AND at < ? LIMIT 500`)
      .bind(cutoff)
      .all<{ id: string; photoKey: string }>();
    if (!results.length) break;
    await deleteKeys(
      bucket,
      results.map((r) => r.photoKey),
    );
    await db.batch(results.map((r) => db.prepare(`UPDATE time_punches SET photo_key = NULL WHERE id = ?`).bind(r.id)));
    total += results.length;
  }
  return total;
}

/** Nightly: checklist photos older than 30 days leave R2; the tick itself stays. */
export async function expireChecklistPhotos(db: D1Database, bucket: R2Bucket, now: Date): Promise<number> {
  const cutoff = now.getTime() - CHECKLIST_PHOTO_DAYS * 86400_000;
  let total = 0;
  for (let round = 0; round < 20; round++) {
    const { results } = await db
      .prepare(`SELECT id, photo_key AS photoKey FROM checklist_marks WHERE photo_key IS NOT NULL AND marked_at < ? LIMIT 500`)
      .bind(cutoff)
      .all<{ id: string; photoKey: string }>();
    if (!results.length) break;
    await deleteKeys(
      bucket,
      results.map((r) => r.photoKey),
    );
    await db.batch(results.map((r) => db.prepare(`UPDATE checklist_marks SET photo_key = NULL WHERE id = ?`).bind(r.id)));
    total += results.length;
  }
  return total;
}
