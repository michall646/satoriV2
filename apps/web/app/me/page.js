// Profile — header, completion, identity, teams, sessions, inbox.
'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, STR, getLang } from '../../lib/client';
import { clearTokens } from '../../hooks/useApi';
import { Badge, Button, Select, Skeleton, EmptyState, Icon, Notice } from '../../components/ui';
import { CopyButton } from '../../components/ui/Code';
import NotificationsInbox from '../../components/NotificationsInbox';
import EyebrowFx from '../../components/EyebrowFx';
import { toast } from '../../components/ui/Toast';

function initials(first, last, login) {
  if (first && last) return `${first[0]}${last[0]}`.toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  if (login) return login.slice(0, 2).toUpperCase();
  return '??';
}

function CompletionRing({ value, max }) {
  const t = STR[getLang()];
  const pct = Math.round((value / max) * 100);
  const r = 18;
  const c = 2 * Math.PI * r;
  const off = c - (pct / 100) * c;
  return (
    <div className="flex items-center gap-3">
      <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" className="-rotate-90">
        <circle cx="22" cy="22" r={r} stroke="var(--border)" strokeWidth="4" fill="none" />
        <circle cx="22" cy="22" r={r} stroke="var(--accent)" strokeWidth="4" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset 600ms ease' }} />
      </svg>
      <div>
        <p className="text-sm font-bold leading-none tabular-nums">{pct}%</p>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>{value}/{max} {t.me_complete}</p>
      </div>
    </div>
  );
}

function SectionHead({ label, meta, action }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <EyebrowFx text={label} />
      {meta || action ? (
        <span className="flex items-baseline gap-3 shrink-0">
          {meta ? <span className="type-mono text-[11px] tabular-nums" style={{ color: 'var(--muted)' }}>{meta}</span> : null}
          {action}
        </span>
      ) : null}
    </div>
  );
}

