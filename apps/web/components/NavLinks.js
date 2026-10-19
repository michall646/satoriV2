// Top-nav links + mobile menu + hint — localized client-side (layout is a server component).
'use client';
import Link from 'next/link';
import { STR, getLang } from '../lib/client';

export function NavLinks() {
  const t = STR[getLang()];
  return (
    <>
      <Link href="/contests" prefetch className="nav-link focus-ring">{t.contests}</Link>
      <Link href="/status" prefetch className="nav-link focus-ring">Status</Link>
    </>
  );
}

export function MobileMenu() {
  const t = STR[getLang()];
  return (
    <details className="md:hidden relative">
      <summary className="icon-btn text-sm px-2 cursor-pointer list-none" style={{ borderRadius: 'var(--radius)' }}>Menu</summary>
      <nav className="absolute border rounded-xl p-3 flex flex-col gap-2 mt-2 w-44 shadow-xl" style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--fg)' }} aria-label="mobile">
        <Link href="/contests" prefetch className="text-sm">{t.contests}</Link>
        <Link href="/status" prefetch className="text-sm">Status</Link>
        <Link href="/me" prefetch className="text-sm">{t.nav_profile}</Link>
      </nav>
    </details>
  );
}

export function TopHint() {
  const t = STR[getLang()];
  return <span className="top-hint hidden lg:inline">{t.nav_hint}</span>;
}
