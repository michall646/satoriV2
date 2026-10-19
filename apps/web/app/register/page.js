// Register: login rules + affiliation nudge (meter, not reject-loop).
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { API, STR, getLang } from '../../lib/client';
import { Button } from '../../components/ui';
import EyebrowFx from '../../components/EyebrowFx';
import AuthField from '../../components/AuthField';

const LOGIN_RE = /^[a-z0-9_]{3,24}$/;

function strength(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s += 1;
  if (/\d/.test(pw)) s += 1;
  if (/[^A-Za-z0-9]/.test(pw)) s += 1;
  return s;
}

export default function RegisterPage() {
  const [f, setF] = useState({ login: '', email: '', password: '', confirm: '', firstName: '', lastName: '', accessCode: '' });
  const [msg, setMsg] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [busy, setBusy] = useState(false);
  const t = STR[getLang()];
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pwScore = strength(f.password);
  async function go(e) {
    e.preventDefault();
    setMsg('');
    setFieldError(null);
    if (!LOGIN_RE.test(f.login)) { setFieldError({ field: 'login', msg: 'login 3–24 [a-z0-9_]' }); return; }
    if (!f.email || !f.email.includes('@')) { setFieldError({ field: 'email', msg: t.reg_err_email }); return; }
    if (f.password !== f.confirm) { setFieldError({ field: 'confirm', msg: t.reg_err_diff }); return; }
    if (pwScore < 2) { setFieldError({ field: 'password', msg: t.reg_err_weak }); return; }
    setBusy(true);
    let r;
    try {
      const body = { login: f.login, email: f.email, password: f.password, firstName: f.firstName, lastName: f.lastName };
      if (f.accessCode) body.accessCode = f.accessCode;
      r = await fetch(`${API}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch { setBusy(false); setMsg(t.errors_retry); return; }
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? `${t.reg_done} ${d.login}. ${t.reg_now_login}` : (d.error?.hint || d.error?.message || t.reg_failed));
  }
  return (
    <div className="auth-shell">
      <form onSubmit={go} className="auth-form" noValidate>
        <EyebrowFx text="Satori V2" />
        <h1 className="type-display auth-title">{t.reg_title}</h1>
        <p className="auth-sub">{t.guest_cta_p}</p>
        <AuthField id="reg-login" label="login" value={f.login} onChange={set('login')} placeholder="login" autoComplete="username" autoFocus error={fieldError?.field === 'login' ? fieldError.msg : ''} hint="3–24 · a–z 0–9 _" />
        <AuthField id="reg-email" label={t.reg_email} value={f.email} onChange={set('email')} placeholder="you@example.com" autoComplete="email" error={fieldError?.field === 'email' ? fieldError.msg : ''} />
        <AuthField id="reg-password" label={t.auth_password} reveal value={f.password} onChange={set('password')} placeholder={t.auth_password} autoComplete="new-password" hint={`${t.reg_strength} ${pwScore}/4`} error={fieldError?.field === 'password' ? fieldError.msg : ''} />
        <AuthField id="reg-confirm" label={t.reg_confirm} reveal value={f.confirm} onChange={set('confirm')} placeholder={t.reg_confirm} autoComplete="new-password" error={fieldError?.field === 'confirm' ? fieldError.msg : ''} />
        <AuthField id="reg-first" label={t.reg_first} value={f.firstName} onChange={set('firstName')} placeholder={t.reg_first} autoComplete="given-name" />
        <AuthField id="reg-last" label={t.reg_last} value={f.lastName} onChange={set('lastName')} placeholder={t.reg_last} autoComplete="family-name" />
        <AuthField id="reg-code" label={t.reg_code_label} value={f.accessCode} onChange={set('accessCode')} placeholder={t.reg_code_ph} hint={t.reg_no_captcha} />
        <Button type="submit" disabled={busy}>{busy ? `${t.auth_register}…` : t.auth_register}</Button>
        {msg ? <p role="status" className="auth-alert">{msg}</p> : null}
        <p className="auth-foot">{t.reg_have_account} <Link className="focus-ring rounded" href="/login">{t.auth_login} →</Link></p>
      </form>
    </div>
  );
}
