import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { POSITIONS } from '../../shared/constants';
import { comparePl, foldPolish } from '../../shared/text';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { navigate } from '../router';
import { ErrorBox, LogoLoader } from '../ui';
import { businessDate, formatDuration } from '../../shared/time';
import { formatMoney } from './TimeTracking';
import { Btn, DeleteForeverModal, formatDateTime, Icon, Modal, SecretCardModal, type SecretInfo } from './common';
import { usePanel } from './Panel';

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  login: string;
  role: string;
  status: 'active' | 'inactive';
  position: string;
  startDate: string | null;
  lastLoginAt: number | null;
  locked: number;
}

type Filter = 'all' | 'active' | 'locked' | 'inactive';
const t = pl.admin.employees;

export function Employees({ selectedId }: { selectedId: string | null }) {
  const { locationId, can, isOwner, me } = usePanel();
  const [list, setList] = useState<Employee[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<SecretInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const canManage = can('employees.manage');

  const load = useCallback(async () => {
    try {
      const res = await api<{ employees: Employee[] }>(`/api/admin/locations/${locationId}/employees`);
      setList(res.employees);
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
      .sort((a, b) => comparePl(`${a.lastName} ${a.firstName}`, `${b.lastName} ${b.firstName}`));
  }, [list, query, filter]);

  const selected = list?.find((e) => e.id === selectedId) ?? null;
  useScrollIntoView(list ? selectedId : null);

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
          {list === null && <LogoLoader />}
          {list !== null && shown.length === 0 && <p className="muted">{list.length ? t.empty : t.emptyAll}</p>}
          {shown.map((e) => (
            <div key={e.id} className={`emp${e.id === selectedId ? ' open' : ''}`} data-emp={e.id}>
              <button
                className="row-btn"
                aria-current={e.id === selectedId}
                aria-expanded={e.id === selectedId}
                onClick={() => navigate(e.id === selectedId ? '/panel/pracownicy' : `/panel/pracownicy/${e.id}`)}
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
                  {pl.admin.positions[e.position] ?? e.position} · {e.login}
                </span>
              </button>
              <div className="emp-detail" inert={e.id !== selectedId}>
                <div className="emp-detail-inner">
                  {e.id === selectedId && selected && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 18,
                      }}
                    >
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
                            {pl.admin.positions[selected.position] ?? selected.position}
                            {selected.startDate ? ` · ${t.startDate.toLowerCase()}: ${selected.startDate}` : ''}
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
                        <Stat label={t.login} value={selected.login} />
                        <Stat label={t.lastLogin} value={selected.lastLoginAt ? formatDateTime(selected.lastLoginAt) : t.never} />
                      </dl>
                      {selected.role === 'employee' && <Summary key={selected.id} userId={selected.id} locationId={locationId} />}
                      {canManage && selected.id !== me.user.id && (selected.role === 'employee' || (isOwner && selected.role === 'manager')) && (
                        <div className="btn-row">
                          {selected.status === 'active' && (
                            <>
                              <Btn
                                onClick={() =>
                                  confirm(
                                    (selected.role === 'manager' ? t.confirmResetPassword : t.confirmReset)(`${selected.firstName} ${selected.lastName}`),
                                  ) &&
                                  void act(`/api/admin/users/${selected.id}/reset-secret`, t.done, (d) =>
                                    setSecret({
                                      name: `${selected.firstName} ${selected.lastName}`,
                                      login: d.login,
                                      tempSecret: d.tempSecret,
                                      secretKind: d.secretKind,
                                    }),
                                  )
                                }
                              >
                                {selected.role === 'manager' ? t.resetPassword : t.resetPin}
                              </Btn>
                              {selected.locked === 1 && <Btn onClick={() => void act(`/api/admin/users/${selected.id}/unlock`, t.done)}>{t.unlock}</Btn>}
                              <Btn onClick={() => void act(`/api/admin/users/${selected.id}/logout-all`, t.done)}>{t.logoutAll}</Btn>
                              <Btn
                                kind="danger"
                                onClick={() =>
                                  confirm(t.confirmDeactivate(`${selected.firstName} ${selected.lastName}`)) &&
                                  void act(`/api/admin/users/${selected.id}/deactivate`, t.done)
                                }
                              >
                                {t.deactivate}
                              </Btn>
                            </>
                          )}
                          {selected.status === 'inactive' && (
                            <Btn
                              onClick={() =>
                                void act(`/api/admin/users/${selected.id}/reactivate`, t.done, (d) =>
                                  setSecret({
                                    name: `${selected.firstName} ${selected.lastName}`,
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
                          {selected.status === 'inactive' && (
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
          ))}
        </section>
      </div>
      {adding && (
        <AddEmployee
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

function AddEmployee({ locationId, onClose, onCreated }: { locationId: string; onClose: () => void; onCreated: (info: SecretInfo, id: string) => void }) {
  const [firstName, setFirst] = useState('');
  const [lastName, setLast] = useState('');
  const [position, setPosition] = useState('waiter');
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
            {POSITIONS.filter((p) => p !== 'shift_manager').map((p) => (
              <option key={p} value={p}>
                {pl.admin.positions[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sd">{t.startDate}</label>
          <input id="sd" type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />
        </div>
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
  lessons: { done: number; total: number };
  mandatory: { done: number; total: number; missing: { id: string; title: string; status: string }[] };
  hours: Record<'thisMonth' | 'prevMonth', { month: string; minutes: number; shifts: number; open: number; costGrosze?: number; missingRate?: boolean }>;
  wages: boolean;
  rate: { current: number | null; history: { rateGrosze: number; validFrom: string }[] } | null;
}

const monthName = (m: string) => new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(m + '-15T12:00:00Z'));

/** Training progress, hours of this and last month, hourly rate (D37). */
function Summary({ userId, locationId }: { userId: string; locationId: string }) {
  const s = pl.admin.employees.summary;
  const [data, setData] = useState<SummaryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState('');
  const [from, setFrom] = useState(businessDate(Date.now()));
  const [saved, setSaved] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await api<SummaryData>(`/api/admin/locations/${locationId}/users/${userId}/summary`));
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }, [locationId, userId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function saveRate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await api(`/api/admin/locations/${locationId}/users/${userId}/rate`, { method: 'PUT', body: { rate, validFrom: from } });
      setRate('');
      setSaved(true);
      await load();
    } catch (err) {
      setError(errorText(err instanceof ApiFailure ? err.code : 'generic'));
    }
  }

  if (!data) return error ? <ErrorBox message={error} /> : <LogoLoader />;
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
        <div className="emp-missing">
          <span className="label">{s.missingDocs}</span>
          {data.mandatory.missing.map((m) => (
            <span key={m.id} className="emp-missing-row">
              {m.title}
              <span className={`badge ${m.status === 'review' ? 'warn' : 'neutral'}`}>{m.status === 'review' ? s.toReconfirm : s.notRead}</span>
            </span>
          ))}
        </div>
      ) : data.mandatory.total > 0 ? (
        <span className="muted" style={{ fontSize: 13 }}>
          {s.allConfirmed}
        </span>
      ) : null}
      {data.rate && (
        <form className="emp-rate" onSubmit={saveRate}>
          <div className="emp-stat" style={{ flex: '1 1 160px' }}>
            <span className="k">{s.rate}</span>
            <span className="v">{data.rate.current === null ? s.noRate : `${formatMoney(data.rate.current)} / h`}</span>
            {data.rate.history.length > 1 && (
              <span className="sub">
                {s.history}:{' '}
                {data.rate.history
                  .slice(-3)
                  .map((r) => `${formatMoney(r.rateGrosze)} ${s.from} ${r.validFrom}`)
                  .join(' · ')}
              </span>
            )}
          </div>
          <div className="field" style={{ flex: '1 1 120px' }}>
            <label htmlFor={`rate-${userId}`}>{s.newRate}</label>
            <input id={`rate-${userId}`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="np. 32,50" />
          </div>
          <div className="field" style={{ flex: '1 1 150px' }}>
            <label htmlFor={`rate-from-${userId}`}>{s.validFrom}</label>
            <input id={`rate-from-${userId}`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <Btn kind="primary" type="submit" disabled={!rate || !from}>
            {s.saveRate}
          </Btn>
          {saved && <span className="muted" style={{ fontSize: 13, alignSelf: 'center' }}>{s.saved}</span>}
          {error && <ErrorBox message={error} />}
        </form>
      )}
    </div>
  );
}

/** Opens a person's card under the name and keeps it in view. */
export function useScrollIntoView(id: string | null) {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!id || done.current === id) return;
    done.current = id;
    const t = window.setTimeout(() => {
      document.querySelector(`[data-emp="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
    return () => clearTimeout(t);
  }, [id]);
}
