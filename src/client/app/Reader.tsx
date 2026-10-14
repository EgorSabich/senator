import { useEffect, useRef, useState } from 'react';
import type { RtNode } from '../../shared/richtext';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { navigate } from '../router';
import { RichText } from './RichText';
import { contentHref, formatDate, Icon, Loading, Problem, useAcademy, useApi } from './shared';

interface ContentView {
  item: {
    id: string;
    kind: string;
    title: string;
    section: string | null;
    requiresAck: boolean;
    externalUrl: string | null;
    attachment: { src: string; name: string | null } | null;
    version: { id: string; versionNo: number; changeLevel: string; changeNote: string | null; createdAt: number; body: RtNode };
    progress: { status: 'new' | 'done' | 'review'; updated: boolean; ackedVersionNo: number | null };
    acknowledgedAt: number | null;
    module: { id: string; title: string } | null;
    next: { id: string; title: string; kind: string } | null;
  };
}

const t = pl.academy;

function goBack() {
  if (history.length > 1) history.back();
  else navigate('/');
}

export function Reader({ id }: { id: string }) {
  const { data, error, code, reload } = useApi<ContentView>(`/api/content/${id}`);
  const [reached, setReached] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);
  const [ackedAt, setAckedAt] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAckedAt(data?.item.acknowledgedAt ?? null);
  }, [data]);

  useEffect(() => {
    const el = end.current;
    if (!el || !data) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setReached(true);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [data]);

  if (!data) {
    return (
      <>
        <TopBar title="" meta="" />
        <main className="a-reader">
          {code === 'lesson_locked' ? <div className="a-note">{t.reader.lockedMsg}</div> : <Problem message={error} />}
          {!error && <Loading />}
        </main>
      </>
    );
  }

  const it = data.item;
  const isDoc = it.requiresAck;
  const currentAcked = ackedAt !== null;

  async function acknowledge(goNext: boolean) {
    setBusy(true);
    setAckError(null);
    try {
      const res = await api<{ acknowledgedAt: number }>(`/api/content/${it.id}/ack`, { method: 'POST', body: { versionId: it.version.id, scrolledToEnd: true } });
      setAckedAt(res.acknowledgedAt);
      if (goNext && it.next) navigate(contentHref(it.next.id));
    } catch (e) {
      const c = e instanceof ApiFailure ? e.code : 'generic';
      setAckError(errorText(c));
      if (c === 'version_changed') void reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar title={it.module?.title ?? it.section ?? ''} meta={t.kinds[it.kind] ?? ''} />
      <main className="a-reader">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="a-label">{t.kinds[it.kind]}</span>
          <h1 className="a-title" style={{ fontSize: 34 }}>
            {it.title}
          </h1>
        </div>
        {it.progress.status === 'review' && !currentAcked && <div className="a-note bad">{t.reader.reviewNote}</div>}
        {it.progress.updated && <div className="a-note warn">{t.reader.updatedNote}</div>}
        {it.externalUrl && (
          <a className="a-btn" href={it.externalUrl} target="_blank" rel="noopener noreferrer">
            <Icon name="external" size={18} /> {t.reader.externalOpen}
          </a>
        )}
        <RichText doc={it.version.body} />
        {it.attachment && (
          <a className="a-btn" href={it.attachment.src} target="_blank" rel="noopener">
            <Icon name="file" size={18} /> {t.reader.attachment}
            {it.attachment.name ? ` · ${it.attachment.name}` : ''}
          </a>
        )}
        <div ref={end} aria-hidden="true" style={{ height: 1 }} />
      </main>

      <footer className="a-footer">
        <Problem message={ackError} />
        {it.externalUrl ? (
          <div className="row">
            <button className="a-btn" onClick={goBack}>
              {pl.common.back}
            </button>
            <span className="a-pill" style={{ alignSelf: 'center', flex: 'none' }}>
              {t.reader.external}
            </span>
          </div>
        ) : isDoc ? (
          currentAcked ? (
            <div className="row">
              <span className="a-note" style={{ alignItems: 'center' }}>
                <Icon name="check" size={18} /> {t.reader.acked(formatDate(ackedAt!))}
              </span>
              {it.next && <NextButton id={it.next.id} />}
            </div>
          ) : (
            <>
              <label className="a-check" aria-disabled={!reached}>
                <input type="checkbox" disabled={!reached} checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                <span>{reached ? t.reader.ackLabel : t.reader.scrollHint}</span>
              </label>
              <div className="row">
                <button className="a-btn" onClick={goBack}>
                  {pl.common.back}
                </button>
                <button className="a-btn primary center wide" disabled={!reached || !checked || busy} onClick={() => void acknowledge(false)}>
                  {t.reader.ackButton}
                </button>
              </div>
            </>
          )
        ) : currentAcked ? (
          <div className="row">
            <span className="a-note" style={{ alignItems: 'center' }}>
              <Icon name="check" size={18} /> {t.reader.read(formatDate(ackedAt!))}
            </span>
            {it.next ? <NextButton id={it.next.id} /> : <button className="a-btn" onClick={goBack}>{pl.common.back}</button>}
          </div>
        ) : (
          <>
            {!reached && <span className="a-sub">{t.reader.scrollHint}</span>}
            <div className="row">
              <button className="a-btn" onClick={goBack}>
                {pl.common.back}
              </button>
              <button className="a-btn primary center wide" disabled={!reached || busy} onClick={() => void acknowledge(true)}>
                {it.next ? t.reader.readNext : t.reader.readDone}
              </button>
            </div>
          </>
        )}
      </footer>
    </>
  );
}

function NextButton({ id }: { id: string }) {
  return (
    <button className="a-btn primary" onClick={() => navigate(contentHref(id))}>
      <span>{t.reader.next}</span>
      <Icon name="next" size={18} />
    </button>
  );
}

function TopBar({ title, meta }: { title: string; meta: string }) {
  const { online } = useAcademy();
  return (
    <header className="a-topbar">
      <button className="a-icon-btn" style={{ border: 'none', background: 'none' }} onClick={goBack} aria-label={t.reader.back}>
        <Icon name="back" />
      </button>
      <div className="meta">
        <span>{title}</span>
        <span>{meta}</span>
      </div>
      {!online && <span className="a-offline">{pl.app.offline}</span>}
    </header>
  );
}
