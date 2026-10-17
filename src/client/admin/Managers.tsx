import { LogoLoader } from '../ui';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { DIVISION_SCOPE_PREFIX, divisionOf, MANAGER_ROLES, PERMISSIONS, POSITIONS, ROLE_PREFIX, type ManagerRole } from '../../shared/constants';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { ErrorBox } from '../ui';
import { Btn, DeleteForeverModal, formatDateTime, Modal, SecretCardModal, type SecretInfo } from './common';
import { DateField } from '../DateField';
import { RateInput } from './Employees';
import { usePanel } from './Panel';

interface Manager {
  id: string;
  firstName: string;
  lastName: string;
  login: string;
  status: string;
  lastLoginAt: number | null;
  permissions: Record<string, string[]>;
  self?: boolean;
  tracksTime?: boolean;
  pinSet?: boolean;
  hours?: Record<string, { position: string; startDate: string | null; rate: number | null; rateFrom: string | null }>;
}

/** Permissions + divisions of a role preset (D44), stored with "role:<key>" so the card shows the role. */
export function rolePermissions(role: ManagerRole): string[] {
  const r = MANAGER_ROLES[role];
  const perms = r.permissions === 'all' ? [...PERMISSIONS] : [...r.permissions];
  return [...perms, ...r.divisions.map((d) => DIVISION_SCOPE_PREFIX + d), ROLE_PREFIX + role];
}
const roleOf = (perms: string[]) => perms.find((p) => p.startsWith(ROLE_PREFIX))?.slice(ROLE_PREFIX.length) as ManagerRole | undefined;
const t = pl.admin.managers;

