/**
 * Rekrutacja (owner, 2026-10-17; mockups 7–9).
 * - Candidates of a location; leaders see and edit those whose position is in their divisions, the owner and
 *   zarządzający (no division limit) see everyone. Permission `recruitment.manage`.
 * - CV (PDF or image, up to 10 MB) in the private bucket, served only through this API; deleted on hire.
 * - „Utwórz konto” makes the employee account (needs `employees.manage` too).
 * - A personal ICS link for Google Calendar; only its hash is stored, a new link revokes the old one.
 * - RODO: the nightly job deletes candidates 6 months after the last change (jobs/candidates.ts).
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { POSITIONS, divisionOf } from '../../shared/constants';
import { CV_MAX_BYTES, deleteAtOf, INTERVIEW_MINUTES, isEmail, normalizePhone, STAGES, TRIAL_MINUTES, type Stage } from '../../shared/recruitment';
import { isIsoDate, warsawToMs } from '../../shared/time';
import { allowedDivisions, loadAccess, requirePermission, type Access } from '../auth/access';
import { randomToken, sha256 } from '../auth/crypto';
import { auditStatement } from '../lib/audit';
import { newEmployee } from '../lib/employees';
import { ApiError, badRequest, newId, notFound, readJson, str } from '../lib/http';

export const recruitmentAdminRoutes = new Hono<AppEnv>();
export const calendarFeedRoutes = new Hono<AppEnv>();

interface Row {
  id: string;
  locationId: string;
  name: string;
  phone: string | null;
  email: string | null;
  position: string;
  stage: Stage;
  interviewAt: number | null;
  trialAt: number | null;
  cvKey: string | null;
  cvName: string | null;
  cvType: string | null;
  hiredUserId: string | null;
  createdAt: number;
  updatedAt: number;
}
const SELECT = `SELECT c.id, c.location_id AS locationId, c.name, c.phone, c.email, c.position, c.stage, c.interview_at AS interviewAt, c.trial_at AS trialAt,
  c.cv_key AS cvKey, c.cv_name AS cvName, c.cv_type AS cvType, c.hired_user_id AS hiredUserId, c.created_at AS createdAt, c.updated_at AS updatedAt
  FROM candidates c`;

const CV_TYPES: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  'application/pdf': { ext: 'pdf', magic: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  'image/webp': { ext: 'webp', magic: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 },
};

function inScope(access: Access, locId: string, position: string) {
  const scope = allowedDivisions(access, locId);
  return !scope || scope.has(position);
}

function view(r: Row, comments = 0) {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    position: r.position,
    division: divisionOf(r.position),
    stage: r.stage,
    interviewAt: r.interviewAt,
    trialAt: r.trialAt,
    cv: r.cvKey ? { name: r.cvName, type: r.cvType } : null,
    hiredUserId: r.hiredUserId,
    comments,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deleteAt: deleteAtOf(r.updatedAt),
  };
}

/** One candidate the actor may work with (404 for others, so their existence is not revealed). */
async function load(c: { env: AppEnv['Bindings']; var: AppEnv['Variables'] }, id: string) {
  const access = await loadAccess(c.env.DB, c.var.user);
  const r = await c.env.DB.prepare(`${SELECT} WHERE c.id = ?`).bind(id).first<Row>();
  if (!r) throw notFound();
  requirePermission(access, r.locationId, 'recruitment.manage');
  if (!inScope(access, r.locationId, r.position)) throw notFound();
  return { access, row: r };
}

/** "2026-10-23T14:00" (Warsaw) → ms; null/'' clears; undefined = not sent. */
function when(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string') throw badRequest('date_invalid');
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(v);
  if (!m || !isIsoDate(m[1]) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(m[2]!)) throw badRequest('date_invalid');
  return warsawToMs(m[1]!, m[2]!);
}

interface Fields {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  position?: unknown;
  stage?: unknown;
  interviewAt?: unknown;
  trialAt?: unknown;
}

