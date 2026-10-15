import { LogoLoader } from '../ui';
import { useCallback, useEffect, useState } from 'react';
import { POSITIONS } from '../../shared/constants';
import { comparePl } from '../../shared/text';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { navigate } from '../router';
import { ErrorBox } from '../ui';
import { Btn, Icon, Modal } from './common';
import { usePanel } from './Panel';

const t = pl.admin.programs;
const errOf = (e: unknown) => errorText(e instanceof ApiFailure ? e.code : 'generic');

interface ProgramRow {
  id: string;
  name: string;
  position: string;
  isDefault: boolean;
  moduleCount: number;
}
interface ModuleItem {
  id: string;
  contentItemId: string;
  isMandatory: boolean;
  kind: string;
  title: string;
  status: string;
}
interface Mod {
  id: string;
  title: string;
  description: string | null;
  isMandatory: boolean;
  unlockRule: 'open' | 'after_module' | 'after_all_mandatory';
  unlockAfterModuleId: string | null;
  items: ModuleItem[];
}
interface Detail {
  program: { id: string; name: string; position: string; isDefault: boolean };
  modules: Mod[];
}
interface ContentRow {
  id: string;
  kind: string;
  title: string;
  status: string;
  versionNo: number | null;
}

export function Programs({ selectedId }: { selectedId: string | null }) {
  const { locationId } = usePanel();
  const [list, setList] = useState<ProgramRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setList((await api<{ programs: ProgramRow[] }>(`/api/admin/locations/${locationId}/programs`)).programs);
    } catch (e) {
      setError(errOf(e));
    }
  }, [locationId]);
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
      <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.5, maxWidth: 760 }}>
        {t.intro}
      </p>
      <ErrorBox message={error} />
      <div className={`split${selectedId ? ' has-selection' : ''}`}>
        <section className="list" aria-label={t.title}>
          {list === null && <LogoLoader />}
          {list?.length === 0 && <p className="muted">{t.empty}</p>}
          {list?.map((p) => (
            <button key={p.id} className="row-btn" aria-current={p.id === selectedId} onClick={() => navigate(`/panel/programy/${p.id}`)}>
              <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%' }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</span>
                {p.isDefault && <span className="badge ok">{t.default}</span>}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {pl.admin.positions[p.position]} · {p.moduleCount} mod.
              </span>
            </button>
          ))}
        </section>
        <section className="detail card" aria-label={t.title}>
          {!selectedId && <p className="muted" style={{ margin: 0 }}>{t.selectHint}</p>}
          {selectedId && (
            <>
              <div className="phone-only" style={{ marginBottom: 14 }}>
                <Btn onClick={() => navigate('/panel/programy')}>‹ {pl.admin.menu.backToList}</Btn>
              </div>
              <ProgramDetail key={selectedId} id={selectedId} onChanged={load} />
            </>
          )}
        </section>
      </div>
      {adding && (
        <AddProgram
          onClose={() => setAdding(false)}
          onDone={async (id) => {
            setAdding(false);
            await load();
            navigate(`/panel/programy/${id}`);
          }}
        />
      )}
    </>
  );
}

