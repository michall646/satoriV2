// Account security: TOTP 2FA setup/enable/disable and revoking other sessions.
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/client';
import { Badge, Button, Input, Skeleton, EmptyState } from '../../../components/ui';
import { CopyButton } from '../../../components/ui/Code';
import EyebrowFx from '../../../components/EyebrowFx';
import { toast } from '../../../components/ui/Toast';

export default function SecurityPage() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [setupData, setSetupData] = useState(null);
  const [enableCode, setEnableCode] = useState('');
  const [disablePw, setDisablePw] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState(null);

  useEffect(() => {
    let live = true;
    api('/api/me')
      .then((d) => { if (live) setMe(d); })
      .catch(() => { if (live) setMe(null); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  function say(tone, text) { setNote({ tone, text }); }

  async function refreshMe() {
    const d = await api('/api/me');
    setMe(d);
  }

  async function startSetup() {
    setBusy('setup');
    setNote(null);
    try {
      const d = await api('/api/auth/2fa/setup', { method: 'POST', body: JSON.stringify({}) });
      setSetupData(d);
      setEnableCode('');
      say('info', 'Add the secret to your authenticator app, then enter a current code to enable 2FA.');
    } catch (e) {
      say('error', e.message);
    } finally { setBusy(''); }
  }

  async function enable(e) {
    e.preventDefault();
    if (!/^\d{6}$/.test(enableCode.trim())) { say('error', 'Enter the current 6-digit code.'); return; }
    setBusy('enable');
    try {
      await api('/api/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ code: enableCode.trim() }) });
      setSetupData(null);
      setEnableCode('');
      await refreshMe();
      say('ok', 'Two-factor authentication is enabled.');
      toast('Two-factor authentication enabled.', 'success');
    } catch (err) {
      say('error', err.message);
    } finally { setBusy(''); }
  }

  async function disable(e) {
    e.preventDefault();
    if (!disablePw || !disableCode.trim()) { say('error', 'Enter your password and the current 6-digit code.'); return; }
    setBusy('disable');
    try {
      await api('/api/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ password: disablePw, code: disableCode.trim() }) });
      setDisablePw('');
      setDisableCode('');
      await refreshMe();
      say('ok', 'Two-factor authentication is disabled.');
      toast('Two-factor authentication disabled.', 'success');
    } catch (err) {
      say('error', err.message);
    } finally { setBusy(''); }
  }

  async function signOutOthers() {
    const others = (me?.sessions || []).filter((s) => !s.current);
    if (!others.length) { say('info', 'No other active sessions.'); return; }
    setBusy('sessions');
    try {
      for (const s of others) await api(`/api/me/sessions/${s.id}`, { method: 'DELETE' });
      await refreshMe();
      say('ok', `Signed out ${others.length} other session${others.length === 1 ? '' : 's'}.`);
      toast('Other sessions signed out.', 'success');
    } catch (err) {
      say('error', err.message);
    } finally { setBusy(''); }
  }

  if (loading) {
    return (
      <div className="w-full max-w-3xl">
        <div className="skeleton h-3 w-32" />
        <div className="skeleton h-8 w-64 mt-3" />
        <div className="card mt-6 space-y-4"><Skeleton lines={5} /><Skeleton lines={3} /></div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="max-w-xl mx-auto mt-6">
        <EmptyState
          line="Sign in to manage two-factor authentication."
          action={<Link href="/login" className="px-4 py-2 rounded text-sm font-semibold focus-ring inline-block" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Sign in</Link>}
        />
      </div>
    );
  }

  const enabled = Boolean(me.totpEnabled);
  const otherSessions = (me.sessions || []).filter((s) => !s.current).length;

  return (
    <div className="w-full max-w-3xl flex flex-col gap-6">
      <header>
        <EyebrowFx text="Account security" />
        <h1 className="type-display mt-2">Two-factor authentication</h1>
        <p className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>
          Protect your account with a 6-digit code from an authenticator app.
        </p>
      </header>

      {note ? (
        <p role={note.tone === 'error' ? 'alert' : 'status'} className={`auth-alert${note.tone === 'error' ? ' is-error' : ''}`} style={{ marginTop: 0 }}>
          {note.text}
        </p>
      ) : null}

      <section className="card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Authenticator app (TOTP)</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              Works with any RFC 6238 app: Google Authenticator, Aegis, 1Password, and similar.
            </p>
          </div>
          <Badge tone={enabled ? 'accent' : 'neutral'}>{enabled ? 'Enabled' : 'Disabled'}</Badge>
        </div>

        {enabled ? (
          <form onSubmit={disable} className="mt-4 flex flex-col gap-3 max-w-sm" noValidate>
            <Input
              id="totp-disable-password"
              type="password"
              label="Current password"
              value={disablePw}
              onChange={(e) => setDisablePw(e.target.value)}
              autoComplete="current-password"
            />
            <Input
              id="totp-disable-code"
              label="Current 6-digit code"
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
            />
            <div className="flex items-center gap-3">
              <Button type="submit" variant="danger" disabled={busy === 'disable'}>
                {busy === 'disable' ? 'Disabling…' : 'Disable 2FA'}
              </Button>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>Requires both password and a current code.</span>
            </div>
          </form>
        ) : (
          <div className="mt-4">
            {!setupData ? (
              <Button onClick={startSetup} disabled={busy === 'setup'}>
                {busy === 'setup' ? 'Generating…' : 'Set up authenticator'}
              </Button>
            ) : (
              <div className="flex flex-col gap-4 max-w-lg">
                <div>
                  <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Secret (base32)</p>
                  <p className="mt-1 flex items-center gap-2 flex-wrap">
                    <code className="type-mono" style={{ wordBreak: 'break-all' }}>{setupData.secret}</code>
                    <CopyButton text={setupData.secret} label="Copy secret" />
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>otpauth URL</p>
                  <p className="mt-1 flex items-start gap-2">
                    <code className="type-mono" style={{ wordBreak: 'break-all', flex: 1 }}>{setupData.otpauthUrl}</code>
                    <CopyButton text={setupData.otpauthUrl} label="Copy URL" />
                  </p>
                </div>
                <form onSubmit={enable} className="flex flex-col gap-3" noValidate>
                  <Input
                    id="totp-enable-code"
                    label="Code from the app"
                    value={enableCode}
                    onChange={(e) => setEnableCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    hint="2FA is not active until this code is verified."
                  />
                  <div>
                    <Button type="submit" disabled={busy === 'enable'}>{busy === 'enable' ? 'Enabling…' : 'Enable 2FA'}</Button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )}

        <p className="text-xs mt-4" style={{ color: 'var(--muted)' }}>
          Recovery codes and WebAuthn are not available yet. Keep a backup of the secret before enabling 2FA.
        </p>
      </section>

      <section className="card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Other sessions</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              {otherSessions ? `${otherSessions} other active session${otherSessions === 1 ? '' : 's'}.` : 'Only this device is signed in.'}
            </p>
          </div>
          <Button variant="secondary" onClick={signOutOthers} disabled={busy === 'sessions' || !otherSessions}>
            {busy === 'sessions' ? 'Signing out…' : 'Sign out other sessions'}
          </Button>
        </div>
      </section>

      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Password changes and the full session list live on your <Link className="underline" href="/me">profile</Link>. This page only manages two-factor authentication and other sessions.
      </p>
    </div>
  );
}
