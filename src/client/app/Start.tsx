import { pl } from '../i18n/pl';
import { onNav } from '../router';
import { TodayCard } from './Checklist';
import { MyTimeCard } from './MyTime';
import { MyScheduleCard } from './Grafik';
import { InstallCard } from './Install';
import { ModuleList, type ProgramView } from './Program';
import { contentHref, Fold, Icon, Loading, Problem, useAcademy, useApi } from './shared';

interface Home {
  user: { firstName: string };
  program: { id: string; name: string; percent: number; modules: number; modulesComplete: number } | null;
  next: { id: string; kind: string; title: string; status: string } | null;
  toConfirm: { id: string; kind: string; title: string; status: string }[];
  review: { id: string; kind: string; title: string }[];
  updated: { id: string; kind: string; title: string }[];
  deadlines?: { ackDays: number; lockedSince: number | null; nextDue: number | null; items: { id: string; title: string; due: number; overdue: boolean }[] } | null;
}

const dueDate = (ms: number) => new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Warsaw' }).format(new Date(ms));
const daysLeft = (ms: number) => Math.max(0, Math.ceil((ms - Date.now()) / 86400_000));

/** Reading period for mandatory documents (2026-10-17): days left, or Grafik locked. */
export function DeadlineNote({ d }: { d: NonNullable<Home['deadlines']> }) {
  const n = d.items.length;
  if (d.lockedSince !== null)
    return (
      <div className="a-note bad" role="alert">
        <Icon name="lock" size={18} />
        <span>
          <b>{pl.deadlines.lockedTitle(Math.max(1, Math.floor((Date.now() - d.lockedSince) / 86400_000)))}</b> {pl.deadlines.lockedText}
        </span>
      </div>
    );
  if (d.nextDue === null) return null;
  return (
    <div className="a-note warn">
      <Icon name="clock" size={18} />
      <span>
        <b>{pl.deadlines.left(daysLeft(d.nextDue), n)}</b> ({pl.deadlines.until(dueDate(d.nextDue))})
        <br />
        <span style={{ fontSize: 13, opacity: 0.85 }}>{pl.deadlines.warning}</span>
      </span>
    </div>
  );
}

const t = pl.academy;

/** Hour in Warsaw (the phone may be set to another zone). */
const warsawHour = () => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Warsaw' }).format(new Date()));

export function Start() {
  const { locationId, me } = useAcademy();
  const { data, error } = useApi<Home>(`/api/locations/${locationId}/home`);
  const prog = useApi<ProgramView>(`/api/locations/${locationId}/program`);

  const tasks = data
    ? [
        ...data.review.map((r) => ({ ...r, pill: <span className="a-pill bad">{t.review}</span>, hint: t.reviewHint })),
        ...data.toConfirm
          .filter((d) => !data.review.some((r) => r.id === d.id))
          .map((d) => {
            const due = data.deadlines?.items.find((x) => x.id === d.id);
            return {
              ...d,
              pill: due?.overdue ? <span className="a-pill bad">{pl.deadlines.overdue}</span> : <span className="a-pill warn">{t.toConfirm}</span>,
              hint: [t.kinds[d.kind] ?? '', due && !due.overdue ? pl.deadlines.until(dueDate(due.due)) : ''].filter(Boolean).join(' · '),
            };
          }),
        ...data.updated.map((u) => ({ ...u, pill: <span className="a-pill">{t.updated}</span>, hint: t.updatedHint })),
      ]
    : [];

  return (
    <main className="a-main">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 className="a-title">{pl.home.hello(data?.user.firstName ?? me.user.firstName, warsawHour())}</h1>
      </div>
      <Problem message={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          {data.deadlines && <DeadlineNote d={data.deadlines} />}
          <InstallCard />
          <TodayCard />
          <MyScheduleCard />
          <MyTimeCard />
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

          {tasks.length === 0 ? (
            <p className="a-sub">{t.nothingTodo}</p>
          ) : (
            <Fold title={t.todo} count={tasks.length} sub={t.todoSub}>
              {tasks.map((x) => (
                <a key={`${x.id}-${x.hint}`} className="a-row" href={contentHref(x.id)} onClick={onNav(contentHref(x.id))}>
                  <span className="grow">
                    <span className="t">{x.title}</span>
                    <span className="s">{x.hint}</span>
                  </span>
                  {x.pill}
                </a>
              ))}
            </Fold>
          )}

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