function AddProgram({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => Promise<void> }) {
  const { locationId } = usePanel();
  const [name, setName] = useState('Wdrożenie kelnera');
  const [position, setPosition] = useState('waiter');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={t.add} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const res = await api<{ id: string }>(`/api/admin/locations/${locationId}/programs`, { method: 'POST', body: { name, position } });
            await onDone(res.id);
          } catch (err) {
            setError(errOf(err));
          }
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <div className="field">
          <label htmlFor="pname">{t.name}</label>
          <input id="pname" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
        <div className="field">
          <label htmlFor="ppos">{t.position}</label>
          <select id="ppos" value={position} onChange={(e) => setPosition(e.target.value)}>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {pl.admin.positions[p]}
              </option>
            ))}
          </select>
        </div>
        <ErrorBox message={error} />
        <div className="btn-row">
          <Btn kind="primary" type="submit" disabled={!name.trim()}>
            {t.add}
          </Btn>
          <Btn onClick={onClose}>{pl.admin.cancel}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function ProgramDetail({ id, onChanged }: { id: string; onChanged: () => Promise<void> }) {
  const { locationId } = usePanel();
  const [d, setD] = useState<Detail | null>(null);
  const [content, setContent] = useState<ContentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newModule, setNewModule] = useState('');
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    try {
      const [det, c] = await Promise.all([api<Detail>(`/api/admin/programs/${id}`), api<{ items: ContentRow[] }>(`/api/admin/locations/${locationId}/content`)]);
      setD(det);
      setName(det.program.name);
      setContent(c.items.filter((x) => x.status === 'published').sort((a, b) => comparePl(a.title, b.title)));
    } catch (e) {
      setError(errOf(e));
    }
  }, [id, locationId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, msg = t.saved) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(msg);
      await load();
      await onChanged();
    } catch (e) {
      setError(errOf(e));
    }
  }

  if (!d) return error ? <ErrorBox message={error} /> : <LogoLoader />;

  const moveModule = (i: number, dir: -1 | 1) => {
    const ids = d.modules.map((m) => m.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void run(() => api(`/api/admin/programs/${id}/modules/order`, { method: 'POST', body: { ids } }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '1 1 240px' }}>
          <label htmlFor="prn">{t.name}</label>
          <input id="prn" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
        <Btn disabled={!name.trim() || name === d.program.name} onClick={() => void run(() => api(`/api/admin/programs/${id}`, { method: 'PUT', body: { name } }))}>
          {pl.common.save}
        </Btn>
        {!d.program.isDefault && <Btn onClick={() => void run(() => api(`/api/admin/programs/${id}`, { method: 'PUT', body: { isDefault: true } }))}>{t.makeDefault}</Btn>}
      </div>
      <span className="muted" style={{ fontSize: 13 }}>
        {pl.admin.positions[d.program.position]}
        {d.program.isDefault ? ` · ${t.default}` : ''}
      </span>
      <ErrorBox message={error} />
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      {d.modules.map((m, i) => (
        <ModuleCard
          key={m.id}
          index={i}
          m={m}
          modules={d.modules}
          content={content}
          onMove={(dir) => moveModule(i, dir)}
          run={run}
        />
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => api(`/api/admin/programs/${id}/modules`, { method: 'POST', body: { title: newModule } }).then(() => setNewModule('')));
        }}
        style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}
      >
        <div className="field" style={{ flex: '1 1 240px' }}>
          <label htmlFor="newmod">{t.moduleTitle}</label>
          <input id="newmod" value={newModule} onChange={(e) => setNewModule(e.target.value)} maxLength={120} />
        </div>
        <Btn kind="primary" type="submit" disabled={!newModule.trim()}>
          {t.addModule}
        </Btn>
      </form>
    </div>
  );
}

