// Login: JWT + refresh stored, remember-me, visible session expiry.
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API, STR, getLang } from '../../lib/client';
import { setTokens } from '../../hooks/useApi';
import { Button } from '../../components/ui';
import EyebrowFx from '../../components/EyebrowFx';
import AuthField from '../../components/AuthField';
import { toast } from '../../components/ui/Toast';

export default function LoginPage({ searchParams }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);
  const router = useRouter();
  const t = STR[getLang()];
  async function go(e) {
    e.preventDefault();
    if (!login || !password) { setMsg(t.auth_login_hint); return; }
    setMsg('');
    setBusy(true);
    let r;
    try {
      r = await fetch(`${API}/api/auth/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password, device: 'web', remember }),
      });
    } catch { setBusy(false); setMsg(t.errors_retry); return; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(false); setMsg(d.error?.message || t.auth_login_hint); return; }
    setTokens(d.token, d.refresh);
    try {
      if (!remember) sessionStorage.setItem('SATORI_SESSION_ONLY', '1');
      else sessionStorage.removeItem('SATORI_SESSION_ONLY');
    } catch { /* noop */ }
    const exp = new Date(Date.now() + d.expiresIn * 1000).toLocaleString();
    setOk(true);
    setMsg(`${t.auth_logged_in} ${t.auth_expiry} ${exp}.`);
    toast(`${t.auth_logged_in} ${t.auth_expiry} ${exp}.`);
    const next = searchParams?.next;
    const recent = (() => { try { return localStorage.getItem('satori-recent'); } catch { return null; } })();
    if (next && next.startsWith('/')) router.push(next);
    else router.push(recent ? `/contests/${recent}` : '/contests');
    router.refresh();
  }
  return (
    <div className="auth-shell">
      <form onSubmit={go} className="auth-form" noValidate>
        <EyebrowFx text="Satori V2" />
        <h1 className="type-display auth-title">{t.auth_welcome}</h1>
        <p className="auth-sub">{t.auth_welcome_sub}</p>
        <AuthField id="auth-login" label="login" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="login" autoComplete="username" autoFocus />
        <AuthField id="auth-password" label={t.auth_password} reveal value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t.auth_password} autoComplete="current-password" />
        <label className="auth-switch">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {t.auth_remember}
        </label>
        <Button type="submit" disabled={busy}>{busy ? `${t.auth_login}…` : t.auth_login}</Button>
        {msg ? <p role={ok ? 'status' : 'alert'} className={`auth-alert${ok ? '' : ' is-error'}`}>{msg}</p> : null}
        <p className="auth-foot">{t.auth_new_here} <Link className="focus-ring rounded" href="/register">{t.auth_register} →</Link></p>
      </form>
    </div>
  );
}
