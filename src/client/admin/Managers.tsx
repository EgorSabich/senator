import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PERMISSIONS } from '../../shared/constants';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { ErrorBox } from '../ui';
import { Btn, formatDateTime, Modal, SecretCardModal, type SecretInfo } from './common';
import { usePanel } from './Panel';

interface Manager {
  id: string;
  firstName: string;
  lastName: string;
  login: string;
  status: string;
  lastLoginAt: number | null;
  permissions: Record<string, string[]>;
}
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
      {list === null && <p className="muted">{pl.app.loading}</p>}
      {list?.length === 0 && <p className="muted">{t.empty}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
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

function ManagerCard(props: { m: Manager; locationId: string; locName: string; onSaved: () => void; onError: (s: string) => void }) {
  const { m } = props;
  const [perms, setPerms] = useState<string[]>(m.permissions[props.locationId] ?? []);
  const [busy, setBusy] = useState(false);
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

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }} aria-label={`${m.firstName} ${m.lastName}`}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
          {m.firstName} {m.lastName}
        </h2>
        <span className="muted" style={{ fontSize: 12 }}>
          {m.login} · {pl.admin.employees.lastLogin.toLowerCase()}: {m.lastLoginAt ? formatDateTime(m.lastLoginAt) : pl.admin.employees.never}
        </span>
      </div>
      <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <legend className="label" style={{ marginBottom: 8 }}>
          {t.permissionsIn(props.locName)}
        </legend>
        {PERMISSIONS.map((p) => (
          <label key={p} className="check">
            <input type="checkbox" checked={perms.includes(p)} onChange={(e) => setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))} />
            <span>{pl.admin.permissions[p]}</span>
          </label>
        ))}
      </fieldset>
      <div>
        <Btn kind="primary" disabled={!dirty || busy} onClick={() => void save()}>
          {t.save}
        </Btn>
      </div>
    </section>
  );
}

function AddManager({ locationId, onClose, onCreated }: { locationId: string; onClose: () => void; onCreated: (i: SecretInfo) => void }) {
  const [firstName, setFirst] = useState('');
  const [lastName, setLast] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await api<{ login: string; tempSecret: string }>('/api/admin/managers', { method: 'POST', body: { firstName, lastName, locationId } });
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
