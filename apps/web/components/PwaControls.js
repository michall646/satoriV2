// PWA controls: install prompt, service worker registration, offline indicator
// and outbox flush. Guard clauses throughout; no fake success states.
'use client';
import { useEffect, useRef, useState } from 'react';
import { flushOutbox, pendingCount } from '../lib/outbox';
import { api, STR, getLang } from '../lib/client';

// Registers /sw.js at site scope. Updates are activated explicitly and the page
// reloads once, after `controllerchange`, never on the first install.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined;
    // A dev-mode cached shell would hide hot reloads; production only.
    if (process.env.NODE_ENV !== 'production') return undefined;

    let disposed = false;
    let reloading = false;
    const hadController = Boolean(navigator.serviceWorker.controller);

    function onControllerChange() {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    }

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((reg) => {
      if (disposed) return;

      function activateWaiting(worker) {
        if (!worker) return;
        if (!navigator.serviceWorker.controller) return;
        worker.postMessage({ type: 'SKIP_WAITING' });
      }

      // An update may already be waiting before this listener attaches.
      activateWaiting(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed') activateWaiting(worker);
        });
      });
    }).catch(() => {
      /* registration is best-effort; the app remains fully usable */
    });

    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  return null;
}

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
  const [notice, setNotice] = useState('');
  const t = STR[getLang()];
  const noticeTimer = useRef(null);
  const flushing = useRef(false);

  useEffect(() => {
    let disposed = false;
    setOnline(navigator.onLine);
    setPending(pendingCount());

    async function flush() {
      if (flushing.current) return;
      const before = pendingCount();
      if (!before) {
        if (!disposed) setPending(0);
        return;
      }
      flushing.current = true;
      try {
        const left = await flushOutbox(api).catch(() => before);
        if (disposed) return;
        setPending(left);
        const sent = before - left;
        if (!sent) return;
        const verb = getLang() === 'pl' ? 'wysłano' : 'sent';
        setNotice(`${verb} ${sent}`);
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => { if (!disposed) setNotice(''); }, 6000);
      } finally {
        flushing.current = false;
      }
    }

    function goOnline() {
      setOnline(true);
      flush();
    }
    function goOffline() { setOnline(false); }

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    if (navigator.onLine) flush();

    const iv = setInterval(() => { if (!disposed) setPending(pendingCount()); }, 5000);
    return () => {
      disposed = true;
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(iv);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  const parts = [];
  if (!online) parts.push(t.offline);
  if (pending) parts.push(`${t.pwa_outbox} ${pending}`);
  if (notice) parts.push(notice);

  if (!parts.length) {
    return <span aria-hidden="true" className="text-xs border px-2 py-0.5 rounded invisible select-none"> </span>;
  }
  return (
    <span role="status" className="text-xs border px-2 py-0.5 rounded" style={{ background: 'var(--tle-soft)', borderColor: 'var(--tle-line)', color: 'var(--tle-text)' }}>
      {parts.join(' · ')}
    </span>
  );
}
