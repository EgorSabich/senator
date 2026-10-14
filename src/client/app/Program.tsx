import { pl } from '../i18n/pl';
import { onNav } from '../router';
import { contentHref, Icon, Loading, Problem, StatusPill, useAcademy, useApi } from './shared';

interface ProgramView {
  program: { id: string; name: string } | null;
  percent: number;
  modules: {
    id: string;
    title: string;
    description: string | null;
    isMandatory: boolean;
    unlockRule: string;
    unlockAfterModuleId: string | null;
    done: number;
    total: number;
    complete: boolean;
    locked: boolean;
    items: { contentItemId: string; kind: string; title: string; isMandatory: boolean; status: 'new' | 'done' | 'review'; updated: boolean }[];
  }[];
}

const t = pl.academy;

export function Program() {
  const { locationId } = useAcademy();
  const { data, error } = useApi<ProgramView>(`/api/locations/${locationId}/program`);

  return (
    <main className="a-main">
      <h1 className="a-title">{data?.program?.name ?? t.programTitle}</h1>
      <Problem message={error} />
      {!data && !error && <Loading />}
      {data && !data.program && <div className="a-note">{t.noProgram}</div>}
      {data?.program && (
        <>
          <div className="a-card" style={{ gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{t.percent(data.percent)}</span>
            <div className="a-progress" aria-hidden="true">
              <div style={{ width: `${data.percent}%` }} />
            </div>
          </div>
          {data.modules.map((m, i) => {
            const after = m.unlockAfterModuleId ? data.modules.find((x) => x.id === m.unlockAfterModuleId) : null;
            return (
              <section key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-label={m.title}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <h2 className="a-label">
                    {t.module} {i + 1} · {m.title}
                  </h2>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {m.locked ? t.locked : t.moduleProgress(m.done, m.total)}
                    {!m.isMandatory ? ` · ${t.optional}` : ''}
                  </span>
                </div>
                {m.description && <p className="a-sub">{m.description}</p>}
                {m.locked && (
                  <div className="a-note">
                    <Icon name="lock" size={18} />
                    <span>{m.unlockRule === 'after_module' && after ? t.lockedAfter(after.title) : t.lockedAfterAll}</span>
                  </div>
                )}
                <div className="a-list">
                  {m.items.map((it) =>
                    m.locked && it.kind === 'lesson' ? (
                      <div key={it.contentItemId} className="a-row" aria-disabled="true">
                        <span className="grow">
                          <span className="t">{it.title}</span>
                          <span className="s">{t.kinds[it.kind]}</span>
                        </span>
                        <Icon name="lock" size={18} />
                      </div>
                    ) : (
                      <a key={it.contentItemId} className="a-row" href={contentHref(it.contentItemId)} onClick={onNav(contentHref(it.contentItemId))}>
                        <span className="grow">
                          <span className="t">{it.title}</span>
                          <span className="s">
                            {t.kinds[it.kind]}
                            {!it.isMandatory ? ` · ${t.optional}` : ''}
                          </span>
                        </span>
                        <StatusPill status={it.status} updated={it.updated} />
                      </a>
                    ),
                  )}
                </div>
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}
