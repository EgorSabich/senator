/**
 * Panel → Testy (owner, 2026-10-17; mockups 19–23): tests with questions (one or several correct answers),
 * import / export as JSON, starting a test for chosen people, live view and the report.
 * `tests.edit` to make and change tests; `training.assign` to start them and see the results.
 * Leaders work with tests for their divisions (like materials).
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { POSITIONS, divisionOf } from '../../shared/constants';
import { allowedDivisions, loadAccess, requirePermission, requirePositionsInScope, type Access } from '../auth/access';
import { auditStatement } from '../lib/audit';
import { ApiError, badRequest, newId, notFound, readJson, str } from '../lib/http';
import { notify } from '../lib/notify';
import { answersOf, finalizeAttempt, questionsOf, settle, TEST_SELECT, type TestRow } from '../lib/tests';

export const testAdminRoutes = new Hono<AppEnv>();

type C = { env: AppEnv['Bindings']; var: AppEnv['Variables'] };

const posList = (t: { positions: string | null }) => (t.positions ? t.positions.split(',').filter(Boolean) : []);

/** 'edit' | 'read' | 'none' for this actor (as for materials). */
function verdict(access: Access, t: TestRow) {
  const scope = allowedDivisions(access, t.locationId);
  if (!scope) return 'edit';
  const ps = posList(t);
  if (ps.length && ps.every((p) => scope.has(p))) return 'edit';
  if (!ps.length || ps.some((p) => scope.has(p))) return 'read';
  return 'none';
}

async function loadTest(c: C, id: string, perm: 'tests.edit' | 'training.assign', need: 'edit' | 'read') {
  const db = c.env.DB;
  const t = await db.prepare(`${TEST_SELECT} WHERE id = ? AND status <> 'archived'`).bind(id).first<TestRow>();
  if (!t) throw notFound();
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, t.locationId, perm);
  const v = verdict(access, t);
  if (v === 'none') throw notFound();
  if (need === 'edit' && v !== 'edit') throw new ApiError(403, 'outside_divisions');
  return { t, access, v };
}

function parsePositions(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v) || !v.every((p) => typeof p === 'string' && (POSITIONS as readonly string[]).includes(p))) throw badRequest('positions_invalid');
  return [...new Set(v as string[])];
}

interface Settings {
  title: string;
  description: string | null;
  positions: string[];
  timeLimitSec: number;
  passScore: number;
  questionCount: number | null;
  shuffle: boolean;
  shuffleOptions: boolean;
}

function parseSettings(b: Record<string, unknown>, cur?: Settings): Settings {
  const title = b.title === undefined && cur ? cur.title : str(b.title, 120);
  if (!title) throw badRequest('title_required');
  const minutes = b.timeLimitMin === undefined ? (cur ? cur.timeLimitSec / 60 : 10) : Number(b.timeLimitMin);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) throw badRequest('test_time_invalid');
  const pass = b.passScore === undefined ? (cur?.passScore ?? 80) : Number(b.passScore);
  if (!Number.isInteger(pass) || pass < 1 || pass > 100) throw badRequest('test_pass_invalid');
  const qc = b.questionCount === undefined ? (cur?.questionCount ?? null) : b.questionCount === null || b.questionCount === '' || b.questionCount === 0 ? null : Number(b.questionCount);
  if (qc !== null && (!Number.isInteger(qc) || qc < 1 || qc > 500)) throw badRequest('test_count_invalid');
  return {
    title,
    description: b.description === undefined ? (cur?.description ?? null) : str(b.description, 500),
    positions: b.positions === undefined ? (cur?.positions ?? []) : parsePositions(b.positions),
    timeLimitSec: Math.round(minutes * 60),
    passScore: pass,
    questionCount: qc,
    shuffle: b.shuffle === undefined ? (cur?.shuffle ?? true) : b.shuffle !== false,
    shuffleOptions: b.shuffleOptions === undefined ? (cur?.shuffleOptions ?? true) : b.shuffleOptions !== false,
  };
}

