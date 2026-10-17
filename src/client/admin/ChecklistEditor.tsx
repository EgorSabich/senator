/**
 * Checklists edited right in "Listy" (owner, 2026-10-17): choose a division, pick a list, change it point by point —
 * sections, item texts, order, "Wymagaj zdjęcia" per item. "Zapisz" publishes at once.
 * The list is still a material underneath (versions, positions); the editor writes headings + bullet lists.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { checklistItems } from '../../shared/checklist';
import { docToModel, modelToDoc, uid, type Model, type Section } from './checklistModel';
import { divisionOf, POSITIONS } from '../../shared/constants';
import type { RtNode } from '../../shared/richtext';
import { comparePl } from '../../shared/text';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { navigate, onNav } from '../router';
import { ErrorBox, LogoLoader } from '../ui';
import { Btn, DeleteForeverModal, Modal } from './common';
import { usePanel } from './Panel';

const t = pl.admin.checklists.edit;
export const DIVISION_ORDER = ['waiter', 'host', 'bartender', 'kitchen', 'hookah_master', 'call_center', 'shift_manager'];

export interface ListRow {
  id: string;
  title: string;
  draftTitle?: string | null;
  status: 'draft' | 'published' | 'archived';
  positions: string[];
  editable?: boolean;
  shared?: boolean;
}

/** Divisions a list is for (empty positions = every division). */
export const listDivisions = (positions: string[]) => [...new Set(positions.map(divisionOf))];
export const inDivision = (positions: string[], division: string) => division === 'all' || !positions.length || listDivisions(positions).includes(division);

/** Division chips used in every mode of "Listy". */
export function DivisionChips({ value, onChange, present }: { value: string; onChange: (d: string) => void; present: string[] }) {
  if (present.length < 2) return null;
  return (
    <div className="btn-row" role="group" aria-label={t.division}>
      <button className="chip" aria-pressed={value === 'all'} onClick={() => onChange('all')}>
        {pl.admin.time.allDivisions}
      </button>
      {DIVISION_ORDER.filter((d) => present.includes(d)).map((d) => (
        <button key={d} className="chip" aria-pressed={value === d} onClick={() => onChange(d)}>
          {pl.admin.divisions[d] ?? d}
        </button>
      ))}
    </div>
  );
}

/* ───────── List of lists ───────── */

export function ChecklistManager({ division, setDivision }: { division: string; setDivision: (d: string) => void }) {
  const { locationId } = usePanel();
  const [lists, setLists] = useState<ListRow[] | null>(null);
  const [scope, setScope] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [archive, setArchive] = useState(false);
  const [deleting, setDeleting] = useState<ListRow | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await api<{ items: ListRow[]; divisions: string[] | null }>(`/api/admin/locations/${locationId}/content?kind=checklist`);
      setLists(r.items);
      setScope(r.divisions);
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }, [locationId]);
  useEffect(() => {
    void load();
  }, [load]);
  const present = useMemo(() => [...new Set((lists ?? []).flatMap((l) => (l.positions.length ? listDivisions(l.positions) : [])))], [lists]);
  const shown = (lists ?? [])
    .filter((l) => (archive ? l.status === 'archived' : l.status !== 'archived'))
    .filter((l) => inDivision(l.positions, division)).sort((a, b) => comparePl(a.draftTitle ?? a.title, b.draftTitle ?? b.title));

  return (
    <>
      <ErrorBox message={error} />
      <DivisionChips value={division} onChange={setDivision} present={present} />
      <div className="btn-row">
        <button className="chip" aria-pressed={!archive} onClick={() => setArchive(false)}>
          {t.active}
        </button>
        <button className="chip" aria-pressed={archive} onClick={() => setArchive(true)}>
          {t.archived} · {(lists ?? []).filter((l) => l.status === 'archived').length}
        </button>
      </div>
      {lists === null && <LogoLoader />}
      {lists && shown.length === 0 && <p className="muted">{archive ? t.noneArchived : t.none}</p>}
      <div className="list">
        {shown.map((l) =>
          archive ? (
            <div key={l.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: 14 }}>
              <span>
                <strong style={{ fontSize: 15 }}>{l.draftTitle ?? l.title}</strong>
                <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                  {l.positions.length ? l.positions.map((p) => pl.admin.positions[p] ?? p).join(', ') : pl.admin.content.forAll}
                </span>
              </span>
              {l.editable !== false && (
                <span className="btn-row">
                  <Btn
                    onClick={async () => {
                      try {
                        await api(`/api/admin/content/${l.id}/restore`, { method: 'POST' });
                        await load();
                      } catch (e) {
                        setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
                      }
                    }}
                  >
                    {t.restore}
                  </Btn>
                  <Btn kind="danger" onClick={() => setDeleting(l)}>
                    {t.deleteForever}
                  </Btn>
                </span>
              )}
            </div>
          ) : (
          <button key={l.id} className="row-btn" onClick={() => navigate(`/panel/listy/edycja/${l.id}`)} disabled={l.editable === false}>
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%' }}>
              <strong style={{ fontSize: 15 }}>{l.draftTitle ?? l.title}</strong>
              {l.status === 'draft' ? <span className="badge warn">{t.draft}</span> : <span className="badge ok">{t.live}</span>}
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              {l.positions.length ? l.positions.map((p) => pl.admin.positions[p] ?? p).join(', ') : pl.admin.content.forAll}
              {l.editable === false ? ` · ${t.readOnly}` : ''}
            </span>
          </button>
          ),
        )}
      </div>
      {deleting && (
        <DeleteForeverModal
          title={pl.admin.deleteForever.itemTitle(deleting.title)}
          impactPath={`/api/admin/content/${deleting.id}/deletion`}
          lines={pl.admin.deleteForever.contentLines}
          deletePath={`/api/admin/content/${deleting.id}`}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            void load();
          }}
        />
      )}
      <div>
        <Btn kind="primary" onClick={() => setCreating(true)}>
          {t.newList}
        </Btn>
      </div>
      {creating && <NewList locationId={locationId} scope={scope} division={division} onClose={() => setCreating(false)} />}
    </>
  );
}

