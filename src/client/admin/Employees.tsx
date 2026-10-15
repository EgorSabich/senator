import { LogoLoader } from '../ui';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { POSITIONS } from '../../shared/constants';
import { comparePl, foldPolish } from '../../shared/text';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { navigate } from '../router';
import { ErrorBox } from '../ui';
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
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
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
      <div className="split">
        <section className="list" aria-label={t.title}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '0 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)' }}>
            <Icon name="search" size={18} />
            <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{t.search}</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.search}
              style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', color: 'var(--text)', fontFamily: 'var(--font-ui)', fontSize: 14, outline: 'none' }}
            />
          </label>
          <div className="btn-row" role="group">
            {(['active', 'locked', 'inactive', 'all'] as Filter[]).map((f) => (
              <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {{ all: t.filterAll, active: t.filterActive, locked: t.filterLocked, inactive: t.filterInactive }[f]} · {counts[f]}
              </button>
            ))}
          </div>
          {list === null && <LogoLoader />}
          {list !== null && shown.length === 0 && <p className="muted">{list.length ? t.empty : t.emptyAll}</p>}
          {shown.map((e) => (
            <button key={e.id} className="row-btn" aria-current={e.id === selectedId} onClick={() => navigate(`/panel/pracownicy/${e.id}`)}>
              <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%' }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>
                  {e.firstName} {e.lastName}
                </span>
                <StatusBadge e={e} />
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {pl.admin.positions[e.position] ?? e.position} · {e.login}
              </span>
            </button>
          ))}
        </section>
        <section className="detail card" aria-label={selected ? `${selected.firstName} ${selected.lastName}` : t.selectHint}>
          {!selected && <p className="muted" style={{ margin: 0 }}>{t.selectHint}</p>}
          {selected && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div>
                  <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600 }}>
                    {selected.firstName} {selected.lastName}
                  </h2>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {pl.admin.positions[selected.position] ?? selected.position}
                    {selected.startDate ? ` · ${t.startDate.toLowerCase()}: ${selected.startDate}` : ''}
                  </span>
                </div>
                <StatusBadge e={selected} />
              </div>
              <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, margin: 0 }}>
                <Stat label={t.login} value={selected.login} />
                <Stat label={t.lastLogin} value={selected.lastLoginAt ? formatDateTime(selected.lastLoginAt) : t.never} />
              </dl>
              {canManage && selected.id !== me.user.id && (selected.role === 'employee' || (isOwner && selected.role === 'manager')) && (
                <div className="btn-row">
                  {selected.status === 'active' && (
                    <>
                      <Btn
                        onClick={() =>
                          confirm((selected.role === 'manager' ? t.confirmResetPassword : t.confirmReset)(`${selected.firstName} ${selected.lastName}`)) &&
                          void act(`/api/admin/users/${selected.id}/reset-secret`, t.done, (d) =>
                            setSecret({ name: `${selected.firstName} ${selected.lastName}`, login: d.login, tempSecret: d.tempSecret, secretKind: d.secretKind }),
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
                          setSecret({ name: `${selected.firstName} ${selected.lastName}`, login: d.login, tempSecret: d.tempSecret, secretKind: d.secretKind }),
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
      <dd style={{ margin: '4px 0 0', fontSize: 15, fontWeight: 600, overflowWrap: 'anywhere' }}>{value}</dd>
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
      const res = await api<{ id: string; login: string; tempSecret: string; secretKind: 'pin' }>(`/api/admin/locations/${locationId}/employees`, {
        method: 'POST',
        body: { firstName, lastName, position, startDate: startDate || undefined },
      });
      onCreated({ name: `${firstName} ${lastName}`, login: res.login, tempSecret: res.tempSecret, secretKind: res.secretKind }, res.id);
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