interface QInput {
  text: string;
  multi: boolean;
  options: { text: string; correct: boolean }[];
}
function parseQuestion(b: Record<string, unknown>): QInput {
  const text = str(b.text, 500);
  if (!text) throw badRequest('question_text_required');
  if (!Array.isArray(b.options)) throw badRequest('question_options_invalid');
  const options = (b.options as unknown[])
    .map((o) => (o && typeof o === 'object' ? (o as Record<string, unknown>) : {}))
    .map((o) => ({ text: str(o.text, 300) ?? '', correct: o.correct === true }))
    .filter((o) => o.text);
  if (options.length < 2 || options.length > 10) throw badRequest('question_options_invalid');
  const right = options.filter((o) => o.correct).length;
  if (!right) throw badRequest('question_no_correct');
  // one correct answer → a one-answer question; several → all of them must be chosen
  const multi = b.multi === true || right > 1;
  return { text, multi, options };
}

function questionStatements(db: D1Database, testId: string, q: QInput, sort: number, id = newId('q')) {
  return [
    db.prepare(`INSERT INTO questions (id, test_id, text, multi, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)`).bind(id, testId, q.text, q.multi ? 1 : 0, sort),
    ...q.options.map((o, i) =>
      db.prepare(`INSERT INTO answer_options (id, question_id, text, is_correct, sort_order) VALUES (?, ?, ?, ?, ?)`).bind(newId('opt'), id, o.text, o.correct ? 1 : 0, i),
    ),
  ];
}

const toSettings = (t: TestRow): Settings => ({
  title: t.title,
  description: t.description,
  positions: posList(t),
  timeLimitSec: t.timeLimitSec,
  passScore: t.passScore,
  questionCount: t.questionCount,
  shuffle: Boolean(t.shuffle),
  shuffleOptions: Boolean(t.shuffleOptions),
});

/* ───────── List, create, import ───────── */

testAdminRoutes.get('/locations/:locId/tests', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const perms = access.locations.get(locId);
  if (!perms) throw notFound();
  if (access.role !== 'owner' && !perms.has('tests.edit') && !perms.has('training.assign')) throw new ApiError(403, 'forbidden');
  const { results } = await db
    .prepare(
      `${TEST_SELECT.replace(' FROM tests', `, (SELECT COUNT(*) FROM questions q WHERE q.test_id = tests.id AND q.is_active = 1) AS questions,
         (SELECT MAX(started_at) FROM test_sessions s WHERE s.test_id = tests.id) AS lastRun FROM tests`)} WHERE location_id = ? AND status <> 'archived' ORDER BY title`,
    )
    .bind(locId)
    .all<TestRow & { questions: number; lastRun: number | null }>();
  const visible = results.map((t) => ({ ...t, v: verdict(access, t) })).filter((t) => t.v !== 'none');
  // last run: people and the average
  const out = [];
  for (const t of visible) {
    let last = null;
    if (t.lastRun) {
      const s = await db
        .prepare(
          `SELECT s.id, s.started_at AS at, COUNT(a.id) AS people, AVG(CASE WHEN a.status = 'submitted' THEN a.score_percent END) AS avg
           FROM test_sessions s LEFT JOIN test_attempts a ON a.session_id = s.id WHERE s.test_id = ? GROUP BY s.id ORDER BY s.started_at DESC LIMIT 1`,
        )
        .bind(t.id)
        .first<{ id: string; at: number; people: number; avg: number | null }>();
      if (s) last = { sessionId: s.id, at: s.at, people: s.people, avg: s.avg === null ? null : Math.round(s.avg) };
    }
    out.push({
      id: t.id,
      title: t.title,
      positions: posList(t),
      questions: t.questions,
      questionCount: t.questionCount,
      timeLimitSec: t.timeLimitSec,
      passScore: t.passScore,
      editable: t.v === 'edit' && Boolean(access.role === 'owner' || perms.has('tests.edit')),
      canRun: Boolean(access.role === 'owner' || perms.has('training.assign')),
      last,
    });
  }
  const scope = allowedDivisions(access, locId);
  return c.json({ tests: out, divisions: scope ? [...scope].filter((p) => divisionOf(p) === p) : null, canEdit: access.role === 'owner' || perms.has('tests.edit') });
});

