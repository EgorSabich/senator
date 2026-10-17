/**
 * Panel → Testy (owner, 2026-10-17; mockups 19–23): tests and their questions, import / export as JSON,
 * „Uruchom” for chosen people, live view and the report (per person and per question).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { divisionOf, POSITIONS } from '../../shared/constants';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { navigate, onNav } from '../router';
import { ErrorBox, LogoLoader } from '../ui';
import { Btn, Modal } from './common';
import { usePanel } from './Panel';

const t = pl.admin.tests;
const DIV = pl.admin.divisions;
const POS = pl.admin.positions;

interface TestItem {
  id: string;
  title: string;
  positions: string[];
  questions: number;
  questionCount: number | null;
  timeLimitSec: number;
  passScore: number;
  editable: boolean;
  canRun: boolean;
  last: { sessionId: string; at: number; people: number; avg: number | null } | null;
}
interface SessionItem {
  id: string;
  testId: string;
  title: string;
  startedAt: number;
  live: boolean;
  people: number;
  done: number;
  passed: number;
  avg: number | null;
}

const errText = (e: unknown) => {
  if (e instanceof ApiFailure) return errorText(e.code);
  return errorText('generic');
};
const when = (ms: number) => new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' }).format(new Date(ms));
const mmss = (sec: number | null) => (sec === null ? '—' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
const forLabel = (ps: string[]) => (ps.length ? ps.map((p) => (divisionOf(p) === p ? (DIV[p] ?? p) : (POS[p] ?? p))).join(', ') : t.everyone);

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Tests({ path }: { path: string }) {
  let m: RegExpExecArray | null;
  if ((m = /^\/panel\/testy\/wyniki\/([A-Za-z0-9_]+)$/.exec(path))) return <SessionView key={m[1]} id={m[1]!} />;
  if ((m = /^\/panel\/testy\/([A-Za-z0-9_]+)$/.exec(path)) && m[1] !== 'wyniki') return <Editor key={m[1]} id={m[1]!} />;
  return <Home tab={path.startsWith('/panel/testy/wyniki') ? 'results' : 'tests'} />;
}

/* ───────── List and results (mockup 19) ───────── */

