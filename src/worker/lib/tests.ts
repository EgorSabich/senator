/**
 * Tests before the shift (owner, 2026-10-17; mockups 19–23).
 * A leader starts a test for chosen people (test_sessions → one test_attempt each, status „assigned”).
 * The person's app shows only the test until it is handed in or the time is up (one timer for the whole test,
 * running from the moment the phone shows it). Questions: one or several correct answers — all of them must be
 * chosen. After handing in the person sees the score and the mistakes with the right answers.
 * Statuses: assigned → in_progress → submitted; never opened before the session closed → abandoned.
 */
import { newId } from './http';

export interface OptionRow {
  id: string;
  questionId: string;
  text: string;
  isCorrect: number;
  sortOrder: number;
}
export interface QuestionRow {
  id: string;
  testId: string;
  text: string;
  multi: number;
  sortOrder: number;
  isActive: number;
}
export interface TestRow {
  id: string;
  locationId: string;
  title: string;
  description: string | null;
  passScore: number;
  questionCount: number | null;
  shuffle: number;
  shuffleOptions: number;
  timeLimitSec: number;
  positions: string | null;
  status: string;
}

export const TEST_SELECT = `SELECT id, location_id AS locationId, title, description, pass_score AS passScore, question_count AS questionCount, shuffle,
  shuffle_options AS shuffleOptions, time_limit_sec AS timeLimitSec, positions, status FROM tests`;

/** Active questions of a test with their options (in the editor's order). */
export async function questionsOf(db: D1Database, testId: string) {
  const { results: qs } = await db
    .prepare(`SELECT id, test_id AS testId, text, multi, sort_order AS sortOrder, is_active AS isActive FROM questions WHERE test_id = ? AND is_active = 1 ORDER BY sort_order, rowid`)
    .bind(testId)
    .all<QuestionRow>();
  const opts = await optionsOf(
    db,
    qs.map((q) => q.id),
  );
  return qs.map((q) => ({ ...q, options: opts.filter((o) => o.questionId === q.id) }));
}

export async function optionsOf(db: D1Database, questionIds: string[]) {
  const out: OptionRow[] = [];
  for (let i = 0; i < questionIds.length; i += 80) {
    const chunk = questionIds.slice(i, i + 80);
    if (!chunk.length) continue;
    const { results } = await db
      .prepare(
        `SELECT id, question_id AS questionId, text, is_correct AS isCorrect, sort_order AS sortOrder FROM answer_options WHERE question_id IN (${chunk.map(() => '?').join(', ')}) ORDER BY sort_order, rowid`,
      )
      .bind(...chunk)
      .all<OptionRow>();
    out.push(...results);
  }
  return out;
}

function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface OrderItem {
  q: string;
  o: string[];
}

