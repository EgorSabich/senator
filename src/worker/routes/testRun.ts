/**
 * The person's side of a test before the shift (mockup 22): /api/tests/active tells the app to show only the test;
 * open → questions; answers are saved one by one; hand in → score and mistakes.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError, badRequest, notFound, readJson } from '../lib/http';
import { finalizeAttempt, optionsOf, pickOrder, questionsOf, resultOf, settle, TEST_SELECT, type OrderItem, type TestRow } from '../lib/tests';
import { newId } from '../lib/http';

export const testRunRoutes = new Hono<AppEnv>();

interface Att {
  id: string;
  testId: string;
  userId: string;
  status: string;
  questionOrderJson: string;
  openedAt: number | null;
  deadlineAt: number | null;
  closesAt: number | null;
  finishedAt: number | null;
  timeLimitSec: number | null;
}
const ATT = `SELECT a.id, a.test_id AS testId, a.user_id AS userId, a.status, a.question_order_json AS questionOrderJson, a.opened_at AS openedAt, a.deadline_at AS deadlineAt,
  s.closes_at AS closesAt, s.finished_at AS finishedAt, s.time_limit_sec AS timeLimitSec
  FROM test_attempts a LEFT JOIN test_sessions s ON s.id = a.session_id`;

async function mine(c: { env: AppEnv['Bindings']; var: AppEnv['Variables'] }, id: string) {
  const a = await c.env.DB.prepare(`${ATT} WHERE a.id = ?`).bind(id).first<Att>();
  if (!a || a.userId !== c.var.user.id) throw notFound();
  return a;
}

/** Is there a test the person must take now? (the app shows only the test then) */
testRunRoutes.get('/tests/active', async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  await settle(db, now, { userId: c.var.user.id });
  const a = await db
    .prepare(
      `SELECT a.id, a.status, a.opened_at AS openedAt, a.deadline_at AS deadlineAt, t.title, s.time_limit_sec AS timeLimitSec,
              (SELECT COUNT(*) FROM questions q WHERE q.test_id = t.id AND q.is_active = 1) AS questions, t.question_count AS questionCount
       FROM test_attempts a JOIN tests t ON t.id = a.test_id JOIN test_sessions s ON s.id = a.session_id
       WHERE a.user_id = ? AND a.status IN ('assigned', 'in_progress') AND s.finished_at IS NULL AND s.closes_at > ?
       ORDER BY a.started_at DESC LIMIT 1`,
    )
    .bind(c.var.user.id, now)
    .first<{ id: string; status: string; openedAt: number | null; deadlineAt: number | null; title: string; timeLimitSec: number; questions: number; questionCount: number | null }>();
  return c.json(
    {
      active: a
        ? {
            attemptId: a.id,
            title: a.title,
            opened: a.status === 'in_progress',
            deadlineAt: a.deadlineAt,
            timeLimitSec: a.timeLimitSec,
            questions: a.questionCount && a.questionCount < a.questions ? a.questionCount : a.questions,
          }
        : null,
      now,
    },
    200,
    { 'Cache-Control': 'no-store' },
  );
});

/** The phone shows the test: the timer starts now (once); returns the questions without the answers. */
testRunRoutes.post('/tests/attempts/:id/open', async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  await settle(db, now, { userId: c.var.user.id });
  let a = await mine(c, c.req.param('id'));
  if (a.status !== 'assigned' && a.status !== 'in_progress') throw new ApiError(409, 'test_closed');
  if (a.status === 'assigned') {
    const test = await db.prepare(`${TEST_SELECT} WHERE id = ?`).bind(a.testId).first<TestRow>();
    if (!test) throw notFound();
    const qs = await questionsOf(db, test.id);
    if (!qs.length) throw new ApiError(409, 'test_empty');
    const order = pickOrder(test, qs);
    const limit = (a.timeLimitSec ?? test.timeLimitSec) * 1000;
    const deadline = Math.min(now + limit, a.closesAt ?? now + limit);
    await db
      .prepare(`UPDATE test_attempts SET status = 'in_progress', opened_at = ?, deadline_at = ?, question_order_json = ? WHERE id = ? AND status = 'assigned'`)
      .bind(now, deadline, JSON.stringify(order), a.id)
      .run();
    a = await mine(c, a.id);
  }
  const order = JSON.parse(a.questionOrderJson) as OrderItem[];
  const ids = order.map((o) => o.q);
  const { results: qs } = await db
    .prepare(`SELECT id, text, multi FROM questions WHERE id IN (${ids.map(() => '?').join(', ')})`)
    .bind(...ids)
    .all<{ id: string; text: string; multi: number }>();
  const opts = await optionsOf(db, ids);
  const { results: saved } = await db.prepare(`SELECT question_id AS q, selected_json AS sel FROM attempt_answers WHERE attempt_id = ?`).bind(a.id).all<{ q: string; sel: string | null }>();
  return c.json({
    attemptId: a.id,
    deadlineAt: a.deadlineAt,
    now,
    questions: order.map((o) => {
      const q = qs.find((x) => x.id === o.q);
      return { id: o.q, text: q?.text ?? '—', multi: Boolean(q?.multi), options: o.o.map((id) => ({ id, text: opts.find((x) => x.id === id)?.text ?? '—' })) };
    }),
    answers: Object.fromEntries(saved.map((s) => [s.q, JSON.parse(s.sel || '[]') as string[]])),
  });
});

testRunRoutes.put('/tests/attempts/:id/answers', async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  const a = await mine(c, c.req.param('id'));
  if (a.status !== 'in_progress') throw new ApiError(409, 'test_closed');
  if (a.deadlineAt !== null && now > a.deadlineAt + 3000) throw new ApiError(409, 'test_time_up');
  const body = await readJson<{ questionId?: unknown; optionIds?: unknown }>(c.req.raw);
  const order = JSON.parse(a.questionOrderJson) as OrderItem[];
  const item = order.find((o) => o.q === body.questionId);
  if (!item) throw badRequest('invalid_input');
  const sel = Array.isArray(body.optionIds) ? [...new Set(body.optionIds.filter((x): x is string => typeof x === 'string' && item.o.includes(x)))] : [];
  await db
    .prepare(
      `INSERT INTO attempt_answers (id, attempt_id, question_id, selected_option_id, selected_json, snapshot_json, answered_at) VALUES (?, ?, ?, ?, ?, '{}', ?)
       ON CONFLICT (attempt_id, question_id) DO UPDATE SET selected_option_id = excluded.selected_option_id, selected_json = excluded.selected_json, answered_at = excluded.answered_at`,
    )
    .bind(newId('aa'), a.id, item.q, sel[0] ?? null, JSON.stringify(sel), now)
    .run();
  return c.json({ ok: true });
});

testRunRoutes.post('/tests/attempts/:id/submit', async (c) => {
  const db = c.env.DB;
  const a = await mine(c, c.req.param('id'));
  if (a.status === 'in_progress') {
    const t = await db.prepare(`SELECT pass_score AS p FROM tests WHERE id = ?`).bind(a.testId).first<{ p: number }>();
    await finalizeAttempt(db, a.id, Date.now(), t?.p ?? 80);
  }
  return c.json(await resultOf(db, a.id));
});

testRunRoutes.get('/tests/attempts/:id/result', async (c) => {
  const a = await mine(c, c.req.param('id'));
  await settle(c.env.DB, Date.now(), { userId: c.var.user.id });
  return c.json(await resultOf(c.env.DB, a.id));
});
