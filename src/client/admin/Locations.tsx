import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { ErrorBox } from '../ui';
import { Btn } from './common';
import { usePanel } from './Panel';

const t = pl.admin.locations;

export function Locations() {
  const { refreshMe } = usePanel();
  const [list, setList] = useState<{ id: string; name: string }[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setList((await api<{ locations: { id: string; name: string }[] }>('/api/admin/locations')).locations);
  }, []);
  useEffect(() => {
    void load().catch(() => setError(errorText('generic')));
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/api/admin/locations', { method: 'POST', body: { name } });
      setName('');
      await load();
      await refreshMe();
    } catch (err) {
      setError(errorText(err instanceof ApiFailure ? err.code : 'generic'));
    }
  }

  return (
    <>
      <h1 className="page-title">{t.title}</h1>
      <ErrorBox message={error} />
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560 }}>
        {list?.map((l) => (
          <div key={l.id} style={{ fontSize: 16, fontWeight: 600, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            {l.name}
          </div>
        ))}
        <form onSubmit={submit} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 8 }}>
          <div className="field" style={{ flex: '1 1 220px' }}>
            <label htmlFor="locname">{t.name}</label>
            <input id="locname" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <Btn kind="primary" type="submit" disabled={!name.trim()}>
            {t.add}
          </Btn>
        </form>
      </div>
    </>
  );
}
