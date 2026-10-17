import { useEffect, useState } from 'react';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { ErrorBox } from '../ui';
import { formatDateTime } from './common';

interface Entry {
  id: string;
  action: string;
  entityType: string;
  afterJson: string | null;
  createdAt: number;
  actorFirstName: string | null;
  actorLastName: string | null;
}
const t = pl.admin.audit;

function summary(e: Entry): string {
  if (!e.afterJson) return '';
  try {
    const a = JSON.parse(e.afterJson) as Record<string, unknown>;
    const parts: string[] = [];
    if (a.firstName || a.lastName) parts.push(`${a.firstName ?? ''} ${a.lastName ?? ''}`.trim());
    if (a.title) parts.push(String(a.title));
    if (a.name) parts.push(String(a.name));
    if (a.versionNo) parts.push(pl.admin.content.version(Number(a.versionNo)));
    if (a.changeLevel) parts.push(pl.admin.content.levels[String(a.changeLevel)]?.label ?? '');
    return parts.filter(Boolean).join(' · ');
  } catch {
    return '';
  }
}

export function Audit() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ entries: Entry[] }>('/api/admin/audit?limit=300')
      .then((r) => setEntries(r.entries))
      .catch((e) => setError(errorText(e instanceof ApiFailure ? e.code : 'generic')));
  }, []);
  return (
    <>
      <h1 className="page-title">{t.title}</h1>
      <ErrorBox message={error} />
      {entries?.length === 0 && <p className="muted">{t.empty}</p>}
      {entries && entries.length > 0 && (
        <div className="table-wrap audit-table">
          <table>
            <thead>
              <tr>
                <th>{t.when}</th>
                <th>{t.who}</th>
                <th>{t.what}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="audit-when" style={{ whiteSpace: 'nowrap', color: 'var(--text-soft)' }}>{formatDateTime(e.createdAt)}</td>
                  <td className="audit-who">{e.actorFirstName ? `${e.actorFirstName} ${e.actorLastName}` : t.system}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{t.actions[e.action] ?? e.action}</div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {summary(e)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
