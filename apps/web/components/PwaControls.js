// PWA controls: install prompt + offline indicator + outbox flush. Guard clauses.
'use client';
import { useEffect, useState } from 'react';
import { flushOutbox, pendingCount } from '../lib/outbox';
import { api, STR, getLang } from '../lib/client';

export function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const t = STR[getLang()];

  useEffect(() => {
    try { if (localStorage.getItem('satori-pwa-dismiss') === '1') setDismissed(true); } catch { /* noop */ }
    function onPrompt(e) {
      e.preventDefault();
      setDeferred(e);
    }
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (!deferred || dismissed) return null;

  async function install() {
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    setDeferred(null);
  }

  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem('satori-pwa-dismiss', '1'); } catch { /* noop */ }
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 border rounded p-2 text-sm flex gap-2 items-center shadow" style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--fg)', boxShadow: 'var(--shadow)' }}>
      {t.pwa_install_line}
      <button onClick={install} className="px-2 border rounded focus-ring">{t.install}</button>
      <button onClick={dismiss} className="px-2 focus-ring" aria-label="dismiss">×</button>
    </div>
  );
}

export function OfflineIndicator() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const t = STR[getLang()];

  useEffect(() => {
    setOnline(navigator.onLine);
    setPending(pendingCount());
    function goOnline() {
      setOnline(true);
      flushOutbox(api).then((left) => setPending(left)).catch(() => {});
    }
    function goOffline() { setOnline(false); }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const iv = setInterval(() => setPending(pendingCount()), 5000);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); clearInterval(iv); };
  }, []);

  if (online && !pending) return <span aria-hidden="true" className="text-xs border px-2 py-0.5 rounded invisible select-none"> </span>;
  return <span role="status" className="text-xs border px-2 py-0.5 rounded" style={{ background: 'var(--tle-soft)', borderColor: 'var(--tle-line)', color: 'var(--tle-text)' }}>{!online ? t.offline : ''}{!online && pending ? ' · ' : ''}{pending ? `${t.pwa_outbox} ${pending}` : ''}</span>;
}
