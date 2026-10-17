/**
 * Rekrutacja (owner, 2026-10-17; mockups 7 table, 8 card, 9 calendar).
 * /panel/rekrutacja — table; /panel/rekrutacja/kalendarz — month; /panel/rekrutacja/<id> — the candidate's card.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveRefresh } from '../live';
import { divisionOf, POSITIONS } from '../../shared/constants';
import { ACTIVE_STAGES, formatPhone, INTERVIEW_MINUTES, REJECT_REASONS, SOURCES, STAGES, TRIAL_MINUTES, WARN_DAYS } from '../../shared/recruitment';
import { addDays } from '../../shared/time';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { navigate, onNav } from '../router';
import { Chevron, ErrorBox, LogoLoader } from '../ui';
import { Btn, Icon, Modal, SecretCardModal, storageGet, storageSet, type SecretInfo } from './common';
import { usePanel } from './Panel';
import { DateField } from '../DateField';
import { RateInput } from './Employees';

const t = pl.admin.recruitment;
const DAY = 86400_000;

export interface Candidate {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  position: string;
  division: string;
  stage: string;
  interviewAt: number | null;
  trialAt: number | null;
  cv: { name: string; type: string } | null;
  hiredUserId: string | null;
  source: string | null;
  rejectReason: string | null;
  noShowInterview: boolean;
  noShowTrial: boolean;
  comments: number;
  createdAt: number;
  updatedAt: number;
  deleteAt: number;
}
interface Comment {
  id: string;
  authorId: string | null;
  authorName: string;
  body: string;
  createdAt: number;
}

/* ───────── Dates (Warsaw) ───────── */

const parts = (ms: number) => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};
const DOW = ['nd', 'pn', 'wt', 'śr', 'czw', 'pt', 'sob'];
const dowOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
/** „pt 23.10 · 14:00” */
export function formatWhen(ms: number) {
  const { date, time } = parts(ms);
  return `${DOW[dowOf(date)]} ${date.slice(8, 10)}.${date.slice(5, 7)} · ${time}`;
}
const shortDate = (ms: number) => {
  const { date } = parts(ms);
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`;
};
const longDate = (ms: number) => {
  const { date } = parts(ms);
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
};
const toInput = (ms: number | null) => (ms ? `${parts(ms).date}T${parts(ms).time}` : '');
const todayWarsaw = () => parts(Date.now()).date;

function nextTerm(c: Candidate, now = Date.now()) {
  const list = [c.interviewAt, c.trialAt].filter((x): x is number => Boolean(x) && x! >= now - 2 * 3600_000).sort((a, b) => a - b);
  return list[0] ?? null;
}

const stageClass: Record<string, string> = { new: 'neutral', interview: 'warn', trial: 'ok', hired: 'ok', reserve: 'neutral', rejected: 'bad' };
const posLabel = (p: string) => pl.admin.positions[p] ?? p;

/** Google Calendar „add event” page, filled in */
function googleLink(kind: 'interview' | 'trial', c: Candidate) {
  const at = kind === 'interview' ? c.interviewAt : c.trialAt;
  if (!at) return null;
  const end = at + (kind === 'interview' ? INTERVIEW_MINUTES : TRIAL_MINUTES) * 60000;
  const z = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${kind === 'interview' ? t.interview : t.trial} · ${c.name} (${posLabel(c.position)})`,
    dates: `${z(at)}/${z(end)}`,
    details: `${location.origin}/panel/rekrutacja/${c.id}`,
    ctz: 'Europe/Warsaw',
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

/* ───────── Router ───────── */

export function Recruitment({ path }: { path: string }) {
  if (path === '/panel/rekrutacja/kalendarz') return <CalendarView />;
  const m = /^\/panel\/rekrutacja\/([A-Za-z0-9_]+)$/.exec(path);
  if (m) return <CandidateCard key={m[1]} id={m[1]!} />;
  return <ListView />;
}

function useCandidates() {
  const { locationId } = usePanel();
  const [data, setData] = useState<{ candidates: Candidate[]; divisions: string[] | null; canHire: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<{ candidates: Candidate[]; divisions: string[] | null; canHire: boolean }>(`/api/admin/locations/${locationId}/candidates`)
      .then(setData)
      .catch((e) => setError(errorText(e instanceof ApiFailure ? e.code : 'generic')));
  }, [locationId]);
  useEffect(load, [load]);
  useLiveRefresh(load);
  return { data, error, load };
}

