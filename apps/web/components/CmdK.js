// Cmd+K contest switcher + recent auto-redirect. Popup, not full page.
'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, STR, getLang } from '../lib/client';

const ACTIONS = [
  { id: 'ranking', key: 'cmdk_ranking', href: null, kind: 'ranking' },
  { id: 'submit', key: 'cmdk_submit', href: null, kind: 'submit' },
  { id: 'theme', key: 'cmdk_theme', href: null, kind: 'theme' },
];

export default function CmdK() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const router = useRouter();
  const t = STR[getLang()];

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v); }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    api('/api/contests').then((d) => setItems(d.items || [])).catch(() => setItems([]));
  }, [open ]);

  const recent = useMemo(() => {
    try { return localStorage.getItem('satori-recent'); } catch { return null; }
  }, [open]);

  if (!open) return null;
  const ql = q.toLowerCase();
  const shown = items.filter((c) => (c.name || '').toLowerCase().includes(ql)).slice(0, 12);
  const shownActions = ACTIONS.filter((a) => t[a.key].toLowerCase().includes(ql));

  function go(href) {
    if (!href) return;
    setOpen(false);
    router.push(href);
  }

  function runAction(a) {
    if (a.kind === 'theme') {
      document.documentElement.classList.toggle('dark');
      try {
        const isDark = document.documentElement.classList.contains('dark');
        document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
        localStorage.setItem('satori-theme', isDark ? 'dark' : 'light');
      } catch { /* noop */ }
      setOpen(false);
      return;
    }
    if (!recent) { setOpen(false); return; }
    if (a.kind === 'ranking') { go(`/contests/${recent}/ranking`); return; }
    if (a.kind === 'submit') {
      setOpen(false);
      api(`/api/contests/${recent}/problems`)
        .then((d) => {
          const first = (d.items || [])[0];
          router.push(first ? `/contests/${recent}/problems/${first.id}/submit` : `/contests/${recent}`);
        })
        .catch(() => router.push(`/contests/${recent}`));
      return;
    }
  }

  function saveRecent(id) {
    try { localStorage.setItem('satori-recent', String(id)); } catch { /* noop */ }
    setOpen(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-center pt-20 px-4" onClick={() => setOpen(false)}>
      <div className="bg-surface w-[500px] max-w-full h-fit p-3 rounded border" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t.cmdk_aria}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.cmdk_ph} className="border w-full px-2 py-1.5 rounded text-sm focus-ring" />
        {recent ? <p className="text-xs text-muted mt-1">{t.cmdk_recent} {recent}</p> : null}
        <ul className="mt-2 max-h-80 overflow-auto">
          {shown.map((c) => (
            <li key={c.id}>
              <Link className="block py-1.5 px-1 text-sm rounded focus-ring" href={`/contests/${c.id}`} onClick={() => saveRecent(c.id)}>
                <b>{c.name}</b> <span className="text-muted">— {c.mode} · {c.lifecycle}</span>
              </Link>
            </li>
          ))}
        </ul>
        {shownActions.length ? (
          <div className="border-t mt-2 pt-2">
            {shownActions.map((a) => (
              <button key={a.id} type="button" onClick={() => runAction(a)} className="block w-full text-left py-1.5 px-1 text-sm rounded focus-ring">
                {t[a.key]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
