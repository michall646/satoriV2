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

export function AdminNavLink({ mobile = false, onClick }) {
  const visible = useOrgAdminAccess();
  const copy = NAV_COPY[getLang()] || NAV_COPY.en;
  if (!visible) return null;
  return (
    <Link
      href="/admin/orgs"
      prefetch
      onClick={onClick}
      className={mobile ? 'text-sm font-medium px-3 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus-ring' : 'nav-link focus-ring'}
    >
      {copy.admin}
    </Link>
  );
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
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="md:hidden relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="icon-btn focus-ring cursor-pointer"
        aria-label="Menu"
        aria-expanded={open}
      >
        {open ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
        )}
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <nav
            className="absolute left-0 mt-2 w-56 border rounded-xl p-2 flex flex-col gap-1 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--fg)' }}
            aria-label="mobile"
          >
            <Link
              href="/contests"
              prefetch
              onClick={() => setOpen(false)}
              className="text-sm font-medium px-3 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus-ring"
            >
              {t.contests}
            </Link>
            <Link
              href="/search"
              prefetch
              onClick={() => setOpen(false)}
              className="text-sm font-medium px-3 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus-ring"
            >
              {t.search}
            </Link>
            <Link
              href="/status"
              prefetch
              onClick={() => setOpen(false)}
              className="text-sm font-medium px-3 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus-ring"
            >
              Status
            </Link>
            <AdminNavLink mobile onClick={() => setOpen(false)} />
            <div className="my-1 border-t" style={{ borderColor: 'var(--border)' }} />
            <Link
              href="/me"
              prefetch
              onClick={() => setOpen(false)}
              className="text-sm font-medium px-3 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus-ring flex items-center justify-between"
            >
              <span>{t.nav_profile}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            </Link>
          </nav>
        </>
      )}
    </div>
  );
}

export function TopHint() {
  const t = STR[getLang()];
  return <span className="top-hint hidden lg:inline">{t.nav_hint}</span>;
}
