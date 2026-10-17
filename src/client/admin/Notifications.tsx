/**
 * Panel → Powiadomienia (owner, 2026-10-17; mockups 10–11).
 * Automatic notifications per division (on/off, time, minutes, which checklists) and own notifications
 * (once, weekly, before shift start, after clock-in, before shift end). Leaders see their own divisions.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { positionsOfDivisions } from '../../shared/constants';
import { warsawToMs } from '../../shared/time';
import { api, ApiFailure } from '../api';
import { DateField } from '../DateField';
import { errorText, pl } from '../i18n/pl';
import { useLiveRefresh } from '../live';
import { ErrorBox, LogoLoader } from '../ui';
import { Btn, DivisionExtras, Modal, storageGet, storageSet } from './common';
import { usePanel } from './Panel';

const t = pl.admin.notifications;
const e = t.editor;
const DIV = pl.admin.divisions;
const KINDS = ['tomorrow_shift', 'clock_in', 'clock_out', 'checklist_open', 'checklist_close', 'unavailability'] as const;
type Kind = (typeof KINDS)[number];

interface Rule {
  enabled: boolean;
  timeMin: number | null;
  minutes: number | null;
  listIds: string[] | null;
  auto: boolean;
}
interface Custom {
  id: string;
  title: string;
  body: string;
  divisions: string[];
  audience: 'on_shift' | 'division';
  trigger: 'once' | 'weekly' | 'shift_start' | 'after_clock_in' | 'shift_end';
  atMs: number | null;
  days: number;
  timeMin: number | null;
  minutes: number | null;
  url: string | null;
  enabled: boolean;
  editable: boolean;
}
interface Data {
  divisions: string[];
  rules: Record<string, Record<Kind, Rule>>;
  checklists: Record<string, { id: string; title: string }[]>;
  custom: Custom[];
}

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const TIMES = Array.from({ length: 96 }, (_, i) => i * 15);
const MINUTES = [5, 10, 15, 20, 30, 45, 60, 90, 120];
const DIV_KEY = 'sa-ntf-div';

/** ms → 'YYYY-MM-DDTHH:mm' in Warsaw */
function warsawInput(ms: number): string {
  const p = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Warsaw' }).formatToParts(new Date(ms));
  const g = (k: string) => p.find((x) => x.type === k)!.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}
function daysText(bits: number): string {
  if (!bits || bits === 127) return t.summary.everyDay;
  return t.days.filter((_, i) => bits & (1 << i)).join(', ');
}
function summary(n: Custom): string {
  const s = t.summary;
  switch (n.trigger) {
    case 'once': {
      const v = n.atMs ? warsawInput(n.atMs) : '';
      return s.once(v ? `${v.slice(8, 10)}.${v.slice(5, 7)}, ${v.slice(11)}` : '—');
    }
    case 'weekly':
      return s.weekly(daysText(n.days), hm(n.timeMin ?? 0));
    default:
      return s[n.trigger](daysText(n.days), n.minutes ?? 0);
  }
}

