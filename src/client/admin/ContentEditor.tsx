import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { POSITIONS } from '../../shared/constants';
import type { RtNode } from '../../shared/richtext';
import { api, ApiFailure } from '../api';
import { diffLines } from '../editor/diff';
import { editorExtensions } from '../editor/extensions';
import { resizeImage, uploadFile } from '../editor/image';
import { errorText, pl } from '../i18n/pl';
import { onNav } from '../router';
import { ErrorBox } from '../ui';
import { Btn, formatDateTime, formatTime, Icon, Modal } from './common';
import { usePanel } from './Panel';

const t = pl.admin.content;
const AUTOSAVE_MS = 1500;

interface Detail {
  item: {
    id: string;
    locationId: string | null;
    shared: boolean;
    kind: string;
    title: string;
    section: string | null;
    status: 'draft' | 'published' | 'archived';
    requiresAck: boolean;
    externalUrl: string | null;
    attachment: { src: string; name: string } | null;
    positions: string[];
    currentAcknowledgements: number;
  };
  draft: { title: string; body: RtNode; updatedAt: number } | null;
  current: { id: string; versionNo: number; title: string; body: RtNode } | null;
  versions: {
    id: string;
    versionNo: number;
    title: string;
    changeLevel: string;
    changeNote: string | null;
    createdAt: number;
    authorFirstName: string | null;
    authorLastName: string | null;
  }[];
}

