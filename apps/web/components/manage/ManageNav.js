// Manage navigation — grouped rail (desktop) + grouped dropdown (narrow).
// One source of truth for manage routes and grouping.
'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { STR, getLang } from '../../lib/client';
import EyebrowFx from '../EyebrowFx';

export function manageGroups(contestId) {
  const base = `/contests/${contestId}/manage`;
  return [
    {
      labelKey: 'manage_contest',
      items: [
        { href: base, labelKey: 'me_overview', exact: true },
        { href: `${base}/problems`, labelKey: 'problems', countKey: 'problems' },
        { href: `${base}/grade`, labelKey: 'grade_title' },
      ],
    },
    {
      labelKey: 'manage_group_people',
      items: [
        { href: `${base}/members`, labelKey: 'manage_members', countKey: 'pending' },
        { href: `${base}/announcements`, labelKey: 'announcements' },
      ],
    },
    {
      labelKey: 'manage_group_rules',
      items: [
        { href: `${base}/settings`, labelKey: 'mset_title' },
        { href: `${base}/integrity`, labelKey: 'integrity' },
        { href: `${base}/webhooks`, labelKey: 'mwh_title' },
      ],
    },
    {
      labelKey: 'manage_group_history',
      items: [{ href: `${base}/audit`, labelKey: 'manage_audit_nav' }],
    },
  ];
}

function isActive(pathname, item) {
  if (item.exact) return pathname === item.href;
  return pathname.startsWith(item.href);
}

function CountPill({ count, active }) {
  if (!count || count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className="tabular-nums ml-auto"
      style={{
        fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, lineHeight: 1.4,
        padding: '1px 6px', borderRadius: 999, fontFeatureSettings: "'tnum'",
        background: active ? 'var(--accent)' : 'var(--hover-wash)',
        color: active ? 'var(--accent-fg)' : 'var(--muted)',
      }}
    >
      {count}
    </span>
  );
}

export default function ManageNav({ contestId, counts = {} }) {
  const t = STR[getLang()];
  const pathname = usePathname() || '';
  const router = useRouter();
  const groups = manageGroups(contestId);
  const all = groups.flatMap((g) => g.items);
  const current = (all.find((it) => isActive(pathname, it)) || all[0]).href;

  return (
    <>
      <aside className="manage-rail">
        <nav aria-label={t.manage_nav_aria} className="flex flex-col gap-5">
          {groups.map((g) => (
            <div key={g.labelKey}>
              <EyebrowFx text={t[g.labelKey]} className="px-3 mb-1" />
              <div className="flex flex-col gap-0.5">
                {g.items.map((it) => {
                  const active = isActive(pathname, it);
                  const count = it.countKey != null ? counts[it.countKey] : undefined;
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      prefetch
                      aria-current={active ? 'page' : undefined}
                      className="nav-link focus-ring w-full justify-start"
                    >
                      <span>{t[it.labelKey]}</span>
                      <CountPill count={count} active={active} />
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className="md:hidden mb-3">
        <label className="block mb-1" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)' }} htmlFor="manage-nav">{t.manage_nav_label}</label>
        <select
          id="manage-nav"
          value={current}
          onChange={(e) => router.push(e.target.value)}
          className="rounded px-3 py-2 w-full text-sm focus-ring"
          style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)' }}
        >
          {groups.map((g) => (
            <optgroup key={g.labelKey} label={t[g.labelKey]}>
              {g.items.map((it) => <option key={it.href} value={it.href}>{t[it.labelKey]}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
    </>
  );
}
