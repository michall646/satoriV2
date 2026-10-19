// Manage Overview — contest health at a glance. Sectioned surface, no card spam.
'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, API, STR, getLang } from '../../../../lib/client';
import { Button, Skeleton } from '../../../../components/ui';
import { toast } from '../../../../components/ui/Toast';
import { PageHeader, PageSection, StatRow, Stat, DangerStrip, ConfirmButton } from '../../../../components/manage';
import { useManage } from '../../../../components/manage/context';

const STEPS = ['draft', 'registration', 'running', 'finished', 'archived'];
const LC_KEY = { draft: 'manage_lc_draft', registration: 'manage_lc_registration', running: 'manage_lc_running', finished: 'manage_lc_finished', archived: 'manage_lc_archived' };
const REG_KEY = { open: 'mset_reg_open', approval: 'mset_reg_approval', invite: 'mset_reg_invite' };
const BOARD_KEY = { everyone: 'mset_board_everyone', 'me-only': 'mset_board_me_only', hidden: 'mset_board_hidden' };

function Lifecycle({ contest, onSet, busy }) {
  const t = STR[getLang()];
  const idx = STEPS.indexOf(contest.lifecycle);
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t.manage_lifecycle_aria}>
      {STEPS.map((l, i) => {
        const active = i === idx;
        const past = i < idx;
        const blocked = i < idx;
        return (
          <button
            key={l}
            onClick={() => onSet(l)}
            disabled={blocked || busy}
            aria-current={active ? 'step' : undefined}
            className="px-3 py-1.5 text-xs focus-ring rounded-full whitespace-nowrap disabled:opacity-40"
            style={{
              border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
              background: active ? 'var(--accent)' : past ? 'var(--ok-soft)' : 'var(--surface)',
              color: active ? 'var(--accent-fg)' : past ? 'var(--ok-text)' : 'var(--muted)',
              fontWeight: active || past ? 600 : 500,
            }}
          >
            {past ? '✓ ' : ''}{t[LC_KEY[l]] || l}
          </button>
        );
      })}
    </div>
  );
}

