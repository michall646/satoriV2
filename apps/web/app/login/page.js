// Login: password step, optional TOTP second step, and a real password-reset request.
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

const COPY = {
  forgot: 'Forgot password?',
  forgotHint: 'Enter your login or e-mail.',
  forgotSend: 'Send reset link',
  forgotSending: 'Sending…',
  forgotGeneric: 'If the account exists, a reset link was sent.',
  devNote: 'Dev mode — this single-use reset link is shown because the API returned a token:',
  devLink: 'Open reset link',
  twoFactorTitle: 'Two-factor authentication',
  twoFactorHint: 'Enter the 6-digit code from your authenticator app.',
  code: '6-digit code',
  verify: 'Verify code',
  verifying: 'Verifying…',
  back: 'Use a different account',
  badCode: 'That code was not accepted. Use the current code from your app.',
  expiredChallenge: 'This sign-in challenge expired. Enter your password again.',
};

export default function LoginPage({ searchParams }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgKind, setMsgKind] = useState('error'); // error | info | ok
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotId, setForgotId] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotMsg, setForgotMsg] = useState('');
  const [forgotDev, setForgotDev] = useState('');
  const router = useRouter();
  const t = STR[getLang()];

  function errorText(d, fallback) {
    const e = (d && d.error) || {};
    const message = e.message || fallback;
    return e.hint ? `${message} ${e.hint}` : message;
  }

  function afterLogin(d) {
    setTokens(d.token, d.refresh);
    try {
      if (!remember) sessionStorage.setItem('SATORI_SESSION_ONLY', '1');
      else sessionStorage.removeItem('SATORI_SESSION_ONLY');
    } catch { /* noop */ }
    const exp = new Date(Date.now() + d.expiresIn * 1000).toLocaleString();
    setBusy(false);
    setVerifyBusy(false);
    setMsgKind('ok');
    setMsg(`${t.auth_logged_in} ${t.auth_expiry} ${exp}.`);
    toast(`${t.auth_logged_in} ${t.auth_expiry} ${exp}.`);
    const next = typeof searchParams?.next === 'string' ? searchParams.next : null;
    const recent = (() => { try { return localStorage.getItem('satori-recent'); } catch { return null; } })();
    if (next && next.startsWith('/')) router.push(next);
    else router.push(recent ? `/contests/${recent}` : '/contests');
    router.refresh();
  }

  async function go(e) {
    e.preventDefault();
    if (!login || !password) { setMsgKind('error'); setMsg(t.auth_login_hint); return; }
    setMsg('');
    setBusy(true);
    let r;
    try {
      r = await fetch(`${API}/api/auth/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password, device: 'web', remember }),
      });
    } catch { setBusy(false); setMsgKind('error'); setMsg(t.errors_retry); return; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(false); setMsgKind('error'); setMsg(errorText(d, t.auth_login_hint)); return; }
    if (d.twoFactorRequired) {
      setBusy(false);
      setChallenge(d.challenge);
      setCode('');
      setMsgKind('info');
      setMsg(COPY.twoFactorHint);
      return;
    }
    afterLogin(d);
  }

  async function verify(e) {
    e.preventDefault();
    if (!challenge) return;
    if (!/^\d{6}$/.test(code.trim())) { setMsgKind('error'); setMsg(COPY.badCode); return; }
    setVerifyBusy(true);
    setMsg('');
    let r;
    try {
      r = await fetch(`${API}/api/auth/2fa/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge, code: code.trim(), device: 'web', remember }),
      });
    } catch { setVerifyBusy(false); setMsgKind('error'); setMsg(t.errors_retry); return; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setVerifyBusy(false);
      setMsgKind('error');
      const expired = ['BAD_CHALLENGE', 'CHALLENGE_USED', 'CHALLENGE_EXPIRED'].includes(d.error?.code);
      if (expired) { setChallenge(null); setCode(''); setMsg(COPY.expiredChallenge); }
      else setMsg(errorText(d, COPY.badCode));
      return;
    }
    setChallenge(null);
    afterLogin(d);
  }

  function backToPassword() {
    setChallenge(null);
    setCode('');
    setPassword('');
    setMsg('');
    setMsgKind('error');
  }

  async function sendReset() {
    const value = (forgotId || login).trim();
    if (!value) { setForgotMsg(COPY.forgotHint); return; }
    setForgotBusy(true);
    setForgotMsg('');
    setForgotDev('');
    let r;
    try {
      const payload = value.includes('@') ? { email: value } : { login: value };
      r = await fetch(`${API}/api/auth/forgot`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch { setForgotBusy(false); setForgotMsg(t.errors_retry); return; }
    const d = await r.json().catch(() => ({}));
    setForgotBusy(false);
    if (!r.ok) { setForgotMsg(errorText(d, t.errors_retry)); return; }
    // Generic on purpose: the API does not reveal whether the account exists.
    setForgotMsg(COPY.forgotGeneric);
    if (d.devToken) setForgotDev(d.devToken);
  }

  function toggleForgot() {
    setForgotOpen((open) => !open);
    setForgotMsg('');
    setForgotDev('');
    if (!forgotId) setForgotId(login);
  }

  const forgotSection = forgotOpen ? (
    <div className="auth-alert" style={{ marginTop: 0, marginBottom: 14 }}>
      <p className="text-xs" style={{ color: 'var(--muted)', marginBottom: 8 }}>{COPY.forgotHint}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          id="auth-forgot"
          className="auth-input"
          value={forgotId}
          onChange={(e) => setForgotId(e.target.value)}
          placeholder="login or e-mail"
          autoComplete="username"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendReset(); } }}
        />
        <Button variant="secondary" onClick={sendReset} disabled={forgotBusy} className="shrink-0">
          {forgotBusy ? COPY.forgotSending : COPY.forgotSend}
        </Button>
      </div>
      {forgotMsg ? <p role="status" className="text-xs" style={{ marginTop: 8 }}>{forgotMsg}</p> : null}
      {forgotDev ? (
        <p className="text-xs" style={{ marginTop: 8 }}>
          {COPY.devNote}{' '}
          <Link className="underline" href={`/reset?token=${encodeURIComponent(forgotDev)}`}>{COPY.devLink}</Link>
        </p>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="auth-shell">
      <form onSubmit={challenge ? verify : go} className="auth-form" noValidate>
        <EyebrowFx text="Satori V2" />
        {challenge ? (
          <>
            <h1 className="type-display auth-title">{COPY.twoFactorTitle}</h1>
            <p className="auth-sub">{COPY.twoFactorHint}</p>
            <AuthField
              id="auth-totp"
              label={COPY.code}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              placeholder="123456"
              autoComplete="one-time-code"
              inputMode="numeric"
              autoFocus
            />
            <Button type="submit" disabled={verifyBusy}>{verifyBusy ? COPY.verifying : COPY.verify}</Button>
            <button type="button" onClick={backToPassword} className="code-mini" style={{ marginTop: 12, alignSelf: 'flex-start' }}>{COPY.back}</button>
          </>
        ) : (
          <>
            <h1 className="type-display auth-title">{t.auth_welcome}</h1>
            <p className="auth-sub">{t.auth_welcome_sub}</p>
            <AuthField id="auth-login" label="login" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="login" autoComplete="username" autoFocus />
            <AuthField id="auth-password" label={t.auth_password} reveal value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t.auth_password} autoComplete="current-password" />
            <label className="auth-switch">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {t.auth_remember}
            </label>
            <button type="button" onClick={toggleForgot} className="code-mini" style={{ alignSelf: 'flex-start', marginBottom: 12 }}>{COPY.forgot}</button>
            <Button type="submit" disabled={busy}>{busy ? `${t.auth_login}…` : t.auth_login}</Button>
            {forgotSection}
          </>
        )}
        {msg ? <p role={msgKind === 'error' ? 'alert' : 'status'} className={`auth-alert${msgKind === 'error' ? ' is-error' : ''}`}>{msg}</p> : null}
        {!challenge ? <p className="auth-foot">{t.auth_new_here} <Link className="focus-ring rounded" href="/register">{t.auth_register} →</Link></p> : null}
      </form>
    </div>
  );
}
