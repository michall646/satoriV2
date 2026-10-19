// 404 page — localized (client component: reads lang from localStorage).
'use client';
import Link from 'next/link';
import { STR, getLang } from '../lib/client';

export default function NotFound() {
  const t = STR[getLang()];
  return (
    <div className="page">
      <h1 className="type-h1">{t.nf_title}</h1>
      <p className="text-sm text-muted mt-2">{t.nf_line}</p>
      <nav className="flex gap-4 mt-4 text-sm" aria-label="not-found">
        <Link href="/" className="underline focus-ring rounded">{t.nav_home}</Link>
        <Link href="/contests" className="underline focus-ring rounded">{t.contests}</Link>
        <Link href="/search" className="underline focus-ring rounded">{t.common_search}</Link>
      </nav>
    </div>
  );
}
