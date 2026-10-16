import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { ErrorBox, LogoLoader } from '../ui';
import { Btn } from './common';
import { usePanel } from './Panel';

const t = pl.admin.locations;
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

interface LocationSettings {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  openingHours: Record<string, string>;
  staffNote: string | null;
  dayStartHour: number;
  staleHours: number;
  punchPhoto: boolean;
}

export function Locations() {
  const { refreshMe, locationId } = usePanel();
  const [list, setList] = useState<{ id: string; name: string }[] | null>(null);
  const [selected, setSelected] = useState<string>(locationId);
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
      const r = await api<{ id: string }>('/api/admin/locations', { method: 'POST', body: { name } });
      setName('');
      await load();
      await refreshMe();
      setSelected(r.id);
    } catch (err) {
      setError(errorText(err instanceof ApiFailure ? err.code : 'generic'));
    }
  }

  return (
    <>
      <h1 className="page-title">{t.title}</h1>
      <ErrorBox message={error} />
      <div className="btn-row" role="tablist" aria-label={t.title}>
        {list?.map((l) => (
          <button key={l.id} role="tab" className="chip" aria-selected={selected === l.id} aria-pressed={selected === l.id} onClick={() => setSelected(l.id)} style={{ minHeight: 42, fontSize: 15 }}>
            {l.name}
          </button>
        ))}
      </div>
      {list === null && <LogoLoader />}
      {list && selected && (
        <LocationSettingsView
          key={selected}
          id={selected}
          onSaved={async () => {
            await load();
            await refreshMe();
          }}
        />
      )}
      <form onSubmit={submit} className="card" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', maxWidth: 920 }}>
        <div className="field" style={{ flex: '1 1 220px' }}>
          <label htmlFor="locname">{t.newLocation}</label>
          <input id="locname" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t.name} />
        </div>
        <Btn kind="primary" type="submit" disabled={!name.trim()}>
          {t.add}
        </Btn>
      </form>
    </>
  );
}

function LocationSettingsView({ id, onSaved }: { id: string; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<LocationSettings | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ location: LocationSettings; counts: Record<string, number>; canEdit: boolean }>(`/api/admin/locations/${id}/settings`)
      .then((r) => {
        setForm(r.location);
        setCounts(r.counts);
        setCanEdit(r.canEdit);
      })
      .catch((e) => setError(errorText(e instanceof ApiFailure ? e.code : 'generic')));
  }, [id]);

  if (!form) return error ? <ErrorBox message={error} /> : <LogoLoader />;
  const set = <K extends keyof LocationSettings>(k: K, v: LocationSettings[K]) => {
    setSaved(false);
    setForm({ ...form, [k]: v });
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/locations/${id}/settings`, { method: 'PUT', body: form });
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(errorText(err instanceof ApiFailure ? err.code : 'generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="loc-grid">
      {counts && (
        <section className="card loc-summary">
          <div className="label">{t.summary}</div>
          <div className="loc-counts">
            {Object.entries(t.counts).map(([k, label]) => (
              <div key={k} className="loc-count">
                <span className="v">{counts[k] ?? 0}</span>
                <span className="k">{label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <fieldset className="card loc-section" disabled={!canEdit}>
        <legend className="label">{t.details}</legend>
        <div className="field">
          <label htmlFor="loc-name">{t.name}</label>
          <input id="loc-name" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} required />
        </div>
        <div className="field">
          <label htmlFor="loc-address">{t.address}</label>
          <input id="loc-address" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} maxLength={200} />
        </div>
        <div className="loc-two">
          <div className="field">
            <label htmlFor="loc-phone">{t.phone}</label>
            <input id="loc-phone" type="tel" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} maxLength={40} />
          </div>
          <div className="field">
            <label htmlFor="loc-email">{t.email}</label>
            <input id="loc-email" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} maxLength={120} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="loc-note">{t.staffNote}</label>
          <textarea id="loc-note" value={form.staffNote ?? ''} onChange={(e) => set('staffNote', e.target.value)} maxLength={1000} />
          <span className="muted" style={{ fontSize: 12 }}>
            {t.staffNoteHint}
          </span>
        </div>
      </fieldset>

      <fieldset className="card loc-section" disabled={!canEdit}>
        <legend className="label">{t.hours}</legend>
        <span className="muted" style={{ fontSize: 12 }}>
          {t.hoursHint}
        </span>
        {DAYS.map((d) => (
          <div key={d} className="loc-day">
            <label htmlFor={`loc-h-${d}`}>{t.days[d]}</label>
            <input id={`loc-h-${d}`} value={form.openingHours[d] ?? ''} onChange={(e) => set('openingHours', { ...form.openingHours, [d]: e.target.value })} maxLength={40} placeholder="08:00–02:00" />
          </div>
        ))}
      </fieldset>

      <fieldset className="card loc-section" disabled={!canEdit}>
        <legend className="label">{t.timeRules}</legend>
        <div className="field">
          <label htmlFor="loc-start">{t.dayStart}</label>
          <select id="loc-start" value={form.dayStartHour} onChange={(e) => set('dayStartHour', Number(e.target.value))}>
            {Array.from({ length: 13 }, (_, h) => (
              <option key={h} value={h}>
                {t.hourOption(h)}
              </option>
            ))}
          </select>
          <span className="muted" style={{ fontSize: 12 }}>
            {t.dayStartHint}
          </span>
        </div>
        <div className="field">
          <label htmlFor="loc-stale">{t.stale}</label>
          <select id="loc-stale" value={form.staleHours} onChange={(e) => set('staleHours', Number(e.target.value))}>
            {Array.from({ length: 17 }, (_, i) => i + 8).map((h) => (
              <option key={h} value={h}>
                {h} h
              </option>
            ))}
          </select>
          <span className="muted" style={{ fontSize: 12 }}>
            {t.staleHint}
          </span>
        </div>
        <div className="field">
          <label className="check">
            <input type="checkbox" checked={form.punchPhoto} onChange={(e) => set('punchPhoto', e.target.checked)} />
            <span>{t.punchPhoto}</span>
          </label>
          <span className="muted" style={{ fontSize: 12 }}>
            {t.punchPhotoHint}
          </span>
        </div>
      </fieldset>

      <div className="loc-actions">
        <ErrorBox message={error} />
        {canEdit ? (
          <div className="btn-row" style={{ alignItems: 'center' }}>
            <Btn kind="primary" type="submit" disabled={busy || !form.name.trim()}>
              {t.save}
            </Btn>
            {saved && <span className="muted">{t.saved}</span>}
          </div>
        ) : (
          <span className="muted">{t.readOnly}</span>
        )}
      </div>
    </form>
  );
}
