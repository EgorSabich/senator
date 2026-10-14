import { useState } from 'react';
import { api } from '../api';
import { pl } from '../i18n/pl';
import { clearPersonalCache } from '../pwa';
import { ChangeSecret } from '../screens/ChangeSecret';
import { useAcademy } from './shared';

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
      {done && (
        <div className="a-note" role="status">
          {t.saved}
        </div>
      )}
      <button className="a-btn" onClick={() => setChanging(true)}>
        {me.user.secretKind === 'pin' ? t.changePin : t.changePassword}
      </button>
      <button className="a-btn" onClick={() => void logout()}>
        {t.logout}
      </button>
      <p className="a-sub">{t.offlineInfo}</p>
    </main>
  );
}
