/**
 * A test started by a leader (owner, 2026-10-17; mockup 22). While it runs the app shows only the test:
 * a short start card, then one question at a time with the time left; at the end the score and the mistakes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { useLiveRefresh } from '../live';
import { navigate } from '../router';
import { Problem } from './shared';

export interface ActiveTest {
  attemptId: string;
  title: string;
  opened: boolean;
  deadlineAt: number | null;
  timeLimitSec: number;
  questions: number;
}
interface Opened {
  attemptId: string;
  deadlineAt: number;
  now: number;
  questions: { id: string; text: string; multi: boolean; options: { id: string; text: string }[] }[];
  answers: Record<string, string[]>;
}
interface Result {
  title: string;
  score: number;
  passed: boolean;
  passScore: number;
  correct: number;
  total: number;
  durationSec: number | null;
  mistakes: { text: string; chosen: string[]; correct: string[] }[];
}

const t = pl.academy.test;
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.max(0, sec % 60)).padStart(2, '0')}`;

/** Asks the server whether a test waits for this person (on start, on changes, when the app comes back). */
export function useActiveTest(enabled: boolean) {
  const [active, setActive] = useState<ActiveTest | null>(null);
  const check = useCallback(async () => {
    if (!enabled) return;
    try {
      setActive((await api<{ active: ActiveTest | null }>('/api/tests/active')).active);
    } catch {
      /* offline: keep what we know */
    }
  }, [enabled]);
  useEffect(() => {
    void check();
  }, [check]);
  useLiveRefresh(check);
  return { active, check, clear: () => setActive(null) };
}

