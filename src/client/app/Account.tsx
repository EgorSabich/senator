import { useState, type FormEvent } from 'react';
import { api, ApiFailure } from '../api';
import { errorText, pl } from '../i18n/pl';
import { clearPersonalCache } from '../pwa';
import { ChangeSecret } from '../screens/ChangeSecret';
import { useAcademy, useApi } from './shared';

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
      {me.user.secretKind === 'password' ? <TerminalPin /> : <p className="a-sub">{pl.academy.profile.pinTerminalInfo}</p>}
      <button className="a-btn" onClick={() => void logout()}>
        {t.logout}
      </button>
      <p className="a-sub">{t.offlineInfo}</p>
    </main>
  );
}

/** Managers and the owner sign in with a password; for the time terminal they choose a separate PIN (D35). */
function TerminalPin() {
  const { data, reload } = useApi<{ set: boolean }>('/api/auth/terminal-pin');
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/api/auth/terminal-pin', { method: 'PUT', body: { password, pin } });
      setSaved(true);
      setOpen(false);
      setPassword('');
      setPin('');
      await reload();
    } catch (err) {
      setError(errorText(err instanceof ApiFailure ? err.code : 'generic'));
    }
  }
  const tp = pl.academy.profile;
  return (
    <div className="a-card">
      <span style={{ fontWeight: 700 }}>{tp.terminalPin}</span>
      <span className="a-sub">{data?.set ? tp.terminalPinSet : tp.terminalPinNone}</span>
      {saved && <span className="a-sub">{tp.saved}</span>}
      {open ? (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="a-sub" htmlFor="tp-pass">{tp.currentPassword}</label>
          <input id="tp-pass" className="a-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <label className="a-sub" htmlFor="tp-pin">{tp.newTerminalPin}</label>
          <input id="tp-pin" className="a-input" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          {error && <div className="a-note bad">{error}</div>}
          <button className="a-btn primary center" type="submit" disabled={!password || pin.length !== 6}>
            {tp.saveTerminalPin}
          </button>
        </form>
      ) : (
        <button className="a-btn" type="button" onClick={() => setOpen(true)}>
          {data?.set ? tp.changeTerminalPin : tp.setTerminalPin}
        </button>
      )}
    </div>
  );
}
