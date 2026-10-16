import { LogoLoader } from '../ui';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CONTENT_KINDS, POSITIONS } from '../../shared/constants';
import { comparePl } from '../../shared/text';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { navigate } from '../router';
import { ErrorBox } from '../ui';
import { Btn, formatDateTime, Modal, storageGet, storageSet } from './common';
import { ContentImport } from './ContentImport';
import { usePanel } from './Panel';

interface Item {
  id: string;
  kind: string;
  title: string;
  draftTitle: string | null;
  section: string | null;
  status: 'draft' | 'published' | 'archived';
  versionNo: number | null;
  hasDraft: boolean;
  imported: boolean;
  shared: boolean;
  editable: boolean;
  requiresAck: boolean;
  positions: string[];
  updatedAt: number;
  tabId?: string | null;
}

export interface KTab {
  id: string;
  title: string;
  positions: string[];
  shared: boolean;
  builtIn: boolean;
  editable: boolean;
  pages: number;
}

const t = pl.admin.content;
const KIND_KEY = 'sa.panel.contentKind';
const POS_KEY = 'sa.panel.contentPosition';

export function ContentList() {
  const { locationId, isOwner } = usePanel();
  const [kind, setKind] = useState<string>(storageGet(KIND_KEY) ?? 'service_book');
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [position, setPosition] = useState<string>(storageGet(POS_KEY) ?? 'all');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [settingPositions, setSettingPositions] = useState(false);
  const [tabs, setTabs] = useState<KTab[]>([]);
  const [tabFilter, setTabFilter] = useState<string>('all');
  const [editingTab, setEditingTab] = useState<KTab | 'new' | null>(null);
  const [divisions, setDivisions] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setItems(null);
    try {
      const res = await api<{ items: Item[]; divisions: string[] | null }>(`/api/admin/locations/${locationId}/content?kind=${kind}`);
      setItems(res.items);
      setDivisions(res.divisions);
      if (kind === 'service_book') setTabs((await api<{ tabs: KTab[] }>(`/api/admin/locations/${locationId}/knowledge-tabs`)).tabs);
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }, [locationId, kind]);
  useEffect(() => {
    void load();
  }, [load]);

  const visible = (items ?? [])
    .filter((i) => (showArchived ? i.status === 'archived' : i.status !== 'archived'))
    .filter((i) => kind !== 'service_book' || tabFilter === 'all' || i.tabId === tabFilter)
    .filter((i) => (position === 'all' ? true : position === 'none' ? i.positions.length === 0 : i.positions.length === 0 || i.positions.includes(position)));
  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const groups = new Map<string, Item[]>();
  for (const i of visible) {
    const key = i.section ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  }
  const sections = [...groups.keys()].sort(comparePl);

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 className="page-title">{t.title}</h1>
        <div className="btn-row">
          <Btn kind="primary" onClick={() => setCreating(true)}>
            {t.new}
          </Btn>
          <Btn onClick={() => setImporting(true)}>{t.importButton}</Btn>
        </div>
      </div>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {(() => {
        const pending = (items ?? []).filter((i) => i.imported && i.versionNo === null && i.status !== 'archived');
        if (!pending.length) return null;
        return (
          <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', padding: 14 }}>
            <span style={{ fontSize: 14, lineHeight: 1.5 }}>{t.importPending(pending.length)}</span>
            <Btn
              kind="primary"
              onClick={async () => {
                if (!confirm(t.importPublishConfirm(pending.length))) return;
                setError(null);
                try {
                  let n = 0;
                  for (let i = 0; i < pending.length; i += 20) {
                    n += (await api<{ published: number }>(`/api/admin/locations/${locationId}/content/import/publish`, { method: 'POST', body: { ids: pending.slice(i, i + 20).map((p) => p.id) } })).published;
                  }
                  setNotice(t.importPublished(n));
                  await load();
                } catch (e) {
                  setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
                }
              }}
            >
              {t.importPublishAll}
            </Btn>
          </div>
        );
      })()}
      <div role="tablist" aria-label={t.title} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, borderBottom: '1px solid var(--border)' }}>
        {CONTENT_KINDS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={k === kind}
            onClick={() => {
              setKind(k);
              storageSet(KIND_KEY, k);
            }}
            style={{
              minHeight: 44,
              padding: '0 12px',
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${k === kind ? 'var(--accent)' : 'transparent'}`,
              color: k === kind ? 'var(--text)' : 'var(--text-muted)',
              fontFamily: 'var(--font-ui)',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {t.kinds[k]}
          </button>
        ))}
      </div>
      {kind === 'service_book' && (
        <div className="kt-bar">
          <div className="btn-row" style={{ alignItems: 'center' }} role="group" aria-label={t.tabs.title}>
            <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
              {t.tabs.title}
            </span>
            <button className="chip" aria-pressed={tabFilter === 'all'} onClick={() => setTabFilter('all')}>
              {t.tabs.all}
            </button>
            {tabs.map((tb) => (
              <button key={tb.id} className="chip" aria-pressed={tabFilter === tb.id} onClick={() => setTabFilter(tb.id)}>
                {tb.title} · {tb.pages}
              </button>
            ))}
            <Btn onClick={() => setEditingTab('new')}>{t.tabs.add}</Btn>
          </div>
          {(() => {
            const cur = tabs.find((x) => x.id === tabFilter);
            if (!cur) return <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t.tabs.hint}</p>;
            return (
              <p className="muted" style={{ margin: 0, fontSize: 13, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>{t.tabs.seenBy(cur.positions.length ? cur.positions.map((p) => pl.admin.positions[p] ?? p).join(', ') : t.forAll)}</span>
                {cur.editable && (
                  <button type="button" className="link-btn" onClick={() => setEditingTab(cur)}>
                    {t.tabs.edit}
                  </button>
                )}
              </p>
            );
          })()}
        </div>
      )}
      <div className="btn-row">
        <button className="chip" aria-pressed={!showArchived} onClick={() => setShowArchived(false)}>
          {t.published} / {t.draft}
        </button>
        <button className="chip" aria-pressed={showArchived} onClick={() => setShowArchived(true)}>
          {t.archived}
        </button>
      </div>
      <div className="btn-row" style={{ alignItems: 'center' }} aria-label={t.seenBy}>
        <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
          {t.seenBy}
        </span>
        {['all', ...POSITIONS, 'none'].map((p) => (
          <button
            key={p}
            className="chip"
            aria-pressed={position === p}
            onClick={() => {
              setPosition(p);
              storageSet(POS_KEY, p);
            }}
          >
            {p === 'all' ? t.allPositions : p === 'none' ? t.noPositionOnly : pl.admin.positions[p]}
          </button>
        ))}
      </div>
      <div className="btn-row" style={{ alignItems: 'center' }}>
        <Btn
          onClick={() => {
            setSelecting(!selecting);
            setPicked(new Set());
          }}
        >
          {selecting ? t.selectDone : t.select}
        </Btn>
        {selecting && (
          <>
            <Btn onClick={() => setPicked(new Set(visible.filter((i) => i.editable).map((i) => i.id)))}>{t.selectAll}</Btn>
            <Btn kind="primary" disabled={!picked.size} onClick={() => setSettingPositions(true)}>
              {t.setPositions}
            </Btn>
            <span className="muted" style={{ fontSize: 13 }}>
              {t.selected(picked.size)}
            </span>
          </>
        )}
      </div>
      <ErrorBox message={error} />
      {items === null && <LogoLoader />}
      {items !== null && visible.length === 0 && <p className="muted">{t.empty}</p>}
      {sections.map((s) => (
        <section key={s} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {s && <h2 className="label" style={{ margin: '8px 0 0' }}>{s}</h2>}
          {groups.get(s)!.map((i) => (
            <button
              key={i.id}
              className={`row-btn${selecting && picked.has(i.id) ? ' picked' : ''}`}
              aria-pressed={selecting ? picked.has(i.id) : undefined}
              disabled={selecting && !i.editable}
              onClick={() => (selecting ? togglePick(i.id) : navigate(`/panel/materialy/${i.id}`))}
            >
              <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%', alignItems: 'flex-start' }}>
                <span style={{ fontSize: 15, fontWeight: 700, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  {selecting && <span className={`pick-box${picked.has(i.id) ? ' on' : ''}`} aria-hidden="true" />}
                  {i.draftTitle ?? i.title}
                </span>
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {i.shared && <span className="badge neutral">{t.shared}</span>}
                  {i.status === 'published' && <span className="badge ok">{t.published}</span>}
                  {i.status === 'draft' && <span className="badge warn">{t.draft}</span>}
                  {i.status === 'archived' && <span className="badge neutral">{t.archived}</span>}
                  {i.hasDraft && i.status === 'published' && <span className="badge warn">{t.unpublishedChanges}</span>}
                </span>
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {i.versionNo ? t.version(i.versionNo) : t.draft} · {formatDateTime(i.updatedAt)}
                {` · ${i.positions.length ? i.positions.map((p) => pl.admin.positions[p]).join(', ') : t.forAll}`}
              </span>
            </button>
          ))}
        </section>
      ))}
      {importing && <ContentImport onClose={() => setImporting(false)} onDone={load} />}
      {settingPositions && (
        <PositionsDialog
          ids={[...picked]}
          initial={(() => {
            const sets = (items ?? []).filter((i) => picked.has(i.id)).map((i) => i.positions.slice().sort().join(','));
            return sets.length && sets.every((x) => x === sets[0]) && sets[0] ? sets[0].split(',') : [];
          })()}
          onClose={() => setSettingPositions(false)}
          onSaved={async (n) => {
            setSettingPositions(false);
            setSelecting(false);
            setPicked(new Set());
            setNotice(t.positionsSaved(n));
            await load();
          }}
        />
      )}
      {editingTab && (
        <TabDialog
          tab={editingTab === 'new' ? null : editingTab}
          locationId={locationId}
          divisions={divisions}
          onClose={() => setEditingTab(null)}
          onSaved={async (id, msg) => {
            setEditingTab(null);
            setNotice(msg);
            if (id) setTabFilter(id);
            else setTabFilter('all');
            await load();
          }}
        />
      )}
      {creating && (
        <NewContent
          tabs={tabs}
          defaultTab={tabFilter !== 'all' ? tabFilter : tabs[0]?.id ?? null}
          defaultKind={kind}
          locationId={locationId}
          canShare={isOwner}
          onClose={() => setCreating(false)}
          onCreated={(id) => navigate(`/panel/materialy/${id}`)}
        />
      )}
    </>
  );
}

function NewContent(props: {
  defaultKind: string;
  locationId: string;
  canShare: boolean;
  tabs: KTab[];
  defaultTab: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [kind, setKind] = useState(props.defaultKind);
  const [tabId, setTabId] = useState(props.defaultTab);
  const [title, setTitle] = useState('');
  const [section, setSection] = useState('');
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await api<{ id: string }>(`/api/admin/locations/${props.locationId}/content`, {
        method: 'POST',
        body: { kind, title, section: section || undefined, shared, tabId: kind === 'service_book' && tabId ? tabId : undefined },
      });
      props.onCreated(res.id);
    } catch (err) {
      setError(errorText(err instanceof ApiFailure ? err.code : 'generic'));
    }
  }
  return (
    <Modal title={t.new} onClose={props.onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="field">
          <label htmlFor="ckind">{t.kindLabel}</label>
          <select id="ckind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {CONTENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t.kindOne[k]}
              </option>
            ))}
          </select>
        </div>
        {kind === 'service_book' && props.tabs.length > 0 && (
          <div className="field">
            <label htmlFor="ctab">{t.tabs.which}</label>
            <select id="ctab" value={tabId ?? ''} onChange={(e) => setTabId(e.target.value)}>
              {props.tabs
                .filter((x) => !shared || x.shared)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="ctitle">{t.titleLabel}</label>
          <input id="ctitle" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
        </div>
        <div className="field">
          <label htmlFor="csection">{t.section}</label>
          <input id="csection" value={section} onChange={(e) => setSection(e.target.value)} maxLength={120} aria-describedby="csection-hint" />
          <span id="csection-hint" className="muted" style={{ fontSize: 12 }}>
            {t.sectionHint}
          </span>
        </div>
        {props.canShare && (
          <label className="check">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            <span>{t.sharedHint}</span>
          </label>
        )}
        <ErrorBox message={error} />
        <div className="btn-row">
          <Btn kind="primary" type="submit" disabled={!title.trim()}>
            {t.new}
          </Btn>
          <Btn onClick={props.onClose}>{pl.admin.cancel}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function PositionsDialog(props: { ids: string[]; initial: string[]; onClose: () => void; onSaved: (n: number) => Promise<void> }) {
  const [chosen, setChosen] = useState<Set<string>>(new Set(props.initial));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ updated: number }>('/api/admin/content/positions', { method: 'POST', body: { ids: props.ids, positions: [...chosen] } });
      await props.onSaved(r.updated);
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
      setBusy(false);
    }
  }
  return (
    <Modal title={t.setPositionsTitle(props.ids.length)} onClose={props.onClose}>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {t.setPositionsHint}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {POSITIONS.map((p) => (
          <label key={p} className="check">
            <input
              type="checkbox"
              checked={chosen.has(p)}
              onChange={(e) => {
                const next = new Set(chosen);
                if (e.target.checked) next.add(p);
                else next.delete(p);
                setChosen(next);
              }}
            />
            <span>{pl.admin.positions[p]}</span>
          </label>
        ))}
      </div>
      <ErrorBox message={error} />
      <div className="btn-row">
        <Btn kind="primary" disabled={busy} onClick={() => void save()}>
          {t.setPositions}
        </Btn>
        <Btn onClick={props.onClose}>{pl.common.cancel}</Btn>
      </div>
    </Modal>
  );
}

/** Add or change a Wiedza tab: its name and who sees it. An empty tab can be removed. */
function TabDialog(props: { tab: KTab | null; locationId: string; divisions: string[] | null; onClose: () => void; onSaved: (id: string | null, msg: string) => Promise<void> }) {
  const tb = t.tabs;
  const [title, setTitle] = useState(props.tab?.title ?? '');
  const [chosen, setChosen] = useState<Set<string>>(new Set(props.tab?.positions ?? props.divisions ?? []));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const allowed = POSITIONS.filter((p) => !props.divisions || props.divisions.includes(p));
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    } finally {
      setBusy(false);
    }
  }
  const save = () =>
    run(async () => {
      const body = { title, positions: [...chosen] };
      if (props.tab) {
        await api(`/api/admin/knowledge-tabs/${props.tab.id}`, { method: 'PUT', body });
        await props.onSaved(props.tab.id, tb.saved);
      } else {
        const r = await api<{ id: string }>(`/api/admin/locations/${props.locationId}/knowledge-tabs`, { method: 'POST', body });
        await props.onSaved(r.id, tb.created);
      }
    });
  const remove = () =>
    run(async () => {
      if (!props.tab || !confirm(tb.confirmDelete(props.tab.title))) return;
      await api(`/api/admin/knowledge-tabs/${props.tab.id}`, { method: 'DELETE' });
      await props.onSaved(null, tb.deleted);
    });
  return (
    <Modal title={props.tab ? tb.editTitle : tb.newTitle} onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <div className="field">
          <label htmlFor="kt-title">{tb.name}</label>
          <input id="kt-title" value={title} maxLength={60} placeholder={tb.namePlaceholder} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <legend style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-soft)', marginBottom: 6 }}>{tb.who}</legend>
          {allowed.map((p) => (
            <label key={p} className="check">
              <input
                type="checkbox"
                checked={chosen.has(p)}
                onChange={(e) => {
                  const n = new Set(chosen);
                  if (e.target.checked) n.add(p);
                  else n.delete(p);
                  setChosen(n);
                }}
              />
              <span>{pl.admin.positions[p] ?? p}</span>
            </label>
          ))}
          <span className="muted" style={{ fontSize: 12 }}>
            {chosen.size ? tb.whoHint : props.divisions ? tb.pickOne : tb.everyone}
          </span>
        </fieldset>
        <ErrorBox message={error} />
        <div className="btn-row">
          <Btn kind="primary" type="submit" disabled={busy || !title.trim() || (Boolean(props.divisions) && chosen.size === 0)}>
            {props.tab ? pl.common.save : tb.add}
          </Btn>
          <Btn onClick={props.onClose}>{pl.admin.cancel}</Btn>
          {props.tab && !props.tab.builtIn && (
            <Btn kind="danger" disabled={busy || props.tab.pages > 0} onClick={() => void remove()}>
              {tb.delete}
            </Btn>
          )}
        </div>
        {props.tab && !props.tab.builtIn && props.tab.pages > 0 && (
          <span className="muted" style={{ fontSize: 12 }}>
            {tb.notEmpty(props.tab.pages)}
          </span>
        )}
      </form>
    </Modal>
  );
}
