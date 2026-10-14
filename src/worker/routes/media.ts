/**
 * Photos and document files in the private PHOTOS bucket.
 * Upload: /api/admin/... (content.edit / menu.edit). Download: /media/<key>, only for signed-in users
 * who can access the key's location (shared files: any signed-in user).
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { ApiError, badRequest, newId } from '../lib/http';
import { requireSession } from '../auth/session';
import { loadAccess, requireOwner, type Access } from '../auth/access';

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const FILE_MAX_BYTES = 15 * 1024 * 1024;

const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  'image/webp': {
    ext: 'webp',
    magic: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
};
const DOC_TYPES: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  'application/pdf': { ext: 'pdf', magic: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    ext: 'docx',
    magic: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,
  },
};

export interface StoredFile {
  key: string;
  src: string;
  contentType: string;
  size: number;
  name: string;
}

/** Validates type by declared MIME *and* magic bytes, stores in R2, records in `media`. */
export async function storeUpload(
  env: AppEnv['Bindings'],
  file: File,
  opts: { kind: 'img' | 'files'; locationId: string | null; userId: string },
): Promise<StoredFile> {
  const table = opts.kind === 'img' ? IMAGE_TYPES : DOC_TYPES;
  const limit = opts.kind === 'img' ? IMAGE_MAX_BYTES : FILE_MAX_BYTES;
  const type = table[file.type];
  if (!type) throw badRequest(opts.kind === 'img' ? 'image_type' : 'file_type');
  if (file.size === 0 || file.size > limit) throw badRequest('file_size');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!type.magic(bytes)) throw badRequest(opts.kind === 'img' ? 'image_type' : 'file_type');

  const id = newId('m');
  const key = `${opts.locationId ? `loc/${opts.locationId}` : 'shared'}/${opts.kind}/${id}.${type.ext}`;
  const name = (file.name || `plik.${type.ext}`).slice(0, 150);
  await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: file.type } });
  await env.DB.prepare(
    `INSERT INTO media (id, location_id, key, content_type, size, original_name, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, opts.locationId, key, file.type, bytes.byteLength, name, opts.userId)
    .run();
  return { key, src: `/media/${key}`, contentType: file.type, size: bytes.byteLength, name };
}

export async function requireUploadRight(access: Access, locationId: string | null): Promise<void> {
  if (locationId === null) return requireOwner(access);
  const perms = access.locations.get(locationId);
  if (!perms) throw new ApiError(404, 'not_found');
  if (!perms.has('content.edit') && !perms.has('menu.edit')) throw new ApiError(403, 'forbidden');
}

/* ───────── Upload (under /api/admin) ───────── */

export const mediaAdminRoutes = new Hono<AppEnv>();
// Session is enforced by the /api/admin router (index.ts).

mediaAdminRoutes.post('/locations/:locId/media', async (c) => {
  const locId = c.req.param('locId');
  const shared = c.req.query('shared') === '1';
  const access = await loadAccess(c.env.DB, c.var.user);
  if (shared) requireOwner(access);
  else if (!access.locations.has(locId)) throw new ApiError(404, 'not_found');
  await requireUploadRight(access, shared ? null : locId);
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) throw badRequest('file_required');
  const stored = await storeUpload(c.env, file, { kind: 'img', locationId: shared ? null : locId, userId: c.var.user.id });
  await auditStatement(c.env.DB, {
    actorId: c.var.user.id,
    locationId: shared ? null : locId,
    action: 'media.upload',
    entityType: 'media',
    entityId: stored.key,
    after: { name: stored.name, size: stored.size },
  }).run();
  return c.json({ src: stored.src, size: stored.size }, 201);
});

/* ───────── Download (/media/*) ───────── */

export const mediaPublicRoutes = new Hono<AppEnv>();
mediaPublicRoutes.use('*', requireSession);

mediaPublicRoutes.get('/*', async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/media\//, ''));
  if (!/^(loc\/[A-Za-z0-9_]+|shared)\/(img|files)\/[A-Za-z0-9_]+\.(jpg|png|webp|pdf|docx)$/.test(key)) {
    throw new ApiError(404, 'not_found');
  }
  if (key.startsWith('loc/')) {
    const access = await loadAccess(c.env.DB, c.var.user);
    const locId = key.split('/')[1]!;
    if (!access.locations.has(locId)) throw new ApiError(404, 'not_found');
  }
  const obj = await c.env.PHOTOS.get(key);
  if (!obj) throw new ApiError(404, 'not_found');
  const row = await c.env.DB.prepare(`SELECT original_name AS name FROM media WHERE key = ?`).bind(key).first<{ name: string | null }>();
  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType ?? 'application/octet-stream');
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  if (key.endsWith('.docx') || key.endsWith('.pdf')) {
    const name = (row?.name ?? key.split('/').pop()!).replace(/[^\p{L}\p{N}._ -]/gu, '_');
    headers.set('Content-Disposition', `${key.endsWith('.pdf') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`);
  }
  return new Response(obj.body, { headers });
});

