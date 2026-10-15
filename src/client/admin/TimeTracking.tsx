import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { addDays, businessDate, formatClock, formatDuration, warsawToMs } from '../../shared/time';
import { comparePl } from '../../shared/text';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { ErrorBox, LogoLoader } from '../ui';
import { Btn, formatDateTime, Modal, SecretCardModal, storageGet, storageSet, type SecretInfo } from './common';
import { usePanel } from './Panel';

const t = pl.admin.time;
const MODE_KEY = 'sa.panel.timeMode';

interface Person {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  position: string | null;
}
interface Entry {
  id: string;
  userId: string;
  businessDate: string;
  clockInAt: number;
  clockOutAt: number | null;
  inSource: string;
  outSource: string | null;
  note: string | null;
  editedAt: number | null;
  editedByName: string | null;
}
interface TimeData {
  days: string[];
  now: number;
  staleHours: number;
  people: Person[];
  entries: Entry[];
  openBefore: Entry[];
}

function mondayOf(date: string): string {
  const d = new Date(date + 'T12:00:00Z').getUTCDay(); // 0 = Sunday
  return addDays(date, -((d + 6) % 7));
}
function monthRange(date: string): [string, string] {
  const first = date.slice(0, 8) + '01';
  const next = new Date(Date.parse(first + 'T12:00:00Z'));
  next.setUTCMonth(next.getUTCMonth() + 1);
  return [first, addDays(next.toISOString().slice(0, 10), -1)];
}
const dayFmt = new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
const longFmt = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const dayLabel = (d: string) => dayFmt.format(new Date(d + 'T12:00:00Z'));
const longLabel = (d: string) => longFmt.format(new Date(d + 'T12:00:00Z'));
const minutesOf = (e: Entry) => (e.clockOutAt ? (e.clockOutAt - e.clockInAt) / 60000 : 0);

/** "HH:MM" on a business day: 00:00–05:59 is the night after that day. */
function businessTimeToMs(date: string, hhmm: string): number {
  const hour = Number(hhmm.slice(0, 2));
  return warsawToMs(hour < 6 ? addDays(date, 1) : date, hhmm);
}