function Home({ tab }: { tab: 'tests' | 'results' }) {
  const { locationId } = usePanel();
  const [data, setData] = useState<{ tests: TestItem[]; canEdit: boolean } | null>(null);
  const [sessions, setSessions] = useState<SessionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [starting, setStarting] = useState<TestItem | null>(null);
  const load = useCallback(() => {
    api<{ tests: TestItem[]; canEdit: boolean }>(`/api/admin/locations/${locationId}/tests`)
      .then(setData)
      .catch((e) => setError(errText(e)));
    api<{ sessions: SessionItem[] }>(`/api/admin/locations/${locationId}/test-sessions`)
      .then((r) => setSessions(r.sessions))
      .catch(() => setSessions([]));
  }, [locationId]);
  useEffect(load, [load]);

  return (
    <div className="page tst">
      <div className="tst-head">
        <h1 className="page-title">{t.title}</h1>
        {data?.canEdit && (
          <div className="btn-row">
            <Btn onClick={() => setImporting(true)}>{t.import}</Btn>
            <Btn kind="primary" onClick={() => setAdding(true)}>
              {t.add}
            </Btn>
          </div>
        )}
      </div>
      <div className="seg" role="tablist">
        <a role="tab" aria-selected={tab === 'tests'} href="/panel/testy" onClick={onNav('/panel/testy')}>
          {t.tabTests}
        </a>
        <a role="tab" aria-selected={tab === 'results'} href="/panel/testy/wyniki" onClick={onNav('/panel/testy/wyniki')}>
          {t.tabResults}
          {sessions?.some((s) => s.live) ? ` · ${t.liveNow}` : ''}
        </a>
      </div>
      <ErrorBox message={error} />
      {tab === 'tests' ? (
        !data ? (
          <LogoLoader />
        ) : !data.tests.length ? (
          <p className="muted">{t.empty}</p>
        ) : (
          <div className="tst-list">
            {data.tests.map((x) => (
              <div key={x.id} className="card tst-row">
                <a className="tst-main" href={`/panel/testy/${x.id}`} onClick={onNav(`/panel/testy/${x.id}`)}>
                  <b>{x.title}</b>
                  <span className="muted">
                    {forLabel(x.positions)} · {x.questionCount && x.questionCount < x.questions ? t.randomOf(x.questionCount, x.questions) : t.questionsN(x.questions)} · {Math.round(x.timeLimitSec / 60)} min · {t.pass(x.passScore)}
                  </span>
                  {x.last && (
                    <span className="muted tst-last">
                      {t.lastRun(when(x.last.at), x.last.people, x.last.avg)}
                    </span>
                  )}
                </a>
                {x.canRun && (
                  <Btn kind="primary" disabled={!x.questions} onClick={() => setStarting(x)}>
                    {t.run}
                  </Btn>
                )}
              </div>
            ))}
          </div>
        )
      ) : !sessions ? (
        <LogoLoader />
      ) : !sessions.length ? (
        <p className="muted">{t.noResults}</p>
      ) : (
        <div className="table-wrap st-table">
          <table>
            <thead>
              <tr>
                <th>{t.cols.test}</th>
                <th>{t.cols.when}</th>
                <th className="c">{t.cols.people}</th>
                <th className="c">{t.cols.avg}</th>
                <th className="c">{t.cols.passed}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="st-row" tabIndex={0} onClick={() => navigate(`/panel/testy/wyniki/${s.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/panel/testy/wyniki/${s.id}`)}>
                  <td data-label={t.cols.test}>
                    <b>{s.title}</b> {s.live && <span className="badge warn">{t.liveNow}</span>}
                  </td>
                  <td data-label={t.cols.when}>{when(s.startedAt)}</td>
                  <td className="c" data-label={t.cols.people}>
                    {s.done} / {s.people}
                  </td>
                  <td className="c" data-label={t.cols.avg}>
                    {s.avg === null ? '—' : `${s.avg}%`}
                  </td>
                  <td className="c" data-label={t.cols.passed}>
                    {s.passed}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <NewTest onClose={() => setAdding(false)} />}
      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false);
            load();
          }}
        />
      )}
      {starting && <StartModal test={starting} onClose={() => setStarting(null)} />}
    </div>
  );
}

function NewTest({ onClose }: { onClose: () => void }) {
  const { locationId } = usePanel();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function create() {
    try {
      const r = await api<{ id: string }>(`/api/admin/locations/${locationId}/tests`, { method: 'POST', body: { title } });
      navigate(`/panel/testy/${r.id}`);
    } catch (e) {
      setError(errText(e));
    }
  }
  return (
    <Modal title={t.add} onClose={onClose}>
      <div className="field">
        <label htmlFor="nt-name">{t.name}</label>
        <input id="nt-name" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </div>
      <ErrorBox message={error} />
      <div className="btn-row">
        <Btn kind="primary" disabled={!title.trim()} onClick={() => void create()}>
          {t.create}
        </Btn>
        <Btn onClick={onClose}>{pl.common.cancel}</Btn>
      </div>
    </Modal>
  );
}