testAdminRoutes.post('/locations/:locId/tests', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'tests.edit');
  const s = parseSettings(await readJson<Record<string, unknown>>(c.req.raw));
  const scope = allowedDivisions(access, locId);
  if (scope && !s.positions.length) s.positions = [...scope].filter((p) => divisionOf(p) === p);
  requirePositionsInScope(access, locId, s.positions);
  const id = newId('test');
  await db.batch([
    db
      .prepare(
        `INSERT INTO tests (id, location_id, title, description, pass_score, question_count, shuffle, shuffle_options, time_limit_sec, positions, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)`,
      )
      .bind(id, locId, s.title, s.description, s.passScore, s.questionCount, s.shuffle ? 1 : 0, s.shuffleOptions ? 1 : 0, s.timeLimitSec, s.positions.join(',') || null, c.var.user.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: locId, action: 'test.create', entityType: 'test', entityId: id, after: { title: s.title } }),
  ]);
  return c.json({ id }, 201);
});

/** Import: { format: 'senator-tests', tests: [{ title, positions?, timeLimitMin?, passScore?, questionCount?, questions: [{ text, options: [{ text, correct }] }] }] } */
testAdminRoutes.post('/locations/:locId/tests/import', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'tests.edit');
  const body = await readJson<{ format?: unknown; tests?: unknown; dryRun?: unknown }>(c.req.raw);
  if (body.format !== 'senator-tests' || !Array.isArray(body.tests) || !body.tests.length || body.tests.length > 50) throw badRequest('test_import_format');
  const scope = allowedDivisions(access, locId);
  const parsed: { s: Settings; qs: QInput[] }[] = [];
  (body.tests as unknown[]).forEach((raw, ti) => {
    const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    try {
      const s = parseSettings(t);
      if (scope && !s.positions.length) s.positions = [...scope].filter((p) => divisionOf(p) === p);
      requirePositionsInScope(access, locId, s.positions);
      if (!Array.isArray(t.questions) || !t.questions.length || t.questions.length > 500) throw badRequest('test_import_questions');
      const qs = (t.questions as unknown[]).map((q, qi) => {
        try {
          return parseQuestion((q && typeof q === 'object' ? q : {}) as Record<string, unknown>);
        } catch (e) {
          throw new ApiError(400, 'test_import_question', { test: ti + 1, question: qi + 1, problem: e instanceof ApiError ? e.code : 'invalid' });
        }
      });
      parsed.push({ s, qs });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'test_import_question') throw e;
      throw new ApiError(e instanceof ApiError ? e.status : 400, 'test_import_test', { test: ti + 1, problem: e instanceof ApiError ? e.code : 'invalid' });
    }
  });
  if (body.dryRun === true) return c.json({ tests: parsed.map((p) => ({ title: p.s.title, questions: p.qs.length, positions: p.s.positions })) });
  const ids: string[] = [];
  for (const p of parsed) {
    const id = newId('test');
    ids.push(id);
    const stmts: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO tests (id, location_id, title, description, pass_score, question_count, shuffle, shuffle_options, time_limit_sec, positions, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)`,
        )
        .bind(id, locId, p.s.title, p.s.description, p.s.passScore, p.s.questionCount, p.s.shuffle ? 1 : 0, p.s.shuffleOptions ? 1 : 0, p.s.timeLimitSec, p.s.positions.join(',') || null, c.var.user.id),
      auditStatement(db, { actorId: c.var.user.id, locationId: locId, action: 'test.import', entityType: 'test', entityId: id, after: { title: p.s.title, questions: p.qs.length } }),
    ];
    p.qs.forEach((q, i) => stmts.push(...questionStatements(db, id, q, i)));
    // D1 batches stay small
    for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
  }
  return c.json({ ids }, 201);
});

/* ───────── One test ───────── */

testAdminRoutes.get('/tests/:id', async (c) => {
  const { t, v, access } = await loadTest(c, c.req.param('id'), 'tests.edit', 'read');
  const qs = await questionsOf(c.env.DB, t.id);
  return c.json({
    test: { id: t.id, ...toSettings(t), questionsTotal: qs.length },
    editable: v === 'edit',
    divisions: (() => {
      const scope = allowedDivisions(access, t.locationId);
      return scope ? [...scope].filter((p) => divisionOf(p) === p) : null;
    })(),
    questions: qs.map((q) => ({ id: q.id, text: q.text, multi: Boolean(q.multi), options: q.options.map((o) => ({ id: o.id, text: o.text, correct: Boolean(o.isCorrect) })) })),
  });
});

testAdminRoutes.put('/tests/:id', async (c) => {
  const { t, access } = await loadTest(c, c.req.param('id'), 'tests.edit', 'edit');
  const s = parseSettings(await readJson<Record<string, unknown>>(c.req.raw), toSettings(t));
  requirePositionsInScope(access, t.locationId, s.positions);
  const db = c.env.DB;
  await db.batch([
    db
      .prepare(
        `UPDATE tests SET title = ?, description = ?, pass_score = ?, question_count = ?, shuffle = ?, shuffle_options = ?, time_limit_sec = ?, positions = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(s.title, s.description, s.passScore, s.questionCount, s.shuffle ? 1 : 0, s.shuffleOptions ? 1 : 0, s.timeLimitSec, s.positions.join(',') || null, Date.now(), t.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: t.locationId, action: 'test.update', entityType: 'test', entityId: t.id, after: s }),
  ]);
  return c.json({ ok: true });
});