function Header({ view, onAdd }: { view: 'list' | 'calendar'; onAdd: () => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <h1 className="page-title">{t.title}</h1>
      <div className="btn-row">
        {view === 'list' ? (
          <a className="btn-link-secondary" href="/panel/rekrutacja/kalendarz" onClick={onNav('/panel/rekrutacja/kalendarz')}>
            {t.calendar}
          </a>
        ) : (
          <a className="btn-link-secondary" href="/panel/rekrutacja" onClick={onNav('/panel/rekrutacja')}>
            {t.list}
          </a>
        )}
        <Btn kind="primary" onClick={onAdd}>
          {t.add}
        </Btn>
      </div>
    </div>
  );
}

/* ───────── Table (mockup 7) ───────── */

const STAGE_KEY = 'sa-rec-stage';
const DIV_KEY = 'sa-rec-div';

function ListView() {
  const { data, error, load } = useCandidates();
  const [stage, setStage] = useState(() => storageGet(STAGE_KEY) ?? 'active');
  const [division, setDivision] = useState(() => storageGet(DIV_KEY) ?? 'all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'name' | 'next' | 'added'>('added');
  const [adding, setAdding] = useState(false);
  const now = Date.now();

  const all = data?.candidates ?? [];
  const divisions = useMemo(() => {
    const present = new Set(all.map((c) => c.division));
    return Object.keys(pl.admin.divisions).filter((d) => present.has(d));
  }, [all]);
  const byDivision = all.filter((c) => division === 'all' || c.division === division);
  const count = (s: string) => byDivision.filter((c) => (s === 'active' ? ACTIVE_STAGES.includes(c.stage as never) : c.stage === s)).length;
  const needle = q.trim().toLowerCase().replace(/\s+/g, ' ');
  const digits = needle.replace(/\D/g, '');
  const shown = byDivision
    .filter((c) => (stage === 'active' ? ACTIVE_STAGES.includes(c.stage as never) : c.stage === stage))
    .filter((c) => !needle || c.name.toLowerCase().includes(needle) || (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits)))
    .sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'pl');
      if (sort === 'next') return (nextTerm(a, now) ?? Infinity) - (nextTerm(b, now) ?? Infinity);
      return b.createdAt - a.createdAt;
    });
  const soon = all.filter((c) => c.deleteAt - now < WARN_DAYS * DAY);

  async function changeStage(c: Candidate, s: string) {
    await api(`/api/admin/candidates/${c.id}`, { method: 'PUT', body: { stage: s } }).catch(() => undefined);
    load();
  }

  return (
    <div className="page">
      <Header view="list" onAdd={() => setAdding(true)} />
      <ErrorBox message={error} />
      {!data && !error && <LogoLoader />}
      {data && (
        <>
          <div className="btn-row rec-chips">
            {['active', ...STAGES].map((s) => (
              <button
                key={s}
                className="chip"
                aria-pressed={stage === s}
                onClick={() => {
                  setStage(s);
                  storageSet(STAGE_KEY, s);
                }}
              >
                {s === 'active' ? t.active : t.stages[s]} · {count(s)}
              </button>
            ))}
          </div>
          <div className="btn-row rec-chips" style={{ alignItems: 'center' }}>
            {divisions.length > 1 && (
              <>
                {['all', ...divisions].map((d) => (
                  <button
                    key={d}
                    className="chip"
                    aria-pressed={division === d}
                    onClick={() => {
                      setDivision(d);
                      storageSet(DIV_KEY, d);
                    }}
                  >
                    {d === 'all' ? t.allDivisions : pl.admin.divisions[d] ?? d}
                  </button>
                ))}
              </>
            )}
            <label className="search-box rec-search">
              <Icon name="search" size={18} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} />
            </label>
          </div>
          {soon.length > 0 && <div className="notice warn-notice">{t.rodoSoon(soon.length)}</div>}
          {!all.length && <p className="muted">{t.empty}</p>}
          {all.length > 0 && !shown.length && <p className="muted">{t.emptyFilter}</p>}
          {shown.length > 0 && (
            <div className="table-wrap rec-table">
              <table>
                <thead>
                  <tr>
                    <th>
                      <button className="th-sort" onClick={() => setSort('name')} aria-pressed={sort === 'name'}>
                        {t.cols.name}
                        {sort === 'name' && <Chevron size={12} />}
                      </button>
                    </th>
                    <th>{t.cols.position}</th>
                    <th>{t.cols.phone}</th>
                    <th>{t.cols.stage}</th>
                    <th>
                      <button className="th-sort" onClick={() => setSort('next')} aria-pressed={sort === 'next'}>
                        {t.cols.next}
                        {sort === 'next' && <Chevron size={12} />}
                      </button>
                    </th>
                    <th className="c">{t.cols.cv}</th>
                    <th className="c">{t.cols.comments}</th>
                    <th>
                      <button className="th-sort" onClick={() => setSort('added')} aria-pressed={sort === 'added'}>
                        {t.cols.added}
                        {sort === 'added' && <Chevron size={12} />}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => {
                    const next = nextTerm(c, now);
                    return (
                      <tr key={c.id} className="rec-row" onClick={() => navigate(`/panel/rekrutacja/${c.id}`)}>
                        <td className="rec-name">
                          <a href={`/panel/rekrutacja/${c.id}`} onClick={(e) => (e.stopPropagation(), onNav(`/panel/rekrutacja/${c.id}`)(e))}>
                            {c.name}
                          </a>
                          {c.deleteAt - now < WARN_DAYS * DAY && <span className="rec-rodo">{t.deletesOn(shortDate(c.deleteAt))}</span>}
                        </td>
                        <td data-label={t.cols.position}>{posLabel(c.position)}</td>
                        <td data-label={t.cols.phone} className="rec-phone">
                          {c.phone ? formatPhone(c.phone) : '—'}
                        </td>
                        <td data-label={t.cols.stage} onClick={(e) => e.stopPropagation()}>
                          <label className={`rec-stage badge ${stageClass[c.stage]}`}>
                            <select value={c.stage} onChange={(e) => void changeStage(c, e.target.value)} aria-label={`${t.cols.stage}: ${c.name}`}>
                              {STAGES.map((s) => (
                                <option key={s} value={s}>
                                  {t.stages[s]}
                                </option>
                              ))}
                            </select>
                            {t.stages[c.stage]} <Chevron size={12} />
                          </label>
                        </td>
                        <td data-label={t.cols.next}>
                          {c.stage === 'hired' && !c.hiredUserId && data.canHire ? (
                            <a className="rec-hire" href={`/panel/rekrutacja/${c.id}`} onClick={(e) => (e.stopPropagation(), onNav(`/panel/rekrutacja/${c.id}`)(e))}>
                              {t.createAccount} →
                            </a>
                          ) : c.hiredUserId ? (
                            <span className="muted">{t.accountMade}</span>
                          ) : next ? (
                            formatWhen(next)
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="c" data-label={t.cols.cv}>
                          {c.cv ? <span className="rec-dot" aria-label="CV" /> : '—'}
                        </td>
                        <td className="c" data-label={t.cols.comments}>
                          {c.comments}
                        </td>
                        <td className="muted" data-label={t.cols.added}>
                          {shortDate(c.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {adding && data && <NewCandidate allowed={data.divisions} onClose={() => setAdding(false)} />}
    </div>
  );
}

/* ───────── New candidate ───────── */

function positionsFor(allowed: string[] | null) {
  return POSITIONS.filter((p) => !allowed || allowed.includes(divisionOf(p)));
}

function PhoneInput({ id, value, onChange, onBlur }: { id: string; value: string; onChange: (v: string) => void; onBlur?: () => void }) {
  return <input id={id} onBlur={onBlur} type="tel" inputMode="tel" autoComplete="off" value={value} onChange={(e) => onChange(formatPhone(e.target.value))} placeholder="+48 600 000 000" />;
}

function SourceSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t.sourceNone}</option>
      {SOURCES.map((x) => (
        <option key={x} value={x}>
          {t.sources[x]}
        </option>
      ))}
    </select>
  );
}

function NewCandidate({ allowed, onClose }: { allowed: string[] | null; onClose: () => void }) {
  const { locationId } = usePanel();
  const options = positionsFor(allowed);
  const [f, setF] = useState({ name: '', phone: '', email: '', position: options.length === 1 ? options[0]! : '', interviewAt: '', source: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ candidate: Candidate }>(`/api/admin/locations/${locationId}/candidates`, {
        method: 'POST',
        body: { name: f.name, phone: f.phone || null, email: f.email || null, position: f.position, interviewAt: f.interviewAt || null, source: f.source || null },
      });
      navigate(`/panel/rekrutacja/${r.candidate.id}`);
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
      setBusy(false);
    }
  }
  return (
    <Modal title={t.newTitle} onClose={onClose}>
      <div className="field">
        <label htmlFor="rc-name">{t.name}</label>
        <input id="rc-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="rc-phone">{t.phone}</label>
        <PhoneInput id="rc-phone" value={f.phone} onChange={(phone) => setF({ ...f, phone })} />
        <span className="muted" style={{ fontSize: 12 }}>
          {t.phoneHint}
        </span>
      </div>
      <div className="field">
        <label htmlFor="rc-email">{t.email}</label>
        <input id="rc-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="rc-pos">{t.position}</label>
        <select id="rc-pos" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })}>
          <option value="">—</option>
          {options.map((p) => (
            <option key={p} value={p}>
              {posLabel(p)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="rc-src">{t.source}</label>
        <SourceSelect id="rc-src" value={f.source} onChange={(source) => setF({ ...f, source })} />
      </div>
      <div className="field">
        <label htmlFor="rc-int">{t.interview}</label>
        <DateField id="rc-int" withTime clearable value={f.interviewAt} onChange={(v) => setF({ ...f, interviewAt: v })} min={todayWarsaw()} />
      </div>
      <ErrorBox message={error} />
      <div className="btn-row">
        <Btn kind="primary" onClick={() => void save()} disabled={busy || !f.name.trim() || !f.position}>
          {t.create}
        </Btn>
        <Btn onClick={onClose}>{pl.common.cancel}</Btn>
      </div>
    </Modal>
  );
}

/* ───────── Candidate card (mockup 8) ───────── */

function CandidateCard({ id }: { id: string }) {
  const { me } = usePanel();
  const [c, setC] = useState<Candidate | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [canHire, setCanHire] = useState(false);
  const [canRate, setCanRate] = useState(false);
  const [allowed, setAllowed] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', position: '', interviewAt: '', trialAt: '' });
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [hiring, setHiring] = useState(false);
  const [secret, setSecret] = useState<SecretInfo | null>(null);
  const { locationId } = usePanel();

  const fill = (x: Candidate) => {
    setC(x);
    setForm({ name: x.name, phone: x.phone ? formatPhone(x.phone) : '', email: x.email ?? '', position: x.position, interviewAt: toInput(x.interviewAt), trialAt: toInput(x.trialAt) });
  };
  useEffect(() => {
    api<{ candidate: Candidate; comments: Comment[] }>(`/api/admin/candidates/${id}`)
      .then((r) => {
        fill(r.candidate);
        setComments(r.comments);
      })
      .catch((e) => setError(errorText(e instanceof ApiFailure ? e.code : 'generic')));
    api<{ divisions: string[] | null; canHire: boolean; canRate?: boolean }>(`/api/admin/locations/${locationId}/candidates`)
      .then((r) => {
        setCanHire(r.canHire);
        setCanRate(Boolean(r.canRate));
        setAllowed(r.divisions);
      })
      .catch(() => undefined);
  }, [id, locationId]);

  async function put(body: Record<string, unknown>, quiet = false) {
    setError(null);
    try {
      const r = await api<{ candidate: Candidate }>(`/api/admin/candidates/${id}`, { method: 'PUT', body });
      fill(r.candidate);
      if (!quiet) setNote(t.saved);
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }
  // fields save when you leave them (no separate „Zapisz”)
  const saveField = (k: keyof typeof form) => {
    if (!c) return;
    const now = { name: c.name, phone: c.phone ? formatPhone(c.phone) : '', email: c.email ?? '', position: c.position, interviewAt: toInput(c.interviewAt), trialAt: toInput(c.trialAt) };
    if (form[k] === now[k]) return;
    if (k === 'name' && !form.name.trim()) return setForm({ ...form, name: c.name });
    void put({ [k]: form[k] === '' ? null : form[k] });
  };

  async function addComment() {
    if (!comment.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ comment: Comment }>(`/api/admin/candidates/${id}/comments`, { method: 'POST', body: { body: comment } });
      setComments([...comments, r.comment]);
      setComment('');
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    } finally {
      setBusy(false);
    }
  }
  async function removeComment(k: Comment) {
    await api(`/api/admin/candidates/${id}/comments/${k.id}`, { method: 'DELETE' }).catch(() => undefined);
    setComments(comments.filter((x) => x.id !== k.id));
  }
  async function keep() {
    const r = await api<{ deleteAt: number }>(`/api/admin/candidates/${id}/keep`, { method: 'POST' });
    if (c) setC({ ...c, deleteAt: r.deleteAt });
    setNote(t.kept(longDate(r.deleteAt)));
  }
  async function remove() {
    if (!c || !window.confirm(t.removeConfirm(c.name))) return;
    await api(`/api/admin/candidates/${id}`, { method: 'DELETE' });
    navigate('/panel/rekrutacja');
  }

  if (error && !c) return <div className="page"><ErrorBox message={error} /></div>;
  if (!c) return <div className="page"><LogoLoader /></div>;
  const options = positionsFor(allowed);
  const soon = c.deleteAt - Date.now() < WARN_DAYS * DAY;
  const gi = googleLink('interview', c);
  const gt = googleLink('trial', c);
  return (
    <div className="page">
      <a className="back-link" href="/panel/rekrutacja" onClick={onNav('/panel/rekrutacja')}>
        ‹ {t.back}
      </a>
      <div className="rec-card">
        <section className="rec-pane">
          <div className="rec-head">
            <h1 className="page-title" style={{ margin: 0 }}>
              {c.name}
            </h1>
            <span className={`badge ${stageClass[c.stage]}`}>{t.stages[c.stage]}</span>
          </div>
          <div className="field">
            <label htmlFor="cd-name">{t.name}</label>
            <input id="cd-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onBlur={() => saveField('name')} />
          </div>
          <div className="field">
            <label htmlFor="cd-phone">{t.phone}</label>
            <PhoneInput id="cd-phone" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} onBlur={() => saveField('phone')} />
            <span className="muted" style={{ fontSize: 12 }}>
              {t.phoneHint}
            </span>
          </div>
          <div className="field">
            <label htmlFor="cd-email">{t.email}</label>
            <input id="cd-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} onBlur={() => saveField('email')} />
          </div>
          <div className="field">
            <label htmlFor="cd-pos">{t.position}</label>
            <select
              id="cd-pos"
              value={form.position}
              onChange={(e) => {
                setForm({ ...form, position: e.target.value });
                void put({ position: e.target.value });
              }}
            >
              {options.map((p) => (
                <option key={p} value={p}>
                  {posLabel(p)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cd-src">{t.source}</label>
            <SourceSelect id="cd-src" value={c.source ?? ''} onChange={(v) => void put({ source: v || null })} />
          </div>
          <div className="rec-dates">
            <div className="field">
              <label htmlFor="cd-int">{t.interview}</label>
              <DateField id="cd-int" withTime clearable value={form.interviewAt} onChange={(v) => { setForm({ ...form, interviewAt: v }); void put({ interviewAt: v || null }); }} />
            </div>
            <div className="field">
              <label htmlFor="cd-trial">{t.trial}</label>
              <DateField id="cd-trial" withTime clearable value={form.trialAt} onChange={(v) => { setForm({ ...form, trialAt: v }); void put({ trialAt: v || null }); }} />
            </div>
          </div>
          {(c.interviewAt !== null || c.trialAt !== null || c.noShowInterview || c.noShowTrial) && (
            <div className="rec-two">
              {(c.interviewAt !== null || c.noShowInterview) && (
                <label className="check">
                  <input type="checkbox" checked={c.noShowInterview} onChange={(e) => void put({ noShowInterview: e.target.checked })} />
                  <span>{t.noShowInterview}</span>
                </label>
              )}
              {(c.trialAt !== null || c.noShowTrial) && (
                <label className="check">
                  <input type="checkbox" checked={c.noShowTrial} onChange={(e) => void put({ noShowTrial: e.target.checked })} />
                  <span>{t.noShowTrial}</span>
                </label>
              )}
            </div>
          )}
          {(gi || gt) && (
            <div className="btn-row">
              {gi && (
                <a className="btn-link-secondary" href={gi} target="_blank" rel="noopener noreferrer">
                  {t.googleInterview}
                </a>
              )}
              {gt && (
                <a className="btn-link-secondary" href={gt} target="_blank" rel="noopener noreferrer">
                  {t.googleTrial}
                </a>
              )}
            </div>
          )}
          <span className="label">{t.stage}</span>
          <div className="btn-row">
            {STAGES.map((s) => (
              <button key={s} className="chip" aria-pressed={c.stage === s} onClick={() => c.stage !== s && void put({ stage: s }, true)}>
                {t.stages[s]}
              </button>
            ))}
          </div>
          {c.stage === 'rejected' && (
            <div className="field">
              <label htmlFor="cd-reason">{t.rejectReason}</label>
              <select id="cd-reason" value={c.rejectReason ?? ''} onChange={(e) => void put({ rejectReason: e.target.value || null })}>
                <option value="">{t.rejectNone}</option>
                {REJECT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t.rejectReasons[r]}
                  </option>
                ))}
              </select>
            </div>
          )}
          {c.stage === 'hired' && !c.hiredUserId && (canHire ? <Btn kind="primary" onClick={() => setHiring(true)}>{t.createAccount}</Btn> : <p className="muted">{t.hireNeedsRight}</p>)}
          {c.hiredUserId && (
            <a className="btn-link-secondary" href={`/panel/pracownicy/${c.hiredUserId}`} onClick={onNav(`/panel/pracownicy/${c.hiredUserId}`)} style={{ alignSelf: 'flex-start' }}>
              {t.openEmployee} →
            </a>
          )}
          <ErrorBox message={error} />
          {note && (
            <div className="notice" role="status">
              {note}
            </div>
          )}
          <span className="label">{t.comments}</span>
          {!comments.length && <p className="muted" style={{ margin: 0 }}>{t.noComments}</p>}
          {comments.map((k) => (
            <div key={k.id} className="rec-comment">
              <div style={{ whiteSpace: 'pre-wrap' }}>{k.body}</div>
              <div className="muted rec-comment-meta">
                <span>
                  {k.authorName} · {formatWhen(k.createdAt)}
                </span>
                {(k.authorId === me.user.id || me.user.role === 'owner') && (
                  <button className="link-btn" onClick={() => void removeComment(k)} aria-label={t.commentDelete}>
                    {t.commentDelete}
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="rec-comment-add">
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t.commentPlaceholder} aria-label={t.commentPlaceholder} rows={2} maxLength={2000} />
            <Btn onClick={() => void addComment()} disabled={busy || !comment.trim()}>
              {t.commentAdd}
            </Btn>
          </div>
        </section>
        <section className="rec-pane">
          <CvBox c={c} onChange={(cv) => setC({ ...c, cv })} onError={setError} />
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {t.rodo(longDate(c.deleteAt))}
          </p>
          <div className="btn-row">
            <Btn onClick={() => void keep()}>{t.keep}</Btn>
            <Btn kind="danger" onClick={() => void remove()}>
              {t.remove}
            </Btn>
          </div>
          {soon && <div className="notice warn-notice">{t.deletesOn(longDate(c.deleteAt))}</div>}
        </section>
      </div>
      {hiring && (
        <HireModal
          c={c}
          canRate={canRate}
          onClose={() => setHiring(false)}
          onDone={(info, userId) => {
            setHiring(false);
            setSecret(info);
            setC({ ...c, hiredUserId: userId, cv: null });
          }}
        />
      )}
      {secret && <SecretCardModal info={secret} onClose={() => setSecret(null)} />}
    </div>
  );
}

function CvBox({ c, onChange, onError }: { c: Candidate; onChange: (cv: Candidate['cv']) => void; onError: (m: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState(0); // refreshes the preview after a new upload
  const [drag, setDrag] = useState(false);
  const [filesOver, setFilesOver] = useState(false);
  // a PDF preview (iframe) would swallow the drop: while a file is dragged over the window, it ignores the pointer
  useEffect(() => {
    let n = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      n++;
      setFilesOver(true);
    };
    const leave = () => {
      n = Math.max(0, n - 1);
      if (!n) setFilesOver(false);
    };
    // a file dropped next to the area must not open in the browser instead of the app
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const end = (e: Event) => {
      if (e.type === 'drop') e.preventDefault();
      n = 0;
      setFilesOver(false);
      setDrag(false);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', end);
    window.addEventListener('dragend', end);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', end);
      window.removeEventListener('dragend', end);
    };
  }, []);
  const src = `/api/admin/candidates/${c.id}/cv?v=${v}`;
  async function upload(file: File) {
    onError(null);
    if (file.size > 10 * 1024 * 1024) return onError(errorText('cv_size'));
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/candidates/${c.id}/cv`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
        body: file,
      });
      const data = (await res.json().catch(() => ({}))) as { cv?: Candidate['cv']; error?: string };
      if (!res.ok) throw new ApiFailure(res.status, data.error ?? 'generic');
      onChange(data.cv ?? null);
      setV(v + 1);
    } catch (e) {
      onError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  async function remove() {
    await api(`/api/admin/candidates/${c.id}/cv`, { method: 'DELETE' }).catch(() => undefined);
    onChange(null);
  }
  return (
    <>
      <h2 className="rec-h2">{t.cv}</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {t.cvHint}
      </p>
      {/* drop a file from the desktop straight onto the area; an empty area also opens the file picker */}
      <div
        className={`rec-cv${drag ? ' drag' : ''}${c.cv ? '' : ' empty'}${filesOver ? ' files-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          if (!drag) setDrag(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !busy) void upload(f);
        }}
        onClick={() => !c.cv && !busy && input.current?.click()}
        role={c.cv ? undefined : 'button'}
        tabIndex={c.cv ? undefined : 0}
        aria-label={c.cv ? undefined : t.cvUpload}
      >
        {drag && <span className="rec-cv-drop">{t.cvDrop}</span>}
        {!c.cv && !drag && (
          <span className="muted rec-cv-empty">
            {busy ? t.cvUploading : t.cvNone}
            <span>{t.cvDropHint}</span>
          </span>
        )}
        {c.cv?.type === 'application/pdf' && <iframe title={c.cv.name} src={`${src}#view=FitH`} />}
        {c.cv && c.cv.type.startsWith('image/') && <img src={src} alt={c.cv.name} />}
      </div>
      <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      <div className="btn-row">
        <Btn onClick={() => input.current?.click()} disabled={busy}>
          {busy ? t.cvUploading : c.cv ? t.cvReplace : t.cvUpload}
        </Btn>
        {c.cv && (
          <a className="btn-link-secondary" href={src} target="_blank" rel="noopener noreferrer">
            {t.cvOpen}
          </a>
        )}
        {c.cv && <Btn onClick={() => void remove()}>{t.cvDelete}</Btn>}
      </div>
    </>
  );
}

function HireModal({ c, canRate, onClose, onDone }: { c: Candidate; canRate: boolean; onClose: () => void; onDone: (info: SecretInfo, userId: string) => void }) {
  const [rate, setRate] = useState('');
  const words = c.name.split(/\s+/);
  const [first, setFirst] = useState(words[0] ?? '');
  const [last, setLast] = useState(words.slice(1).join(' '));
  const [start, setStart] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string; login: string; tempSecret: string; secretKind: 'pin'; name: string }>(`/api/admin/candidates/${c.id}/hire`, {
        method: 'POST',
        body: { firstName: first, lastName: last, startDate: start || null, rate: rate.trim() || null },
      });
      onDone({ name: r.name, login: r.login, tempSecret: r.tempSecret, secretKind: r.secretKind }, r.id);
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
      setBusy(false);
    }
  }
  return (
    <Modal title={t.hireTitle} onClose={onClose}>
      <p style={{ margin: 0 }}>{t.hireIntro(posLabel(c.position))}</p>
      <div className="rec-two">
        <div className="field">
          <label htmlFor="h-first">{t.firstName}</label>
          <input id="h-first" value={first} onChange={(e) => setFirst(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="h-last">{t.lastName}</label>
          <input id="h-last" value={last} onChange={(e) => setLast(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="h-start">{t.startDate}</label>
        <DateField id="h-start" value={start} onChange={setStart} shortcuts clearable />
      </div>
      {canRate && (
        <div className="field">
          <label htmlFor="h-rate">{pl.admin.employees.rateField(posLabel(c.position))}</label>
          <RateInput id="h-rate" value={rate} onChange={setRate} />
          <span className="muted" style={{ fontSize: 12 }}>{pl.admin.employees.rateHint}</span>
        </div>
      )}
      <ErrorBox message={error} />
      <div className="btn-row">
        <Btn kind="primary" onClick={() => void go()} disabled={busy || !first.trim() || !last.trim()}>
          {t.hire}
        </Btn>
        <Btn onClick={onClose}>{pl.common.cancel}</Btn>
      </div>
    </Modal>
  );
}

/* ───────── Calendar (mockup 9) ───────── */

const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];

function CalendarView() {
  const { data, error } = useCandidates();
  const [month, setMonth] = useState(() => todayWarsaw().slice(0, 7));
  const [adding, setAdding] = useState(false);
  const [feed, setFeed] = useState(false);
  const first = `${month}-01`;
  const lead = (dowOf(first) + 6) % 7; // Monday first
  const start = addDays(first, -lead);
  const daysIn = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const weeks = Math.ceil((lead + daysIn) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  const shift = (n: number) => {
    const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const events = useMemo(() => {
    const out = new Map<string, { at: number; kind: 'interview' | 'trial'; c: Candidate }[]>();
    for (const c of data?.candidates ?? []) {
      if (c.stage === 'rejected') continue;
      for (const kind of ['interview', 'trial'] as const) {
        const at = kind === 'interview' ? c.interviewAt : c.trialAt;
        if (!at) continue;
        const d = parts(at).date;
        (out.get(d) ?? out.set(d, []).get(d)!).push({ at, kind, c });
      }
    }
    for (const list of out.values()) list.sort((a, b) => a.at - b.at);
    return out;
  }, [data]);
  const today = todayWarsaw();
  const inMonth = [...events.keys()].some((d) => d.startsWith(month));
  return (
    <div className="page">
      <Header view="calendar" onAdd={() => setAdding(true)} />
      <ErrorBox message={error} />
      <div className="btn-row" style={{ alignItems: 'center' }}>
        <Btn onClick={() => shift(-1)}>‹</Btn>
        <Btn onClick={() => setMonth(today.slice(0, 7))}>{t.thisMonth}</Btn>
        <Btn onClick={() => shift(1)}>›</Btn>
        <strong style={{ fontSize: 17 }}>
          {MONTHS[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}
        </strong>
        <span style={{ flex: 1 }} />
        <Btn onClick={() => setFeed(true)}>{t.subscribe}</Btn>
      </div>
      {!data && !error && <LogoLoader />}
      {data && (
        <>
          <div className="rec-cal" role="grid">
            {t.days.map((d) => (
              <div key={d} className="rec-cal-dow" role="columnheader">
                {d}
              </div>
            ))}
            {cells.map((d) => {
              const list = events.get(d) ?? [];
              return (
                <div key={d} className={`rec-cal-day${d.startsWith(month) ? '' : ' out'}${d === today ? ' today' : ''}`} role="gridcell">
                  <span className="rec-cal-num">{Number(d.slice(8, 10))}</span>
                  {list.map((e) => (
                    <a key={`${e.c.id}-${e.kind}`} className={`rec-ev ${e.kind}`} href={`/panel/rekrutacja/${e.c.id}`} onClick={onNav(`/panel/rekrutacja/${e.c.id}`)}>
                      <b>{parts(e.at).time}</b> {e.kind === 'interview' ? t.interview : t.trial} · {e.c.name}
                    </a>
                  ))}
                </div>
              );
            })}
          </div>
          {!inMonth && <p className="muted">{t.noEvents}</p>}
          {/* phone: a plain agenda instead of the grid */}
          <div className="rec-agenda">
            {[...events.entries()]
              .filter(([d]) => d.startsWith(month))
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([d, list]) => (
                <div key={d} className="rec-agenda-day">
                  <span className="label">
                    {DOW[dowOf(d)]} {d.slice(8, 10)}.{d.slice(5, 7)}
                  </span>
                  {list.map((e) => (
                    <a key={`${e.c.id}-${e.kind}`} className={`rec-ev ${e.kind}`} href={`/panel/rekrutacja/${e.c.id}`} onClick={onNav(`/panel/rekrutacja/${e.c.id}`)}>
                      <b>{parts(e.at).time}</b> {e.kind === 'interview' ? t.interview : t.trial} · {e.c.name} ({posLabel(e.c.position)})
                    </a>
                  ))}
                </div>
              ))}
          </div>
        </>
      )}
      {adding && data && <NewCandidate allowed={data.divisions} onClose={() => setAdding(false)} />}
      {feed && <FeedModal onClose={() => setFeed(false)} />}
    </div>
  );
}

function FeedModal({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<{ createdAt: number; lastUsedAt: number | null } | null | undefined>(undefined);
  const [link, setLink] = useState<{ url: string; webcal: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ feed: { createdAt: number; lastUsedAt: number | null } | null }>('/api/admin/recruitment/feed')
      .then((r) => setState(r.feed))
      .catch(() => setState(null));
  }, []);
  async function create() {
    setError(null);
    try {
      const r = await api<{ url: string; webcal: string }>('/api/admin/recruitment/feed', { method: 'POST' });
      setLink(r);
      setState({ createdAt: Date.now(), lastUsedAt: null });
      setNote(null);
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }
  async function revoke() {
    await api('/api/admin/recruitment/feed', { method: 'DELETE' }).catch(() => undefined);
    setState(null);
    setLink(null);
    setNote(t.feedRevoked);
  }
  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the link is visible to copy by hand */
    }
  }
  return (
    <Modal title={t.feedTitle} onClose={onClose}>
      <p style={{ margin: 0 }}>{t.feedIntro}</p>
      {state === undefined && <p className="muted">{pl.app.loading}</p>}
      {link && (
        <>
          <code className="rec-feed-url">{link.url}</code>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {t.feedOnce}
          </p>
          <div className="btn-row">
            <a className="btn-link-primary" href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(link.webcal)}`} target="_blank" rel="noopener noreferrer">
              {t.feedOpenGoogle}
            </a>
            <Btn onClick={() => void copy()}>{copied ? t.feedCopied : t.feedCopy}</Btn>
          </div>
        </>
      )}
      {!link && state && (
        <p className="muted" style={{ margin: 0 }}>
          {t.feedActive(longDate(state.createdAt))} {state.lastUsedAt ? t.feedUsed(formatWhen(state.lastUsedAt)) : ''}
        </p>
      )}
      {!link && state === null && <p className="muted" style={{ margin: 0 }}>{t.feedNone}</p>}
      {note && <div className="notice">{note}</div>}
      <ErrorBox message={error} />
      <div className="pub-actions">
        {state !== undefined && !link && (
          <Btn kind="primary" onClick={() => void create()}>
            {state ? t.feedNew : t.feedCreate}
          </Btn>
        )}
        {state && (
          <Btn kind="danger" onClick={() => void revoke()}>
            {t.feedRevoke}
          </Btn>
        )}
        <Btn onClick={onClose}>{t.close}</Btn>
      </div>
    </Modal>
  );
}
