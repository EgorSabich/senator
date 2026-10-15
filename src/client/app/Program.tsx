import { useState } from 'react';
import { pl } from '../i18n/pl';
import { onNav } from '../router';
import { contentHref, Icon, Loading, Problem, StatusPill, useAcademy, useApi } from './shared';

export interface ProgramView {
  program: { id: string; name: string } | null;
  percent: number;
  modules: ModuleView[];
}

interface ModuleView {
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
}

const t = pl.academy;

/** The module to open first: the first one that is open and not finished (else none). */
function currentModuleId(modules: ModuleView[]): string | null {
  return modules.find((m) => !m.locked && !m.complete)?.id ?? null;
}

/** All modules at once; each one folds out (accordion). Used on Start and on Nauka. */
export function ModuleList({ modules }: { modules: ModuleView[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set([currentModuleId(modules)].filter((x): x is string => Boolean(x))));
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="a-modules">
      {modules.map((m, i) => {
        const isOpen = open.has(m.id);
        const after = m.unlockAfterModuleId ? modules.find((x) => x.id === m.unlockAfterModuleId) : null;
        const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
        return (
          <section key={m.id} className={`a-module${isOpen ? ' open' : ''}${m.locked ? ' locked' : ''}${m.complete ? ' complete' : ''}`}>
            <button type="button" className="a-module-head" aria-expanded={isOpen} aria-controls={`mod-${m.id}`} onClick={() => toggle(m.id)}>
              <span className="a-module-no" aria-hidden="true">
                {m.complete ? <Icon name="check" size={16} /> : m.locked ? <Icon name="lock" size={15} /> : i + 1}
              </span>
              <span className="grow">
                <span className="t">{m.title}</span>
                <span className="s">
                  {t.module} {i + 1} · {m.locked ? t.locked : t.moduleProgress(m.done, m.total)}
                  {!m.isMandatory ? ` · ${t.optional}` : ''}
                </span>
              </span>
              {!m.locked && !m.complete && m.total > 0 && <span className="a-ring" style={{ ['--p' as string]: pct }} aria-hidden="true" />}
              <span className="a-chevron" aria-hidden="true">
                <Icon name="down" size={18} />
              </span>
            </button>
            <div className="a-module-body" id={`mod-${m.id}`} role="region" aria-label={m.title} inert={!isOpen}>
              <div className="a-module-inner">
                {m.description && <p className="a-sub a-module-desc">{m.description}</p>}
                {m.locked && (
                  <div className="a-note a-module-desc">
                    <Icon name="lock" size={18} />
                    <span>{m.unlockRule === 'after_module' && after ? t.lockedAfter(after.title) : t.lockedAfterAll}</span>
                  </div>
                )}
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
            </div>
          </section>
        );
      })}
    </div>
  );
}

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
          <ModuleList modules={data.modules} />
        </>
      )}
    </main>
  );
}
