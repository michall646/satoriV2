// Top-bar controls: search bar, profile link. Guard clauses.
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { STR, getLang } from '../lib/client';

export function SearchBar() {
  const [q, setQ] = useState('');
  const router = useRouter();
  const t = STR[getLang()];
  function go(e) {
    e?.preventDefault();
    if (!q.trim()) return;
    router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  }
  return (
    <form onSubmit={go} role="search" className="hidden sm:block">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t.nav_search_ph}
        aria-label="search"
        className="top-search focus-ring"
      />
    </form>
  );
}

export function ProfileLink() {
  const t = STR[getLang()];
  return (
    <Link href="/me" prefetch aria-label={t.nav_profile} title={t.nav_profile} className="icon-btn focus-ring">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
    </Link>
  );
}

