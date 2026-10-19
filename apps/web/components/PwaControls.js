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
  const [flushing, setFlushing] = useState(false);
  const t = STR[getLang()];
  const pl = getLang() === 'pl';
  const noticeTimer = useRef(null);
  const flushingRef = useRef(false);
  const pendingRef = useRef(null);

  useEffect(() => {
    let disposed = false;
    setOnline(navigator.onLine !== false);

    function showNotice(text) {
      if (disposed) return;
      setNotice(text);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => { if (!disposed) setNotice(''); }, 6000);
    }

    async function refreshCount() {
      const count = await pendingCount().catch(() => 0);
      if (disposed) return count;
      // Do not let a slow read race the flush's final remaining count.
      if (flushingRef.current) return pendingRef.current ?? count;
      const previous = pendingRef.current;
      pendingRef.current = count;
      setPending(count);
      if (previous != null && count > previous) {
        showNotice(`${pl ? 'w kolejce' : 'queued'} ${count}`);
      }
      return count;
    }

    async function flush() {
      if (flushingRef.current) return;
      flushingRef.current = true;
      if (!disposed) setFlushing(true);
      try {
        const result = await flushOutbox(api);
        if (disposed) return;
        pendingRef.current = result.remaining;
        setPending(result.remaining);

        const parts = [];
        if (result.sent > 0) parts.push(`${pl ? 'wysłano' : 'sent'} ${result.sent}`);
        if (result.failed > 0) parts.push(`${pl ? 'nie wysłano' : 'failed'} ${result.failed}`);
        if (parts.length) showNotice(parts.join(' · '));
      } catch {
        showNotice(pl ? 'nie udało się wysłać' : 'send failed');
      } finally {
        flushingRef.current = false;
        if (!disposed) setFlushing(false);
      }
    }

    function goOnline() {
      setOnline(true);
      showNotice(pl ? 'połączono' : 'online');
      flush();
    }
    function goOffline() { setOnline(false); }

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    refreshCount().then(() => {
      if (!disposed && navigator.onLine !== false) flush();
    });

    const iv = setInterval(() => { if (!disposed) refreshCount(); }, 5000);
    return () => {
      disposed = true;
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(iv);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, [pl]);

  const parts = [];
  if (!online) parts.push(t.offline);
  if (pending) parts.push(`${t.pwa_outbox} ${pending}`);
  if (flushing) parts.push(pl ? 'wysyłanie…' : 'sending…');
  if (notice) parts.push(notice);

  if (!parts.length) {
    return <span aria-hidden="true" className="text-xs border px-2 py-0.5 rounded invisible select-none"> </span>;
  }
  return (
    <span role="status" aria-busy={flushing} className="text-xs border px-2 py-0.5 rounded" style={{ background: 'var(--tle-soft)', borderColor: 'var(--tle-line)', color: 'var(--tle-text)' }}>
      {parts.join(' · ')}
    </span>
  );
}
