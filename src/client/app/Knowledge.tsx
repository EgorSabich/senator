import { useState } from 'react';
import { comparePl } from '../../shared/text';
import { pl } from '../i18n/pl';
import { onNav } from '../router';
import { contentHref, Icon, Loading, Problem, StatusPill, useAcademy, useApi } from './shared';

interface SbItem {
  id: string;
  title: string;
  section: string | null;
  status: 'new' | 'done' | 'review';
  updated: boolean;
}
interface DocItem {
  id: string;
  kind: string;
  title: string;
  section: string | null;
  requiresAck: boolean;
  external: boolean;
  status: 'new' | 'done' | 'review';
  updated: boolean;
  acknowledgedAt: number | null;
}

const t = pl.academy.knowledge;
const KIND_ORDER = ['regulation', 'sop', 'job_description', 'checklist'];

export function Knowledge({ tab }: { tab: 'sb' | 'library' }) {
  return (
    <main className="a-main">
      <h1 className="a-title">{t.title}</h1>
      <nav className="a-chips" aria-label={t.title}>
        <a className="a-chip" href="/wiedza" onClick={onNav('/wiedza')} aria-current={tab === 'sb' ? 'page' : undefined}>
          {t.serviceBook}
        </a>
        <a className="a-chip" href="/wiedza/regulaminy" onClick={onNav('/wiedza/regulaminy')} aria-current={tab === 'library' ? 'page' : undefined}>
          {t.library}
        </a>
      </nav>
      {tab === 'sb' ? <ServiceBook /> : <Library />}
    </main>
  );
}

function groupBySection<T extends { section: string | null }>(items: T[]): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const i of items) {
    const k = i.section ?? '';
    (map.get(k) ?? map.set(k, []).get(k)!).push(i);
  }
  return [...map.entries()];
}

function ServiceBook() {
  const { locationId } = useAcademy();
  const { data, error } = useApi<{ items: SbItem[] }>(`/api/locations/${locationId}/service-book`);
  return (
    <>
      <Problem message={error} />
      {!data && !error && <Loading />}
      {data && data.items.length === 0 && <p className="a-sub">{t.empty}</p>}
      {data &&
        groupBySection(data.items).map(([section, items]) => (
          <section key={section} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {section && <h2 className="a-label">{section}</h2>}
            <div className="a-list">
              {items.map((i) => (
                <a key={i.id} className="a-row" href={contentHref(i.id)} onClick={onNav(contentHref(i.id))}>
                  <span className="grow">
                    <span className="t">{i.title}</span>
                  </span>
                  {i.status !== 'new' && <StatusPill status={i.status} updated={i.updated} />}
                </a>
              ))}
            </div>
          </section>
        ))}
    </>
  );
}

function Library() {
  const { locationId } = useAcademy();
  const { data, error } = useApi<{ items: DocItem[] }>(`/api/locations/${locationId}/library`);
  const [kind, setKind] = useState('all');
  const kinds = KIND_ORDER.filter((k) => data?.items.some((i) => i.kind === k));
  const shown = (data?.items ?? []).filter((i) => kind === 'all' || i.kind === kind);

  return (
    <>
      {kinds.length > 1 && (
        <div className="a-chips" role="group">
          <button className="a-chip" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>
            {t.all}
          </button>
          {kinds.map((k) => (
            <button key={k} className="a-chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {pl.admin.content.kinds[k]}
            </button>
          ))}
        </div>
      )}
      <Problem message={error} />
      {!data && !error && <Loading />}
      {data && shown.length === 0 && <p className="a-sub">{t.empty}</p>}
      {KIND_ORDER.filter((k) => shown.some((i) => i.kind === k)).map((k) => (
        <section key={k} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 className="a-label">{pl.admin.content.kinds[k]}</h2>
          <div className="a-list">
            {shown
              .filter((i) => i.kind === k)
              .sort((a, b) => comparePl(a.title, b.title))
              .map((i) => (
                <a key={i.id} className="a-row" href={contentHref(i.id)} onClick={onNav(contentHref(i.id))}>
                  <span className="grow">
                    <span className="t">{i.title}</span>
                    {i.external && <span className="s">{pl.academy.reader.external}</span>}
                  </span>
                  {i.external ? (
                    <Icon name="external" size={18} />
                  ) : i.requiresAck ? (
                    i.status === 'review' ? (
                      <span className="a-pill bad">{pl.academy.review}</span>
                    ) : i.acknowledgedAt && i.status === 'done' ? (
                      <span className="a-pill ok">{t.confirmed}</span>
                    ) : (
                      <span className="a-pill warn">{t.toConfirm}</span>
                    )
                  ) : (
                    i.status !== 'new' && <StatusPill status={i.status} updated={i.updated} />
                  )}
                </a>
              ))}
          </div>
        </section>
      ))}
    </>
  );
}