function parse(body: Fields, partial: boolean) {
  const out: Partial<Pick<Row, 'name' | 'phone' | 'email' | 'position' | 'stage' | 'interviewAt' | 'trialAt'>> = {};
  if (body.name !== undefined || !partial) {
    const name = str(body.name, 120);
    if (!name) throw badRequest('name_required');
    out.name = name;
  }
  if (body.phone !== undefined) {
    if (body.phone === null || body.phone === '') out.phone = null;
    else {
      const p = typeof body.phone === 'string' ? normalizePhone(body.phone) : null;
      if (!p) throw badRequest('phone_invalid');
      out.phone = p;
    }
  }
  if (body.email !== undefined) {
    if (body.email === null || body.email === '') out.email = null;
    else {
      const e = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!isEmail(e)) throw badRequest('email_invalid');
      out.email = e;
    }
  }
  if (body.position !== undefined || !partial) {
    if (typeof body.position !== 'string' || !(POSITIONS as readonly string[]).includes(body.position)) throw badRequest('position_invalid');
    out.position = body.position;
  }
  if (body.stage !== undefined) {
    if (typeof body.stage !== 'string' || !(STAGES as readonly string[]).includes(body.stage)) throw badRequest('stage_invalid');
    out.stage = body.stage as Stage;
  }
  const i = when(body.interviewAt);
  if (i !== undefined) out.interviewAt = i;
  const t = when(body.trialAt);
  if (t !== undefined) out.trialAt = t;
  return out;
}

/* ───────── List and create ───────── */

recruitmentAdminRoutes.get('/locations/:locId/candidates', async (c) => {
  const locId = c.req.param('locId');
  const access = await loadAccess(c.env.DB, c.var.user);
  requirePermission(access, locId, 'recruitment.manage');
  const { results } = await c.env.DB.prepare(
    `${SELECT.replace('FROM candidates c', ', (SELECT COUNT(*) FROM candidate_comments k WHERE k.candidate_id = c.id) AS n FROM candidates c')} WHERE c.location_id = ? ORDER BY c.created_at DESC`,
  )
    .bind(locId)
    .all<Row & { n: number }>();
  const scope = allowedDivisions(access, locId);
  return c.json({
    candidates: results.filter((r) => !scope || scope.has(r.position)).map((r) => view(r, r.n)),
    divisions: scope ? [...new Set([...scope].map(divisionOf))] : null,
    canHire: access.locations.get(locId)?.has('employees.manage') ?? false,
  });
});