/** Delete: a test with results is only hidden (the reports stay); one never taken is removed. */
testAdminRoutes.delete('/tests/:id', async (c) => {
  const { t } = await loadTest(c, c.req.param('id'), 'tests.edit', 'edit');
  const db = c.env.DB;
  const used = await db.prepare(`SELECT 1 FROM test_attempts WHERE test_id = ? LIMIT 1`).bind(t.id).first();
  if (used) await db.prepare(`UPDATE tests SET status = 'archived', updated_at = ? WHERE id = ?`).bind(Date.now(), t.id).run();
  else
    await db.batch([
      db.prepare(`DELETE FROM answer_options WHERE question_id IN (SELECT id FROM questions WHERE test_id = ?)`).bind(t.id),
      db.prepare(`DELETE FROM questions WHERE test_id = ?`).bind(t.id),
      db.prepare(`DELETE FROM test_review_content WHERE test_id = ?`).bind(t.id),
      db.prepare(`DELETE FROM extra_attempt_grants WHERE test_id = ?`).bind(t.id),
      db.prepare(`DELETE FROM tests WHERE id = ?`).bind(t.id),
    ]);
  await auditStatement(db, { actorId: c.var.user.id, locationId: t.locationId, action: 'test.delete', entityType: 'test', entityId: t.id, before: { title: t.title } }).run();
  return c.json({ ok: true });
});

testAdminRoutes.get('/tests/:id/export', async (c) => {
  const { t } = await loadTest(c, c.req.param('id'), 'tests.edit', 'read');
  const qs = await questionsOf(c.env.DB, t.id);
  return c.json({
    format: 'senator-tests',
    tests: [
      {
        title: t.title,
        description: t.description,
        positions: posList(t),
        timeLimitMin: t.timeLimitSec / 60,
        passScore: t.passScore,
        questionCount: t.questionCount,
        shuffle: Boolean(t.shuffle),
        shuffleOptions: Boolean(t.shuffleOptions),
        questions: qs.map((q) => ({ text: q.text, ...(q.multi ? { multi: true } : {}), options: q.options.map((o) => ({ text: o.text, correct: Boolean(o.isCorrect) })) })),
      },
    ],
  });
});

/* ───────── Questions ───────── */