export function Notifications() {
  const { locationId } = usePanel();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [division, setDivision] = useState<string>(() => storageGet(DIV_KEY) ?? '');
  const [editing, setEditing] = useState<Custom | 'new' | null>(null);
  const load = useCallback(
    () =>
      api<Data>(`/api/admin/locations/${locationId}/notifications`)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((x) => setError(errorText(x instanceof ApiFailure ? x.code : 'generic'))),
    [locationId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(load);

  const div = data && data.divisions.includes(division) ? division : (data?.divisions[0] ?? '');
  const pick = (d: string) => {
    setDivision(d);
    storageSet(DIV_KEY, d);
  };

  async function saveRule(kind: Kind, patch: Partial<Rule>) {
    if (!data) return;
    // optimistic
    setData({ ...data, rules: { ...data.rules, [div]: { ...data.rules[div]!, [kind]: { ...data.rules[div]![kind], ...patch, ...(patch.listIds !== undefined ? { auto: false } : {}) } } } });
    try {
      await api(`/api/admin/locations/${locationId}/notifications/rules`, { method: 'PUT', body: { division: div, kind, ...patch } });
    } catch (x) {
      setError(errorText(x instanceof ApiFailure ? x.code : 'generic'));
    }
    void load();
  }

  if (!data) return error ? <ErrorBox message={error} /> : <LogoLoader />;
  const rules = data.rules[div];
  const lists = data.checklists[div] ?? [];
  const custom = data.custom.filter((n) => n.divisions.includes(div));

  return (
    <div className="ntf">
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 className="page-title">{t.title}</h1>
        <Btn kind="primary" onClick={() => setEditing('new')}>
          {t.add}
        </Btn>
      </div>
      <div className="ntf-divs" role="tablist">
        {data.divisions.map((d) => (
          <button key={d} type="button" className="chip" aria-pressed={d === div} onClick={() => pick(d)}>
            {DIV[d] ?? d}
            {/* assistants get their division's notifications — shown on the chip (owner, 2026-10-17) */}
            <DivisionExtras division={d} />
          </button>
        ))}
        <span className="muted ntf-note">{t.scopeNote}</span>
      </div>
      <ErrorBox message={error} />

      {rules && (
        <section className="card ntf-card">
          <h2 className="ntf-h">{t.auto(DIV[div] ?? div)}</h2>
          <span className="muted ntf-who">{t.covers(positionsOfDivisions([div]).map((p) => pl.admin.positions[p] ?? p).join(', '))}</span>
          {KINDS.map((k) => {
            const r = rules[k];
            const info = t.kinds[k]!;
            return (
              <div key={k} className="ntf-row" data-kind={k}>
                <div className="ntf-what">
                  <b>{info.title}</b>
                  <span className="muted">{info.sub}</span>
                </div>
                <div className="ntf-when">
                  {(k === 'tomorrow_shift' || k === 'unavailability') && (
                    <label className="ntf-sel">
                      <span>{k === 'tomorrow_shift' ? t.dailyAt : t.dayBeforeAt}</span>
                      <select aria-label={`${info.title}: godzina`} value={r.timeMin ?? 1080} disabled={!r.enabled} onChange={(ev) => void saveRule(k, { timeMin: Number(ev.target.value) })}>
                        {TIMES.map((m) => (
                          <option key={m} value={m}>
                            {hm(m)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {(k === 'clock_in' || k === 'clock_out') && <span className="ntf-static">{t.immediately}</span>}
                  {(k === 'checklist_open' || k === 'checklist_close') && (
                    <span className="ntf-when-two">
                      <label className="ntf-sel">
                        <select
                          aria-label={`${info.title}: kiedy`}
                          value={r.timeMin !== null ? 'time' : String(r.minutes ?? 30)}
                          disabled={!r.enabled}
                          onChange={(ev) => void saveRule(k, ev.target.value === 'time' ? { timeMin: k === 'checklist_open' ? 17 * 60 : 23 * 60 } : { minutes: Number(ev.target.value), timeMin: null })}
                        >
                          {MINUTES.map((m) => (
                            <option key={m} value={m}>
                              {k === 'checklist_open' ? t.afterIn(m) : t.beforeEnd(m)}
                            </option>
                          ))}
                          <option value="time">{t.atTime}</option>
                        </select>
                      </label>
                      {r.timeMin !== null && (
                        <label className="ntf-sel">
                          <select aria-label={`${info.title}: godzina`} value={r.timeMin} disabled={!r.enabled} onChange={(ev) => void saveRule(k, { timeMin: Number(ev.target.value) })}>
                            {TIMES.map((m) => (
                              <option key={m} value={m}>
                                {hm(m)}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </span>
                  )}
                </div>
                <span className="ntf-example muted">{info.example}</span>
                <Toggle label={info.title} on={r.enabled} onChange={(v) => void saveRule(k, { enabled: v })} />
                {(k === 'checklist_open' || k === 'checklist_close') && r.enabled && (
                  <div className="ntf-lists">
                    <span className="ntf-cap">{t.lists}</span>
                    {lists.length ? (
                      <>
                        <div className="ntf-chips">
                          {lists.map((l) => {
                            const on = (r.listIds ?? []).includes(l.id);
                            return (
                              <button
                                key={l.id}
                                type="button"
                                className="chip"
                                aria-pressed={on}
                                onClick={() => void saveRule(k, { listIds: on ? (r.listIds ?? []).filter((x) => x !== l.id) : [...(r.listIds ?? []), l.id] })}
                              >
                                {l.title}
                              </button>
                            );
                          })}
                        </div>
                        {r.auto && <span className="muted ntf-hint">{t.listsAuto}</span>}
                      </>
                    ) : (
                      <span className="muted ntf-hint">{t.noLists}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      <section className="card ntf-card">
        <h2 className="ntf-h">{t.own}</h2>
        {!custom.length && <p className="muted" style={{ margin: 0 }}>{t.ownEmpty}</p>}
        {custom.map((n) => (
          <div key={n.id} className="ntf-row ntf-custom" data-custom={n.id}>
            <button type="button" className="ntf-what ntf-open" onClick={() => setEditing(n)}>
              <b>
                {n.title}{' '}
                <span className="ntf-tag">{n.divisions.length === Object.keys(DIV).length ? 'wszyscy' : n.divisions.map((d) => DIV[d] ?? d).join(', ')}</span>
              </b>
              <span className="muted">„{n.body}”</span>
            </button>
            <div className="ntf-when">
              <span className="ntf-static">{summary(n)}</span>
            </div>
            <span className="ntf-example muted">{n.trigger === 'once' || n.trigger === 'weekly' ? (n.audience === 'division' ? t.summary.division : t.summary.onShift) : t.summary.onShift}</span>
            <Toggle
              label={n.title}
              on={n.enabled}
              disabled={!n.editable}
              onChange={async (v) => {
                await api(`/api/admin/notifications/custom/${n.id}`, { method: 'PUT', body: { ...n, enabled: v } }).catch((x) => setError(errorText(x instanceof ApiFailure ? x.code : 'generic')));
                void load();
              }}
            />
          </div>
        ))}
      </section>

      {editing && (
        <CustomModal
          initial={editing === 'new' ? null : editing}
          divisions={data.divisions}
          division={div}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="ntf-switch" disabled={disabled} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

type Mode = 'once' | 'repeat';
type RepeatKind = 'weekly' | 'shift_start' | 'after_clock_in' | 'shift_end';

function CustomModal({ initial, divisions, division, onClose, onSaved }: { initial: Custom | null; divisions: string[]; division: string; onClose: () => void; onSaved: () => void }) {
  const { locationId } = usePanel();
  const editable = !initial || initial.editable;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [divs, setDivs] = useState<string[]>(initial?.divisions ?? [division]);
  const [audience, setAudience] = useState<'on_shift' | 'division'>(initial?.audience ?? 'on_shift');
  const [mode, setMode] = useState<Mode>(initial?.trigger === 'once' ? 'once' : initial ? 'repeat' : 'once');
  const [kind, setKind] = useState<RepeatKind>(initial && initial.trigger !== 'once' ? initial.trigger : 'weekly');
  const [days, setDays] = useState(initial?.days ?? 0);
  const [timeMin, setTimeMin] = useState(initial?.timeMin ?? 16 * 60);
  const [minutes, setMinutes] = useState(initial?.minutes ?? 15);
  const [at, setAt] = useState(initial?.atMs ? warsawInput(initial.atMs) : '');
  const [url, setUrl] = useState(initial?.url ?? '/');
  const [enabled] = useState(initial?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trigger = mode === 'once' ? 'once' : kind;
  const shiftBased = trigger !== 'once' && trigger !== 'weekly';

  const payload = useMemo(
    () => ({
      title: title.trim(),
      body: body.trim(),
      divisions: divs,
      audience: shiftBased ? 'on_shift' : audience,
      trigger,
      atMs: trigger === 'once' && at ? warsawToMs(at.slice(0, 10), at.slice(11, 16)) : null,
      days: trigger === 'once' ? 0 : days,
      timeMin: trigger === 'weekly' ? timeMin : null,
      minutes: shiftBased ? minutes : null,
      url,
      enabled,
    }),
    [title, body, divs, audience, trigger, at, days, timeMin, minutes, url, enabled, shiftBased],
  );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (initial) await api(`/api/admin/notifications/custom/${initial.id}`, { method: 'PUT', body: payload });
      else await api(`/api/admin/locations/${locationId}/notifications/custom`, { method: 'POST', body: payload });
      onSaved();
    } catch (x) {
      setError(errorText(x instanceof ApiFailure ? x.code : 'generic'));
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setInfo(null);
    setError(null);
    try {
      const r = await api<{ devices: number }>(`/api/admin/locations/${locationId}/notifications/test`, { method: 'POST', body: { title: payload.title || 'Senator Academy', body: payload.body } });
      setInfo(r.devices ? e.testSent : e.testNone);
    } catch (x) {
      setError(errorText(x instanceof ApiFailure ? x.code : 'generic'));
    }
  }
  async function remove() {
    if (!initial || !window.confirm(e.removeConfirm)) return;
    await api(`/api/admin/notifications/custom/${initial.id}`, { method: 'DELETE' }).catch(() => undefined);
    onSaved();
  }
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <Modal title={initial ? e.editTitle : e.newTitle} onClose={onClose}>
      {!editable && <p className="muted" style={{ margin: 0 }}>{e.notEditable}</p>}
      <fieldset disabled={!editable} className="ntf-form">
        <div className="field">
          <label htmlFor="nt-title">{e.title}</label>
          <input id="nt-title" value={title} maxLength={60} onChange={(ev) => setTitle(ev.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="nt-body">{e.body}</label>
          <textarea id="nt-body" rows={3} value={body} maxLength={300} onChange={(ev) => setBody(ev.target.value)} />
        </div>
        <div className="field">
          <span className="ntf-label">{e.who}</span>
          <div className="ntf-chips">
            {divisions.map((d) => (
              <button key={d} type="button" className="chip" aria-pressed={divs.includes(d)} onClick={() => setDivs(toggle(divs, d))}>
                {DIV[d] ?? d}
              </button>
            ))}
          </div>
          {!shiftBased && (
            <div className="ntf-chips">
              <button type="button" className="chip" aria-pressed={audience === 'on_shift'} onClick={() => setAudience('on_shift')}>
                {e.onShift}
              </button>
              <button type="button" className="chip" aria-pressed={audience === 'division'} onClick={() => setAudience('division')}>
                {e.wholeDivision}
              </button>
            </div>
          )}
        </div>
        <div className="field">
          <span className="ntf-label">{e.when}</span>
          <div className="ntf-chips">
            <button type="button" className="chip" aria-pressed={mode === 'once'} onClick={() => setMode('once')}>
              {e.once}
            </button>
            <button type="button" className="chip" aria-pressed={mode === 'repeat'} onClick={() => setMode('repeat')}>
              {e.repeat}
            </button>
          </div>
          {mode === 'once' ? (
            <DateField value={at} onChange={setAt} withTime placeholder={e.date} />
          ) : (
            <>
              <div className="ntf-chips" aria-label="Dni tygodnia">
                {t.days.map((d, i) => (
                  <button key={d} type="button" className="chip" aria-pressed={Boolean(days & (1 << i))} onClick={() => setDays(days ^ (1 << i))}>
                    {d}
                  </button>
                ))}
              </div>
              {!days && <span className="muted ntf-hint">{e.everyDay}</span>}
              <div className="ntf-chips">
                {(
                  [
                    ['weekly', e.atTime],
                    ['shift_start', e.beforeStart],
                    ['after_clock_in', e.afterClockIn],
                    ['shift_end', e.beforeEnd],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
                    {l}
                  </button>
                ))}
              </div>
              {kind === 'weekly' ? (
                <label className="ntf-sel">
                  <span>{e.time}</span>
                  <select value={timeMin} onChange={(ev) => setTimeMin(Number(ev.target.value))}>
                    {TIMES.map((m) => (
                      <option key={m} value={m}>
                        {hm(m)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="ntf-sel">
                  <span>{e.minutes}</span>
                  <select value={minutes} onChange={(ev) => setMinutes(Number(ev.target.value))}>
                    {(kind === 'after_clock_in' ? [0, ...MINUTES] : MINUTES).map((m) => (
                      <option key={m} value={m}>
                        {m} min
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
        </div>
        <div className="field">
          <label htmlFor="nt-url">{e.open}</label>
          <select id="nt-url" value={url} onChange={(ev) => setUrl(ev.target.value)}>
            {Object.entries(t.targets).map(([p, l]) => (
              <option key={p} value={p}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </fieldset>
      <ErrorBox message={error} />
      {info && <p className="muted" style={{ margin: 0 }} role="status">{info}</p>}
      <div className="btn-row">
        {editable && (
          <Btn kind="primary" onClick={() => void save()} disabled={busy || !title.trim() || !body.trim() || !divs.length || (mode === 'once' && !at)}>
            {e.save}
          </Btn>
        )}
        <Btn onClick={() => void test()} disabled={!body.trim()}>
          {e.test}
        </Btn>
        {initial && editable && (
          <Btn kind="danger" onClick={() => void remove()}>
            {e.remove}
          </Btn>
        )}
        <Btn onClick={onClose}>{pl.common.cancel}</Btn>
      </div>
    </Modal>
  );
}
