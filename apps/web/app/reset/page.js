// Reset password: token from /reset?token=…, password + confirmation, then sign in.
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API, STR, getLang } from '../../lib/client';
import { Button } from '../../components/ui';
import EyebrowFx from '../../components/EyebrowFx';
import AuthField from '../../components/AuthField';

const COPY = {
  title: 'Choose a new password',
  sub: 'This single-use link expires 30 minutes after it was requested.',
  missing: 'This page needs a reset token. Open the link from your reset request, or request a new one from the sign-in page.',
  password: 'New password',
  confirm: 'Confirm new password',
  submit: 'Set new password',
  busy: 'Saving…',
  done: 'Password changed. You can sign in with the new password.',
  min: 'Use at least 6 characters.',
  mismatch: 'The passwords do not match.',
  failed: 'The password could not be changed.',
};

export default function ResetPage({ searchParams }) {
  const rawToken = searchParams?.token;
  const token = Array.isArray(rawToken) ? rawToken[0] : String(rawToken || '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);
  const router = useRouter();
  const t = STR[getLang()];

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => router.push('/login'), 1800);
    return () => clearTimeout(timer);
  }, [done, router]);

  async function submit(e) {
    e.preventDefault();
    if (password.length < 6) { setOk(false); setMsg(COPY.min); return; }
    if (password !== confirm) { setOk(false); setMsg(COPY.mismatch); return; }
    setBusy(true);
    setMsg('');
    let r;
    try {
      r = await fetch(`${API}/api/auth/reset`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
    } catch { setBusy(false); setOk(false); setMsg(t.errors_retry); return; }
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setOk(false);
      const hint = d.error?.hint ? ` ${d.error.hint}` : '';
      setMsg(`${d.error?.message || COPY.failed}${hint}`);
      return;
    }
    setOk(true);
    setDone(true);
    setMsg(COPY.done);
  }

  if (!token) {
    return (
      <div className="auth-shell">
        <div className="auth-form">
          <EyebrowFx text="Satori V2" />
          <h1 className="type-display auth-title">{COPY.title}</h1>
          <p className="auth-sub">{COPY.missing}</p>
          <Link className="focus-ring rounded underline" href="/login">{t.auth_login} →</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <form onSubmit={submit} className="auth-form" noValidate>
        <EyebrowFx text="Satori V2" />
        <h1 className="type-display auth-title">{COPY.title}</h1>
        <p className="auth-sub">{COPY.sub}</p>
        <AuthField id="reset-password" label={COPY.password} reveal value={password} onChange={(e) => setPassword(e.target.value)} placeholder={COPY.password} autoComplete="new-password" autoFocus hint={COPY.min} />
        <AuthField id="reset-confirm" label={COPY.confirm} reveal value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={COPY.confirm} autoComplete="new-password" />
        <Button type="submit" disabled={busy || done}>{busy ? COPY.busy : COPY.submit}</Button>
        {msg ? <p role={ok ? 'status' : 'alert'} className={`auth-alert${ok ? '' : ' is-error'}`}>{msg}</p> : null}
        <p className="auth-foot"><Link className="focus-ring rounded" href="/login">{t.auth_login} →</Link></p>
      </form>
    </div>
  );
}
