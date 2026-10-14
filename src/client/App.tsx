import { useEffect, useState } from 'react';
import { pl } from './i18n/pl';

type Health = { ok: boolean; db: boolean; env: string } | 'error' | null;

/** Stage 1 shell: brand + server/database status. Replaced by the real app in stages 2–5. */
export function App() {
  const [health, setHealth] = useState<Health>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json() as Promise<{ ok: boolean; db: boolean; env: string }>)
      .then(setHealth)
      .catch(() => setHealth('error'));
  }, []);

  return (
    <main style={styles.page}>
      <div style={styles.brand}>
        <span style={styles.wordmark}>{pl.app.name}</span>
        <span style={styles.sub}>{pl.app.subtitle}</span>
      </div>
      <p style={styles.note}>{pl.shell.stageNote}</p>
      <p role="status" style={styles.status}>
        {health === null && pl.app.loading}
        {health === 'error' && pl.shell.healthFail}
        {health && health !== 'error' && (
          <>
            {pl.shell.healthOk} · {pl.shell.healthDb}: {health.db ? 'OK' : '—'} · {health.env}
          </>
        )}
      </p>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    textAlign: 'center',
  },
  brand: { display: 'flex', flexDirection: 'column', gap: 4 },
  wordmark: { fontFamily: 'var(--font-display)', fontSize: 40, fontWeight: 600, letterSpacing: '0.08em' },
  sub: { fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-muted)' },
  note: { margin: 0, color: 'var(--text-soft)', fontSize: 15 },
  status: { margin: 0, color: 'var(--text-muted)', fontSize: 13 },
};
