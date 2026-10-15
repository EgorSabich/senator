import { pl } from '../i18n/pl';
import { onNav } from '../router';
import { ModuleList, type ProgramView } from './Program';
import { contentHref, Icon, Loading, Problem, useAcademy, useApi } from './shared';

interface Home {
  user: { firstName: string };
  program: { id: string; name: string; percent: number; modules: number; modulesComplete: number } | null;
  next: { id: string; kind: string; title: string; status: string } | null;
  toConfirm: { id: string; kind: string; title: string; status: string }[];
  review: { id: string; kind: string; title: string }[];
  updated: { id: string; kind: string; title: string }[];
}

const t = pl.academy;

export function Start() {
  const { locationId, me } = useAcademy();
  const { data, error } = useApi<Home>(`/api/locations/${locationId}/home`);
  const prog = useApi<ProgramView>(`/api/locations/${locationId}/program`);

  const tasks = data
    ? [
        ...data.review.map((r) => ({ ...r, pill: <span className="a-pill bad">{t.review}</span>, hint: t.reviewHint })),
        ...data.toConfirm
          .filter((d) => !data.review.some((r) => r.id === d.id))
          .map((d) => ({ ...d, pill: <span className="a-pill warn">{t.toConfirm}</span>, hint: t.kinds[d.kind] ?? '' })),
        ...data.updated.map((u) => ({ ...u, pill: <span className="a-pill">{t.updated}</span>, hint: t.updatedHint })),
      ]
    : [];

  return (
    <main className="a-main">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 className="a-title">{pl.home.hello(data?.user.firstName ?? me.user.firstName)}</h1>
      </div>
      <Problem message={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          {data.program ? (
            <section className="a-card" aria-label={data.program.name}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{data.program.name}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{t.modulesDone(data.program.modulesComplete, data.program.modules)}</span>
              </div>
              <div className="a-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.program.percent} aria-label={t.percent(data.program.percent)}>
                <div style={{ width: `${data.program.percent}%` }} />
              </div>
              {data.next ? (
                <a className="a-btn primary" href={contentHref(data.next.id)} onClick={onNav(contentHref(data.next.id))}>
                  <span>{data.next.status === 'new' && data.program.percent === 0 ? t.startWith(data.next.title) : t.continueWith(data.next.title)}</span>
                  <Icon name="next" size={18} />
                </a>
              ) : (
                <p className="a-sub">{t.programDone}</p>
              )}
            </section>
          ) : (
            <div className="a-note">{t.noProgram}</div>
          )}

          {data.program && prog.data?.program && prog.data.modules.length > 0 && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h2 className="a-label">{t.modulesTitle}</h2>
              <ModuleList modules={prog.data.modules} />
            </section>
          )}

          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 className="a-label">{t.todo}</h2>
            {tasks.length === 0 ? (
              <p className="a-sub">{t.nothingTodo}</p>
            ) : (
              <div className="a-list">
                {tasks.map((x) => (
                  <a key={`${x.id}-${x.hint}`} className="a-row" href={contentHref(x.id)} onClick={onNav(contentHref(x.id))}>
                    <span className="grow">
                      <span className="t">{x.title}</span>
                      <span className="s">{x.hint}</span>
                    </span>
                    {x.pill}
                  </a>
                ))}
              </div>
            )}
          </section>

          <div className="a-list">
            {[
              { href: '/wiedza', icon: 'book', label: pl.nav.serviceBook },
              { href: '/wiedza/regulaminy', icon: 'file', label: pl.nav.documents },
              { href: '/menu', icon: 'menu', label: pl.nav.menu },
            ].map((l) => (
              <a key={l.href} className="a-row" href={l.href} onClick={onNav(l.href)}>
                <Icon name={l.icon} size={20} />
                <span className="grow">
                  <span className="t">{l.label}</span>
                </span>
                <Icon name="next" size={18} />
              </a>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