async function running(db: D1Database, testId: string) {
  return db.prepare(`SELECT 1 FROM test_attempts WHERE test_id = ? AND status IN ('assigned', 'in_progress') LIMIT 1`).bind(testId).first();
}

testAdminRoutes.post('/tests/:id/questions', async (c) => {
  const { t } = await loadTest(c, c.req.param('id'), 'tests.edit', 'edit');
  const q = parseQuestion(await readJson<Record<string, unknown>>(c.req.raw));
  const db = c.env.DB;
  const max = await db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM questions WHERE test_id = ?`).bind(t.id).first<{ m: number }>();
  const id = newId('q');
  await db.batch([...questionStatements(db, t.id, q, (max?.m ?? -1) + 1, id), db.prepare(`UPDATE tests SET updated_at = ? WHERE id = ?`).bind(Date.now(), t.id)]);
  return c.json({ id }, 201);
});

async function loadQuestion(c: C, id: string) {
  const q = await c.env.DB.prepare(`SELECT id, test_id AS testId, sort_order AS sortOrder FROM questions WHERE id = ? AND is_active = 1`).bind(id).first<{ id: string; testId: string; sortOrder: number }>();
  if (!q) throw notFound();
  const { t } = await loadTest(c, q.testId, 'tests.edit', 'edit');
  return { q, t };
}

/** Changing a question: a new version (the old one stays for past results), in the same place. */
testAdminRoutes.put('/tests/questions/:qid', async (c) => {
  const { q, t } = await loadQuestion(c, c.req.param('qid'));
  if (await running(c.env.DB, t.id)) throw new ApiError(409, 'test_running');
  const input = parseQuestion(await readJson<Record<string, unknown>>(c.req.raw));
  const db = c.env.DB;
  const id = newId('q');
  await db.batch([db.prepare(`UPDATE questions SET is_active = 0 WHERE id = ?`).bind(q.id), ...questionStatements(db, t.id, input, q.sortOrder, id)]);
  return c.json({ id });
});

testAdminRoutes.delete('/tests/questions/:qid', async (c) => {
  const { q, t } = await loadQuestion(c, c.req.param('qid'));
  if (await running(c.env.DB, t.id)) throw new ApiError(409, 'test_running');
  await c.env.DB.prepare(`UPDATE questions SET is_active = 0 WHERE id = ?`).bind(q.id).run();
  return c.json({ ok: true });
});

testAdminRoutes.put('/tests/:id/order', async (c) => {
  const { t } = await loadTest(c, c.req.param('id'), 'tests.edit', 'edit');
  const body = await readJson<{ ids?: unknown }>(c.req.raw);
  if (!Array.isArray(body.ids) || body.ids.some((x) => typeof x !== 'string')) throw badRequest('invalid_input');
  const db = c.env.DB;
  await db.batch((body.ids as string[]).map((id, i) => db.prepare(`UPDATE questions SET sort_order = ? WHERE id = ? AND test_id = ?`).bind(i, id, t.id)));
  return c.json({ ok: true });
});

/* ───────── Starting a test, live view, report ───────── */

/** People who can take it: active employees of the location in the actor's divisions; who is on shift now first. */
testAdminRoutes.get('/tests/:id/candidates', async (c) => {
  const { t, access } = await loadTest(c, c.req.param('id'), 'training.assign', 'read');
  const db = c.env.DB;
  const { results } = await db
    .prepare(
      `SELECT u.id, u.first_name AS f, u.last_name AS l, group_concat(ul.position) AS positions,
              EXISTS (SELECT 1 FROM time_entries e WHERE e.user_id = u.id AND e.location_id = ?1 AND e.clock_out_at IS NULL AND e.clock_in_at > ?2) AS onShift
       FROM users u JOIN user_locations ul ON ul.user_id = u.id AND ul.location_id = ?1 AND ul.is_active = 1
       WHERE u.role = 'employee' AND u.status = 'active' GROUP BY u.id ORDER BY u.first_name, u.last_name`,
    )
    .bind(t.locationId, Date.now() - 16 * 3600_000)
    .all<{ id: string; f: string; l: string; positions: string; onShift: number }>();
  const scope = allowedDivisions(access, t.locationId);
  const forTest = posList(t);
  const people = results
    .map((r) => ({ id: r.id, name: `${r.f} ${r.l}`.trim(), positions: r.positions.split(','), onShift: Boolean(r.onShift) }))
    .filter((p) => !scope || p.positions.some((x) => scope.has(x)))
    .map((p) => ({ ...p, matches: !forTest.length || p.positions.some((x) => forTest.includes(x) || forTest.includes(divisionOf(x))) }));
  return c.json({ people, timeLimitSec: t.timeLimitSec });
});

testAdminRoutes.post('/tests/:id/sessions', async (c) => {
  const { t, access } = await loadTest(c, c.req.param('id'), 'training.assign', 'read');
  const db = c.env.DB;
  const body = await readJson<{ userIds?: unknown; timeLimitMin?: unknown }>(c.req.raw);
  const ids = Array.isArray(body.userIds) ? [...new Set(body.userIds.filter((x): x is string => typeof x === 'string'))] : [];
  if (!ids.length || ids.length > 100) throw badRequest('test_people_required');
  const minutes = body.timeLimitMin === undefined ? t.timeLimitSec / 60 : Number(body.timeLimitMin);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) throw badRequest('test_time_invalid');
  const qn = await db.prepare(`SELECT COUNT(*) AS n FROM questions WHERE test_id = ? AND is_active = 1`).bind(t.id).first<{ n: number }>();
  if (!qn?.n) throw new ApiError(409, 'test_empty');
  // only people of this location within the actor's divisions
  const { results: ok } = await db
    .prepare(
      `SELECT DISTINCT u.id, ul.position FROM users u JOIN user_locations ul ON ul.user_id = u.id AND ul.location_id = ? AND ul.is_active = 1
       WHERE u.role = 'employee' AND u.status = 'active' AND u.id IN (${ids.map(() => '?').join(', ')})`,
    )
    .bind(t.locationId, ...ids)
    .all<{ id: string; position: string }>();
  const scope = allowedDivisions(access, t.locationId);
  const allowed = [...new Set(ok.filter((r) => !scope || scope.has(r.position)).map((r) => r.id))];
  if (allowed.length !== ids.length) throw new ApiError(403, 'outside_divisions');
  const now = Date.now();
  const limit = Math.round(minutes * 60);
  const sid = newId('ts');
  // a person in another test started now: that one is closed first
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(`INSERT INTO test_sessions (id, location_id, test_id, started_by, started_at, time_limit_sec, closes_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(sid, t.locationId, t.id, c.var.user.id, now, limit, now + limit * 1000 + 30 * 60_000),
    auditStatement(db, { actorId: c.var.user.id, locationId: t.locationId, action: 'test.start', entityType: 'test', entityId: t.id, after: { session: sid, people: allowed.length, minutes } }),
  ];
  for (const u of allowed) {
    const n = await db.prepare(`SELECT COALESCE(MAX(attempt_no), 0) AS n FROM test_attempts WHERE test_id = ? AND user_id = ?`).bind(t.id, u).first<{ n: number }>();
    stmts.push(
      db
        .prepare(
          `INSERT INTO test_attempts (id, test_id, user_id, location_id, attempt_no, status, question_order_json, started_at, session_id) VALUES (?, ?, ?, ?, ?, 'assigned', '[]', ?, ?)`,
        )
        .bind(newId('att'), t.id, u, t.locationId, (n?.n ?? 0) + 1, now, sid),
    );
  }
  for (const u of allowed) await settleOthers(db, u, now);
  await db.batch(stmts);
  // the phones open the test (push; an open app also refreshes on it)
  c.executionCtx.waitUntil(
    notify(c.env, allowed, () => ({ title: 'Test', body: `„${t.title}” — ${Math.round(minutes)} min. Otwórz aplikację, test zaczyna się od razu.`, url: '/', tag: `test-${sid}` })).catch(() => undefined),
  );
  return c.json({ sessionId: sid }, 201);
});