export function TestRunner({ test, onDone }: { test: ActiveTest; onDone: () => void }) {
  const [data, setData] = useState<Opened | null>(null);
  const [skew, setSkew] = useState(0); // server time − phone time
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  const submitted = useRef(false);

  const open = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const o = await api<Opened>(`/api/tests/attempts/${test.attemptId}/open`, { method: 'POST' });
      setSkew(o.now - Date.now());
      setData(o);
      setAnswers(o.answers);
      const firstOpen = o.questions.findIndex((q) => !o.answers[q.id]?.length);
      setI(firstOpen < 0 ? 0 : firstOpen);
    } catch (e) {
      const c = e instanceof ApiFailure ? e.code : 'generic';
      // closed by the leader before it was opened: back to the app
      if (c === 'test_closed') onDone();
      else setError(errorText(c));
    } finally {
      setBusy(false);
    }
  }, [test.attemptId, onDone]);

  // a test already started on this phone continues at once
  useEffect(() => {
    if (test.opened) void open();
  }, [test.opened, open]);

  const submit = useCallback(async () => {
    if (submitted.current) return;
    submitted.current = true;
    setBusy(true);
    try {
      setResult(await api<Result>(`/api/tests/attempts/${test.attemptId}/submit`, { method: 'POST' }));
    } catch (e) {
      submitted.current = false;
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    } finally {
      setBusy(false);
    }
  }, [test.attemptId]);

  // the clock; time up → handed in with what is answered
  useEffect(() => {
    if (!data || result) return;
    const id = window.setInterval(() => {
      tick((n) => n + 1);
      if (Date.now() + skew >= data.deadlineAt) void submit();
    }, 1000);
    return () => window.clearInterval(id);
  }, [data, result, skew, submit]);

  async function choose(qid: string, oid: string, multi: boolean) {
    const cur = answers[qid] ?? [];
    const next = multi ? (cur.includes(oid) ? cur.filter((x) => x !== oid) : [...cur, oid]) : [oid];
    setAnswers({ ...answers, [qid]: next });
    try {
      await api(`/api/tests/attempts/${test.attemptId}/answers`, { method: 'PUT', body: { questionId: qid, optionIds: next } });
    } catch (e) {
      const c = e instanceof ApiFailure ? e.code : 'generic';
      if (c === 'test_time_up' || c === 'test_closed') void submit();
      else setError(errorText(c));
    }
  }

  if (result)
    return (
      <main className="a-main tr">
        <span className="a-pill">{t.result}</span>
        <div className="tr-score">{result.score}%</div>
        <b className={result.passed ? 'tr-ok' : 'tr-bad'}>{result.passed ? t.passed(result.passScore) : t.failed(result.passScore)}</b>
        <span className="a-sub">
          {t.correctOf(result.correct, result.total)}
          {result.durationSec !== null ? ` · ${mmss(result.durationSec)}` : ''}
        </span>
        {result.mistakes.length > 0 ? (
          <section className="a-card">
            <b>{t.mistakes}</b>
            {result.mistakes.map((m, k) => (
              <div key={k} className="tr-mistake">
                <div>{m.text}</div>
                <div className="tr-bad">
                  {t.yours}: {m.chosen.length ? m.chosen.join(', ') : t.none}
                </div>
                <div className="tr-ok">
                  {t.right}: {m.correct.join(', ')}
                </div>
              </div>
            ))}
          </section>
        ) : (
          <div className="a-note">{t.perfect}</div>
        )}
        <button
          className="a-btn primary center"
          onClick={() => {
            onDone();
            navigate('/', true);
          }}
        >
          {t.toStart}
        </button>
      </main>
    );

  if (!data)
    return (
      <main className="a-main tr">
        <span className="a-pill warn">{t.fromLeader}</span>
        <h1 className="a-title">{test.title}</h1>
        <p className="a-sub">{t.intro(test.questions, Math.round(test.timeLimitSec / 60))}</p>
        <div className="a-note">{t.lockNote}</div>
        <Problem message={error} />
        <button className="a-btn primary center" disabled={busy} onClick={() => void open()}>
          {test.opened ? t.continue : t.start}
        </button>
      </main>
    );

  const q = data.questions[i]!;
  const left = Math.max(0, Math.round((data.deadlineAt - (Date.now() + skew)) / 1000));
  const chosen = answers[q.id] ?? [];
  const last = i === data.questions.length - 1;
  const unanswered = data.questions.filter((x) => !(answers[x.id]?.length)).length;
  return (
    <main className="a-main tr">
      <div className="tr-top">
        <span className="a-pill">{test.title}</span>
        <b className={`tr-clock${left <= 60 ? ' low' : ''}`} aria-live="off">
          ⏱ {mmss(left)}
        </b>
      </div>
      <div className="a-progress" aria-hidden="true">
        <div style={{ width: `${Math.round(((i + 1) / data.questions.length) * 100)}%` }} />
      </div>
      <span className="a-sub">
        {t.questionOf(i + 1, data.questions.length)} · {q.multi ? t.multi : t.single}
      </span>
      <h2 className="tr-q">{q.text}</h2>
      <div className="tr-opts" role={q.multi ? 'group' : 'radiogroup'} aria-label={q.text}>
        {q.options.map((o) => {
          const on = chosen.includes(o.id);
          return (
            <button key={o.id} type="button" role={q.multi ? 'checkbox' : 'radio'} aria-checked={on} className={`tr-opt${on ? ' on' : ''}`} onClick={() => void choose(q.id, o.id, q.multi)}>
              <span className={`tr-box${q.multi ? '' : ' round'}`} aria-hidden="true" />
              <span>{o.text}</span>
            </button>
          );
        })}
      </div>
      <Problem message={error} />
      <div className="tr-nav">
        {i > 0 && (
          <button className="a-btn" onClick={() => setI(i - 1)}>
            {pl.common.back}
          </button>
        )}
        {last ? (
          <button
            className="a-btn primary center wide"
            disabled={busy}
            onClick={() => {
              if (!unanswered || window.confirm(t.confirmUnanswered(unanswered))) void submit();
            }}
          >
            {t.finish}
          </button>
        ) : (
          <button className="a-btn primary center wide" onClick={() => setI(i + 1)}>
            {t.next}
          </button>
        )}
      </div>
      <span className="a-sub tr-lock">{t.lockNote}</span>
    </main>
  );
}