/** The questions this person gets: all or a random part, in random order when the test says so. */
export function pickOrder(test: TestRow, qs: (QuestionRow & { options: OptionRow[] })[]): OrderItem[] {
  let list = test.shuffle ? shuffled(qs) : qs;
  if (test.questionCount && test.questionCount > 0 && test.questionCount < list.length) {
    list = test.shuffle ? list.slice(0, test.questionCount) : shuffled(qs).slice(0, test.questionCount).sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return list.map((q) => ({ q: q.id, o: (test.shuffleOptions ? shuffled(q.options) : q.options).map((o) => o.id) }));
}

export const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

interface AttemptRow {
  id: string;
  testId: string;
  userId: string;
  status: string;
  questionOrderJson: string;
  startedAt: number;
  openedAt: number | null;
  deadlineAt: number | null;
  sessionId: string | null;
}

/**
 * Hands the attempt in: every question of the person's order gets an answer row (empty when not answered) with a
 * snapshot of the question as it is now, so later edits never change the result.
 */
export async function finalizeAttempt(db: D1Database, attemptId: string, now: number, passScore: number) {
  const a = await db
    .prepare(`SELECT id, test_id AS testId, user_id AS userId, status, question_order_json AS questionOrderJson, started_at AS startedAt, opened_at AS openedAt, deadline_at AS deadlineAt, session_id AS sessionId FROM test_attempts WHERE id = ?`)
    .bind(attemptId)
    .first<AttemptRow>();
  if (!a || a.status === 'submitted' || a.status === 'abandoned') return;
  const order = JSON.parse(a.questionOrderJson || '[]') as OrderItem[];
  if (a.status === 'assigned' || !order.length) {
    await db.prepare(`UPDATE test_attempts SET status = 'abandoned', submitted_at = ? WHERE id = ? AND status IN ('assigned', 'in_progress')`).bind(now, a.id).run();
    return;
  }
  const ids = order.map((o) => o.q);
  const { results: qs } = await db
    .prepare(`SELECT id, text, multi FROM questions WHERE id IN (${ids.map(() => '?').join(', ')})`)
    .bind(...ids)
    .all<{ id: string; text: string; multi: number }>();
  const opts = await optionsOf(db, ids);
  const { results: given } = await db
    .prepare(`SELECT question_id AS q, selected_json AS sel FROM attempt_answers WHERE attempt_id = ?`)
    .bind(a.id)
    .all<{ q: string; sel: string | null }>();
  const chosen = new Map(given.map((g) => [g.q, JSON.parse(g.sel || '[]') as string[]]));
  let correct = 0;
  const stmts: D1PreparedStatement[] = [];
  for (const item of order) {
    const q = qs.find((x) => x.id === item.q);
    const qo = item.o.map((id) => opts.find((o) => o.id === id)).filter((o): o is OptionRow => Boolean(o));
    const right = qo.filter((o) => o.isCorrect).map((o) => o.id);
    const sel = (chosen.get(item.q) ?? []).filter((id) => qo.some((o) => o.id === id));
    const ok = right.length > 0 && sameSet(sel, right);
    if (ok) correct++;
    const snapshot = JSON.stringify({ text: q?.text ?? '—', multi: Boolean(q?.multi), options: qo.map((o) => ({ id: o.id, text: o.text })), correct: right });
    stmts.push(
      db
        .prepare(
          `INSERT INTO attempt_answers (id, attempt_id, question_id, selected_option_id, selected_json, is_correct, snapshot_json, answered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (attempt_id, question_id) DO UPDATE SET selected_json = excluded.selected_json, is_correct = excluded.is_correct, snapshot_json = excluded.snapshot_json`,
        )
        .bind(newId('aa'), a.id, item.q, sel[0] ?? null, JSON.stringify(sel), ok ? 1 : 0, snapshot, chosen.has(item.q) ? now : null),
    );
  }
  const total = order.length;
  const score = total ? Math.round((correct / total) * 100) : 0;
  stmts.push(
    db
      .prepare(`UPDATE test_attempts SET status = 'submitted', submitted_at = ?, correct_count = ?, total_count = ?, score_percent = ?, passed = ? WHERE id = ? AND status = 'in_progress'`)
      .bind(Math.min(now, a.deadlineAt ?? now), correct, total, score, score >= passScore ? 1 : 0, a.id),
  );
  await db.batch(stmts);
}

/** Hands in what ran out of time and closes what was never opened (called before any read). */
export async function settle(db: D1Database, now: number, filter: { userId?: string; sessionId?: string }) {
  const where = filter.userId ? 'a.user_id = ?' : 'a.session_id = ?';
  const { results } = await db
    .prepare(
      `SELECT a.id, a.status, a.deadline_at AS deadlineAt, t.pass_score AS passScore, s.closes_at AS closesAt, s.finished_at AS finishedAt
       FROM test_attempts a JOIN tests t ON t.id = a.test_id LEFT JOIN test_sessions s ON s.id = a.session_id
       WHERE ${where} AND a.status IN ('assigned', 'in_progress')`,
    )
    .bind(filter.userId ?? filter.sessionId)
    .all<{ id: string; status: string; deadlineAt: number | null; passScore: number; closesAt: number | null; finishedAt: number | null }>();
  for (const r of results) {
    const closed = (r.finishedAt !== null && r.finishedAt <= now) || (r.closesAt !== null && r.closesAt <= now);
    const late = r.status === 'in_progress' && r.deadlineAt !== null && r.deadlineAt + 3000 <= now;
    if (closed || late) await finalizeAttempt(db, r.id, now, r.passScore);
  }
}

/** The person's view of a handed-in attempt: score and mistakes with the right answers. */
export async function resultOf(db: D1Database, attemptId: string) {
  const a = await db
    .prepare(
      `SELECT a.id, a.status, a.score_percent AS score, a.passed, a.correct_count AS correct, a.total_count AS total, a.opened_at AS openedAt, a.submitted_at AS submittedAt,
              t.title, t.pass_score AS passScore
       FROM test_attempts a JOIN tests t ON t.id = a.test_id WHERE a.id = ?`,
    )
    .bind(attemptId)
    .first<{ id: string; status: string; score: number | null; passed: number | null; correct: number | null; total: number | null; openedAt: number | null; submittedAt: number | null; title: string; passScore: number }>();
  if (!a) return null;
  const answers = await answersOf(db, attemptId);
  return {
    attemptId: a.id,
    status: a.status,
    title: a.title,
    score: a.score ?? 0,
    passed: Boolean(a.passed),
    passScore: a.passScore,
    correct: a.correct ?? 0,
    total: a.total ?? 0,
    durationSec: a.openedAt && a.submittedAt ? Math.max(0, Math.round((a.submittedAt - a.openedAt) / 1000)) : null,
    mistakes: answers.filter((x) => !x.ok).map((x) => ({ text: x.text, chosen: x.chosen, correct: x.correct })),
  };
}

export async function answersOf(db: D1Database, attemptId: string) {
  const a = await db.prepare(`SELECT question_order_json AS o FROM test_attempts WHERE id = ?`).bind(attemptId).first<{ o: string }>();
  const order = (JSON.parse(a?.o || '[]') as OrderItem[]).map((x) => x.q);
  const { results } = await db
    .prepare(`SELECT question_id AS q, selected_json AS sel, is_correct AS ok, snapshot_json AS snap FROM attempt_answers WHERE attempt_id = ?`)
    .bind(attemptId)
    .all<{ q: string; sel: string | null; ok: number | null; snap: string }>();
  return results
    .sort((x, y) => order.indexOf(x.q) - order.indexOf(y.q))
    .map((r) => {
      const s = JSON.parse(r.snap) as { text: string; options: { id: string; text: string }[]; correct: string[] };
      const sel = JSON.parse(r.sel || '[]') as string[];
      const label = (ids: string[]) => ids.map((id) => s.options.find((o) => o.id === id)?.text ?? '—');
      return { questionId: r.q, text: s.text, ok: Boolean(r.ok), chosen: label(sel), correct: label(s.correct) };
    });
}