function ModuleCard({
  index,
  m,
  modules,
  content,
  onMove,
  run,
}: {
  index: number;
  m: Mod;
  modules: Mod[];
  content: ContentRow[];
  onMove: (dir: -1 | 1) => void;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [title, setTitle] = useState(m.title);
  const [description, setDescription] = useState(m.description ?? '');
  const [mandatory, setMandatory] = useState(m.isMandatory);
  const [rule, setRule] = useState(m.unlockRule);
  const [after, setAfter] = useState(m.unlockAfterModuleId ?? modules.find((x) => x.id !== m.id)?.id ?? '');
  const [pick, setPick] = useState('');
  const kinds = pl.admin.content.kindOne;

  const saveItems = (items: { contentItemId: string; isMandatory: boolean }[]) => run(() => api(`/api/admin/modules/${m.id}/items`, { method: 'PUT', body: { items } }));
  const current = m.items.map((i) => ({ contentItemId: i.contentItemId, isMandatory: i.isMandatory }));
  const dirty =
    title !== m.title || description !== (m.description ?? '') || mandatory !== m.isMandatory || rule !== m.unlockRule || (rule === 'after_module' && after !== m.unlockAfterModuleId);

  return (
    <section style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }} aria-label={m.title}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span className="label">
          {pl.academy.module} {index + 1}
        </span>
        <div className="btn-row">
          <button className="chip" onClick={() => onMove(-1)} disabled={index === 0} aria-label={t.up}>
            <Icon name="up" size={16} />
          </button>
          <button className="chip" onClick={() => onMove(1)} disabled={index === modules.length - 1} aria-label={t.down}>
            <Icon name="down" size={16} />
          </button>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`mt-${m.id}`}>{t.moduleTitle}</label>
        <input id={`mt-${m.id}`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </div>
      <div className="field">
        <label htmlFor={`md-${m.id}`}>{t.moduleDescription}</label>
        <input id={`md-${m.id}`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
      </div>
      <label className="check">
        <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
        <span>{t.mandatory}</span>
      </label>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 200px' }}>
          <label htmlFor={`mu-${m.id}`}>{t.unlock}</label>
          <select id={`mu-${m.id}`} value={rule} onChange={(e) => setRule(e.target.value as Mod['unlockRule'])}>
            <option value="open">{t.unlockOpen}</option>
            {modules.length > 1 && <option value="after_module">{t.unlockAfter}</option>}
            <option value="after_all_mandatory">{t.unlockAll}</option>
          </select>
        </div>
        {rule === 'after_module' && (
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label htmlFor={`ma-${m.id}`}>{t.afterModule}</label>
            <select id={`ma-${m.id}`} value={after} onChange={(e) => setAfter(e.target.value)}>
              {modules
                .filter((x) => x.id !== m.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
            </select>
          </div>
        )}
      </div>
      <div className="btn-row">
        <Btn
          disabled={!dirty || !title.trim()}
          onClick={() =>
            void run(() =>
              api(`/api/admin/modules/${m.id}`, {
                method: 'PUT',
                body: { title, description, isMandatory: mandatory, unlockRule: rule, unlockAfterModuleId: rule === 'after_module' ? after : null },
              }),
            )
          }
        >
          {t.saveModule}
        </Btn>
        <Btn kind="danger" onClick={() => confirm(t.confirmDeleteModule(m.title)) && void run(() => api(`/api/admin/modules/${m.id}`, { method: 'DELETE' }))}>
          {t.deleteModule}
        </Btn>
      </div>

      <div className="label" style={{ marginTop: 4 }}>
        {t.items}
      </div>
      {m.items.length === 0 && <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t.noItems}</p>}
      {m.items.map((it, i) => (
        <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 10, background: 'var(--surface-2)' }}>
          <span style={{ flex: '1 1 200px', minWidth: 0, fontSize: 14 }}>
            <strong>{it.title}</strong>{' '}
            <span className="muted" style={{ fontSize: 12 }}>
              · {kinds[it.kind]}
              {it.status !== 'published' ? ` · ${t.unpublished}` : ''}
            </span>
          </span>
          <label className="check" style={{ fontSize: 13, minHeight: 0 }}>
            <input
              type="checkbox"
              checked={it.isMandatory}
              onChange={(e) => void saveItems(current.map((c, j) => (j === i ? { ...c, isMandatory: e.target.checked } : c)))}
            />
            <span>{t.itemMandatory}</span>
          </label>
          <button
            className="chip"
            disabled={i === 0}
            aria-label={t.up}
            onClick={() => {
              const next = [...current];
              [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
              void saveItems(next);
            }}
          >
            <Icon name="up" size={16} />
          </button>
          <button
            className="chip"
            disabled={i === m.items.length - 1}
            aria-label={t.down}
            onClick={() => {
              const next = [...current];
              [next[i + 1], next[i]] = [next[i]!, next[i + 1]!];
              void saveItems(next);
            }}
          >
            <Icon name="down" size={16} />
          </button>
          <button className="chip" aria-label={t.remove} onClick={() => void saveItems(current.filter((_, j) => j !== i))}>
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '1 1 260px' }}>
          <label htmlFor={`mp-${m.id}`}>{t.addItem}</label>
          <select id={`mp-${m.id}`} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{t.pickItem}</option>
            {content
              .filter((c) => !m.items.some((i) => i.contentItemId === c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {kinds[c.kind]}: {c.title}
                </option>
              ))}
          </select>
        </div>
        <Btn
          disabled={!pick}
          onClick={() => {
            const id = pick;
            setPick('');
            void saveItems([...current, { contentItemId: id, isMandatory: true }]);
          }}
        >
          {t.addItem}
        </Btn>
      </div>
    </section>
  );
}