export function Managers() {
  const { me, locationId } = usePanel();
  const [list, setList] = useState<Manager[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<SecretInfo | null>(null);
  const locName = me.locations.find((l) => l.id === locationId)?.name ?? '';

  const load = useCallback(async () => {
    try {
      setList((await api<{ managers: Manager[] }>('/api/admin/managers')).managers);
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 className="page-title">{t.title}</h1>
        <Btn kind="primary" onClick={() => setAdding(true)}>
          {t.add}
        </Btn>
      </div>
      <ErrorBox message={error} />
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {list === null && <LogoLoader />}
      {list?.length === 0 && <p className="muted">{t.empty}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 920 }}>
        {list?.map((m) => (
          <ManagerCard
            key={m.id}
            m={m}
            locationId={locationId}
            locName={locName}
            onSaved={async () => {
              setNotice(t.saved);
              await load();
            }}
            onError={setError}
            onSecret={setSecret}
            onRemoved={async () => {
              setNotice(t.removed);
              await load();
            }}
          />
        ))}
      </div>
      {adding && (
        <AddManager
          locationId={locationId}
          onClose={() => setAdding(false)}
          onCreated={async (info) => {
            setAdding(false);
            setSecret(info);
            await load();
          }}
        />
      )}
      {secret && <SecretCardModal info={secret} onClose={() => setSecret(null)} />}
    </>
  );
}

function ManagerCard(props: {
  m: Manager;
  locationId: string;
  locName: string;
  onSaved: () => void;
  onError: (s: string) => void;
  onSecret: (i: SecretInfo) => void;
  onRemoved: () => void;
}) {
  const { m } = props;
  const [perms, setPerms] = useState<string[]>(m.permissions[props.locationId] ?? []);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const dirty = JSON.stringify([...perms].sort()) !== JSON.stringify([...(m.permissions[props.locationId] ?? [])].sort());

  async function save() {
    setBusy(true);
    try {
      await api(`/api/admin/managers/${m.id}/permissions`, { method: 'PUT', body: { locationId: props.locationId, permissions: perms } });
      props.onSaved();
    } catch (e) {
      props.onError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    } finally {
      setBusy(false);
    }
  }

  const savedRole = roleOf(m.permissions[props.locationId] ?? []);
  return (
    <div className={`emp${open ? ' open' : ''}`} aria-label={`${m.firstName} ${m.lastName}`}>
      <button type="button" className="row-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%', alignItems: 'center' }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>
            {m.firstName} {m.lastName}
          </span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {m.status === 'inactive' && <span className="badge bad">{t.inactive}</span>}
            {m.tracksTime && <span className="badge neutral">{t.hourlyBadge}</span>}
            <span className="badge neutral">{savedRole ? t.roles[savedRole] : t.customRole}</span>
            <span className={`chev${open ? ' up' : ''}`} aria-hidden="true">
              ▾
            </span>
          </span>
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          {m.login} · {pl.admin.employees.lastLogin.toLowerCase()}: {m.lastLoginAt ? formatDateTime(m.lastLoginAt) : pl.admin.employees.never}
        </span>
      </button>
      <div className="emp-detail">
        <div className="emp-detail-inner" inert={!open}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {m.self ? (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {t.selfInfo}
              </p>
            ) : null}
            <div className="field">
              <label htmlFor={`role-${m.id}`}>{t.role}</label>
              <select
                id={`role-${m.id}`}
                disabled={m.self}
                value={roleOf(perms) ?? ''}
                onChange={(e) => setPerms(e.target.value ? rolePermissions(e.target.value as ManagerRole) : perms.filter((p) => !p.startsWith(ROLE_PREFIX)))}
                /* changing single permissions below keeps the role name (owner, 2026-10-17) */
              >
                <option value="">{t.customRole}</option>
                {(Object.keys(MANAGER_ROLES) as ManagerRole[]).map((r) => (
                  <option key={r} value={r}>
                    {t.roles[r]}
                  </option>
                ))}
              </select>
              <span className="muted" style={{ fontSize: 12 }}>
                {roleOf(perms) ? t.roleHints[roleOf(perms)!] : t.customHint}
              </span>
            </div>
            <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <legend className="label" style={{ marginBottom: 8 }}>
                {t.permissionsIn(props.locName)}
              </legend>
              {PERMISSIONS.map((p) => (
                <label key={p} className="check">
                  <input
                    type="checkbox"
                    disabled={m.self}
                    checked={perms.includes(p)}
                    onChange={(e) => setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))}
                  />
                  <span>{pl.admin.permissions[p]}</span>
                </label>
              ))}
            </fieldset>
            <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <legend className="label" style={{ marginBottom: 4 }}>
                {t.divisions}
              </legend>
              <span className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                {t.divisionsHint}
              </span>
              <div className="btn-row">
                {POSITIONS.filter((d) => divisionOf(d) === d).map((d) => {
                  const key = DIVISION_SCOPE_PREFIX + d;
                  return (
                    <button
                      key={d}
                      type="button"
                      className="chip"
                      disabled={m.self}
                      aria-pressed={perms.includes(key)}
                      onClick={() => setPerms(perms.includes(key) ? perms.filter((x) => x !== key) : [...perms, key])}
                    >
                      {pl.admin.divisions[d] ?? d}
                      {/* the division includes its assistants (Runner, Barback, pomocnik) — say so on the chip */}
                      {POSITIONS.filter((p) => p !== d && divisionOf(p) === d).map((p) => (
                        <span key={p} className="chip-extra">
                          + {pl.admin.positions[p] ?? p}
                        </span>
                      ))}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div>
              <Btn kind="primary" disabled={!dirty || busy || m.self} onClick={() => void save()}>
                {t.save}
              </Btn>
            </div>
            {!m.self && (
              <>
                <Hourly m={m} locationId={props.locationId} onSaved={props.onSaved} onError={props.onError} />
                <Access m={m} onSaved={props.onSaved} onError={props.onError} onSecret={props.onSecret} onRemoved={props.onRemoved} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const POS_LABEL = (p: string) => pl.admin.positions[p] ?? p;

/** „Rozlicza czas pracy” (mockup 17): position for the hours, hourly rate, from when; PIN state. */
function Hourly({ m, locationId, onSaved, onError }: { m: Manager; locationId: string; onSaved: () => void; onError: (s: string) => void }) {
  const { can } = usePanel();
  const cur = m.hours?.[locationId];
  const [on, setOn] = useState(Boolean(m.tracksTime && cur));
  const [position, setPosition] = useState(cur?.position && cur.position !== 'shift_manager' ? cur.position : 'shift_manager');
  const [rate, setRate] = useState(cur?.rate != null ? String(cur.rate).replace('.', ',') : '');
  const [from, setFrom] = useState(cur?.rateFrom ?? cur?.startDate ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date()));
  const [busy, setBusy] = useState(false);
  const wages = can('wages.manage');
  async function send(enabled: boolean) {
    setBusy(true);
    try {
      await api(`/api/admin/managers/${m.id}/time`, {
        method: 'PUT',
        body: enabled ? { locationId, enabled: true, position, rate: wages && rate ? rate : null, validFrom: from } : { locationId, enabled: false },
      });
      onSaved();
    } catch (e) {
      onError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mgr-box">
      <div className="mgr-row">
        <div>
          <b>{t.hourly}</b>
          <p className="muted">{t.hourlyHint}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={t.hourly}
          className="ntf-switch"
          disabled={busy}
          onClick={() => {
            if (on && m.tracksTime) void send(false);
            setOn(!on);
          }}
        >
          <span />
        </button>
      </div>
      {on && (
        <>
          <div className="mgr-three">
            <div className="field">
              <label htmlFor={`hp-${m.id}`}>{t.hourlyPosition}</label>
              <select id={`hp-${m.id}`} value={position} onChange={(e) => setPosition(e.target.value)}>
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {POS_LABEL(p)}
                  </option>
                ))}
              </select>
            </div>
            {wages && (
              <div className="field">
                <label htmlFor={`hr-${m.id}`}>{t.hourlyRate}</label>
                <RateInput id={`hr-${m.id}`} value={rate} onChange={setRate} />
              </div>
            )}
            <div className="field">
              <label htmlFor={`hf-${m.id}`}>{t.hourlyFrom}</label>
              <DateField id={`hf-${m.id}`} value={from} onChange={(v) => v && setFrom(v)} />
            </div>
          </div>
          {m.tracksTime && <p className="muted mgr-pin">{m.pinSet ? t.pinSet : t.pinMissing}</p>}
          <div>
            <Btn kind="primary" disabled={busy} onClick={() => void send(true)}>
              {m.tracksTime ? t.hourlySave : t.hourlyEnable}
            </Btn>
          </div>
        </>
      )}
    </section>
  );
}

/** „Wyłącz dostęp” → „Włącz ponownie” / „Usuń na zawsze” (owner, 2026-10-17). */
function Access({ m, onSaved, onError, onSecret, onRemoved }: { m: Manager; onSaved: () => void; onError: (s: string) => void; onSecret: (i: SecretInfo) => void; onRemoved: () => void }) {
  const [deleting, setDeleting] = useState(false);
  async function post(action: 'deactivate' | 'reactivate') {
    if (action === 'deactivate' && !window.confirm(t.deactivateConfirm(`${m.firstName} ${m.lastName}`))) return;
    try {
      const r = await api<{ login?: string; tempSecret?: string }>(`/api/admin/managers/${m.id}/${action}`, { method: 'POST' });
      if (r.tempSecret) onSecret({ name: `${m.firstName} ${m.lastName}`, login: r.login!, tempSecret: r.tempSecret, secretKind: 'password' });
      onSaved();
    } catch (e) {
      onError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }
  return (
    <section className="mgr-box">
      {m.status === 'active' ? (
        <div className="mgr-row">
          <div>
            <b>{t.deactivate}</b>
            <p className="muted">{t.deactivateHint}</p>
          </div>
          <Btn kind="danger" onClick={() => void post('deactivate')}>
            {t.deactivate}
          </Btn>
        </div>
      ) : (
        <div className="mgr-row">
          <div>
            <b>{t.inactiveTitle}</b>
            <p className="muted">{t.inactiveHint}</p>
          </div>
          <div className="btn-row">
            <Btn onClick={() => void post('reactivate')}>{t.reactivate}</Btn>
            <Btn kind="danger" onClick={() => setDeleting(true)}>
              {t.deleteForever}
            </Btn>
          </div>
        </div>
      )}
      {deleting && (
        <DeleteForeverModal
          title={t.deleteTitle(`${m.firstName} ${m.lastName}`)}
          impactPath={null}
          confirmText={m.login}
          deletePath={`/api/admin/managers/${m.id}`}
          onDeleted={() => {
            setDeleting(false);
            onRemoved();
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </section>
  );
}

function AddManager({ locationId, onClose, onCreated }: { locationId: string; onClose: () => void; onCreated: (i: SecretInfo) => void }) {
  const [firstName, setFirst] = useState('');
  const [lastName, setLast] = useState('');
  const [role, setRole] = useState<ManagerRole>('floor_manager');
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await api<{ login: string; tempSecret: string }>('/api/admin/managers', {
        method: 'POST',
        body: { firstName, lastName, locationId, permissions: rolePermissions(role) },
      });
      onCreated({ name: `${firstName} ${lastName}`, login: res.login, tempSecret: res.tempSecret, secretKind: 'password' });
    } catch (err) {
      setError(errorText(err instanceof ApiFailure ? err.code : 'generic'));
    }
  }
  return (
    <Modal title={t.add} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="field">
          <label htmlFor="mfn">{pl.admin.employees.firstName}</label>
          <input id="mfn" value={firstName} onChange={(e) => setFirst(e.target.value)} maxLength={60} />
        </div>
        <div className="field">
          <label htmlFor="mln">{pl.admin.employees.lastName}</label>
          <input id="mln" value={lastName} onChange={(e) => setLast(e.target.value)} maxLength={80} />
        </div>
        <div className="field">
          <label htmlFor="mrole">{t.role}</label>
          <select id="mrole" value={role} onChange={(e) => setRole(e.target.value as ManagerRole)}>
            {(Object.keys(MANAGER_ROLES) as ManagerRole[]).map((r) => (
              <option key={r} value={r}>
                {t.roles[r]}
              </option>
            ))}
          </select>
          <span className="muted" style={{ fontSize: 12 }}>
            {t.roleHints[role]}
          </span>
        </div>
        <ErrorBox message={error} />
        <div className="btn-row">
          <Btn kind="primary" type="submit" disabled={!firstName.trim() || !lastName.trim()}>
            {t.add}
          </Btn>
          <Btn onClick={onClose}>{pl.admin.cancel}</Btn>
        </div>
      </form>
    </Modal>
  );
}