/** Earlier tests still open for this person are handed in (one test at a time). */
async function settleOthers(db: D1Database, userId: string, now: number) {
  const { results } = await db
    .prepare(`SELECT a.id, t.pass_score AS p FROM test_attempts a JOIN tests t ON t.id = a.test_id WHERE a.user_id = ? AND a.status IN ('assigned', 'in_progress')`)
    .bind(userId)
    .all<{ id: string; p: number }>();
  for (const r of results) await finalizeAttempt(db, r.id, now, r.p);
}

async function loadSession(c: C, id: string) {
  const s = await c.env.DB.prepare(`SELECT id, location_id AS locationId, test_id AS testId, started_at AS startedAt, time_limit_sec AS timeLimitSec, closes_at AS closesAt, finished_at AS finishedAt FROM test_sessions WHERE id = ?`)
    .bind(id)
    .first<{ id: string; locationId: string; testId: string; startedAt: number; timeLimitSec: number; closesAt: number; finishedAt: number | null }>();
  if (!s) throw notFound();
  const db = c.env.DB;
  const t = await db.prepare(`${TEST_SELECT} WHERE id = ?`).bind(s.testId).first<TestRow>();
  if (!t) throw notFound();
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, s.locationId, 'training.assign');
  if (verdict(access, t) === 'none') throw notFound();
  return { s, t, access };
}

