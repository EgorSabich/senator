import { useEffect, useState } from 'react';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { onNav } from '../router';
import { contentHref, Icon, Loading, Problem, useAcademy } from './shared';

interface Hit {
  type: 'content' | 'menu_item';
  id: string;
  kind: string;
  title: string;
  section: string | null;
  snippet: { text: string; marks: [number, number][] };
}

const t = pl.academy.search;

function Marked({ text, marks }: { text: string; marks: [number, number][] }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  marks.forEach(([a, b], i) => {
    if (a > at) parts.push(text.slice(at, a));
    parts.push(<mark key={i}>{text.slice(a, b)}</mark>);
    at = b;
  });
  parts.push(text.slice(at));
  return <>{parts}</>;
}

function readQuery(): string {
  return new URLSearchParams(location.search).get('q') ?? '';
}

export function Search() {
  const { locationId } = useAcademy();
  const [q, setQ] = useState(readQuery);
  const [results, setResults] = useState<Hit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const query = q.trim();
    history.replaceState(null, '', query ? `/szukaj?q=${encodeURIComponent(query)}` : '/szukaj');
    if (query.length < 2) {
      setResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const res = await api<{ results: Hit[] }>(`/api/locations/${locationId}/search?q=${encodeURIComponent(query)}`);
        setResults(res.results);
      } catch (e) {
        setError(errorText(e instanceof ApiFailure ? e.code : 'generic'));
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q, locationId]);

  return (
    <main className="a-main">
      <h1 className="a-title">{t.title}</h1>
      <label className="a-search">
        <Icon name="search" size={18} />
        <span className="sr-only">{t.title}</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.placeholder} autoFocus enterKeyHint="search" />
      </label>
      {!results && !busy && <p className="a-sub">{t.hint}</p>}
      <Problem message={error} />
      {busy && !results && <Loading />}
      {results && results.length === 0 && <p className="a-sub">{t.none(q.trim())}</p>}
      {results && results.length > 0 && (
        <div className="a-list" aria-live="polite">
          {results.map((r) => {
            const href = r.type === 'content' ? contentHref(r.id) : `/menu/${r.id}`;
            const label = r.type === 'content' ? pl.academy.kinds[r.kind] : r.kind === 'bar' ? t.menuBar : t.menuKitchen;
            return (
              <a key={`${r.type}-${r.id}`} className="a-row a-hit" href={href} onClick={onNav(href)}>
                <span className="grow">
                  <span className="s">
                    {label}
                    {r.section ? ` · ${r.section}` : ''}
                  </span>
                  <span className="t">{r.title}</span>
                  {r.snippet.text && (
                    <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-soft)' }}>
                      <Marked text={r.snippet.text} marks={r.snippet.marks} />
                    </span>
                  )}
                </span>
              </a>
            );
          })}
        </div>
      )}
    </main>
  );
}