function NewList({ locationId, scope, division, onClose }: { locationId: string; scope: string[] | null; division: string; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function create() {
    try {
      const r = await api<{ id: string }>(`/api/admin/locations/${locationId}/content`, { method: 'POST', body: { kind: 'checklist', title } });
      // a new list starts with the chosen division (a leader's: their own ones)
      const positions = division !== 'all' ? POSITIONS.filter((p) => divisionOf(p) === division && (!scope || scope.includes(p))) : null;
      if (positions?.length) await api(`/api/admin/content/${r.id}`, { method: 'PUT', body: { positions } });
      navigate(`/panel/listy/edycja/${r.id}`);
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }
  return (
    <Modal title={t.newList} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <div className="field">
          <label htmlFor="nl-title">{t.listTitle}</label>
          <input id="nl-title" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder={t.titlePlaceholder} />
        </div>
        <ErrorBox message={error} />
        <div className="btn-row">
          <Btn kind="primary" type="submit" disabled={!title.trim()}>
            {t.create}
          </Btn>
          <Btn onClick={onClose}>{pl.admin.cancel}</Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ───────── One list, point by point ───────── */

interface Detail {
  item: { id: string; title: string; checklistMode: 'individual' | 'shared' | null; positions: string[]; checklistPhotoKeys?: string[]; checklistSharedKeys?: string[]; editable?: boolean; status: string };
  draft: { title: string; body: RtNode } | null;
  current: { title: string; body: RtNode } | null;
}

export function ChecklistEditor({ id }: { id: string }) {
  const { locationId } = usePanel();
  const [model, setModel] = useState<Model | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [status, setStatus] = useState('');
  const [scope, setScope] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, list] = await Promise.all([
        api<Detail>(`/api/admin/content/${id}`),
        api<{ divisions: string[] | null }>(`/api/admin/locations/${locationId}/content?kind=checklist`),
      ]);
      const body = d.draft?.body ?? d.current?.body ?? null;
      const m: Model = {
        title: d.draft?.title ?? d.current?.title ?? d.item.title,
        mode: d.item.checklistMode ?? 'individual',
        positions: d.item.positions,
        ...docToModel(body, d.item.checklistPhotoKeys ?? [], d.item.checklistSharedKeys ?? []),
      };
      setModel(m);
      setSaved(JSON.stringify(m));
      setStatus(d.item.status);
      setScope(list.divisions);
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }, [id, locationId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!model) return error ? <ErrorBox message={error} /> : <LogoLoader />;
  const dirty = JSON.stringify(model) !== saved || status !== 'published';
  const set = (f: (m: Model) => Model) => {
    setNotice(null);
    setModel((m) => (m ? f(m) : m));
  };
  const setSection = (si: number, f: (s: Section) => Section) => set((m) => ({ ...m, sections: m.sections.map((s, i) => (i === si ? f(s) : s)) }));
  const move = <T,>(arr: T[], i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= arr.length) return arr;
    const next = arr.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  };
  const allItems = model.sections.flatMap((s) => s.items).filter((i) => i.text.trim());
  const rewritten = allItems.filter((i) => i.origKey).length; // only used for the warning below
  const allowed = POSITIONS.filter((p) => !scope || scope.includes(p));

  async function save() {
    if (!model) return;
    setBusy(true);
    setError(null);
    try {
      const doc = modelToDoc(model);
      const keys = checklistItems(doc);
      const flat = model.sections.flatMap((s) => s.items.filter((i) => i.text.trim()));
      const photoKeys = keys.filter((_, i) => flat[i]?.photo).map((k) => k.key);
      const sharedKeys = keys.filter((_, i) => flat[i]?.shared).map((k) => k.key);
      await api(`/api/admin/content/${id}`, {
        method: 'PUT',
        body: { title: model.title.trim(), body: doc, checklistMode: 'individual', positions: model.positions, checklistPhotoKeys: photoKeys, checklistSharedKeys: sharedKeys },
      });
      try {
        await api(`/api/admin/content/${id}/publish`, { method: 'POST', body: { changeLevel: 'clarification' } });
      } catch (e) {
        if (!(e instanceof ApiFailure && e.code === 'no_changes')) throw e;
      }
      setNotice(t.saved);
      await load();
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    } finally {
      setBusy(false);
    }
  }

  const changedTexts = (() => {
    const before = JSON.parse(saved) as Model;
    const old = new Map(before.sections.flatMap((s) => s.items.map((i) => [i.uid, `${s.name}\u0001${i.text}`])));
    let n = 0;
    for (const s of model.sections) for (const i of s.items) if (i.origKey && old.has(i.uid) && old.get(i.uid) !== `${s.name}\u0001${i.text}`) n++;
    return n;
  })();

  return (
    <div className="cle">
      <div className="cle-head">
        <a href="/panel/listy/edycja" onClick={onNav('/panel/listy/edycja')} className="muted">
          ← {t.back}
        </a>
        <div className="btn-row">
          <Btn
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(t.confirmArchive(model.title))) return;
              try {
                await api(`/api/admin/content/${id}/archive`, { method: 'POST' });
                navigate('/panel/listy/edycja');
              } catch (e) {
                setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
              }
            }}
          >
            {t.archive}
          </Btn>
          <Btn kind="primary" disabled={busy || !dirty || !model.title.trim() || !allItems.length || (Boolean(scope) && !model.positions.length)} onClick={() => void save()}>
            {busy ? t.saving : t.save}
          </Btn>
        </div>
      </div>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <ErrorBox message={error} />

      <section className="card cle-settings">
        <div className="field">
          <label htmlFor="cle-title">{t.listTitle}</label>
          <input id="cle-title" value={model.title} maxLength={160} onChange={(e) => set((m) => ({ ...m, title: e.target.value }))} />
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          {t.modeHint}
        </p>
        <fieldset className="cle-positions">
          <legend>{t.forWhom}</legend>
          <div className="btn-row">
            {allowed.map((p) => (
              <button
                key={p}
                type="button"
                className="chip"
                aria-pressed={model.positions.includes(p)}
                onClick={() => set((m) => ({ ...m, positions: m.positions.includes(p) ? m.positions.filter((x) => x !== p) : [...m.positions, p] }))}
              >
                {pl.admin.positions[p] ?? p}
              </button>
            ))}
          </div>
          {!model.positions.length && <span className="muted" style={{ fontSize: 12 }}>{scope ? t.pickPosition : pl.admin.content.forAll}</span>}
        </fieldset>
      </section>

      {model.sections.map((s, si) => (
        <section key={s.uid} className="card cle-section">
          <div className="cle-section-head">
            <input
              className="cle-section-name"
              value={s.name}
              maxLength={120}
              placeholder={t.sectionPlaceholder}
              aria-label={t.sectionName}
              onChange={(e) => setSection(si, (x) => ({ ...x, name: e.target.value }))}
            />
            <div className="cle-tools">
              <button type="button" className="cle-icon" aria-label={t.up} disabled={si === 0} onClick={() => set((m) => ({ ...m, sections: move(m.sections, si, -1) }))}>
                ↑
              </button>
              <button type="button" className="cle-icon" aria-label={t.down} disabled={si === model.sections.length - 1} onClick={() => set((m) => ({ ...m, sections: move(m.sections, si, 1) }))}>
                ↓
              </button>
              <button
                type="button"
                className="cle-icon"
                aria-label={t.removeSection}
                onClick={() =>
                  (!s.items.length || window.confirm(t.confirmRemoveSection(s.name || t.noName, s.items.length))) &&
                  set((m) => ({ ...m, sections: m.sections.length > 1 ? m.sections.filter((_, i) => i !== si) : [{ uid: uid(), name: '', items: [] }] }))
                }
              >
                ✕
              </button>
            </div>
          </div>
          <ol className="cle-items">
            {s.items.map((it, ii) => (
              <li key={it.uid} className="cle-item">
                <textarea
                  rows={1}
                  value={it.text}
                  maxLength={500}
                  placeholder={t.itemPlaceholder}
                  aria-label={t.itemText(ii + 1)}
                  onChange={(e) => setSection(si, (x) => ({ ...x, items: x.items.map((y, k) => (k === ii ? { ...y, text: e.target.value.replace(/\n/g, ' ') } : y)) }))}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = 'auto';
                    el.style.height = `${el.scrollHeight}px`;
                  }}
                  ref={(el) => {
                    if (el) {
                      el.style.height = 'auto';
                      el.style.height = `${el.scrollHeight}px`;
                    }
                  }}
                />
                <div className="cle-tools">
                  <div className="seg cle-mode" role="group" aria-label={t.whoTicks}>
                    <button type="button" aria-pressed={!it.shared} onClick={() => setSection(si, (x) => ({ ...x, items: x.items.map((y, k) => (k === ii ? { ...y, shared: false } : y)) }))}>
                      {t.everyone}
                    </button>
                    <button type="button" aria-pressed={it.shared} onClick={() => setSection(si, (x) => ({ ...x, items: x.items.map((y, k) => (k === ii ? { ...y, shared: true } : y)) }))}>
                      {t.oneForShift}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="chip cle-photo"
                    aria-pressed={it.photo}
                    onClick={() => setSection(si, (x) => ({ ...x, items: x.items.map((y, k) => (k === ii ? { ...y, photo: !y.photo } : y)) }))}
                  >
                    {it.photo ? t.photoOn : t.photoOff}
                  </button>
                  <button type="button" className="cle-icon" aria-label={t.up} disabled={ii === 0} onClick={() => setSection(si, (x) => ({ ...x, items: move(x.items, ii, -1) }))}>
                    ↑
                  </button>
                  <button type="button" className="cle-icon" aria-label={t.down} disabled={ii === s.items.length - 1} onClick={() => setSection(si, (x) => ({ ...x, items: move(x.items, ii, 1) }))}>
                    ↓
                  </button>
                  <button type="button" className="cle-icon" aria-label={t.removeItem} onClick={() => setSection(si, (x) => ({ ...x, items: x.items.filter((_, k) => k !== ii) }))}>
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <div>
            <Btn onClick={() => setSection(si, (x) => ({ ...x, items: [...x.items, { uid: uid(), text: '', photo: false, shared: false, origKey: null }] }))}>{t.addItem}</Btn>
          </div>
        </section>
      ))}
      <div className="btn-row">
        <Btn onClick={() => set((m) => ({ ...m, sections: [...m.sections, { uid: uid(), name: '', items: [{ uid: uid(), text: '', photo: false, shared: false, origKey: null }] }] }))}>{t.addSection}</Btn>
      </div>
      {changedTexts > 0 && rewritten > 0 && <p className="muted" style={{ fontSize: 12 }}>{t.changedWarning(changedTexts)}</p>}
      {model.extra.length > 0 && <p className="muted" style={{ fontSize: 12 }}>{t.extraKept}</p>}
    </div>
  );
}
