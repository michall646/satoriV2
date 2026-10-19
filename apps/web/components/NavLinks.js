// Top-nav links + mobile menu + hint — localized client-side (layout is a server component).
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api, STR, getLang } from '../lib/client';

const NAV_COPY = {
  en: { admin: 'Admin → Organizations' },
  pl: { admin: 'Administracja → Organizacje' },
};

// Visible only for superadmins and org admins. A 401/empty list hides it.
function useOrgAdminAccess() {
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();
  useEffect(() => {
    let live = true;
    function load() {
      api('/api/me/orgs')
        .then((data) => {
          if (!live) return;
          setVisible(Boolean(data && (data.superadmin || (data.items || []).length > 0)));
        })
        .catch(() => { if (live) setVisible(false); });
    }
    load();
    function onStorage(event) {
      if (event.key === 'SATORI_TOKEN') load();
    }
    window.addEventListener('storage', onStorage);
    return () => { live = false; window.removeEventListener('storage', onStorage); };
  }, [pathname]);
  return visible;
}

export function AdminNavLink({ mobile = false }) {
  const visible = useOrgAdminAccess();
  const copy = NAV_COPY[getLang()] || NAV_COPY.en;
  if (!visible) return null;
  return <Link href="/admin/orgs" prefetch className={mobile ? 'text-sm' : 'nav-link focus-ring'}>{copy.admin}</Link>;
}

export function NavLinks() {
  const t = STR[getLang()];
  return (
    <>
      <Link href="/contests" prefetch className="nav-link focus-ring">{t.contests}</Link>
      <Link href="/status" prefetch className="nav-link focus-ring">Status</Link>
      <AdminNavLink />
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
        <AdminNavLink mobile />
        <Link href="/me" prefetch className="text-sm">{t.nav_profile}</Link>
      </nav>
    </details>
  );
}

export function TopHint() {
  const t = STR[getLang()];
  return <span className="top-hint hidden lg:inline">{t.nav_hint}</span>;
}
