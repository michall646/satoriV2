// Global search: contest / problem / user / announcement.
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, STR, getLang } from '../../lib/client';
import { Button, EmptyState, Input, Skeleton } from '../../components/ui';

const E8_TXT = {
  en: {
    usersNote: 'Users are shown as logins only — there are no public profiles yet.',
    announcementSnippet: 'Open the contest announcements',
  },
  pl: {
    usersNote: 'Użytkownicy są pokazani tylko jako loginy — nie ma jeszcze publicznych profili.',
    announcementSnippet: 'Otwórz ogłoszenia konkursu',
  },
};

export default function SearchPage({ searchParams }) {
  const [q, setQ] = useState(searchParams?.q || '');
  const t = STR[getLang()];
  const txt = E8_TXT[getLang() === 'pl' ? 'pl' : 'en'];
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
  const contests = r?.contests || [];
  const problems = r?.problems || [];
  const users = r?.users || [];
  // Lane J adds announcements to the search response; render them only when present.
  const announcements = r?.announcements || [];
  const empty = r && !(contests.length || problems.length || users.length || announcements.length);
  return (
    <div>
      <h1 className="type-h1">{t.common_search}</h1>
      <form onSubmit={go} className="flex gap-2 my-2">
        <Input id="sq" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search_ph} className="flex-1" />
        <Button type="submit" variant="secondary">{t.search_go}</Button>
      </form>
      {loading ? <Skeleton lines={4} /> : null}
      {!loading && empty ? <EmptyState line={t.search_none} /> : null}
      {r && !empty ? (
        <div className="text-sm space-y-3">
          {contests.length ? (
            <section>
              <h2 className="font-bold">{t.contests}</h2>
              {contests.map((c) => <div key={c.id}><Link className="underline focus-ring rounded" href={`/contests/${c.id}`} prefetch>{c.name}</Link></div>)}
            </section>
          ) : null}
          {problems.length ? (
            <section>
              <h2 className="font-bold">{t.problems}</h2>
              {problems.map((p) => (
                <div key={p.id}>
                  {p.contestId != null ? (
                    <Link className="underline focus-ring rounded" href={`/contests/${p.contestId}/problems/${p.id}`} prefetch><span className="type-mono">{p.code}</span> {p.name}</Link>
                  ) : <span><span className="type-mono">{p.code}</span> {p.name}</span>}
                </div>
              ))}
            </section>
          ) : null}
          {users.length ? (
            <section>
              <h2 className="font-bold">{t.search_users}</h2>
              {users.map((u) => <div key={u.id} className="type-mono">{u.login}</div>)}
              <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{txt.usersNote}</p>
            </section>
          ) : null}
          {announcements.length ? (
            <section>
              <h2 className="font-bold">{t.announcements}</h2>
              {announcements.map((a) => {
                const title = a.title || a.bodyMd?.slice(0, 80) || t.ann_untitled;
                return (
                  <div key={a.id}>
                    {a.contestId != null
                      ? <Link className="underline focus-ring rounded" href={`/contests/${a.contestId}/announcements`} prefetch title={txt.announcementSnippet}>{title}</Link>
                      : <span>{title}</span>}
                    {a.bodyMd && a.title ? <span className="block text-xs" style={{ color: 'var(--muted)' }}>{a.bodyMd.slice(0, 140)}</span> : null}
                  </div>
                );
              })}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