recruitmentAdminRoutes.post('/locations/:locId/candidates', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'recruitment.manage');
  const f = parse(await readJson<Fields>(c.req.raw), false);
  if (!inScope(access, locId, f.position!)) throw new ApiError(403, 'outside_divisions');
  const id = newId('cand');
  const now = Date.now();
  const stage = f.stage ?? (f.trialAt ? 'trial' : f.interviewAt ? 'interview' : 'new');
  await db.batch([
    db
      .prepare(
        `INSERT INTO candidates (id, location_id, name, phone, email, position, stage, interview_at, trial_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, locId, f.name, f.phone ?? null, f.email ?? null, f.position, stage, f.interviewAt ?? null, f.trialAt ?? null, c.var.user.id, now, now),
    // no personal data in the log: it outlives the candidate
    auditStatement(db, { actorId: c.var.user.id, locationId: locId, action: 'candidate.create', entityType: 'candidate', entityId: id, after: { position: f.position, stage } }),
  ]);
  const r = await db.prepare(`${SELECT} WHERE c.id = ?`).bind(id).first<Row>();
  return c.json({ candidate: view(r!) }, 201);
});

/* ───────── One candidate ───────── */

recruitmentAdminRoutes.get('/candidates/:id', async (c) => {
  const { row } = await load(c, c.req.param('id'));
  const { results } = await c.env.DB.prepare(
    `SELECT id, author_id AS authorId, author_name AS authorName, body, created_at AS createdAt FROM candidate_comments WHERE candidate_id = ? ORDER BY created_at`,
  )
    .bind(row.id)
    .all();
  return c.json({ candidate: view(row, results.length), comments: results });
});

recruitmentAdminRoutes.put('/candidates/:id', async (c) => {
  const { access, row } = await load(c, c.req.param('id'));
  const db = c.env.DB;
  const f = parse(await readJson<Fields>(c.req.raw), true);
  if (f.position && !inScope(access, row.locationId, f.position)) throw new ApiError(403, 'outside_divisions');
  // a date set for the next step moves the candidate there (unless the stage was chosen in the same save)
  if (!f.stage) {
    if (f.trialAt && !row.trialAt && (row.stage === 'new' || row.stage === 'interview')) f.stage = 'trial';
    else if (f.interviewAt && !row.interviewAt && row.stage === 'new') f.stage = 'interview';
  }
  const cols: Record<string, unknown> = {};
  const map: Record<string, string> = { name: 'name', phone: 'phone', email: 'email', position: 'position', stage: 'stage', interviewAt: 'interview_at', trialAt: 'trial_at' };
  for (const [k, col] of Object.entries(map)) if (k in f) cols[col] = (f as Record<string, unknown>)[k];
  const now = Date.now();
  const sets = Object.keys(cols).map((k) => `${k} = ?`);
  await db.batch([
    db.prepare(`UPDATE candidates SET ${[...sets, 'updated_at = ?'].join(', ')} WHERE id = ?`).bind(...Object.values(cols), now, row.id),
    ...(f.stage && f.stage !== row.stage
      ? [auditStatement(db, { actorId: c.var.user.id, locationId: row.locationId, action: 'candidate.stage', entityType: 'candidate', entityId: row.id, before: { stage: row.stage }, after: { stage: f.stage } })]
      : []),
  ]);
  const r = await db.prepare(`${SELECT} WHERE c.id = ?`).bind(row.id).first<Row>();
  const n = await db.prepare(`SELECT COUNT(*) AS n FROM candidate_comments WHERE candidate_id = ?`).bind(row.id).first<{ n: number }>();
  return c.json({ candidate: view(r!, n?.n ?? 0) });
});

/** „Zachowaj” — counts as a change, so the RODO period starts again. */
recruitmentAdminRoutes.post('/candidates/:id/keep', async (c) => {
  const { row } = await load(c, c.req.param('id'));
  const now = Date.now();
  await c.env.DB.prepare(`UPDATE candidates SET updated_at = ? WHERE id = ?`).bind(now, row.id).run();
  return c.json({ deleteAt: deleteAtOf(now) });
});

recruitmentAdminRoutes.delete('/candidates/:id', async (c) => {
  const { row } = await load(c, c.req.param('id'));
  await removeCandidates(c.env, [row]);
  await auditStatement(c.env.DB, { actorId: c.var.user.id, locationId: row.locationId, action: 'candidate.delete', entityType: 'candidate', entityId: row.id }).run();
  return c.json({ ok: true });
});

/** Deletes candidates with their comments and CV (also used by the nightly RODO job). */
export async function removeCandidates(env: AppEnv['Bindings'], rows: { id: string; cvKey: string | null }[]) {
  if (!rows.length) return;
  const keys = rows.map((r) => r.cvKey).filter((k): k is string => Boolean(k));
  if (keys.length) await env.PHOTOS.delete(keys);
  const db = env.DB;
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    stmts.push(db.prepare(`DELETE FROM candidate_comments WHERE candidate_id = ?`).bind(r.id));
    stmts.push(db.prepare(`DELETE FROM candidates WHERE id = ?`).bind(r.id));
  }
  await db.batch(stmts);
}

/* ───────── Comments ───────── */

recruitmentAdminRoutes.post('/candidates/:id/comments', async (c) => {
  const { row } = await load(c, c.req.param('id'));
  const body = await readJson<{ body?: unknown }>(c.req.raw);
  const text = str(body.body, 2000);
  if (!text) throw badRequest('comment_invalid');
  const u = c.var.user;
  const author = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.login;
  const id = newId('cc');
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO candidate_comments (id, candidate_id, author_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(id, row.id, u.id, author, text, now),
    c.env.DB.prepare(`UPDATE candidates SET updated_at = ? WHERE id = ?`).bind(now, row.id),
  ]);
  return c.json({ comment: { id, authorId: u.id, authorName: author, body: text, createdAt: now } }, 201);
});

recruitmentAdminRoutes.delete('/candidates/:id/comments/:commentId', async (c) => {
  const { access, row } = await load(c, c.req.param('id'));
  const k = await c.env.DB.prepare(`SELECT author_id AS a FROM candidate_comments WHERE id = ? AND candidate_id = ?`).bind(c.req.param('commentId'), row.id).first<{ a: string | null }>();
  if (!k) throw notFound();
  // own comments; the owner may remove any
  if (k.a !== c.var.user.id && access.role !== 'owner') throw new ApiError(403, 'forbidden');
  await c.env.DB.prepare(`DELETE FROM candidate_comments WHERE id = ?`).bind(c.req.param('commentId')).run();
  return c.json({ ok: true });
});

/* ───────── CV ───────── */

/** Body = the file itself; Content-Type = its type; X-File-Name = original name (URI-encoded). */
recruitmentAdminRoutes.put('/candidates/:id/cv', async (c) => {
  const { row } = await load(c, c.req.param('id'));
  const type = (c.req.header('Content-Type') ?? '').split(';')[0]!.trim();
  const t = CV_TYPES[type];
  if (!t) throw badRequest('cv_type');
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > CV_MAX_BYTES) throw badRequest('cv_size');
  if (!t.magic(bytes)) throw badRequest('cv_type');
  let name = `CV.${t.ext}`;
  try {
    name = decodeURIComponent(c.req.header('X-File-Name') ?? '').slice(0, 150) || name;
  } catch {
    /* keep the default */
  }
  const key = `cv/${row.locationId}/${row.id}/${newId('f')}.${t.ext}`;
  await c.env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: type } });
  await c.env.DB.prepare(`UPDATE candidates SET cv_key = ?, cv_name = ?, cv_type = ?, updated_at = ? WHERE id = ?`).bind(key, name, type, Date.now(), row.id).run();
  if (row.cvKey) await c.env.PHOTOS.delete(row.cvKey);
  return c.json({ cv: { name, type } });
});

recruitmentAdminRoutes.get('/candidates/:id/cv', async (c) => {
  const { row } = await load(c, c.req.param('id'));
  if (!row.cvKey) throw notFound();
  const obj = await c.env.PHOTOS.get(row.cvKey);
  if (!obj) throw notFound();
  const download = c.req.query('download') === '1';
  return new Response(obj.body, {
    headers: {
      'Content-Type': row.cvType ?? 'application/octet-stream',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(row.cvName ?? 'CV')}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

recruitmentAdminRoutes.delete('/candidates/:id/cv', async (c) => {
  const { row } = await load(c, c.req.param('id'));
  if (row.cvKey) await c.env.PHOTOS.delete(row.cvKey);
  await c.env.DB.prepare(`UPDATE candidates SET cv_key = NULL, cv_name = NULL, cv_type = NULL, updated_at = ? WHERE id = ?`).bind(Date.now(), row.id).run();
  return c.json({ ok: true });
});

/* ───────── Hire ───────── */

/** „Utwórz konto”: an employee account from the candidate; the CV is deleted (no longer needed). */
recruitmentAdminRoutes.post('/candidates/:id/hire', async (c) => {
  const { access, row } = await load(c, c.req.param('id'));
  requirePermission(access, row.locationId, 'employees.manage');
  if (row.hiredUserId) throw new ApiError(409, 'already_hired');
  const body = await readJson<{ firstName?: unknown; lastName?: unknown; startDate?: unknown }>(c.req.raw);
  const parts = row.name.split(/\s+/);
  const firstName = str(body.firstName, 60) ?? parts[0] ?? '';
  const lastName = str(body.lastName, 80) ?? (parts.slice(1).join(' ') || '');
  if (!firstName || !lastName) throw badRequest('name_required');
  if (body.startDate !== undefined && body.startDate !== null && body.startDate !== '' && !isIsoDate(body.startDate)) throw badRequest('start_date_invalid');
  const db = c.env.DB;
  const made = await newEmployee(db, c.env.AUTH_SECRET, {
    firstName,
    lastName,
    position: row.position,
    locationId: row.locationId,
    startDate: isIsoDate(body.startDate) ? body.startDate : null,
    actorId: c.var.user.id,
    source: 'recruitment',
  });
  await db.batch([
    ...made.statements,
    db.prepare(`UPDATE candidates SET stage = 'hired', hired_user_id = ?, cv_key = NULL, cv_name = NULL, cv_type = NULL, updated_at = ? WHERE id = ?`).bind(made.id, Date.now(), row.id),
  ]);
  if (row.cvKey) await c.env.PHOTOS.delete(row.cvKey);
  return c.json({ id: made.id, login: made.login, tempSecret: made.tempSecret, secretKind: 'pin', name: `${firstName} ${lastName}` }, 201);
});

/* ───────── Calendar subscription ───────── */

recruitmentAdminRoutes.get('/recruitment/feed', async (c) => {
  const r = await c.env.DB.prepare(`SELECT created_at AS createdAt, last_used_at AS lastUsedAt FROM calendar_feeds WHERE user_id = ?`).bind(c.var.user.id).first();
  return c.json({ feed: r ?? null });
});

/** A new personal link (the previous one stops working). The link is shown once. */
recruitmentAdminRoutes.post('/recruitment/feed', async (c) => {
  const access = await loadAccess(c.env.DB, c.var.user);
  if (![...access.locations.values()].some((p) => p.has('recruitment.manage'))) throw new ApiError(403, 'forbidden');
  const token = randomToken(24);
  const hash = await sha256(token);
  await c.env.DB.prepare(
    `INSERT INTO calendar_feeds (id, user_id, token_hash, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at, last_used_at = NULL`,
  )
    .bind(newId('cf'), c.var.user.id, hash, Date.now())
    .run();
  const url = new URL(`/api/calendar/${token}.ics`, c.req.url).href;
  return c.json({ url, webcal: url.replace(/^https?:/, 'webcal:') });
});

recruitmentAdminRoutes.delete('/recruitment/feed', async (c) => {
  await c.env.DB.prepare(`DELETE FROM calendar_feeds WHERE user_id = ?`).bind(c.var.user.id).run();
  return c.json({ ok: true });
});

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsTime = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** RFC 5545: lines longer than 75 octets are folded */
function fold(line: string) {
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > 73) {
      out.push(cur);
      cur = ' ';
    }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}

const POSITION_PL: Record<string, string> = {
  waiter: 'Kelner',
  waiter_assistant: 'Runner',
  host: 'Host',
  shift_manager: 'Menedżer zmiany',
  bartender: 'Barman',
  bartender_assistant: 'Barback',
  kitchen: 'Kuchnia',
  hookah_master: 'Master shishy',
  hookah_assistant: 'Pomocnik mistrza shishy',
  call_center: 'Call center',
};

/**
 * The ICS feed (no session: Google Calendar fetches it). Interviews and trial days from 30 days back,
 * only of candidates the link's owner may see today. Names and positions only — phones and CVs stay in the app.
 */
calendarFeedRoutes.get('/calendar/:file', async (c) => {
  const m = /^([A-Za-z0-9_-]{20,80})\.ics$/.exec(c.req.param('file'));
  if (!m) return c.text('Not found', 404);
  const db = c.env.DB;
  const feed = await db
    .prepare(
      `SELECT f.id, u.id AS userId, u.role, u.status, u.first_name AS firstName, u.last_name AS lastName, u.login FROM calendar_feeds f JOIN users u ON u.id = f.user_id WHERE f.token_hash = ?`,
    )
    .bind(await sha256(m[1]!))
    .first<{ id: string; userId: string; role: 'owner' | 'manager' | 'employee' | 'terminal'; status: string; firstName: string; lastName: string; login: string }>();
  if (!feed || feed.status !== 'active') return c.text('Not found', 404);
  const access = await loadAccess(db, { id: feed.userId, role: feed.role, firstName: feed.firstName, lastName: feed.lastName, login: feed.login } as AppEnv['Variables']['user']);
  const from = Date.now() - 30 * 86400_000;
  const events: string[] = [];
  const origin = new URL(c.req.url).origin;
  for (const [locId, perms] of access.locations) {
    if (!perms.has('recruitment.manage')) continue;
    const { results } = await db
      .prepare(`${SELECT} WHERE c.location_id = ? AND (c.interview_at >= ? OR c.trial_at >= ?) AND c.stage NOT IN ('rejected')`)
      .bind(locId, from, from)
      .all<Row>();
    for (const r of results) {
      if (!inScope(access, locId, r.position)) continue;
      for (const [kind, at, minutes, label] of [
        ['i', r.interviewAt, INTERVIEW_MINUTES, 'Rozmowa'],
        ['t', r.trialAt, TRIAL_MINUTES, 'Dzień próbny'],
      ] as const) {
        if (!at || at < from) continue;
        events.push(
          [
            'BEGIN:VEVENT',
            `UID:${r.id}-${kind}@senator-academy`,
            `DTSTAMP:${icsTime(r.updatedAt)}`,
            `DTSTART:${icsTime(at)}`,
            `DTEND:${icsTime(at + minutes * 60000)}`,
            fold(`SUMMARY:${icsText(`${label} · ${r.name} (${POSITION_PL[r.position] ?? r.position})`)}`),
            fold(`URL:${origin}/panel/rekrutacja/${r.id}`),
            'END:VEVENT',
          ].join('\r\n'),
        );
      }
    }
  }
  await db.prepare(`UPDATE calendar_feeds SET last_used_at = ? WHERE id = ?`).bind(Date.now(), feed.id).run();
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Senator Academy//Rekrutacja//PL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Senator · Rekrutacja', 'X-WR-TIMEZONE:Europe/Warsaw', ...events, 'END:VCALENDAR', ''].join('\r\n');
  return new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300' } });
});
