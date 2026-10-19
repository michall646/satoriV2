// Global search: contest / problem / user / announcement.
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, STR, getLang } from '../../lib/client';
import { Button, EmptyState, Input, Skeleton } from '../../components/ui';

export default function SearchPage({ searchParams }) {
  const [q, setQ] = useState(searchParams?.q || '');
  const t = STR[getLang()];
  const [r, setR] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    function onKey(e) {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        document.getElementById('sq')?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (searchParams?.q) run(searchParams.q);
  }, []);
  async function run(query) {
    const term = (query ?? q).trim();
    if (!term) return;
    setLoading(true);
    try {
      setR(await api(`/api/search?q=${encodeURIComponent(term)}`));
      const url = new URL(window.location.href);
      url.searchParams.set('q', term);
      window.history.replaceState(null, '', url);
    } catch { setR({ contests: [], problems: [], users: [], announcements: [] }); }
    setLoading(false);
  }
  async function go(e) {
    e?.preventDefault();
    run();
  }
  return (
    <div>
      <h1 className="type-h1">{t.common_search}</h1>
      <form onSubmit={go} className="flex gap-2 my-2">
        <Input id="sq" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search_ph} className="flex-1" />
        <Button type="submit" variant="secondary">{t.search_go}</Button>
      </form>
      {loading ? <Skeleton lines={4} /> : null}
      {!loading && r && !(r.contests?.length || r.problems?.length || r.users?.length || r.announcements?.length) ? <EmptyState line={t.search_none} /> : null}
      {r && (
        <div className="text-sm">
          <h2 className="font-bold">{t.contests}</h2>
          {(r.contests || []).map((c) => <div key={c.id}><Link className="underline focus-ring rounded" href={`/contests/${c.id}`} prefetch>{c.name}</Link></div>)}
          <h2 className="font-bold mt-2">{t.problems}</h2>
          {(r.problems || []).map((p) => <div key={p.id}><Link className="underline focus-ring rounded" href={`/contests/${p.contestId}/problems/${p.id}`} prefetch>{p.code} {p.name}</Link></div>)}
          <h2 className="font-bold mt-2">{t.search_users}</h2>
          {(r.users || []).map((u) => <div key={u.id}>{u.login}</div>)}
          {r.announcements?.length ? <><h2 className="font-bold mt-2">{t.announcements}</h2>{r.announcements.map((a) => <div key={a.id}>{a.title || a.bodyMd?.slice(0, 80)}</div>)}</> : null}
        </div>
      )}
    </div>
  );
}