const SAMPLE = {
  format: 'senator-tests',
  tests: [
    {
      title: 'Menu — dania główne',
      positions: ['waiter'],
      timeLimitMin: 10,
      passScore: 80,
      questionCount: 15,
      questions: [
        { text: 'Z czym podajemy stek?', options: [{ text: 'Sos pieprzowy i frytki', correct: true }, { text: 'Puree', correct: false }] },
        { text: 'Które dania są wegetariańskie?', options: [{ text: 'Risotto z grzybami', correct: true }, { text: 'Tatar', correct: false }, { text: 'Sałatka z burratą', correct: true }] },
      ],
    },
  ],
};

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { locationId } = usePanel();
  const [json, setJson] = useState<unknown>(null);
  const [preview, setPreview] = useState<{ title: string; questions: number; positions: string[] }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  async function read(f: File | undefined) {
    setError(null);
    setPreview(null);
    if (!f) return;
    try {
      const data = JSON.parse(await f.text()) as unknown;
      const r = await api<{ tests: { title: string; questions: number; positions: string[] }[] }>(`/api/admin/locations/${locationId}/tests/import`, {
        method: 'POST',
        body: { ...(data as object), dryRun: true },
      });
      setJson(data);
      setPreview(r.tests);
    } catch (e) {
      if (e instanceof SyntaxError) setError(t.importNotJson);
      else if (e instanceof ApiFailure) setError(errorText(e.code));
      else setError(errText(e));
    }
  }
  async function run() {
    setBusy(true);
    try {
      await api(`/api/admin/locations/${locationId}/tests/import`, { method: 'POST', body: json });
      onDone();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }
  return (
    <Modal title={t.importTitle} onClose={onClose}>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        {t.importHint}
      </p>
      <div className="btn-row">
        <Btn onClick={() => file.current?.click()}>{t.chooseFile}</Btn>
        <Btn onClick={() => download('wzor-testu.json', SAMPLE)}>{t.sample}</Btn>
      </div>
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void read(e.target.files?.[0])} />
      <ErrorBox message={error} />
      {preview && (
        <div className="notice" role="status">
          {preview.map((p) => (
            <div key={p.title}>
              <b>{p.title}</b> · {t.questionsN(p.questions)} · {forLabel(p.positions)}
            </div>
          ))}
        </div>
      )}
      <div className="btn-row">
        <Btn kind="primary" disabled={!preview || busy} onClick={() => void run()}>
          {t.importRun(preview?.length ?? 0)}
        </Btn>
        <Btn onClick={onClose}>{pl.common.cancel}</Btn>
      </div>
    </Modal>
  );
}

/* ───────── Editor (mockup 20) ───────── */

interface Question {
  id: string;
  text: string;
  multi: boolean;
  options: { id: string; text: string; correct: boolean }[];
}
interface TestData {
  test: { id: string; title: string; description: string | null; positions: string[]; timeLimitSec: number; passScore: number; questionCount: number | null; shuffle: boolean; shuffleOptions: boolean; questionsTotal: number };
  editable: boolean;
  divisions: string[] | null;
  questions: Question[];
}

