import { useState } from 'react';
import { api } from '../api';
import { pl } from '../i18n/pl';
import { clearPersonalCache } from '../pwa';
import { ChangeSecret } from '../screens/ChangeSecret';
import { onNav } from '../router';
import { Icon, useAcademy, useApi } from './shared';

const t = pl.academy.profile;

export function Account({ onLoggedOut, refreshMe }: { onLoggedOut: () => void; refreshMe: () => Promise<void> }) {
  const { me } = useAcademy();
  const [changing, setChanging] = useState(false);
  const [done, setDone] = useState(false);

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    await clearPersonalCache();
    onLoggedOut();
  }

  if (changing) {
    return (
      <ChangeSecret
        me={me}
        onCancel={() => setChanging(false)}
        onDone={async () => {
          setChanging(false);
          setDone(true);
          await refreshMe();
        }}
      />
    );
  }

  const role = me.user.role === 'owner' ? pl.home.roleOwner : me.user.role === 'manager' ? pl.home.roleManager : pl.home.roleEmployee;
  return (
    <main className="a-main">
      <h1 className="a-title">{t.title}</h1>
      <div className="a-card">
        <span style={{ fontSize: 20, fontWeight: 700 }}>
          {me.user.firstName} {me.user.lastName}
        </span>
        <span className="a-sub">
          {role} · {me.locations.map((l) => l.name).join(', ')}
        </span>
        <span className="a-sub">
          {t.login}: <strong style={{ color: 'var(--text)' }}>{me.user.login}</strong>
        </span>
      </div>
      {me.user.role === 'employee' && (
        <div className="a-list">
          <a className="a-row" href="/godziny" onClick={onNav('/godziny')}>
            <Icon name="clock" size={20} />
            <span className="grow">
              <span className="t">{pl.myTime.title}</span>
            </span>
            <Icon name="next" size={18} />
          </a>
        </div>
      )}
      <div className="a-list">
        <a className="a-row" href="/instaluj" onClick={onNav('/instaluj')}>
          <Icon name="download" size={20} />
          <span className="grow">
            <span className="t">{pl.install.accountLink}</span>
          </span>
          <Icon name="next" size={18} />
        </a>
      </div>
      <LocationInfo />
      {done && (
        <div className="a-note" role="status">
          {t.saved}
        </div>
      )}
      <button className="a-btn" onClick={() => setChanging(true)}>
        {me.user.secretKind === 'pin' ? t.changePin : t.changePassword}
      </button>
      {me.user.secretKind === 'pin' && <p className="a-sub">{pl.academy.profile.pinTerminalInfo}</p>}
      <button className="a-btn" onClick={() => void logout()}>
        {t.logout}
      </button>
      <p className="a-sub">{t.offlineInfo}</p>
      <p className="a-sub" style={{ opacity: 0.6 }}>{t.version(__APP_VERSION__)}</p>
    </main>
  );
}


const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** Address, phone, opening hours and the owner's note for the team (D38). */
function LocationInfo() {
  const { locationId } = useAcademy();
  const { data } = useApi<{
    location: { name: string; address: string | null; phone: string | null; email: string | null; openingHours: Record<string, string>; staffNote: string | null; punchPhoto?: boolean };
  }>(`/api/locations/${locationId}/info`);
  if (!data) return null;
  const l = data.location;
  const hours = DAYS.filter((d) => l.openingHours[d]);
  if (!l.address && !l.phone && !l.email && !hours.length && !l.staffNote && !l.punchPhoto) return null;
  const tp = pl.academy.profile;
  return (
    <div className="a-card">
      <span className="a-label">{tp.location}</span>
      <span style={{ fontSize: 18, fontWeight: 700 }}>{l.name}</span>
      {l.address && <span className="a-sub">{l.address}</span>}
      {(l.phone || l.email) && (
        <span className="a-sub">
          {l.phone && <a href={`tel:${l.phone.replace(/\s/g, '')}`}>{l.phone}</a>}
          {l.phone && l.email ? ' · ' : ''}
          {l.email && <a href={`mailto:${l.email}`}>{l.email}</a>}
        </span>
      )}
      {hours.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="a-label" style={{ marginTop: 6 }}>
            {tp.hours}
          </span>
          {hours.map((d) => (
            <span key={d} className="a-sub" style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span>{pl.admin.locations.days[d]}</span>
              <span style={{ color: 'var(--text)' }}>{l.openingHours[d]}</span>
            </span>
          ))}
        </div>
      )}
      {l.staffNote && (
        <div className="a-note" style={{ whiteSpace: 'pre-wrap' }}>
          <span>
            <strong>{tp.note}:</strong> {l.staffNote}
          </span>
        </div>
      )}
      {l.punchPhoto && <span className="a-sub">{tp.punchPhoto}</span>}
    </div>
  );
}