export function ContentEditor({ id }: { id: string }) {
  const { locationId } = usePanel();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [compare, setCompare] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const titleRef = useRef('');

  const load = useCallback(async () => {
    try {
      const d = await api<Detail>(`/api/admin/content/${id}`);
      setDetail(d);
      const startTitle = d.draft?.title ?? d.current?.title ?? d.item.title;
      setTitle(startTitle);
      titleRef.current = startTitle;
      setSavedAt(d.draft?.updatedAt ?? null);
      setDirty(false);
      return d;
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
      return null;
    }
  }, [id]);

  const editor = useEditor({
    extensions: editorExtensions,
    content: null,
    editorProps: { attributes: { class: 'rt', 'aria-label': t.bodyLabel, role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: () => scheduleSave(),
  });

  useEffect(() => {
    void load().then((d) => {
      if (d && editor) editor.commands.setContent((d.draft?.body ?? d.current?.body ?? { type: 'doc', content: [{ type: 'paragraph' }] }) as never, { emitUpdate: false });
    });
  }, [load, editor]);

  const save = useCallback(async () => {
    if (!editor) return;
    window.clearTimeout(timer.current);
    setSaving(true);
    try {
      const res = await api<{ savedAt: number }>(`/api/admin/content/${id}`, { method: 'PUT', body: { title: titleRef.current, body: editor.getJSON() } });
      setSavedAt(res.savedAt);
      setDirty(false);
      setError(null);
      // The server now holds a draft: keep "Opublikuj" available.
      setDetail((d) => (d ? { ...d, draft: { title: titleRef.current, body: editor.getJSON() as RtNode, updatedAt: res.savedAt } } : d));
    } catch (e) {
      setError(`${pl.admin.saveError} ${errorText(e instanceof ApiFailure ? e.code : 'generic')}`);
    } finally {
      setSaving(false);
    }
  }, [editor, id]);

  function scheduleSave() {
    setDirty(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
  }
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function saveSettings(body: Record<string, unknown>) {
    setError(null);
    try {
      await api(`/api/admin/content/${id}`, { method: 'PUT', body });
      await load();
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }

  async function post(path: string, success: string, reload = true) {
    setError(null);
    try {
      await api(path, { method: 'POST' });
      setNotice(success);
      if (reload) {
        const d = await load();
        if (d && editor) editor.commands.setContent((d.draft?.body ?? d.current?.body) as never, { emitUpdate: false });
      }
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }

  if (!detail) {
    return (
      <>
        <ErrorBox message={error} />
        {!error && <p className="muted">{pl.app.loading}</p>}
      </>
    );
  }

  const { item } = detail;
  const isDocument = item.kind !== 'lesson' && item.kind !== 'service_book';
  const hasUnpublished = Boolean(detail.draft) || dirty;

  return (
    <>
      <a href="/panel/materialy" onClick={onNav('/panel/materialy')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', minHeight: 44 }}>
        <Icon name="back" size={18} /> {pl.admin.back}
      </a>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div className="muted" style={{ fontSize: 13 }}>
          {t.kindOne[item.kind]}
          {item.shared ? ` · ${t.shared}` : ''}
          {detail.current ? ` · ${t.version(detail.current.versionNo)}` : ` · ${t.draft}`}
          {item.status === 'archived' ? ` · ${t.archived}` : ''}
        </div>
        <div className="btn-row" style={{ alignItems: 'center' }}>
          <span className="muted" role="status" style={{ fontSize: 13 }}>
            {saving ? t.saving : savedAt && !dirty ? t.savedAt(formatTime(savedAt)) : ''}
          </span>
          <Btn onClick={() => void save()} disabled={saving || !dirty}>
            {t.save}
          </Btn>
          <Btn
            kind="primary"
            disabled={!hasUnpublished || saving}
            onClick={async () => {
              if (dirty) await save();
              setPublishing(true);
            }}
          >
            {t.publish}
          </Btn>
        </div>
      </div>
      <ErrorBox message={error} />
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      <div className="split">
        <section className="detail" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <label htmlFor="ctitle-edit">{t.titleLabel}</label>
            <input
              id="ctitle-edit"
              value={title}
              maxLength={160}
              style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, minHeight: 56 }}
              onChange={(e) => {
                setTitle(e.target.value);
                titleRef.current = e.target.value;
                scheduleSave();
              }}
            />
          </div>
          {editor && <Toolbar editor={editor} locationId={item.shared ? null : item.locationId ?? locationId} onError={setError} />}
          <div className="editor-surface">
            <EditorContent editor={editor} />
          </div>
        </section>

        <aside className="list" aria-label={t.settings}>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 className="label" style={{ margin: 0 }}>
              {t.settings}
            </h2>
            <SettingText label={t.section} value={item.section ?? ''} onSave={(v) => void saveSettings({ section: v || null })} />
            {isDocument && (
              <>
                <label className="check">
                  <input type="checkbox" checked={item.requiresAck} onChange={(e) => void saveSettings({ requiresAck: e.target.checked })} />
                  <span>{t.requiresAck}</span>
                </label>
                <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <legend style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-soft)', marginBottom: 6 }}>{t.positions}</legend>
                  {POSITIONS.map((p) => (
                    <label key={p} className="check">
                      <input
                        type="checkbox"
                        checked={item.positions.includes(p)}
                        onChange={(e) =>
                          void saveSettings({ positions: e.target.checked ? [...item.positions, p] : item.positions.filter((x) => x !== p) })
                        }
                      />
                      <span>{pl.admin.positions[p]}</span>
                    </label>
                  ))}
                  <span className="muted" style={{ fontSize: 12 }}>
                    {t.positionsHint}
                  </span>
                </fieldset>
                <SettingText label={t.externalUrl} value={item.externalUrl ?? ''} onSave={(v) => void saveSettings({ externalUrl: v || null })} />
                <Attachment id={item.id} attachment={item.attachment} onChange={() => void load()} onError={setError} />
              </>
            )}
            {detail.current && (
              <span className="muted" style={{ fontSize: 13 }}>
                {t.ackCount(item.currentAcknowledgements)}
              </span>
            )}
            <div className="btn-row">
              {detail.draft && detail.current && (
                <Btn onClick={() => confirm(`${t.discard}?`) && void post(`/api/admin/content/${id}/discard-draft`, pl.admin.employees.done)}>{t.discard}</Btn>
              )}
              {item.status !== 'archived' ? (
                <Btn kind="danger" onClick={() => confirm(`${t.archive}?`) && void post(`/api/admin/content/${id}/archive`, pl.admin.employees.done)}>
                  {t.archive}
                </Btn>
              ) : (
                <Btn onClick={() => void post(`/api/admin/content/${id}/restore`, pl.admin.employees.done)}>{t.restore}</Btn>
              )}
            </div>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 className="label" style={{ margin: 0 }}>
              {t.history}
            </h2>
            {detail.versions.length === 0 && <span className="muted">{t.noHistory}</span>}
            {detail.versions.map((v, i) => (
              <div key={v.id} style={{ borderTop: i ? '1px solid var(--border)' : 'none', paddingTop: i ? 10 : 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong>{t.version(v.versionNo)}</strong>
                  <span className={`badge ${v.changeLevel === 'significant' ? 'bad' : v.changeLevel === 'clarification' ? 'warn' : 'neutral'}`}>
                    {t.levels[v.changeLevel]?.label}
                  </span>
                </div>
                <span className="muted" style={{ fontSize: 12 }}>
                  {formatDateTime(v.createdAt)} · {v.authorFirstName} {v.authorLastName}
                </span>
                {v.changeNote && <span style={{ fontSize: 13 }}>{v.changeNote}</span>}
                {detail.versions[i + 1] && (
                  <div>
                    <Btn onClick={() => setCompare(v.id)}>{t.compare}</Btn>
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>
      </div>

      {publishing && (
        <PublishDialog
          first={!detail.current}
          onClose={() => setPublishing(false)}
          onPublish={async (changeLevel, changeNote) => {
            try {
              const res = await api<{ versionNo: number }>(`/api/admin/content/${id}/publish`, { method: 'POST', body: { changeLevel, changeNote } });
              setPublishing(false);
              setNotice(`${t.published_ok} ${t.version(res.versionNo)}.`);
              const d = await load();
              if (d && editor) editor.commands.setContent((d.draft?.body ?? d.current?.body) as never, { emitUpdate: false });
            } catch (e) {
              return errorText(e instanceof ApiFailure ? e.code : 'generic');
            }
            return null;
          }}
        />
      )}
      {compare && <CompareDialog itemId={id} versions={detail.versions} versionId={compare} onClose={() => setCompare(null)} />}
    </>
  );
}

function SettingText({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const fieldId = `s-${label.length}-${label.charCodeAt(0)}`;
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <input id={fieldId} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v.trim())} />
    </div>
  );
}

function Attachment({ id, attachment, onChange, onError }: { id: string; attachment: Detail['item']['attachment']; onChange: () => void; onError: (s: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="field">
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-soft)' }}>{t.attachment}</span>
      {attachment && (
        <a href={attachment.src} target="_blank" rel="noopener">
          {attachment.name}
        </a>
      )}
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            await uploadFile(`/api/admin/content/${id}/attachment`, f, f.name);
            onChange();
          } catch (err) {
            onError(errorText((err as { code?: string }).code ?? 'generic'));
          }
          e.target.value = '';
        }}
      />
      <div className="btn-row">
        <Btn onClick={() => input.current?.click()}>{t.attachmentAdd}</Btn>
        {attachment && (
          <Btn
            onClick={async () => {
              await api(`/api/admin/content/${id}/attachment`, { method: 'DELETE' }).catch(() => undefined);
              onChange();
            }}
          >
            {t.attachmentRemove}
          </Btn>
        )}
      </div>
    </div>
  );
}

function Toolbar({ editor, locationId, onError }: { editor: Editor; locationId: string | null; onError: (s: string) => void }) {
  const e = t.editor;
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      h2: ed.isActive('heading', { level: 2 }),
      h3: ed.isActive('heading', { level: 3 }),
      bold: ed.isActive('bold'),
      italic: ed.isActive('italic'),
      bullet: ed.isActive('bulletList'),
      ordered: ed.isActive('orderedList'),
      important: ed.isActive('callout', { variant: 'important' }),
      warning: ed.isActive('callout', { variant: 'warning' }),
      info: ed.isActive('callout', { variant: 'info' }),
      link: ed.isActive('link'),
      table: ed.isActive('table'),
    }),
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const chain = () => editor.chain().focus();
  const b = (label: string, pressed: boolean, run: () => void, text?: string) => (
    <button type="button" aria-label={label} title={label} aria-pressed={pressed} onMouseDown={(ev) => ev.preventDefault()} onClick={run}>
      {text ?? label}
    </button>
  );

  return (
    <div className="editor-toolbar" role="toolbar" aria-label={pl.admin.content.title}>
      {b(e.h2, state.h2, () => chain().toggleHeading({ level: 2 }).run(), 'H2')}
      {b(e.h3, state.h3, () => chain().toggleHeading({ level: 3 }).run(), 'H3')}
      <span className="sep" />
      {b(e.bold, state.bold, () => chain().toggleBold().run(), 'B')}
      {b(e.italic, state.italic, () => chain().toggleItalic().run(), 'I')}
      <span className="sep" />
      {b(e.bullet, state.bullet, () => chain().toggleBulletList().run())}
      {b(e.ordered, state.ordered, () => chain().toggleOrderedList().run())}
      <span className="sep" />
      {b(e.important, state.important, () => chain().toggleCallout('important').run())}
      {b(e.warning, state.warning, () => chain().toggleCallout('warning').run())}
      {b(e.info, state.info, () => chain().toggleCallout('info').run())}
      <span className="sep" />
      {b(e.table, state.table, () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
      {state.table && (
        <>
          {b(e.addRow, false, () => chain().addRowAfter().run(), '+ ' + e.row)}
          {b(e.addCol, false, () => chain().addColumnAfter().run(), '+ ' + e.col)}
          {b(e.delRow, false, () => chain().deleteRow().run(), '− ' + e.row)}
          {b(e.delCol, false, () => chain().deleteColumn().run(), '− ' + e.col)}
          {b(e.delTable, false, () => chain().deleteTable().run())}
        </>
      )}
      <span className="sep" />
      {b(e.link, state.link, () => {
        if (state.link) return void chain().unsetLink().run();
        const href = window.prompt(e.linkPrompt, 'https://');
        if (href && /^(https?:\/\/|mailto:|tel:)/i.test(href)) chain().extendMarkRange('link').setLink({ href }).run();
      })}
      {b(uploading ? e.uploading : e.image, false, () => fileInput.current?.click())}
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={async (ev) => {
          const f = ev.target.files?.[0];
          ev.target.value = '';
          if (!f) return;
          setUploading(true);
          try {
            const blob = await resizeImage(f).catch(() => f);
            const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
            const path = locationId ? `/api/admin/locations/${locationId}/media` : `/api/admin/locations/_/media?shared=1`;
            const res = await uploadFile(path, blob, `zdjecie.${ext}`);
            const alt = window.prompt(e.imageAlt, '') ?? '';
            chain().setImage({ src: res.src, alt }).run();
          } catch (err) {
            onError(errorText((err as { code?: string }).code ?? 'generic'));
          } finally {
            setUploading(false);
          }
        }}
      />
      <span className="sep" />
      {b(e.undo, false, () => chain().undo().run(), '↶')}
      {b(e.redo, false, () => chain().redo().run(), '↷')}
    </div>
  );
}

function PublishDialog(props: { first: boolean; onClose: () => void; onPublish: (level: string | undefined, note: string) => Promise<string | null> }) {
  const [level, setLevel] = useState<string>('clarification');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={t.publishTitle} onClose={props.onClose}>
      {props.first ? (
        <p style={{ margin: 0, lineHeight: 1.5 }}>{t.firstPublish}</p>
      ) : (
        <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <legend style={{ fontWeight: 600, marginBottom: 10 }}>{t.levelQuestion}</legend>
          {(['cosmetic', 'clarification', 'significant'] as const).map((l) => (
            <label key={l} className="check" style={{ padding: 10, border: `1px solid ${level === l ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 12 }}>
              <input type="radio" name="level" value={l} checked={level === l} onChange={() => setLevel(l)} />
              <span>
                <strong>{t.levels[l]!.label}</strong>
                <br />
                <span className="muted" style={{ fontSize: 13 }}>
                  {t.levels[l]!.hint}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="field">
        <label htmlFor="cnote">{t.changeNote}</label>
        <textarea id="cnote" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </div>
      <ErrorBox message={error} />
      <div className="btn-row">
        <Btn
          kind="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(await props.onPublish(props.first ? undefined : level, note.trim()));
            setBusy(false);
          }}
        >
          {t.publishConfirm}
        </Btn>
        <Btn onClick={props.onClose}>{pl.admin.cancel}</Btn>
      </div>
    </Modal>
  );
}

function CompareDialog({ itemId, versions, versionId, onClose }: { itemId: string; versions: Detail['versions']; versionId: string; onClose: () => void }) {
  const idx = versions.findIndex((v) => v.id === versionId);
  const prev = versions[idx + 1];
  const [lines, setLines] = useState<ReturnType<typeof diffLines> | null>(null);
  useEffect(() => {
    if (!prev) return;
    Promise.all([
      api<{ version: { bodyText: string; title: string } }>(`/api/admin/content/${itemId}/versions/${prev.id}`),
      api<{ version: { bodyText: string; title: string } }>(`/api/admin/content/${itemId}/versions/${versionId}`),
    ]).then(([a, b]) => setLines(diffLines(`${a.version.title}\n${a.version.bodyText}`, `${b.version.title}\n${b.version.bodyText}`)));
  }, [itemId, prev, versionId]);
  return (
    <Modal title={`${t.version(versions[idx]!.versionNo)} ↔ ${prev ? t.version(prev.versionNo) : ''}`} onClose={onClose}>
      <div className="btn-row" style={{ fontSize: 13 }}>
        <span className="badge ok">{t.added}</span>
        <span className="badge bad">{t.removed}</span>
      </div>
      {!lines && <p className="muted">{pl.app.loading}</p>}
      {lines && (
        <div className="diff">
          {lines.map((l, i) => (
            <div key={i} className={l.kind === 'add' ? 'add' : l.kind === 'del' ? 'del' : ''}>
              {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '− ' : '  '}
              {l.text || ' '}
            </div>
          ))}
        </div>
      )}
      <Btn onClick={onClose}>{pl.admin.card.close}</Btn>
    </Modal>
  );
}