testAdminRoutes.get('/locations/:locId/test-sessions', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'training.assign');
  const testId = c.req.query('testId');
  const { results } = await db
    .prepare(
      `SELECT s.id, s.test_id AS testId, t.title, t.positions, t.location_id AS locationId, s.started_at AS startedAt, s.finished_at AS finishedAt, s.closes_at AS closesAt,
              COUNT(a.id) AS people, SUM(CASE WHEN a.status = 'submitted' THEN 1 ELSE 0 END) AS done,
              AVG(CASE WHEN a.status = 'submitted' THEN a.score_percent END) AS avg, SUM(CASE WHEN a.passed = 1 THEN 1 ELSE 0 END) AS passed, SUM(CASE WHEN a.status IN ('assigned', 'in_progress') THEN 1 ELSE 0 END) AS open
       FROM test_sessions s JOIN tests t ON t.id = s.test_id LEFT JOIN test_attempts a ON a.session_id = s.id
       WHERE s.location_id = ? ${testId ? 'AND s.test_id = ?' : ''} GROUP BY s.id ORDER BY s.started_at DESC LIMIT 100`,
    )
    .bind(locId, ...(testId ? [testId] : []))
    .all<{ id: string; testId: string; title: string; positions: string | null; locationId: string; startedAt: number; finishedAt: number | null; closesAt: number; people: number; done: number; avg: number | null; passed: number; open: number }>();
  const now = Date.now();
  return c.json({
    sessions: results
      .filter((r) => verdict(access, { ...(r as unknown as TestRow), positions: r.positions, locationId: r.locationId }) !== 'none')
      .map((r) => ({ id: r.id, testId: r.testId, title: r.title, startedAt: r.startedAt, live: !r.finishedAt && r.closesAt > now && r.open > 0, people: r.people, done: r.done, passed: r.passed, avg: r.avg === null ? null : Math.round(r.avg) })),
  });
});

