/** Shrinks a photo in the browser before upload (spec: resize client-side, max 1600 px, WebP). */
export async function resizeImage(file: File, maxSide = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const webp = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.82));
  if (webp && webp.type === 'image/webp') return webp;
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.85));
}

export async function uploadFile(path: string, blob: Blob, name: string): Promise<any> {
  const form = new FormData();
  form.append('file', blob, name);
  const res = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'generic'), { code: data.error ?? 'generic' });
  return data;
}