export function TimeTracking() {
  const { locationId, isOwner } = usePanel();
  const [mode, setMode] = useState<'week' | 'month'>(storageGet(MODE_KEY) === 'month' ? 'month' : 'week');
  const [anchor, setAnchor] = useState(businessDate(Date.now()));
  const [data, setData] = useState<TimeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cell, setCell] = useState<{ person: Person; date: string } | null>(null);

  const [from, to] = useMemo<[string, string]>(() => (mode === 'week' ? [mondayOf(anchor), addDays(mondayOf(anchor), 6)] : monthRange(anchor)), [mode, anchor]);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api<TimeData>(`/api/admin/locations/${locationId}/time?from=${from}&to=${to}`));
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }, [locationId, from, to]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const people = useMemo(() => [...(data?.people ?? [])].sort((a, b) => comparePl(`${a.lastName} ${a.firstName}`, `${b.lastName} ${b.firstName}`)), [data]);
  const staleMs = (data?.staleHours ?? 16) * 3600_000;
  const isLive = (e: Entry) => !e.clockOutAt && data !== null && data.now - e.clockInAt <= staleMs;
  const isMissing = (e: Entry) => !e.clockOutAt && data !== null && data.now - e.clockInAt > staleMs;
  const all = [...(data?.entries ?? []), ...(data?.openBefore ?? [])];
  const live = all.filter(isLive);
  const missing = all.filter(isMissing);
  const nameOf = (id: string) => {
    const p = data?.people.find((x) => x.id === id);
    return p ? `${p.firstName} ${p.lastName}` : '—';
  };

  function shift(dir: -1 | 1) {
    if (mode === 'week') setAnchor(addDays(anchor, dir * 7));
    else {
      const d = new Date(Date.parse(anchor.slice(0, 8) + '15T12:00:00Z'));
      d.setUTCMonth(d.getUTCMonth() + dir);
      setAnchor(d.toISOString().slice(0, 10));
    }
  }

  function exportCsv() {
    if (!data) return;
    const rows: string[][] = [[...t.csvHeader]];
    const sorted = [...data.entries].sort((a, b) => comparePl(nameOf(a.userId), nameOf(b.userId)) || a.clockInAt - b.clockInAt);
    for (const e of sorted) {
      rows.push([
        nameOf(e.userId),
        e.businessDate,
        formatDateTime(e.clockInAt),
        e.clockOutAt ? formatDateTime(e.clockOutAt) : t.missingShort,
        e.clockOutAt ? formatDuration(minutesOf(e)) : '',
        t.sources[e.inSource] ?? e.inSource,
        e.note ?? '',
      ]);
    }
    rows.push([]);
    for (const p of people) {
      const mins = data.entries.filter((e) => e.userId === p.id).reduce((s, e) => s + minutesOf(e), 0);
      if (mins) rows.push([`${p.firstName} ${p.lastName}`, `${from} – ${to}`, '', '', formatDuration(mins), t.total, '']);
    }
    const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `czas-pracy-${from}-${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 className="page-title">{t.title}</h1>
        <div className="btn-row">
          <Btn onClick={exportCsv} disabled={!data}>
            {t.export}
          </Btn>
        </div>
      </div>
      <ErrorBox message={error} />

      <div className="btn-row" style={{ alignItems: 'center' }}>
        {(['week', 'month'] as const).map((m) => (
          <button
            key={m}
            className="chip"
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              storageSet(MODE_KEY, m);
            }}
          >
            {t[m]}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <Btn onClick={() => shift(-1)}>‹ {t.prev}</Btn>
        <Btn onClick={() => setAnchor(businessDate(Date.now()))}>{t.today}</Btn>
        <Btn onClick={() => shift(1)}>
          {t.next} ›
        </Btn>
      </div>
      <div className="muted" style={{ fontSize: 14, fontWeight: 600 }}>
        {longLabel(from)} – {longLabel(to)}
      </div>

      {data && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="label">{t.nowOnShift}</div>
          {live.length === 0 ? (
            <span className="muted">{t.nobody}</span>
          ) : (
            <div className="btn-row">
              {live.map((e) => (
                <span key={e.id} className="badge ok" style={{ fontSize: 13, padding: '6px 10px' }}>
                  {nameOf(e.userId)} · {formatClock(e.clockInAt)}
                </span>
              ))}
            </div>
          )}
          {missing.length > 0 && <div className="notice warn-notice">{t.missing(missing.length)}</div>}
        </div>
      )}

      {!data && !error && <LogoLoader />}
      {data && people.length === 0 && <p className="muted">{t.empty}</p>}
      {data && people.length > 0 && (
        <div className="time-grid-wrap">
          <table className="time-grid">
            <thead>
              <tr>
                <th className="sticky">{t.person}</th>
                {data.days.map((d) => (
                  <th key={d} className={d === businessDate(data.now) ? 'today' : ''}>
                    {dayLabel(d)}
                  </th>
                ))}
                <th>{t.total}</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const mine = data.entries.filter((e) => e.userId === p.id);
                const total = mine.reduce((s, e) => s + minutesOf(e), 0);
                return (
                  <tr key={p.id}>
                    <th className="sticky" scope="row">
                      <span className="name">
                        {p.firstName} {p.lastName}
                      </span>
                      <span className="pos">{p.position ? pl.admin.positions[p.position] ?? p.position : p.role === 'owner' ? pl.home.roleOwner : pl.home.roleManager}</span>
                    </th>
                    {data.days.map((d) => {
                      const es = mine.filter((e) => e.businessDate === d);
                      const mins = es.reduce((s, e) => s + minutesOf(e), 0);
                      const miss = es.some(isMissing);
                      const on = es.some(isLive);
                      return (
                        <td key={d} className={d === businessDate(data.now) ? 'today' : ''}>
                          <button type="button" className={`cell${es.length ? ' has' : ''}${miss ? ' miss' : ''}${on ? ' live' : ''}`} onClick={() => setCell({ person: p, date: d })} aria-label={`${p.firstName} ${p.lastName}, ${d}`}>
                            {miss ? '!' : on ? '●' : mins ? formatDuration(mins) : es.length ? '—' : ''}
                          </button>
                        </td>
                      );
                    })}
                    <td className="total">{total ? formatDuration(total) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {t.legend}
      </p>

      <Terminals locationId={locationId} isOwner={isOwner} />

      {cell && data && (
        <DayDialog
          locationId={locationId}
          person={cell.person}
          date={cell.date}
          entries={all.filter((e) => e.userId === cell.person.id && e.businessDate === cell.date)}
          onClose={() => setCell(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function EntryEditor({ entry, date, onSave, onDelete }: { entry: Entry | null; date: string; onSave: (inAt: number, outAt: number | null, note: string) => Promise<string | null>; onDelete?: () => Promise<void> }) {
  const toHHMM = (ms: number) => formatClock(ms);
  const [inT, setIn] = useState(entry ? toHHMM(entry.clockInAt) : '');
  const [outT, setOut] = useState(entry?.clockOutAt ? toHHMM(entry.clockOutAt) : '');
  const [note, setNote] = useState(entry?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // the original entry may start on another business day (open shift from earlier): keep its own date
  const day = entry ? entry.businessDate : date;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const inAt = businessTimeToMs(day, inT);
    let outAt = outT ? businessTimeToMs(day, outT) : null;
    if (outAt !== null && outAt <= inAt) outAt += 24 * 3600_000; // e.g. 05:00 → 07:00 next morning
    setError(await onSave(inAt, outAt, note));
    setBusy(false);
  }
  return (
    <form onSubmit={submit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="field">
          <label>{t.in}</label>
          <input type="time" value={inT} onChange={(e) => setIn(e.target.value)} required />
        </div>
        <div className="field">
          <label>{t.out}</label>
          <input type="time" value={outT} onChange={(e) => setOut(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>{t.note}</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </div>
      {entry && (
        <span className="muted" style={{ fontSize: 12 }}>
          {t.sources[entry.inSource] ?? entry.inSource}
          {entry.outSource && entry.outSource !== entry.inSource ? ` / ${t.sources[entry.outSource] ?? entry.outSource}` : ''}
          {entry.editedByName && entry.editedAt ? ` · ${t.edited(entry.editedByName, formatDateTime(entry.editedAt))}` : ''}
        </span>
      )}
      {error && <div className="notice warn-notice">{error}</div>}
      <div className="btn-row">
        <Btn kind="primary" type="submit" disabled={!inT || busy}>
          {entry ? t.save : t.addEntry}
        </Btn>
        {onDelete && (
          <Btn kind="danger" onClick={() => window.confirm(t.removeConfirm) && void onDelete()}>
            {t.remove}
          </Btn>
        )}
      </div>
    </form>
  );
}

function DayDialog(props: { locationId: string; person: Person; date: string; entries: Entry[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [adding, setAdding] = useState(props.entries.length === 0);
  const [punches, setPunches] = useState<{ id: string; at: number; outcome: string; person: string | null; offline: number }[] | null>(null);
  useEffect(() => {
    void api<{ punches: typeof punches }>(`/api/admin/locations/${props.locationId}/time/punches?date=${props.date}`)
      .then((r) => setPunches(r.punches))
      .catch(() => setPunches([]));
  }, [props.locationId, props.date]);
  const name = `${props.person.firstName} ${props.person.lastName}`;
  const mine = (punches ?? []).filter((p) => p.person === name);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await props.onChanged();
      return null;
    } catch (e) {
      return errorText(e instanceof ApiFailure ? e.code : 'generic');
    }
  };

  return (
    <Modal title={t.dayTitle(name, longLabel(props.date))} onClose={props.onClose}>
      {props.entries.length === 0 && !adding && <p className="muted">{t.noEntries}</p>}
      {props.entries.map((e) => (
        <EntryEditor
          key={`${e.id}-${e.clockInAt}-${e.clockOutAt}`}
          entry={e}
          date={props.date}
          onSave={(inAt, outAt, note) => run(() => api(`/api/admin/time/entries/${e.id}`, { method: 'PUT', body: { clockInAt: inAt, clockOutAt: outAt, note } }))}
          onDelete={async () => {
            await run(() => api(`/api/admin/time/entries/${e.id}`, { method: 'DELETE' }));
            props.onClose();
          }}
        />
      ))}
      {adding ? (
        <EntryEditor
          entry={null}
          date={props.date}
          onSave={async (inAt, outAt, note) => {
            const err = await run(() => api(`/api/admin/locations/${props.locationId}/time/entries`, { method: 'POST', body: { userId: props.person.id, clockInAt: inAt, clockOutAt: outAt, note } }));
            if (!err) props.onClose();
            return err;
          }}
        />
      ) : (
        <Btn onClick={() => setAdding(true)}>{t.addEntry}</Btn>
      )}
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        {t.afterMidnight}
      </p>
      {mine.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="label">{t.punches}</div>
          {mine.map((p) => (
            <span key={p.id} className="muted" style={{ fontSize: 13 }}>
              {formatClock(p.at)} · {t.outcomes[p.outcome] ?? p.outcome}
              {p.offline ? ` · ${t.sources.offline}` : ''}
            </span>
          ))}
        </div>
      )}
    </Modal>
  );
}

interface TerminalRow {
  id: string;
  name: string;
  login: string;
  status: string;
  lastSeenAt: number | null;
  sessions: number;
}

function Terminals({ locationId, isOwner }: { locationId: string; isOwner: boolean }) {
  const [list, setList] = useState<TerminalRow[] | null>(null);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<SecretInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setList((await api<{ terminals: TerminalRow[] }>(`/api/admin/locations/${locationId}/terminals`)).terminals);
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }, [locationId]);
  useEffect(() => {
    void load();
  }, [load]);

  const card = (n: string, d: { login: string; tempSecret: string }): SecretInfo => ({
    name: `Terminal · ${n}`,
    login: d.login,
    tempSecret: d.tempSecret,
    secretKind: 'password',
    note: t.terminalCardNote,
    secretLabel: t.terminalPassword,
  });

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const d = await api<{ login: string; tempSecret: string }>(`/api/admin/locations/${locationId}/terminals`, { method: 'POST', body: { name } });
      setSecret(card(name, d));
      setName('');
      await load();
    } catch (err) {
      setError(errorText(err instanceof ApiFailure ? err.code : 'generic'));
    }
  }

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="label">{t.terminals}</div>
      <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
        {t.terminalsInfo}
      </p>
      <ErrorBox message={error} />
      {list?.map((r) => (
        <div key={r.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <strong>{r.name}</strong>
            <span className="muted" style={{ fontSize: 12 }}>
              {r.login} · {r.status !== 'active' ? t.disabled : r.sessions ? t.signedIn : t.signedOut} · {r.lastSeenAt ? t.lastSeen(formatDateTime(r.lastSeenAt)) : t.neverSeen}
            </span>
          </div>
          {isOwner && (
            <div className="btn-row">
              <Btn
                onClick={async () => {
                  const d = await api<{ login: string; tempSecret: string }>(`/api/admin/terminals/${r.id}/reset`, { method: 'POST' });
                  setSecret(card(r.name, d));
                  await load();
                }}
              >
                {t.resetTerminal}
              </Btn>
              {r.status === 'active' && (
                <Btn
                  kind="danger"
                  onClick={async () => {
                    if (!window.confirm(t.disableConfirm)) return;
                    await api(`/api/admin/terminals/${r.id}/disable`, { method: 'POST' });
                    await load();
                  }}
                >
                  {t.disableTerminal}
                </Btn>
              )}
            </div>
          )}
        </div>
      ))}
      {isOwner && (
        <form onSubmit={add} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 220px' }}>
            <label htmlFor="trm-name">{t.terminalName}</label>
            <input id="trm-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
          <Btn kind="primary" type="submit" disabled={!name.trim()}>
            {t.addTerminal}
          </Btn>
        </form>
      )}
      {secret && <SecretCardModal info={secret} onClose={() => setSecret(null)} />}
    </section>
  );
}
