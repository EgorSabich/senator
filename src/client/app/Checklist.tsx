import { useState } from 'react';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { goBack, onNav } from '../router';
import { formatClock } from '../../shared/time';
import { Icon, Loading, Problem, useAcademy, useApi } from './shared';

const t = pl.checklists;

export interface TodayView {
  date: string;
  onShift: { since: number } | null;
  checklists: { id: string; title: string; done: number; total: number; closed: boolean; mine: number }[];
}

interface DayView {
  id: string;
  title: string;
  date: string;
  me: string;
  onShift: { since: number } | null;
  items: { key: string; section: string | null; text: string; mark: { userId: string; name: string; at: number } | null }[];
  done: number;
  total: number;
  closed: { closedAt: number; closedByName: string | null } | null;
}

/** "Dziś" card on Start: shift status and today's checklists. */
export function TodayCard() {
  const { locationId } = useAcademy();
  const { data } = useApi<TodayView>(`/api/locations/${locationId}/checklists/today`);
  if (!data || (!data.checklists.length && !data.onShift)) return null;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 className="a-label">{t.todayTitle}</h2>
      <div className={`a-note${data.onShift ? '' : ' warn'}`}>
        <Icon name={data.onShift ? 'check' : 'info'} size={18} />
        <span>{data.onShift ? t.onShift(formatClock(data.onShift.since)) : t.offShift}</span>
      </div>
      {data.checklists.length > 0 && (
        <div className="a-list">
          {data.checklists.map((c) => (
            <a key={c.id} className="a-row" href={`/listy/${c.id}`} onClick={onNav(`/listy/${c.id}`)}>
              <span className="grow">
                <span className="t">{c.title}</span>
                <span className="s">
                  {t.progress(c.done, c.total)}
                  {t.mine(c.mine)}
                </span>
              </span>
              {c.closed ? <span className="a-pill ok">{t.closed}</span> : <span className="a-ring" style={{ ['--p' as string]: Math.round((c.done / c.total) * 100) }} aria-hidden="true" />}
              <Icon name="next" size={18} />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

export function ChecklistDay({ id }: { id: string }) {
  const { data, error, reload, setData } = useApi<DayView>(`/api/checklists/${id}/today`);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function toggle(item: DayView['items'][number]) {
    if (!data || busy) return;
    const mine = item.mark?.userId === data.me;
    if (item.mark && !mine) return;
    setBusy(item.key);
    setProblem(null);
    // optimistic
    setData({
      ...data,
      items: data.items.map((i) => (i.key === item.key ? { ...i, mark: mine ? null : { userId: data.me, name: t.you, at: Date.now() } } : i)),
      done: data.done + (mine ? -1 : 1),
    });
    try {
      if (mine) await api(`/api/checklists/${id}/marks/${item.key}`, { method: 'DELETE' });
      else await api(`/api/checklists/${id}/marks`, { method: 'POST', body: { key: item.key } });
      try {
        navigator.vibrate?.(15);
      } catch {
        /* none */
      }
    } catch (e) {
      setProblem(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    } finally {
      setBusy(null);
      await reload();
    }
  }

  async function close() {
    if (!data) return;
    if (!window.confirm(t.closeConfirm(data.total - data.done))) return;
    setProblem(null);
    try {
      await api(`/api/checklists/${id}/close`, { method: 'POST' });
      await reload();
    } catch (e) {
      setProblem(errorText(e instanceof ApiFailure ? e.code : 'generic'));
    }
  }

  const sections: { name: string | null; items: DayView['items'] }[] = [];
  for (const it of data?.items ?? []) {
    const last = sections[sections.length - 1];
    if (last && last.name === it.section) last.items.push(it);
    else sections.push({ name: it.section, items: [it] });
  }
  const pct = data && data.total ? Math.round((data.done / data.total) * 100) : 0;
  const locked = !data?.onShift || Boolean(data?.closed);

  return (
    <>
      <header className="a-topbar">
        <button type="button" className="a-icon-btn" aria-label={pl.common.back} onClick={() => goBack('/')}>
          <Icon name="back" size={20} />
        </button>
        <div className="meta">
          <span>{data ? t.dayLabel(data.date) : ''}</span>
          <span>{data ? t.progress(data.done, data.total) : ''}</span>
        </div>
      </header>
      <main className="a-main" style={{ paddingTop: 4 }}>
        {!data && !error && <Loading />}
        <Problem message={error} />
        {data && (
          <>
            <h1 className="a-title" style={{ fontSize: 28 }}>
              {data.title}
            </h1>
            <div className="a-progress" aria-hidden="true">
              <div style={{ width: `${pct}%` }} />
            </div>
            {data.closed ? (
              <div className="a-note">{t.closedInfo(data.closed.closedByName ?? '—', formatClock(data.closed.closedAt))}</div>
            ) : !data.onShift ? (
              <div className="a-note warn">
                <Icon name="info" size={18} />
                <span>{t.offShift}</span>
              </div>
            ) : (
              <p className="a-sub">{t.intro}</p>
            )}
            <Problem message={problem} />
            {sections.map((s, si) => (
              <section key={si} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {s.name && <h2 className="a-label">{s.name}</h2>}
                <div className="a-list">
                  {s.items.map((it) => {
                    const mine = it.mark?.userId === data.me;
                    const other = it.mark && !mine;
                    return (
                      <button
                        key={it.key}
                        type="button"
                        className={`a-row a-task${it.mark ? ' done' : ''}${other ? ' other' : ''}`}
                        onClick={() => void toggle(it)}
                        disabled={locked || Boolean(other) || busy === it.key}
                        aria-pressed={Boolean(it.mark)}
                      >
                        <span className="a-tick" aria-hidden="true">
                          {it.mark && <Icon name="check" size={16} />}
                        </span>
                        <span className="grow">
                          <span className="t">{it.text}</span>
                          {it.mark && <span className="s">{t.by(mine ? t.you : it.mark.name, formatClock(it.mark.at))}</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
            {data.onShift && !data.closed && (
              <button type="button" className="a-btn" onClick={() => void close()}>
                {t.close}
              </button>
            )}
          </>
        )}
      </main>
    </>
  );
}