function Checklist({ me, orgName }) {
  const t = STR[getLang()];
  const items = [
    { key: 'login', label: 'Login', done: !!me.login, hint: me.login },
    { key: 'email', label: 'E-mail', done: !!me.email, hint: me.email },
    { key: 'name', label: t.me_real_name, done: !!(me.firstName && me.lastName), hint: me.firstName && me.lastName ? `${me.firstName} ${me.lastName}` : t.me_add_name },
    { key: 'affiliation', label: t.me_affiliation, done: !!me.affiliationOrgId, hint: orgName || t.me_affiliation_hint },
    { key: 'team', label: t.me_team, done: !!(me.teams && me.teams.length), hint: me.teams?.length ? `${me.teams.length} ${me.teams.length > 1 ? t.me_team_n : t.me_team_1}` : t.me_join_team },
  ];
  return (
    <ul className="mt-3 grid sm:grid-cols-2 gap-x-8">
      {items.map((it) => (
        <li key={it.key} className="flex gap-2.5 items-start py-2 border-b" style={{ borderColor: 'var(--border)' }}>
          <span
            aria-hidden="true"
            className={`mt-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold border shrink-0 ${it.done ? 'text-white border-transparent' : ''}`}
            style={it.done ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { borderColor: 'var(--border)', color: 'var(--muted)' }}
          >
            {it.done ? '✓' : ''}
          </span>
          <span className="flex-1 min-w-0">
            <span className={`block text-sm leading-tight ${it.done ? '' : 'font-medium opacity-75'}`}>{it.label}</span>
            <span className="block text-xs truncate mt-0.5" style={{ color: 'var(--muted)' }}>{it.hint}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Segmented({ tabs, active, onChange }) {
  if (!tabs.length) return null;
  return (
    <div role="tablist" aria-label={STR[getLang()].me_sections_aria} className="flex items-center gap-0.5 max-w-full overflow-x-auto">
      {tabs.map((tab) => {
        const on = active === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(tab.id)}
            className={`px-2 sm:px-3 pt-2 pb-2.5 text-sm focus-ring transition-colors whitespace-nowrap ${on ? 'font-semibold' : 'font-medium opacity-60 hover:opacity-100'}`}
            style={on
              ? { color: 'var(--fg)', boxShadow: 'inset 0 -2px 0 var(--accent)' }
              : { color: 'var(--muted)' }}
          >
            {tab.label}
            {tab.count ? <span className="ml-1.5 type-mono text-[11px] tabular-nums" style={{ color: 'var(--muted)' }}>{tab.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, value, mono, copy, action }) {
  if (!value && value !== 0) return null;
  const t = STR[getLang()];
  return (
    <div className="flex gap-2 items-center justify-between py-2 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
      <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="flex items-center gap-2 min-w-0">
        <span className={`text-sm truncate ${mono ? 'type-mono' : 'font-medium'}`}>{value}</span>
        {copy ? <CopyButton text={String(value)} label={t.common_copy} /> : null}
        {action}
      </span>
    </div>
  );
}

export default function MePage() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState('overview');
  const [revoking, setRevoking] = useState(false);
  const [revokingId, setRevokingId] = useState(null);
  const [pw, setPw] = useState({ old: '', next: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const t = STR[getLang()];

  useEffect(() => {
    let live = true;
    setLoading(true);
    api('/api/me').then((d) => { if (live) setMe(d); }).catch(() => { if (live) setMe(null); }).finally(() => { if (live) setLoading(false); });
    api('/api/orgs').then((d) => { if (live) setOrgs(d.items || []); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const orgName = useMemo(() => {
    if (!me?.affiliationOrgId) return '';
    const o = orgs.find((x) => String(x.id) === String(me.affiliationOrgId));
    return o?.name || `#${me.affiliationOrgId}`;
  }, [me, orgs]);

  const complete = useMemo(() => {
    if (!me) return 0;
    return [me.login, me.email, me.firstName, me.lastName, me.affiliationOrgId].filter(Boolean).length;
  }, [me]);

  const roleTone = useMemo(() => {
    if (!me) return 'neutral';
    if (me.rolesGlobal?.includes('superadmin')) return 'danger';
    if (me.rolesGlobal?.includes('teacher')) return 'warn';
    return 'neutral';
  }, [me]);

  async function save() {
    if (!me) return;
    setSaving(true);
    try {
      const r = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ affiliationOrgId: me.affiliationOrgId || null }) });
      setMe(r);
      toast(t.me_saved);
    } catch {
      toast(t.me_save_failed);
    } finally { setSaving(false); }
  }

  async function logout() {
    setRevoking(true);
    try { await api('/api/auth/revoke', { method: 'POST', body: JSON.stringify({}) }); } catch { /* keep */ }
    clearTokens();
    router.push('/login');
    router.refresh();
  }

  async function revokeSession(jti) {
    setRevokingId(jti);
    try {
      await api(`/api/me/sessions/${jti}`, { method: 'DELETE' });
      setMe((m) => (m ? { ...m, sessions: (m.sessions || []).filter((s) => s.id !== jti) } : m));
      toast(t.me_session_revoked, 'success');
    } catch { toast(t.me_revoke_failed); }
    finally { setRevokingId(null); }
  }

  async function changePassword() {
    if (!pw.old || !pw.next) { toast(t.me_fill_pw); return; }
    setPwBusy(true);
    try {
      const r = await api('/api/me/password', { method: 'POST', body: JSON.stringify({ old: pw.old, new: pw.next }) });
      setPw({ old: '', next: '' });
      toast(`${t.me_pw_changed}${r.revokedOthers ? ` — ${r.revokedOthers} ${t.me_pw_revoked}` : ''}`, 'success');
    } catch (e) { toast(e?.status === 403 ? t.me_pw_wrong : t.me_pw_failed); }
    finally { setPwBusy(false); }
  }

  if (loading) {
    return (
      <div className="w-full">
        <div className="skeleton h-3 w-20" />
        <div className="skeleton h-8 w-56 mt-3" />
        <div className="skeleton h-4 w-72 mt-3" />
        <div className="card mt-6 space-y-4"><Skeleton lines={6} /><Skeleton lines={4} /></div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="max-w-xl mx-auto mt-6">
        <EmptyState line={t.me_guest_line} action={<Link href="/login" className="px-4 py-2 rounded text-sm font-semibold focus-ring inline-block" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{t.auth_login}</Link>} />
        <p className="text-center text-xs mt-3" style={{ color: 'var(--muted)' }}>{t.me_no_account} <Link href="/register" className="underline">{t.me_register_link}</Link></p>
      </div>
    );
  }

  const tabs = [
    { id: 'overview', label: t.me_overview },
    { id: 'security', label: t.me_security, count: me.sessions?.length || null },
    { id: 'notifications', label: t.notifications },
  ];

  const displayName = me.firstName || me.lastName ? `${me.firstName || ''} ${me.lastName || ''}`.trim() : me.login;

  return (
    <div className="w-full flex flex-col gap-6">
      {/* HEADER — no surface card */}
      <header>
        <EyebrowFx text={t.nav_profile} />
        <div className="mt-2 flex items-start gap-4">
          <div
            className="shrink-0 w-14 h-14 md:w-16 md:h-16 rounded-2xl flex items-center justify-center text-lg font-bold border"
            style={{ background: 'var(--ink)', color: '#fff', borderColor: 'rgba(255,255,255,0.12)', fontFamily: 'var(--font-display)' }}
            aria-hidden="true"
          >
            {initials(me.firstName, me.lastName, me.login)}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-2 items-center">
              <h1 className="type-display leading-none truncate">{displayName}</h1>
              <Badge tone={roleTone}>{(me.rolesGlobal && me.rolesGlobal[0]) || 'student'}</Badge>
              {me.affiliationOrgId ? <Badge>{orgName}</Badge> : <Badge tone="warn">{t.me_no_aff}</Badge>}
            </div>

            <div className="text-sm mt-2 flex flex-wrap gap-x-3 gap-y-1 items-center" style={{ color: 'var(--muted)' }}>
              <span className="inline-flex gap-1.5 items-center"><span className="type-mono text-xs">@{me.login}</span> <CopyButton text={me.login} label={t.common_copy} /></span>
              <span className="hidden sm:inline opacity-30">·</span>
              <span className="inline-flex gap-1.5 items-center min-w-0 truncate">{me.email} <CopyButton text={me.email} label={t.common_copy} /></span>
              {me.createdAt ? <><span className="hidden sm:inline opacity-30">·</span><span className="text-xs">{t.me_member_since} {new Date(me.createdAt).toLocaleDateString()}</span></> : null}
            </div>

            <div className="flex flex-wrap gap-3 mt-3 text-xs font-semibold">
              <Link href="/results?me=1" className="underline underline-offset-2 focus-ring rounded">{t.home_my_results}</Link>
              <Link href="/contests" className="underline underline-offset-2 focus-ring rounded">{t.home_browse}</Link>
            </div>

            {/* mobile completion */}
            <div className="md:hidden mt-4" role="progressbar" aria-valuenow={complete} aria-valuemin={0} aria-valuemax={5} aria-label={t.auth_completion}>
              <div className="flex gap-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i} className="h-1.5 flex-1 rounded-full" style={{ background: i < complete ? 'var(--accent)' : 'var(--border)' }} />
                ))}
              </div>
              <p className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}>{complete}/5 {t.me_complete}</p>
            </div>
          </div>

          <div className="hidden md:flex shrink-0 pl-4 border-l" style={{ borderColor: 'var(--border)' }}>
            <CompletionRing value={complete} max={5} />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3 items-end justify-between border-b" style={{ borderColor: 'var(--border)' }}>
          <Segmented tabs={tabs} active={active} onChange={setActive} />
          <span className="hidden sm:inline pb-2 text-xs" style={{ color: 'var(--muted)' }}>{t.me_cmdk_hint}</span>
        </div>
      </header>

      {/* OVERVIEW — hairline sections */}
      {active === 'overview' ? (
        <div className="grid lg:grid-cols-12 lg:gap-x-10">
            <div className="min-w-0 lg:col-span-8 flex flex-col divide-y divide-border">
              <section className="pb-6">
                <SectionHead label={t.auth_completion} meta={`${complete}/5`} />
                <p className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>
                  {complete === 5 ? t.me_all_set : t.me_complete_hint}
                </p>
                <Checklist me={me} orgName={orgName} />
                {!me.affiliationOrgId ? (
                  <Notice tone="info" icon={<Icon name="flag" size={16} />} className="mt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex-1">{t.me_aff_nudge}</span>
                      <a href="#affiliation" className="btn btn-secondary btn-compact focus-ring">{t.me_set_now}</a>
                    </div>
                  </Notice>
                ) : null}
              </section>

              <section id="affiliation" className="py-6">
                <SectionHead label={t.me_identity} meta={`#${me.id}`} />
                <div className="mt-2">
                  <Field label="Login" value={me.login} mono copy />
                  <Field label="E-mail" value={me.email} mono copy />
                  <Field label={t.me_name} value={me.firstName || me.lastName ? `${me.firstName || ''} ${me.lastName || ''}`.trim() : '—'} />
                  <div className="flex gap-2 items-end pt-3">
                    <div className="flex-1">
                      <Select label={t.me_affiliation} value={me.affiliationOrgId || ''} onChange={(e) => setMe({ ...me, affiliationOrgId: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">{t.me_aff_none}</option>
                        {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </Select>
                    </div>
                    <Button variant="secondary" onClick={save} disabled={saving} className="shrink-0 !py-2.5">{saving ? t.common_saving : t.common_save}</Button>
                  </div>
                  <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>{t.me_aff_note}</p>
                </div>
              </section>

              <section className="py-6">
                <SectionHead
                  label={t.me_teams_title}
                  meta={me.teams?.length ? String(me.teams.length) : null}
                  action={<Link href="/contests" className="text-xs underline underline-offset-2 focus-ring rounded">{t.me_find_team_contests}</Link>}
                />
                {!me.teams?.length ? (
                  <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>{t.me_no_teams}</p>
                ) : (
                  <ul className="mt-1">
                    {me.teams.map((team) => (
                      <li key={team.id || team.name} className="flex items-center gap-2 py-2.5 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                        <span className="font-medium text-sm truncate flex-1">{team.name || team.login}</span>
                        {team.role ? <Badge tone="neutral">{team.role}</Badge> : <Badge>{t.me_member}</Badge>}
                        {team.contestId ? <Link href={`/contests/${team.contestId}`} className="text-xs underline underline-offset-2 shrink-0">{t.me_contest} #{team.contestId}</Link> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* Rail */}
            <aside className="min-w-0 lg:col-span-4 flex flex-col divide-y divide-border border-t lg:border-t-0 lg:border-l lg:pl-10 border-border mt-6 lg:mt-0">
              <section className="py-6 lg:first:pt-0">
                <SectionHead label={t.me_at_glance} />
                <div className="mt-3 grid grid-cols-2 gap-4">
                  <div>
                    <p className="type-h2 tabular-nums leading-none">{me.sessions?.length || 1}</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{t.me_active_devices}</p>
                  </div>
                  <div>
                    <p className="type-h2 tabular-nums leading-none">{me.teams?.length || 0}</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{t.me_joined}</p>
                  </div>
                </div>
              </section>

              <section className="py-6">
                <SectionHead
                  label={t.me_inbox_preview}
                  action={<Link href="/notifications" className="text-xs underline underline-offset-2 focus-ring rounded">{t.me_open_inbox} →</Link>}
                />
                <NotificationsInbox preview />
              </section>

              <section className="py-6">
                <SectionHead label={t.me_security} />
                <p className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>{t.me_security_tip_line}</p>
                <button type="button" onClick={() => setActive('security')} className="mt-2 text-xs font-semibold underline underline-offset-2 focus-ring rounded">
                  {t.me_manage_sessions} →
                </button>
              </section>
            </aside>
        </div>
      ) : null}

      {/* SECURITY — hairline sections */}
      {active === 'security' ? (
        <>
        <div className="grid lg:grid-cols-12 lg:gap-x-10">
            <div className="min-w-0 lg:col-span-8 flex flex-col divide-y divide-border">
              <section className="pb-6">
                <SectionHead label={t.auth_sessions} meta={String(me.sessions?.length || 1)} action={<span className="text-xs" style={{ color: 'var(--muted)' }}>{t.me_current_highlighted}</span>} />

                {!me.sessions?.length ? (
                  <div className="mt-3 flex gap-3 items-center py-2">
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center border shrink-0" style={{ background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' }}>◎</span>
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{t.me_this_device}</span>
                      <span className="block text-xs" style={{ color: 'var(--muted)' }}>{t.me_active_now}</span>
                    </span>
                    <Badge tone="accent">{t.me_current_badge}</Badge>
                  </div>
                ) : (
                  <ul className="mt-2">
                    {me.sessions.map((s, idx) => {
                      const isCurrent = Boolean(s.current) || idx === 0;
                      const exp = s.expiresAt ? new Date(s.expiresAt) : null;
                      const at = s.at ? new Date(s.at) : null;
                      const expLabel = exp ? exp.toLocaleString() : '—';
                      return (
                        <li key={s.id || s.device || idx} className="flex gap-3 items-center py-3 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                          <span className="w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 text-xs" style={{ borderColor: 'var(--border)', background: isCurrent ? 'var(--ink)' : 'var(--bg)', color: isCurrent ? '#fff' : 'var(--muted)' }} aria-hidden="true">{s.device?.includes('Mobile') ? '◧' : '▭'}</span>
                          <span className="flex-1 min-w-0">
                            <span className="text-sm font-medium truncate flex gap-1.5 items-center">{s.device || 'web'} {isCurrent ? <Badge tone="accent" className="!px-1.5 !py-0 !text-[10px]">{t.me_current_badge}</Badge> : null}</span>
                            <span className="block text-xs truncate" style={{ color: 'var(--muted)' }}>{at ? `${at.toLocaleString()} · ` : ''}{t.auth_expiry}: {expLabel}</span>
                          </span>
                          {exp ? <span className="text-[11px] type-mono hidden sm:inline" style={{ color: 'var(--muted)' }}>{Math.max(0, Math.ceil((exp - Date.now()) / 3600000))}{t.me_h_left}</span> : null}
                          {!isCurrent ? <button type="button" onClick={() => revokeSession(s.id)} disabled={revokingId === s.id} className="btn-ghost px-2.5 py-1 rounded text-xs font-semibold shrink-0 focus-ring">{revokingId === s.id ? t.common_revoking : t.me_revoke}</button> : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="py-6">
                <SectionHead label={t.me_account} meta={`#${me.id}`} />
                <div className="mt-2">
                  <Field label="Login" value={me.login} mono copy />
                  <Field label="E-mail" value={me.email} mono copy />
                </div>
                <div className="mt-4 flex flex-col gap-2 max-w-sm">
                  <input type="password" autoComplete="current-password" placeholder={t.me_ph_old_pw} value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} className="w-full rounded border px-3 py-2 text-sm focus-ring" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }} />
                  <input type="password" autoComplete="new-password" placeholder={t.me_ph_new_pw} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} className="w-full rounded border px-3 py-2 text-sm focus-ring" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }} />
                  <div className="flex items-center gap-3">
                    <Button variant="secondary" onClick={changePassword} disabled={pwBusy}>{pwBusy ? t.common_saving : t.me_change_pw}</Button>
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>{t.me_change_pw_note}</span>
                  </div>
                </div>
              </section>
            </div>

            <aside className="min-w-0 lg:col-span-4 border-border border-t lg:border-t-0 lg:border-l lg:pl-10 mt-6 lg:mt-0 py-6 lg:py-0">
              <SectionHead label={t.me_how_sessions} />
              <ul className="text-sm mt-2 flex flex-col gap-1.5 list-disc ml-4" style={{ color: 'var(--muted)' }}>
                <li>{t.me_how_1}</li>
                <li>{t.me_how_2}</li>
                <li>{t.me_how_3}</li>
              </ul>
              <div className="mt-3 flex gap-3 text-xs font-semibold">
                <Link href="/login" className="underline underline-offset-2 focus-ring rounded">{t.me_relogin}</Link>
                <Link href="/register" className="underline underline-offset-2 focus-ring rounded">{t.guest_cta_btn}</Link>
              </div>
            </aside>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border px-4 py-3" style={{ background: 'var(--surface)', borderColor: 'var(--wa-line)', borderRadius: 'var(--radius)' }}>
            <div>
              <p className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--wa-text)' }}><Icon name="alert" size={15} />{t.me_danger}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{t.me_danger_line}</p>
            </div>
            <Button variant="danger" onClick={logout} disabled={revoking}>{revoking ? t.common_revoking : t.auth_revoke_all}</Button>
          </div>
        </>
      ) : null}

      {/* NOTIFICATIONS — inbox owns the surface */}
      {active === 'notifications' ? (
        <div>
          <NotificationsInbox compact />
        </div>
      ) : null}

      <p className="text-xs text-center" style={{ color: 'var(--muted)' }}>
        {t.me_need_help} <Link className="underline" href="/status" prefetch>{t.me_system_status}</Link> · <Link className="underline" href="/contests" prefetch>{t.contests}</Link> · <a className="underline" href="https://satori.tcs.uj.edu.pl/">{t.me_v1_archive}</a>
      </p>
    </div>
  );
}
