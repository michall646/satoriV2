// Shared data hooks: auth-aware fetch + SSE subscribe. Guard clauses, no nesting.
'use client';
import { useEffect, useState } from 'react';
import { api, API } from '../lib/client';

export function useApi(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setLoading] = useState(!!path);
  useEffect(() => {
    if (!path) { setLoading(false); return; }
    let live = true;
    setLoading(true);
    setError(null);
    api(path).then((d) => { if (live) { setData(d); setLoading(false); } }).catch((e) => { if (live) { setError(String(e.message || e)); setLoading(false); } });
    return () => { live = false; };
  }, [path]);
  async function reload() {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const d = await api(path);
      setData(d);
    } catch (e) { setError(String(e.message || e)); }
    setLoading(false);
  }
  return { data, error, isLoading, reload };
}

export function useSSE(url, onMsg) {
  useEffect(() => {
    if (!url) return;
    let token = null;
    try { token = localStorage.getItem('SATORI_TOKEN'); } catch { token = null; }
    const sep = url.includes('?') ? '&' : '?';
    const full = token ? `${API}${url}${sep}token=${encodeURIComponent(token)}` : `${API}${url}`;
    const es = new EventSource(full);
    es.onmessage = (ev) => {
      try { onMsg(JSON.parse(ev.data)); } catch { /* keep */ }
    };
    return () => es.close();
  }, [url]);
}

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('SATORI_TOKEN');
}

export function setTokens(token, refresh) {
  localStorage.setItem('SATORI_TOKEN', token);
  if (refresh) localStorage.setItem('SATORI_REFRESH', refresh);
}

export function clearTokens() {
  localStorage.removeItem('SATORI_TOKEN');
  localStorage.removeItem('SATORI_REFRESH');
}
