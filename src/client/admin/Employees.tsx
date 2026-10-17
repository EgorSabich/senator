import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { DateField } from '../DateField';
import { divisionOf, POSITIONS } from '../../shared/constants';
import { comparePl, foldPolish } from '../../shared/text';
import { api, ApiFailure, cached } from '../api';
import { errorText, pl } from '../i18n/pl';
import { navigate } from '../router';
import { ErrorBox, LogoLoader } from '../ui';
import { businessDate, formatDuration } from '../../shared/time';
import { formatMoney } from './TimeTracking';
import { Btn, DeleteForeverModal, formatDateTime, Icon, Modal, SecretCardModal, storageGet, storageSet, type SecretInfo } from './common';
import { usePanel } from './Panel';

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  login: string;
  role: string;
  status: 'active' | 'inactive';
  position: string;
  positions: string[];
  startDate: string | null;
  lastLoginAt: number | null;
  locked: number;
}

type Filter = 'all' | 'active' | 'locked' | 'inactive';
const SORT_KEY = 'sa.panel.employeesSort';
const posRank = (p: string) => {
  const i = (POSITIONS as readonly string[]).indexOf(p);
  return i < 0 ? 99 : i;
};
const t = pl.admin.employees;

export function Employees({ selectedId }: { selectedId: string | null }) {
  const { locationId, can, isOwner, me } = usePanel();
  const [list, setList] = useState<Employee[] | null>(() => cached<{ employees: Employee[] }>(`/api/admin/locations/${locationId}/employees`)?.employees ?? null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [positions, setPositions] = useState<string[]>([]);
  const [byPosition, setByPosition] = useState(() => storageGet(SORT_KEY) === 'position');
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<SecretInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const canManage = can('employees.manage');
  const [divisions, setDivisions] = useState<string[] | null>(() => cached<{ divisions?: string[] | null }>(`/api/admin/locations/${locationId}/employees`)?.divisions ?? null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ employees: Employee[]; divisions?: string[] | null }>(`/api/admin/locations/${locationId}/employees`);
      setList(res.employees);
      setDivisions(res.divisions ?? null);
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }, [locationId]);
  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = foldPolish(query.trim());
    return (list ?? [])
      .filter((e) => (filter === 'all' ? true : filter === 'active' ? e.status === 'active' : filter === 'inactive' ? e.status === 'inactive' : e.locked === 1))
      .filter((e) => !q || foldPolish(`${e.firstName} ${e.lastName} ${e.login}`).includes(q))
      .filter((e) => !positions.length || positions.some((p) => (e.positions ?? [e.position]).includes(p)))
      .sort(
        (a, b) => (byPosition ? posRank(a.position) - posRank(b.position) : 0) || comparePl(`${a.lastName} ${a.firstName}`, `${b.lastName} ${b.firstName}`),
      );
  }, [list, query, filter, positions, byPosition]);
  const presentPositions = useMemo(() => [...new Set((list ?? []).flatMap((e) => e.positions ?? [e.position]))].sort((a, b) => posRank(a) - posRank(b)), [list]);

  const selected = list?.find((e) => e.id === selectedId) ?? null;
  useScrollIntoView(list ? selectedId : null);
  // A card that is folding keeps its content until the animation ends, so it closes smoothly.
  const [closingId, setClosingId] = useState<string | null>(null);
  const prevSelected = useRef(selectedId);
  useEffect(() => {
    const prev = prevSelected.current;
    prevSelected.current = selectedId;
    if (!prev || prev === selectedId) return;
    setClosingId(prev);
    const t = window.setTimeout(() => setClosingId(null), 600);
    return () => clearTimeout(t);
  }, [selectedId]);

  async function act(path: string, success: string, after?: (data: any) => void) {
    setError(null);
    setNotice(null);
    try {
      const data = await api<any>(path, { method: 'POST' });
      after?.(data);
      setNotice(success);
      await load();
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }

  const counts = {
    all: list?.length ?? 0,
    active: list?.filter((e) => e.status === 'active').length ?? 0,
    locked: list?.filter((e) => e.locked === 1).length ?? 0,
    inactive: list?.filter((e) => e.status === 'inactive').length ?? 0,
  };

  return (
    <>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <h1 className="page-title">{t.title}</h1>
        {canManage && (
          <Btn kind="primary" onClick={() => setAdding(true)}>
            {t.add}
          </Btn>
        )}
      </div>
      <ErrorBox message={error} />
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <div className="emp-list">
        <section className="list" aria-label={t.title}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              minHeight: 44,
              padding: '0 14px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
            }}
          >
            <Icon name="search" size={18} />
            <span
              style={{
                position: 'absolute',
                width: 1,
                height: 1,
                overflow: 'hidden',
                clip: 'rect(0 0 0 0)',
              }}
            >
              {t.search}
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.search}
              style={{
                flex: 1,
                minWidth: 0,
                background: 'none',
                border: 'none',
                color: 'var(--text)',
                fontFamily: 'var(--font-ui)',
                fontSize: 14,
                outline: 'none',
              }}
            />
          </label>
          <div className="btn-row" role="group">
            {(['active', 'locked', 'inactive', 'all'] as Filter[]).map((f) => (
              <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {
                  {
                    all: t.filterAll,
                    active: t.filterActive,
                    locked: t.filterLocked,
                    inactive: t.filterInactive,
                  }[f]
                }{' '}
                · {counts[f]}
              </button>
            ))}
          </div>
          {presentPositions.length > 1 && (
            <div className="btn-row" role="group" aria-label={t.positionFilter} style={{ alignItems: 'center' }}>
              <button className="chip" aria-pressed={positions.length === 0} onClick={() => setPositions([])}>
                {t.allPositions}
              </button>
              {presentPositions.map((p) => (
                <button
                  key={p}
                  className="chip"
                  aria-pressed={positions.includes(p)}
                  onClick={() => setPositions(positions.includes(p) ? positions.filter((x) => x !== p) : [...positions, p])}
                >
                  {pl.admin.positions[p] ?? p} · {(list ?? []).filter((e) => (e.positions ?? [e.position]).includes(p)).length}
                </button>
              ))}
            </div>
          )}
          <label className="check" style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              checked={byPosition}
              onChange={(e) => {
                setByPosition(e.target.checked);
                storageSet(SORT_KEY, e.target.checked ? 'position' : 'name');
              }}
            />
            <span>{t.groupByPosition}</span>
          </label>
          {list === null && <LogoLoader />}
          {list !== null && shown.length === 0 && <p className="muted">{list.length ? t.empty : t.emptyAll}</p>}
          {shown.map((e, i) => (
            <Fragment key={e.id}>
              {byPosition && (i === 0 || shown[i - 1]!.position !== e.position) && (
                <div className="label emp-group">{pl.admin.divisions[e.position] ?? pl.admin.positions[e.position] ?? e.position}</div>
              )}
              <div className={`emp${e.id === selectedId ? ' open' : ''}`} data-emp={e.id}>
                <button
                  className="row-btn"
                  onPointerDown={() => e.role === 'employee' && e.id !== selectedId && void prefetchSummary(locationId, e.id).catch(() => undefined)}
                  aria-current={e.id === selectedId}
                  aria-expanded={e.id === selectedId}
                  onClick={() => navigate(e.id === selectedId ? '/panel/pracownicy' : `/panel/pracownicy/${e.id}`, { keepScroll: true })}
                >
                  <span
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      width: '100%',
                    }}
                  >
                    <span style={{ fontSize: 15, fontWeight: 700 }}>
                      {e.firstName} {e.lastName}
                    </span>
                    <StatusBadge e={e} />
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {(e.positions ?? [e.position]).map((p) => pl.admin.positions[p] ?? p).join(' + ')} · {e.login}
                  </span>
                </button>
                <div className="emp-detail" inert={e.id !== selectedId}>
                  <div className="emp-detail-inner">
                    {(e.id === selectedId || e.id === closingId) && (
                      <div className="emp-detail-body">
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            gap: 10,
                          }}
                        >
                          <div>
                            <span className="muted" style={{ fontSize: 13 }}>
                              {pl.admin.positions[e.position] ?? e.position}
                              {e.startDate ? ` · ${t.startDate.toLowerCase()}: ${e.startDate}` : ''}
                            </span>
                          </div>
                        </div>
                        <dl
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                            gap: 10,
                            margin: 0,
                          }}
                        >
                          <Stat label={t.login} value={e.login} />
                          <Stat label={t.lastLogin} value={e.lastLoginAt ? formatDateTime(e.lastLoginAt) : t.never} />
                        </dl>
                        {e.role === 'employee' && <Summary key={e.id} userId={e.id} locationId={locationId} canManage={canManage} allowed={POSITIONS.filter((p) => !divisions || divisions.includes(p))} />}
                        {canManage && e.id !== me.user.id && (e.role === 'employee' || (isOwner && e.role === 'manager')) && (
                          <div className="btn-row">
                            {e.status === 'active' && (
                              <>
                                <Btn
                                  onClick={() =>
                                    confirm(
                                      (e.role === 'manager' ? t.confirmResetPassword : t.confirmReset)(`${e.firstName} ${e.lastName}`),
                                    ) &&
                                    void act(`/api/admin/users/${e.id}/reset-secret`, t.done, (d) =>
                                      setSecret({
                                        name: `${e.firstName} ${e.lastName}`,
                                        login: d.login,
                                        tempSecret: d.tempSecret,
                                        secretKind: d.secretKind,
                                      }),
                                    )
                                  }
                                >
                                  {e.role === 'manager' ? t.resetPassword : t.resetPin}
                                </Btn>
                                {e.locked === 1 && <Btn onClick={() => void act(`/api/admin/users/${e.id}/unlock`, t.done)}>{t.unlock}</Btn>}
                                <Btn onClick={() => void act(`/api/admin/users/${e.id}/logout-all`, t.done)}>{t.logoutAll}</Btn>
                                <Btn
                                  kind="danger"
                                  onClick={() =>
                                    confirm(t.confirmDeactivate(`${e.firstName} ${e.lastName}`)) &&
                                    void act(`/api/admin/users/${e.id}/deactivate`, t.done)
                                  }
                                >
                                  {t.deactivate}
                                </Btn>
                              </>
                            )}
                            {e.status === 'inactive' && (
                              <Btn
                                onClick={() =>
                                  void act(`/api/admin/users/${e.id}/reactivate`, t.done, (d) =>
                                    setSecret({
                                      name: `${e.firstName} ${e.lastName}`,
                                      login: d.login,
                                      tempSecret: d.tempSecret,
                                      secretKind: d.secretKind,
                                    }),
                                  )
                                }
                              >
                                {t.reactivate}
                              </Btn>
                            )}
                            {e.status === 'inactive' && (
                              <Btn kind="danger" onClick={() => setDeleting(true)}>
                                {pl.admin.deleteForever.button}
                              </Btn>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Fragment>
          ))}
        </section>
      </div>
      {adding && (
        <AddEmployee
          canRate={can('wages.manage')}
          divisions={divisions}
          locationId={locationId}
          onClose={() => setAdding(false)}
          onCreated={async (info, id) => {
            setAdding(false);
            setSecret(info);
            setNotice(t.created);
            await load();
            navigate(`/panel/pracownicy/${id}`);
          }}
        />
      )}
      {secret && <SecretCardModal info={secret} onClose={() => setSecret(null)} />}
      {deleting && selected && (
        <DeleteForeverModal
          title={pl.admin.deleteForever.userTitle(`${selected.firstName} ${selected.lastName}`)}
          impactPath={`/api/admin/users/${selected.id}/deletion`}
          lines={pl.admin.deleteForever.userLines}
          deletePath={`/api/admin/users/${selected.id}`}
          onClose={() => setDeleting(false)}
          onDeleted={async () => {
            setDeleting(false);
            setNotice(t.deleted);
            await load();
            navigate('/panel/pracownicy');
          }}
        />
      )}
    </>
  );
}

