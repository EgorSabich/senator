import { useState } from 'react';
import { checkContentBundle, CONTENT_BUNDLE_FORMAT, CONTENT_IMPORT_CHUNK, type ContentBundle } from '../../shared/contentBundle';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { ErrorBox } from '../ui';
import { Btn, Modal } from './common';
import { usePanel } from './Panel';

const t = pl.admin.content;

export function ContentImport({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const { locationId } = usePanel();
  const [bundle, setBundle] = useState<ContentBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);

  async function read(file: File | undefined) {
    setError(null);
    setBundle(null);
    setResult(null);
    if (!file) return;
    try {
      const b = checkContentBundle(JSON.parse(await file.text()));
      if (!b) throw new Error('bad');
      setBundle(b);
    } catch {
      setError(t.importBadFile);
    }
  }

  async function run() {
    if (!bundle) return;
    setError(null);
    const total = { created: 0, skipped: 0 };
    try {
      for (let i = 0; i < bundle.items.length; i += CONTENT_IMPORT_CHUNK) {
        setProgress([i, bundle.items.length]);
        const res = await api<{ created: string[]; skipped: string[] }>(`/api/admin/locations/${locationId}/content/import`, {
          method: 'POST',
          body: { format: CONTENT_BUNDLE_FORMAT, items: bundle.items.slice(i, i + CONTENT_IMPORT_CHUNK) },
        });
        total.created += res.created.length;
        total.skipped += res.skipped.length;
      }
      setResult(total);
    } catch (e) {
      setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
      if (total.created || total.skipped) setResult(total);
    } finally {
      setProgress(null);
      await onDone();
    }
  }

  const byKind = new Map<string, number>();
  for (const i of bundle?.items ?? []) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);

  return (
    <Modal title={t.importTitle} onClose={progress ? () => undefined : onClose}>
      <p style={{ margin: 0, lineHeight: 1.5, fontSize: 14 }}>{t.importIntro}</p>
      <label className="file-btn">
        <input type="file" accept="application/json,.json" disabled={Boolean(progress)} onChange={(e) => void read(e.target.files?.[0])} />
        <span>{t.importChoose}</span>
      </label>
      {bundle && (
        <>
          <p style={{ margin: 0, fontWeight: 600 }}>{t.importSummary(bundle.items.length)}</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>
            {[...byKind.entries()].map(([k, n]) => (
              <li key={k}>
                {t.kinds[k] ?? k}: {n}
              </li>
            ))}
          </ul>
          {bundle.notes && bundle.notes.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 14 }}>
                {t.importNotes} ({bundle.notes.length})
              </summary>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.5, maxHeight: 240, overflow: 'auto' }}>
                {bundle.notes.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {progress && <p className="muted" role="status">{t.importProgress(progress[0], progress[1])}</p>}
      {result && (
        <div className="notice" role="status">
          {t.importResult(result.created, result.skipped)}
        </div>
      )}
      <ErrorBox message={error} />
      <div className="btn-row">
        {!result && (
          <Btn kind="primary" disabled={!bundle || Boolean(progress)} onClick={() => void run()}>
            {t.importStart}
          </Btn>
        )}
        <Btn onClick={onClose} disabled={Boolean(progress)}>
          {pl.admin.card.close}
        </Btn>
      </div>
    </Modal>
  );
}