function Editor({ id }: { id: string }) {
  const { can } = usePanel();
  const [data, setData] = useState<TestData | null>(null);
  const [form, setForm] = useState<TestData['test'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<Question | 'new' | null>(null);
  const [starting, setStarting] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await api<TestData>(`/api/admin/tests/${id}`);
      setData(r);
      setForm(r.test);
    } catch (e) {
      setError(errText(e));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!data || !form) return <div className="page">{error ? <ErrorBox message={error} /> : <LogoLoader />}</div>;
  const ro = !data.editable;
  const positionsChoice = POSITIONS.filter((p) => !data.divisions || data.divisions.includes(divisionOf(p)));

  async function save() {
    setError(null);
    try {
      await api(`/api/admin/tests/${id}`, {
        method: 'PUT',
        body: { title: form!.title, positions: form!.positions, timeLimitMin: form!.timeLimitSec / 60, passScore: form!.passScore, questionCount: form!.questionCount, shuffle: form!.shuffle, shuffleOptions: form!.shuffleOptions },
      });
      setNote(t.saved);
      await load();
    } catch (e) {
      setError(errText(e));
    }
  }
  async function remove() {
    if (!window.confirm(t.deleteConfirm(data!.test.title))) return;
    try {
      await api(`/api/admin/tests/${id}`, { method: 'DELETE' });
      navigate('/panel/testy');
    } catch (e) {
      setError(errText(e));
    }
  }
  async function move(qid: string, dir: -1 | 1) {
    const ids = data!.questions.map((q) => q.id);
    const i = ids.indexOf(qid);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    setData({ ...data!, questions: ids.map((x) => data!.questions.find((q) => q.id === x)!) });
    await api(`/api/admin/tests/${id}/order`, { method: 'PUT', body: { ids } }).catch((e) => setError(errText(e)));
  }
  async function removeQ(q: Question) {
    if (!window.confirm(t.deleteQuestion)) return;
    try {
      await api(`/api/admin/tests/questions/${q.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(errText(e));
    }
  }
  const total = data.questions.length;
  return (
    <div className="page tst">
      <a className="back-link" href="/panel/testy" onClick={onNav('/panel/testy')}>
        ‹ {t.title}
      </a>
      <div className="tst-head">
        <h1 className="page-title">{data.test.title}</h1>
        {can('training.assign') && (
          <Btn kind="primary" disabled={!total} onClick={() => setStarting(true)}>
            {t.run}
          </Btn>
        )}
      </div>
      <ErrorBox message={error} />
      {note && (
        <div className="notice" role="status">
          {note}
        </div>
      )}
      <div className="tst-two">
        <section className="card tst-settings">
          <h2 className="ntf-h">{t.settings}</h2>
          <fieldset disabled={ro} className="ntf-form">
            <div className="field">
              <label htmlFor="ts-title">{t.name}</label>
              <input id="ts-title" value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="field">
              <span className="ntf-label">{t.forWhom}</span>
              <div className="ntf-chips">
                {positionsChoice.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="chip"
                    aria-pressed={form.positions.includes(p)}
                    onClick={() => setForm({ ...form, positions: form.positions.includes(p) ? form.positions.filter((x) => x !== p) : [...form.positions, p] })}
                  >
                    {POS[p] ?? p}
                  </button>
                ))}
              </div>
              <span className="muted" style={{ fontSize: 12 }}>
                {t.forWhomHint}
              </span>
            </div>
            <div className="tst-three">
              <div className="field">
                <label htmlFor="ts-time">{t.time}</label>
                <select id="ts-time" value={form.timeLimitSec / 60} onChange={(e) => setForm({ ...form, timeLimitSec: Number(e.target.value) * 60 })}>
                  {[2, 3, 5, 8, 10, 12, 15, 20, 25, 30, 45, 60].map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="ts-pass">{t.passScore}</label>
                <select id="ts-pass" value={form.passScore} onChange={(e) => setForm({ ...form, passScore: Number(e.target.value) })}>
                  {[50, 60, 70, 75, 80, 85, 90, 95, 100].map((p) => (
                    <option key={p} value={p}>
                      {p}%
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="ts-count">{t.count}</label>
                <select id="ts-count" value={form.questionCount ?? 0} onChange={(e) => setForm({ ...form, questionCount: Number(e.target.value) || null })}>
                  <option value={0}>{t.allQuestions(total)}</option>
                  {[5, 10, 15, 20, 25, 30, 40, 50].filter((n) => n < total).map((n) => (
                    <option key={n} value={n}>
                      {t.randomOf(n, total)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={form.shuffle} onChange={(e) => setForm({ ...form, shuffle: e.target.checked })} />
              <span>{t.shuffle}</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={form.shuffleOptions} onChange={(e) => setForm({ ...form, shuffleOptions: e.target.checked })} />
              <span>{t.shuffleOptions}</span>
            </label>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              {t.afterTest}
            </p>
          </fieldset>
          <div className="btn-row">
            {!ro && (
              <Btn kind="primary" onClick={() => void save()} disabled={!form.title.trim()}>
                {pl.common.save}
              </Btn>
            )}
            <Btn onClick={() => void api(`/api/admin/tests/${id}/export`).then((d) => download(`test-${data.test.title.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.json`, d))}>{t.export}</Btn>
            {!ro && (
              <Btn kind="danger" onClick={() => void remove()}>
                {t.delete}
              </Btn>
            )}
          </div>
        </section>
        <section className="card tst-questions">
          <div className="tst-head">
            <h2 className="ntf-h">{t.questionsTitle(total)}</h2>
            {!ro && <Btn onClick={() => setEditing('new')}>{t.addQuestion}</Btn>}
          </div>
          {!total && <p className="muted">{t.noQuestions}</p>}
          {data.questions.map((q, i) => (
            <div key={q.id} className="tst-q">
              <b className="tst-qn">{i + 1}</b>
              <button type="button" className="tst-qmain" onClick={() => !ro && setEditing(q)} disabled={ro}>
                <b>{q.text}</b>
                <span className="muted">
                  {q.multi ? t.multi : t.single} · ✓ {q.options.filter((o) => o.correct).map((o) => o.text).join(', ')}
                </span>
              </button>
              {!ro && (
                <span className="tst-qtools">
                  <button type="button" aria-label={t.up} disabled={i === 0} onClick={() => void move(q.id, -1)}>
                    ↑
                  </button>
                  <button type="button" aria-label={t.down} disabled={i === total - 1} onClick={() => void move(q.id, 1)}>
                    ↓
                  </button>
                  <button type="button" aria-label={t.deleteQuestion} onClick={() => void removeQ(q)}>
                    ×
                  </button>
                </span>
              )}
            </div>
          ))}
        </section>
      </div>
      {editing && (
        <QuestionModal
          testId={id}
          q={editing === 'new' ? null : editing}
          n={editing === 'new' ? total + 1 : data.questions.indexOf(editing) + 1}
          onClose={() => setEditing(null)}
          onSaved={async (another) => {
            if (!another) setEditing(null);
            await load();
          }}
        />
      )}
      {starting && (
        <StartModal
          test={{ id, title: data.test.title, positions: data.test.positions, questions: total, questionCount: data.test.questionCount, timeLimitSec: data.test.timeLimitSec, passScore: data.test.passScore, editable: true, canRun: true, last: null }}
          onClose={() => setStarting(false)}
        />
      )}
    </div>
  );
}

function QuestionModal({ testId, q, n, onClose, onSaved }: { testId: string; q: Question | null; n: number; onClose: () => void; onSaved: (another: boolean) => Promise<void> }) {
  const blank = () => [
    { text: '', correct: true },
    { text: '', correct: false },
    { text: '', correct: false },
  ];
  const [text, setText] = useState(q?.text ?? '');
  const [multi, setMulti] = useState(q?.multi ?? false);
  const [opts, setOpts] = useState(q ? q.options.map((o) => ({ text: o.text, correct: o.correct })) : blank());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  function setCorrect(i: number) {
    setOpts(opts.map((o, k) => (multi ? (k === i ? { ...o, correct: !o.correct } : o) : { ...o, correct: k === i })));
  }
  async function save(another: boolean) {
    setBusy(true);
    setError(null);
    const body = { text, multi, options: opts.filter((o) => o.text.trim()) };
    try {
      if (q) await api(`/api/admin/tests/questions/${q.id}`, { method: 'PUT', body });
      else await api(`/api/admin/tests/${testId}/questions`, { method: 'POST', body });
      if (another) {
        setText('');
        setOpts(blank());
      }
      await onSaved(another);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t.questionN(n)} onClose={onClose}>
      <div className="field">
        <label htmlFor="tq-text">{t.questionText}</label>
        <textarea id="tq-text" rows={2} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} autoFocus />
      </div>
      <div className="ntf-chips">
        <button
          type="button"
          className="chip"
          aria-pressed={!multi}
          onClick={() => {
            setMulti(false);
            const first = opts.findIndex((o) => o.correct);
            setOpts(opts.map((o, k) => ({ ...o, correct: k === (first < 0 ? 0 : first) })));
          }}
        >
          {t.single}
        </button>
        <button type="button" className="chip" aria-pressed={multi} onClick={() => setMulti(true)}>
          {t.multi}
        </button>
      </div>
      <div className="tst-opts">
        {opts.map((o, i) => (
          <div key={i} className={`tst-opt${o.correct ? ' on' : ''}`}>
            <button type="button" className={`tr-box${multi ? '' : ' round'}`} aria-pressed={o.correct} aria-label={t.markCorrect} onClick={() => setCorrect(i)} />
            <input value={o.text} maxLength={300} placeholder={t.answerN(i + 1)} aria-label={t.answerN(i + 1)} onChange={(e) => setOpts(opts.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} />
            {o.correct && <span className="muted tst-right">{t.correct}</span>}
            {opts.length > 2 && (
              <button type="button" className="link-btn" aria-label={t.removeAnswer} onClick={() => setOpts(opts.filter((_, k) => k !== i))}>
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      {opts.length < 10 && (
        <div>
          <Btn onClick={() => setOpts([...opts, { text: '', correct: false }])}>{t.addAnswer}</Btn>
        </div>
      )}
      <ErrorBox message={error} />
      <div className="btn-row">
        <Btn kind="primary" disabled={busy || !text.trim()} onClick={() => void save(false)}>
          {t.saveQuestion}
        </Btn>
        {!q && (
          <Btn disabled={busy || !text.trim()} onClick={() => void save(true)}>
            {t.saveAndNext}
          </Btn>
        )}
        <Btn onClick={onClose}>{pl.common.cancel}</Btn>
      </div>
    </Modal>
  );
}

/* ───────── Start (mockup 21, left) ───────── */

interface Candidate {
  id: string;
  name: string;
  positions: string[];
  onShift: boolean;
  matches: boolean;
}

function StartModal({ test, onClose }: { test: TestItem; onClose: () => void }) {
  const [people, setPeople] = useState<Candidate[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [minutes, setMinutes] = useState(Math.round(test.timeLimitSec / 60));
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ people: Candidate[] }>(`/api/admin/tests/${test.id}/candidates`)
      .then((r) => {
        setPeople(r.people);
        // on shift now and for this test: chosen from the start
        setChosen(r.people.filter((p) => p.onShift && p.matches).map((p) => p.id));
      })
      .catch((e) => setError(errText(e)));
  }, [test.id]);
  const list = useMemo(() => (people ?? []).filter((p) => showAll || p.onShift || p.matches).sort((a, b) => Number(b.onShift) - Number(a.onShift) || a.name.localeCompare(b.name, 'pl')), [people, showAll]);
  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ sessionId: string }>(`/api/admin/tests/${test.id}/sessions`, { method: 'POST', body: { userIds: chosen, timeLimitMin: minutes } });
      navigate(`/panel/testy/wyniki/${r.sessionId}`);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }
  return (
    <Modal title={t.runTitle(test.title)} onClose={onClose}>
      {!people ? (
        <LogoLoader />
      ) : (
        <>
          <span className="ntf-label">{t.who}</span>
          <div className="ntf-chips">
            {list.map((p) => (
              <button key={p.id} type="button" className="chip" aria-pressed={chosen.includes(p.id)} onClick={() => setChosen(chosen.includes(p.id) ? chosen.filter((x) => x !== p.id) : [...chosen, p.id])}>
                {p.name}
                {p.onShift && <span className="chip-extra">{t.onShift}</span>}
              </button>
            ))}
          </div>
          {!list.length && <p className="muted">{t.nobody}</p>}
          <div className="btn-row">
            {!showAll && people.length > list.length && <Btn onClick={() => setShowAll(true)}>{t.showAll(people.length - list.length)}</Btn>}
            {list.length > 0 && <Btn onClick={() => setChosen(chosen.length === list.length ? [] : list.map((p) => p.id))}>{chosen.length === list.length ? t.none : t.all}</Btn>}
          </div>
          <div className="field">
            <label htmlFor="ts-run-time">{t.time}</label>
            <select id="ts-run-time" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {[...new Set([2, 3, 5, 8, 10, 12, 15, 20, 25, 30, 45, 60, Math.round(test.timeLimitSec / 60)])]
                .sort((a, b) => a - b)
                .map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
            </select>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {t.runHint}
          </p>
        </>
      )}
      <ErrorBox message={error} />
      <div className="btn-row">
        <Btn kind="primary" disabled={busy || !chosen.length} onClick={() => void start()}>
          {t.runFor(chosen.length)}
        </Btn>
        <Btn onClick={onClose}>{pl.common.cancel}</Btn>
      </div>
    </Modal>
  );
}

/* ───────── Live view and report (mockups 21 right, 23) ───────── */

interface SessionData {
  session: { id: string; testId: string; title: string; passScore: number; startedAt: number; timeLimitSec: number; live: boolean; finishedAt: number | null };
  now: number;
  totals: { people: number; done: number; abandoned: number; avgScore: number | null; passed: number; avgSec: number | null; hardest: { text: string; okPct: number } | null };
  people: {
    attemptId: string;
    userId: string;
    name: string;
    status: string;
    answered: number;
    total: number;
    score: number | null;
    passed: boolean | null;
    durationSec: number | null;
    timeUp: boolean;
    answers: { questionId: string; text: string; ok: boolean; chosen: string[]; correct: string[] }[];
  }[];
  questions: { text: string; answers: number; okPct: number; topWrong: string | null }[];
}

function SessionView({ id }: { id: string }) {
  const [data, setData] = useState<SessionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<SessionData>(`/api/admin/test-sessions/${id}`));
    } catch (e) {
      setError(errText(e));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  // live: every few seconds while the test runs
  useEffect(() => {
    if (!data?.session.live) return;
    const i = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(i);
  }, [data?.session.live, load]);
  if (!data) return <div className="page">{error ? <ErrorBox message={error} /> : <LogoLoader />}</div>;
  const s = data.session;
  const k = data.totals;
  const left = s.live ? Math.max(0, Math.round((s.startedAt + s.timeLimitSec * 1000 - data.now) / 1000)) : 0;
  async function finish() {
    if (!window.confirm(t.finishConfirm)) return;
    await api(`/api/admin/test-sessions/${id}/finish`, { method: 'POST' }).catch((e) => setError(errText(e)));
    await load();
  }
  function csv() {
    const rows: (string | number)[][] = [[t.cols.person, t.cols.status, t.cols.score, t.cols.time, ...data!.questions.map((q) => q.text)]];
    for (const p of data!.people)
      rows.push([
        p.name,
        t.status[p.status] ?? p.status,
        p.score === null ? '' : `${p.score}%`,
        mmss(p.durationSec),
        ...data!.questions.map((q) => {
          const a = p.answers.find((x) => x.text === q.text);
          return a ? `${a.ok ? '✓' : '✗'} ${a.chosen.join(', ')}` : '';
        }),
      ]);
    const text = rows.map((r) => r.map((v) => (/[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `test_${new Date(s.startedAt).toISOString().slice(0, 10)}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="page tst">
      <a className="back-link" href="/panel/testy/wyniki" onClick={onNav('/panel/testy/wyniki')}>
        ‹ {t.tabResults}
      </a>
      <div className="tst-head">
        <h1 className="page-title">
          {s.title} · {when(s.startedAt)}
        </h1>
        <div className="btn-row">
          {s.live && (
            <>
              <span className="badge warn">{t.left(mmss(left))}</span>
              <Btn onClick={() => void finish()}>{t.finishAll}</Btn>
            </>
          )}
          <Btn onClick={csv}>{pl.admin.stats.csv}</Btn>
        </div>
      </div>
      <ErrorBox message={error} />
      <div className="st-kpis">
        <div className="st-kpi">
          <span className="muted">{t.kpi.people}</span>
          <b>{k.people}</b>
          <span className="st-sub">{t.kpi.peopleSub(k.done, k.abandoned)}</span>
        </div>
        <div className="st-kpi">
          <span className="muted">{t.kpi.avg}</span>
          <b>{k.avgScore === null ? '—' : `${k.avgScore}%`}</b>
          <span className="st-sub">{t.pass(s.passScore)}</span>
        </div>
        <div className="st-kpi">
          <span className="muted">{t.kpi.passed}</span>
          <b>
            {k.passed} / {k.done}
          </b>
        </div>
        <div className="st-kpi">
          <span className="muted">{t.kpi.hardest}</span>
          <b className="tst-hard">{k.hardest ? k.hardest.text : '—'}</b>
          {k.hardest && <span className="st-sub bad">{t.okPct(k.hardest.okPct)}</span>}
        </div>
        <div className="st-kpi">
          <span className="muted">{t.kpi.avgTime}</span>
          <b>{mmss(k.avgSec)}</b>
          <span className="st-sub">{t.of(mmss(s.timeLimitSec))}</span>
        </div>
      </div>
      <section className="card">
        <h2 className="ntf-h">{t.peopleTitle}</h2>
        <div className="tst-people">
          {data.people.map((p) => (
            <div key={p.attemptId} className="tst-person">
              <button type="button" className="tst-prow" aria-expanded={openPerson === p.attemptId} onClick={() => setOpenPerson(openPerson === p.attemptId ? null : p.attemptId)} disabled={p.status !== 'submitted'}>
                <b>{p.name}</b>
                <span className="tst-pstate">
                  {p.status === 'submitted' ? (
                    <>
                      <span className={p.passed ? 'tr-ok' : 'tr-bad'}>
                        {p.score}% {p.passed ? '✓' : '✗'}
                      </span>
                      <span className="muted">
                        {mmss(p.durationSec)}
                        {p.timeUp ? ` · ${t.timeUp}` : ''}
                      </span>
                    </>
                  ) : p.status === 'in_progress' ? (
                    <span className="tst-progress">
                      <span className="a-progress-mini">
                        <i style={{ width: `${p.total ? Math.round((p.answered / p.total) * 100) : 0}%` }} />
                      </span>
                      <span className="muted">
                        {p.answered} / {p.total}
                      </span>
                    </span>
                  ) : (
                    <span className="muted">{t.status[p.status]}</span>
                  )}
                </span>
              </button>
              {openPerson === p.attemptId && (
                <ol className="tst-answers">
                  {p.answers.map((a) => (
                    <li key={a.questionId}>
                      <span>{a.text}</span>
                      {a.ok ? (
                        <span className="tr-ok">✓ {a.chosen.join(', ')}</span>
                      ) : (
                        <span>
                          <span className="tr-bad">✗ {a.chosen.length ? a.chosen.join(', ') : t.noAnswer}</span>
                          <span className="tr-ok"> → {a.correct.join(', ')}</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      </section>
      {data.questions.length > 0 && (
        <div className="table-wrap st-table">
          <table>
            <thead>
              <tr>
                <th>{t.cols.question}</th>
                <th className="c">{t.cols.okPct}</th>
                <th>{t.cols.topWrong}</th>
              </tr>
            </thead>
            <tbody>
              {data.questions.map((q) => (
                <tr key={q.text}>
                  <td data-label={t.cols.question}>{q.text}</td>
                  <td className="c" data-label={t.cols.okPct}>
                    <span className={q.okPct < 50 ? 'tr-bad' : q.okPct === 100 ? 'tr-ok' : undefined}>{q.okPct}%</span>
                  </td>
                  <td data-label={t.cols.topWrong}>{q.topWrong ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