function StatusBadge({ e }: { e: Employee }) {
  if (e.status === 'inactive') return <span className="badge neutral">{t.statusInactive}</span>;
  if (e.locked === 1) return <span className="badge bad">{t.statusLocked}</span>;
  return <span className="badge ok">{t.statusActive}</span>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 12 }}>
      <dt className="muted" style={{ fontSize: 12 }}>
        {label}
      </dt>
      <dd
        style={{
          margin: '4px 0 0',
          fontSize: 15,
          fontWeight: 600,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </dd>
    </div>
  );
}

function AddEmployee({
  locationId,
  divisions,
  canRate,
  onClose,
  onCreated,
}: {
  canRate: boolean;
  locationId: string;
  divisions: string[] | null;
  onClose: () => void;
  onCreated: (info: SecretInfo, id: string) => void;
}) {
  const [firstName, setFirst] = useState('');
  const [lastName, setLast] = useState('');
  const [rate, setRate] = useState('');
  const [position, setPosition] = useState(divisions?.[0] ?? 'waiter');
  const [startDate, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{
        id: string;
        login: string;
        tempSecret: string;
        secretKind: 'pin';
      }>(`/api/admin/locations/${locationId}/employees`, {
        method: 'POST',
        body: {
          firstName,
          lastName,
          position,
          startDate: startDate || undefined,
          rate: canRate && rate.trim() ? rate.trim() : undefined,
        },
      });
      onCreated(
        {
          name: `${firstName} ${lastName}`,
          login: res.login,
          tempSecret: res.tempSecret,
          secretKind: res.secretKind,
        },
        res.id,
      );
    } catch (err) {
      setError(errorText(err instanceof ApiFailure ? err.code : 'generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t.add} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="field">
          <label htmlFor="fn">{t.firstName}</label>
          <input id="fn" value={firstName} onChange={(e) => setFirst(e.target.value)} autoComplete="off" maxLength={60} />
        </div>
        <div className="field">
          <label htmlFor="ln">{t.lastName}</label>
          <input id="ln" value={lastName} onChange={(e) => setLast(e.target.value)} autoComplete="off" maxLength={80} />
        </div>
        <div className="field">
          <label htmlFor="pos">{t.position}</label>
          <select id="pos" value={position} onChange={(e) => setPosition(e.target.value)}>
            {POSITIONS.filter((p) => p !== 'shift_manager' && (!divisions || divisions.includes(divisionOf(p)))).map((p) => (
              <option key={p} value={p}>
                {pl.admin.positions[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sd">{t.startDate}</label>
          <DateField id="sd" value={startDate} onChange={setStart} shortcuts />
        </div>
        {canRate && (
          <div className="field">
            <label htmlFor="rate-new">{t.rateField(pl.admin.positions[position] ?? position)}</label>
            <RateInput id="rate-new" value={rate} onChange={setRate} />
            <span className="muted" style={{ fontSize: 12 }}>
              {t.rateHint}
            </span>
          </div>
        )}
        <ErrorBox message={error} />
        <div className="btn-row">
          <Btn kind="primary" type="submit" disabled={busy || !firstName.trim() || !lastName.trim()}>
            {t.add}
          </Btn>
          <Btn onClick={onClose}>{pl.admin.cancel}</Btn>
        </div>
      </form>
    </Modal>
  );
}

interface SummaryData {
  deadlines?: { lockedSince: number | null; nextDue: number | null; due: Record<string, number> };
  lessons: { done: number; total: number };
  mandatory: { done: number; total: number; missing: { id: string; title: string; status: string }[] };
  hours: Record<'thisMonth' | 'prevMonth', { month: string; minutes: number; shifts: number; open: number; costGrosze?: number; missingRate?: boolean }>;
  wages: boolean;
  rate: { current: number | null; history: { rateGrosze: number; validFrom: string }[] } | null;
  positions: { position: string; startDate: string | null; primary: boolean; rate?: number | null; ownRate?: boolean; history?: { position: string; rateGrosze: number; validFrom: string }[] }[];
}

const monthName = (m: string) => new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(m + '-15T12:00:00Z'));

/** Training progress, hours of this and last month, hourly rate (D37). */
/**
 * Card data is fetched when the finger touches the row (before the card opens) and kept for a minute,
 * so the opening card already has its content and nothing pops in afterwards.
 */
const summaryCache = new Map<string, { at: number; p: Promise<SummaryData> }>();
export function prefetchSummary(locationId: string, userId: string, fresh = false): Promise<SummaryData> {
  const key = `${locationId}:${userId}`;
  const hit = summaryCache.get(key);
  if (hit && !fresh && Date.now() - hit.at < 60_000) return hit.p;
  const p = api<SummaryData>(`/api/admin/locations/${locationId}/users/${userId}/summary`);
  summaryCache.set(key, { at: Date.now(), p });
  p.catch(() => summaryCache.delete(key));
  return p;
}

function Summary({ userId, locationId, canManage, allowed }: { userId: string; locationId: string; canManage: boolean; allowed: string[] }) {
  const s = pl.admin.employees.summary;
  const [data, setData] = useState<SummaryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);
  const load = useCallback(async () => {
    try {
      // the first load uses the prefetched answer; later reloads (after a change) ask again
      setData(await prefetchSummary(locationId, userId, !first.current));
      first.current = false;
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }, [locationId, userId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return error ? <ErrorBox message={error} /> : <div className="emp-summary-wait"><LogoLoader /></div>;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const month = (k: 'thisMonth' | 'prevMonth') => {
    const h = data.hours[k];
    return (
      <div className="emp-stat">
        <span className="k">{k === 'thisMonth' ? s.thisMonth : s.prevMonth}</span>
        <span className="v">{formatDuration(h.minutes)} h</span>
        <span className="sub">
          {monthName(h.month)} · {s.shifts(h.shifts)}
          {h.open ? ` · ${s.open(h.open)}` : ''}
        </span>
        {data.wages && h.costGrosze !== undefined && (
          <span className="sub">
            {formatMoney(h.costGrosze)}
            {h.missingRate ? ` · ${s.missingRate}` : ''}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="emp-summary">
      <div className="emp-stats">
        <div className="emp-stat">
          <span className="k">{s.lessons}</span>
          <span className="v">
            {data.lessons.done} / {data.lessons.total}
          </span>
          <span className="emp-bar" aria-hidden="true">
            <span style={{ width: `${pct(data.lessons.done, data.lessons.total)}%` }} />
          </span>
        </div>
        <div className="emp-stat">
          <span className="k">{s.mandatory}</span>
          <span className="v">
            {data.mandatory.done} / {data.mandatory.total}
          </span>
          <span className="emp-bar" aria-hidden="true">
            <span style={{ width: `${pct(data.mandatory.done, data.mandatory.total)}%` }} />
          </span>
        </div>
        {month('thisMonth')}
        {month('prevMonth')}
      </div>
      {data.mandatory.missing.length > 0 ? (
        <details className="emp-missing">
          <summary>
            <span className="label">{s.missingDocs}</span>
            <span className="badge neutral">{data.mandatory.missing.length}</span>
            {data.deadlines?.lockedSince != null ? (
              <span className="badge bad">{pl.admin.today.locked}</span>
            ) : data.deadlines?.nextDue != null ? (
              <span className="badge warn">{s.dueBy(new Date(data.deadlines.nextDue).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }))}</span>
            ) : null}
            <span className="emp-chevron" aria-hidden="true">
              <Icon name="down" size={16} />
            </span>
          </summary>
          <div className="emp-missing-list">
            {data.mandatory.missing.map((m) => (
              <span key={m.id} className="emp-missing-row">
                {m.title}
                <span className={`badge ${data.deadlines?.due[m.id] && data.deadlines.due[m.id]! < Date.now() ? 'bad' : m.status === 'review' ? 'warn' : 'neutral'}`}>
                  {data.deadlines?.due[m.id] && data.deadlines.due[m.id]! < Date.now() ? pl.deadlines.overdue : m.status === 'review' ? s.toReconfirm : s.notRead}
                </span>
              </span>
            ))}
          </div>
        </details>
      ) : data.mandatory.total > 0 ? (
        <span className="muted" style={{ fontSize: 13 }}>
          {s.allConfirmed}
        </span>
      ) : null}
      <Positions data={data} userId={userId} locationId={locationId} canManage={canManage} allowed={allowed} onChanged={load} />
    </div>
  );
}

/** Opens a person's card under the name and keeps it in view — scrolls only when the name is off screen. */
export function useScrollIntoView(id: string | null) {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!id || done.current === id) return;
    done.current = id;
    const check = () => {
      const el = document.querySelector(`[data-emp="${id}"]`);
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      if (top < 56 || top > window.innerHeight * 0.55) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    // Once now, and again after a card above has finished folding.
    const a = window.setTimeout(check, 60);
    const b = window.setTimeout(check, 620);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [id]);
}

/** Positions of a person with their own rates (owner, 2026-10-17). */
function Positions(props: { data: SummaryData; userId: string; locationId: string; canManage: boolean; allowed: string[]; onChanged: () => Promise<void> }) {
  const s = pl.admin.employees.positionsCard;
  const { data } = props;
  const [error, setError] = useState<string | null>(null);
  const [rateFor, setRateFor] = useState<string | null>(null);
  const [rate, setRate] = useState('');
  const [from, setFrom] = useState(businessDate(Date.now()));
  const [adding, setAdding] = useState(false);
  const [newPos, setNewPos] = useState('');
  const [newStart, setNewStart] = useState(businessDate(Date.now()));
  const [busy, setBusy] = useState(false);
  const list = data.positions;
  const primary = list.find((p) => p.primary)?.position ?? list[0]?.position;
  const free = props.allowed.filter((p) => !list.some((x) => x.position === p));
  const canTouch = (p: string) => props.canManage && props.allowed.includes(p);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await props.onChanged();
      return true;
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const save = (positions: { position: string; startDate: string | null }[], main: string | undefined) =>
    run(() => api(`/api/admin/locations/${props.locationId}/users/${props.userId}/positions`, { method: 'PUT', body: { positions, primary: main } }));
  const current = () => list.map((p) => ({ position: p.position, startDate: p.startDate }));

  return (
    <div className="emp-positions">
      <div className="label">{s.title}</div>
      <div className="emp-pos-list">
        {list.map((p) => (
          <div key={p.position} className="emp-pos">
            <div className="emp-pos-main">
              <span className="emp-pos-name">
                {pl.admin.positions[p.position] ?? p.position}
                {p.primary && list.length > 1 && <span className="badge neutral">{s.primary}</span>}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {[p.startDate ? s.since(p.startDate) : null, data.wages ? (p.rate == null ? s.noRate : `${formatMoney(p.rate)} / h${p.ownRate ? '' : ` · ${s.commonRate}`}`) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <div className="btn-row">
              {canTouch(p.position) && !p.primary && list.length > 1 && (
                <Btn disabled={busy} onClick={() => void save(current(), p.position)}>
                  {s.makePrimary}
                </Btn>
              )}
              {data.wages && (
                <Btn disabled={busy} onClick={() => (setRateFor(rateFor === p.position ? null : p.position), setRate(''))}>
                  {s.rate}
                </Btn>
              )}
              {canTouch(p.position) && list.length > 1 && (
                <Btn
                  kind="danger"
                  disabled={busy}
                  onClick={() =>
                    window.confirm(s.confirmRemove(pl.admin.positions[p.position] ?? p.position)) &&
                    void save(
                      current().filter((x) => x.position !== p.position),
                      p.primary ? list.find((x) => x.position !== p.position)?.position : primary,
                    )
                  }
                >
                  {s.remove}
                </Btn>
              )}
            </div>
            {rateFor === p.position && (
              <form
                className="emp-rate"
                onSubmit={async (e: FormEvent) => {
                  e.preventDefault();
                  if (await run(() => api(`/api/admin/locations/${props.locationId}/users/${props.userId}/rate`, { method: 'PUT', body: { rate, validFrom: from, position: p.position } }))) setRateFor(null);
                }}
              >
                <div className="field" style={{ flex: '1 1 120px' }}>
                  <label htmlFor={`rate-${p.position}`}>{s.newRate(pl.admin.positions[p.position] ?? p.position)}</label>
                  <input id={`rate-${p.position}`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="np. 32,50" />
                </div>
                <div className="field" style={{ flex: '1 1 150px' }}>
                  <label htmlFor={`rate-from-${p.position}`}>{pl.admin.employees.summary.validFrom}</label>
                  <DateField id={`rate-from-${p.position}`} value={from} onChange={setFrom} />
                </div>
                <Btn kind="primary" type="submit" disabled={busy || !rate || !from}>
                  {pl.admin.employees.summary.saveRate}
                </Btn>
                {p.history && p.history.length > 0 && (
                  <span className="muted" style={{ fontSize: 12, flexBasis: '100%' }}>
                    {pl.admin.employees.summary.history}:{' '}
                    {p.history
                      .slice(-4)
                      .map((r) => `${formatMoney(r.rateGrosze)} ${pl.admin.employees.summary.from} ${r.validFrom}${r.position ? '' : ` (${s.commonRate})`}`)
                      .join(' · ')}
                  </span>
                )}
              </form>
            )}
          </div>
        ))}
      </div>
      {props.canManage && free.length > 0 && !adding && (
        <div>
          <Btn onClick={() => (setAdding(true), setNewPos(free[0]!))}>{s.add}</Btn>
        </div>
      )}
      {adding && (
        <form
          className="emp-rate"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            if (await save([...current(), { position: newPos, startDate: newStart || null }], primary)) setAdding(false);
          }}
        >
          <div className="field" style={{ flex: '1 1 160px' }}>
            <label htmlFor="new-pos">{s.position}</label>
            <select id="new-pos" value={newPos} onChange={(e) => setNewPos(e.target.value)}>
              {free.map((p) => (
                <option key={p} value={p}>
                  {pl.admin.positions[p] ?? p}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 150px' }}>
            <label htmlFor="new-pos-start">{s.startDate}</label>
            <DateField id="new-pos-start" value={newStart} onChange={setNewStart} shortcuts />
          </div>
          <Btn kind="primary" type="submit" disabled={busy || !newPos}>
            {s.addShort}
          </Btn>
          <Btn onClick={() => setAdding(false)}>{pl.admin.cancel}</Btn>
        </form>
      )}
      <span className="muted" style={{ fontSize: 12 }}>
        {s.hint}
      </span>
      <ErrorBox message={error} />
    </div>
  );
}

/** Hourly rate input: „32,50” with „zł / h” on the right (Polish comma accepted). */
export function RateInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="rate-input">
      <input id={id} inputMode="decimal" autoComplete="off" value={value} placeholder="0,00" onChange={(e) => onChange(e.target.value.replace(/[^\d,.]/g, '').slice(0, 8))} />
      <span aria-hidden="true">zł / h</span>
    </div>
  );
}