/** Live view while it runs, the report afterwards (mockups 21, 23). */
testAdminRoutes.get('/test-sessions/:id', async (c) => {
  const { s, t } = await loadSession(c, c.req.param('id'));
  const db = c.env.DB;
  const now = Date.now();
  await settle(db, now, { sessionId: s.id });
  const { results: atts } = await db
    .prepare(
      `SELECT a.id, a.user_id AS userId, u.first_name || ' ' || u.last_name AS name, a.status, a.opened_at AS openedAt, a.deadline_at AS deadlineAt, a.submitted_at AS submittedAt,
              a.score_percent AS score, a.passed, a.correct_count AS correct, a.total_count AS total, a.question_order_json AS orderJson,
              (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id AND aa.answered_at IS NOT NULL) AS answered
       FROM test_attempts a JOIN users u ON u.id = a.user_id WHERE a.session_id = ? ORDER BY u.first_name, u.last_name`,
    )
    .bind(s.id)
    .all<{ id: string; userId: string; name: string; status: string; openedAt: number | null; deadlineAt: number | null; submittedAt: number | null; score: number | null; passed: number | null; correct: number | null; total: number | null; orderJson: string; answered: number }>();
  const people = [];
  const perQuestion = new Map<string, { text: string; n: number; ok: number; wrong: Map<string, number> }>();
  for (const a of atts) {
    const answers = a.status === 'submitted' ? await answersOf(db, a.id) : [];
    for (const x of answers) {
      const q = perQuestion.get(x.text) ?? { text: x.text, n: 0, ok: 0, wrong: new Map<string, number>() };
      q.n++;
      if (x.ok) q.ok++;
      else {
        const k = x.chosen.length ? x.chosen.join(', ') : '— brak odpowiedzi —';
        q.wrong.set(k, (q.wrong.get(k) ?? 0) + 1);
      }
      perQuestion.set(x.text, q);
    }
    let total = a.total ?? 0;
    try {
      total = total || (JSON.parse(a.orderJson || '[]') as unknown[]).length;
    } catch {
      /* keep */
    }
    people.push({
      attemptId: a.id,
      userId: a.userId,
      name: a.name,
      status: a.status,
      answered: a.answered,
      total,
      score: a.score,
      passed: a.passed === null ? null : Boolean(a.passed),
      durationSec: a.openedAt && a.submittedAt ? Math.round((a.submittedAt - a.openedAt) / 1000) : null,
      timeUp: Boolean(a.status === 'submitted' && a.deadlineAt && a.submittedAt && a.submittedAt >= a.deadlineAt - 1000),
      answers,
    });
  }
  const done = people.filter((p) => p.status === 'submitted');
  const questions = [...perQuestion.values()]
    .map((q) => ({ text: q.text, answers: q.n, okPct: Math.round((q.ok / q.n) * 100), topWrong: [...q.wrong].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null }))
    .sort((a, b) => a.okPct - b.okPct);
  return c.json({
    session: { id: s.id, testId: t.id, title: t.title, passScore: t.passScore, startedAt: s.startedAt, timeLimitSec: s.timeLimitSec, live: !s.finishedAt && s.closesAt > now && people.some((p) => p.status === 'assigned' || p.status === 'in_progress'), finishedAt: s.finishedAt },
    now,
    totals: {
      people: people.length,
      done: done.length,
      abandoned: people.filter((p) => p.status === 'abandoned').length,
      avgScore: done.length ? Math.round(done.reduce((a, p) => a + (p.score ?? 0), 0) / done.length) : null,
      passed: done.filter((p) => p.passed).length,
      avgSec: done.filter((p) => p.durationSec !== null).length ? Math.round(done.reduce((a, p) => a + (p.durationSec ?? 0), 0) / done.filter((p) => p.durationSec !== null).length) : null,
      hardest: questions[0] && questions[0].okPct < 100 ? questions[0] : null,
    },
    people,
    questions,
  });
});

testAdminRoutes.post('/test-sessions/:id/finish', async (c) => {
  const { s, t } = await loadSession(c, c.req.param('id'));
  const db = c.env.DB;
  const now = Date.now();
  if (!s.finishedAt) await db.prepare(`UPDATE test_sessions SET finished_at = ? WHERE id = ?`).bind(now, s.id).run();
  await settle(db, now + 1, { sessionId: s.id });
  await auditStatement(db, { actorId: c.var.user.id, locationId: s.locationId, action: 'test.finish', entityType: 'test', entityId: t.id, after: { session: s.id } }).run();
  return c.json({ ok: true });
});