export default function ManageOverviewPage({ params }) {
  const t = STR[getLang()];
  const { contest, reload } = useManage();
  const router = useRouter();
  const [problems, setProblems] = useState(null);
  const [members, setMembers] = useState({ members: [], pending: [] });
  const [teams, setTeams] = useState([]);
  const [audit, setAudit] = useState([]);
  const [busy, setBusy] = useState(false);
  const [extendDays, setExtendDays] = useState('7');
  const [showExtend, setShowExtend] = useState(false);

  useEffect(() => {
    api(`/api/contests/${params.id}/problems?all=1`).then((d) => setProblems(d.items || [])).catch(() => setProblems([]));
    api(`/api/contests/${params.id}/members`).then(setMembers).catch(() => setMembers({ members: [], pending: [] }));
    api(`/api/contests/${params.id}/teams`).then((d) => setTeams(d.items || [])).catch(() => setTeams([]));
    api(`/api/contests/${params.id}/audit`).then((d) => setAudit(d.items || [])).catch(() => setAudit([]));
  }, [params.id]);

  const visibleProblems = useMemo(() => (problems || []).filter((p) => (p.visibility || 'visible') === 'visible').length, [problems]);

  async function setLifecycle(lifecycle) {
    if (lifecycle === contest.lifecycle) return;
    if (lifecycle === 'running' && visibleProblems === 0) { toast(t.manage_need_visible, 'warn'); return; }
    const targetIdx = STEPS.indexOf(lifecycle);
    if (targetIdx < STEPS.indexOf(contest.lifecycle) && lifecycle !== 'archived') { toast(`${t.manage_no_move_back} ${t[LC_KEY[contest.lifecycle]] || contest.lifecycle}.`, 'warn'); return; }
    setBusy(true);
    try {
      await api(`/api/contests/${params.id}`, { method: 'PATCH', body: JSON.stringify({ lifecycle }) });
      toast(`${t.manage_lifecycle_set} ${t[LC_KEY[lifecycle]] || lifecycle}.`, 'success');
      await reload();
    } catch (e) { toast(`${t.manage_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function duplicate() {
    setBusy(true);
    try {
      const r = await api(`/api/contests/${params.id}/duplicate`, { method: 'POST', body: JSON.stringify({}) });
      toast(`${t.manage_duplicated} ${r.id}.`, 'success');
    } catch (e) { toast(`${t.manage_duplicate_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function bulkExtend() {
    const days = Number(extendDays);
    if (!Number.isFinite(days) || days === 0) { toast(t.manage_days_nonzero, 'warn'); return; }
    setBusy(true);
    try {
      const r = await api(`/api/contests/${params.id}/deadlines/bulk-extend`, { method: 'POST', body: JSON.stringify({ days }) });
      toast(`${t.manage_deadlines_shifted} ${r.shifted ?? 0}.`, 'success');
      setShowExtend(false);
      await reload();
    } catch (e) { toast(`${t.manage_extend_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function snapshot() {
    try {
      const d = await api(`/api/contests/${params.id}/ranking`);
      const blob = new Blob([JSON.stringify({ at: new Date().toISOString(), rows: d.rows || [] }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ranking-snapshot-${params.id}.json`;
      a.click();
      toast(t.manage_snapshot_done, 'success');
    } catch (e) { toast(`${t.manage_snapshot_failed} ${e.message}`, 'danger'); }
  }

  async function archive() {
    setBusy(true);
    try {
      await api(`/api/contests/${params.id}`, { method: 'PATCH', body: JSON.stringify({ lifecycle: 'archived' }) });
      toast(t.manage_archived, 'success');
      await reload();
    } catch (e) { toast(`${t.manage_archive_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function destroyContest() {
    setBusy(true);
    try {
      await api(`/api/contests/${params.id}`, { method: 'DELETE' });
      toast(t.manage_deleted, 'success');
      router.push('/contests');
    } catch (e) { toast(`${t.manage_delete_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  const dp = contest.settings?.deadlinePolicy;
  const sc = contest.settings?.scoring || {};
  const lateTxt = dp?.enabled ? `${dp.lateMode} ${dp.penaltyKind} ${dp.penaltyValue}` : t.manage_off;
  const boardTxt = t[BOARD_KEY[contest.settings?.board?.mode]] || t.mset_board_everyone;
  const scoringTxt = `${sc.rule || 'best'} · ${t.manage_late} ${lateTxt} · ${t.manage_board} ${boardTxt}`;
  const regTxt = t[REG_KEY[contest.registration]] || contest.registration || '—';
  const checklist = [
    { ok: !!(contest.name && contest.mode), label: t.manage_chk_settings, href: `/contests/${params.id}/manage/settings` },
    { ok: !!dp, label: `${t.manage_chk_scoring} ${scoringTxt}`, href: `/contests/${params.id}/manage/settings` },
    { ok: visibleProblems >= 1, label: `${t.problems}: ${visibleProblems} ${t.manage_visible_l} (${(problems || []).length} ${t.manage_total})`, href: `/contests/${params.id}/manage/problems` },
    { ok: !!(contest.startAt && contest.stopAt), label: t.manage_chk_schedule, href: `/contests/${params.id}/manage/settings` },
    { ok: !!contest.registration, label: `${t.mset_registration}: ${regTxt} · ${members.members.length} ${t.contests_members}`, href: `/contests/${params.id}/manage/members` },
    { ok: false, label: t.manage_chk_grade, href: `/contests/${params.id}/manage/grade` },
    { ok: false, label: t.manage_chk_integrity, href: `/contests/${params.id}/manage/integrity` },
    { ok: false, label: t.manage_chk_webhooks, href: `/contests/${params.id}/manage/announcements` },
  ];
  const done = checklist.filter((s) => s.ok).length;
  const pct = Math.round((done / checklist.length) * 100);
  const recent = audit.slice(-6).reverse();

  if (problems === null) return <Skeleton lines={6} />;

  return (
    <div className="w-full min-w-0 max-w-4xl">
      <PageHeader title={t.me_overview} description={t.manage_overview_desc} />

      <StatRow>
        <Stat label={t.mprob_vis_visible} value={visibleProblems} hint={`${(problems || []).length} ${t.manage_total}`} tone={visibleProblems ? 'ok' : 'warn'} href={`/contests/${params.id}/manage/problems`} />
        <Stat label={t.manage_members} value={members.members.length} hint={teams.length ? `${teams.length} ${t.me_team_n}` : t.manage_no_teams} href={`/contests/${params.id}/manage/members`} />
        <Stat label={t.contests_pending} value={members.pending.length} hint={members.pending.length ? t.manage_need_approval : t.manage_all_clear} tone={members.pending.length ? 'warn' : 'neutral'} href={`/contests/${params.id}/manage/members`} />
        <Stat label={t.manage_readiness} value={`${pct}%`} hint={`${done}/${checklist.length} ${t.manage_steps}`} tone={pct === 100 ? 'ok' : 'accent'} />
      </StatRow>

      <div className="mt-6">
        <PageSection title={t.manage_lifecycle} actions={<span className="type-mono text-xs" style={{ color: 'var(--muted)' }}>{t[LC_KEY[contest.lifecycle]] || contest.lifecycle}</span>}>
          <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>{t.manage_lifecycle_hint}</p>
          <Lifecycle contest={contest} onSet={setLifecycle} busy={busy} />
        </PageSection>

        <PageSection title={t.manage_readiness} actions={<span className="type-mono text-xs" style={{ color: 'var(--muted)' }}>{done}/{checklist.length}</span>}>
          <div className="h-1 rounded overflow-hidden" style={{ background: 'var(--border)' }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
          </div>
          <ul>
            {checklist.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-3 py-2 border-t" style={{ borderColor: 'var(--border)' }}>
                <span className="text-sm flex items-center gap-2 min-w-0">
                  <span aria-hidden="true" style={{ color: s.ok ? 'var(--ok-text)' : 'var(--muted)' }}>{s.ok ? '✓' : '○'}</span>
                  <span className="truncate">{s.label}</span>
                </span>
                <Link className="text-xs underline focus-ring rounded whitespace-nowrap" href={s.href} prefetch>{t.manage_configure}</Link>
              </li>
            ))}
          </ul>
        </PageSection>

        <PageSection
          title={t.home_activity}
          actions={<Link className="text-xs underline focus-ring rounded" href={`/contests/${params.id}/manage/audit`} prefetch>{t.manage_full_audit}</Link>}
        >
          {recent.length ? (
            <ul>
              {recent.map((a, i) => (
                <li key={i} className="flex items-baseline gap-3 py-2 border-t" style={{ borderColor: 'var(--border)' }}>
                  <span className="type-mono text-xs shrink-0" style={{ color: 'var(--muted)' }}>{a.at ? new Date(a.at).toLocaleString() : '—'}</span>
                  <span className="text-sm truncate">{a.action} <span style={{ color: 'var(--muted)' }}>{a.target}</span></span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm" style={{ color: 'var(--muted)' }}>{t.manage_no_activity}</p>}
        </PageSection>

        <PageSection title={t.manage_quick_actions}>
          <div className="flex flex-wrap gap-2 items-end">
            <Button variant="secondary" onClick={duplicate} disabled={busy}>{t.manage_duplicate_btn}</Button>
            <Button variant="secondary" onClick={snapshot}>{t.manage_snapshot_btn}</Button>
            {showExtend ? (
              <div className="flex items-end gap-2">
                <label className="text-xs">
                  <span className="block mb-1" style={{ color: 'var(--muted)' }}>{t.manage_shift_days}</span>
                  <input
                    type="number"
                    value={extendDays}
                    onChange={(e) => setExtendDays(e.target.value)}
                    className="rounded px-2 py-1.5 text-sm focus-ring !w-28"
                    style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)' }}
                  />
                </label>
                <Button onClick={bulkExtend} disabled={busy}>{t.manage_apply}</Button>
                <Button variant="secondary" onClick={() => setShowExtend(false)} disabled={busy}>×</Button>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setShowExtend(true)}>{t.manage_bulk_extend}</Button>
            )}
            <a className="text-xs underline self-center focus-ring rounded" href={`${API}/api/contests/${params.id}/grade.ics`}>{t.manage_ics}</a>
          </div>
        </PageSection>
      </div>

      <DangerStrip hint={t.manage_danger_hint}>
        <ConfirmButton onConfirm={archive} busy={busy} confirmLabel={t.manage_confirm_archive}>{t.manage_archive_btn}</ConfirmButton>
        {(contest.archived || contest.lifecycle === 'archived') ? (
          <ConfirmButton onConfirm={destroyContest} busy={busy} confirmLabel={t.manage_confirm_purge}>{t.manage_delete_permanently}</ConfirmButton>
        ) : null}
      </DangerStrip>
    </div>
  );
}
