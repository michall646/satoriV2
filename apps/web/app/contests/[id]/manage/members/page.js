// Manage → Members & teams. Pending approvals, CSV import, roles/demote, USOS IDs, team roster.
'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, STR, getLang } from '../../../../../lib/client';
import { Button, EmptyState, Input, Skeleton, Table } from '../../../../../components/ui';
import { toast } from '../../../../../components/ui/Toast';
import { PageHeader, PageSection } from '../../../../../components/manage';
import { useManage } from '../../../../../components/manage/context';

// Explicit map so scanner sees static key references (dynamic t[expr] alone reads as DEAD).
const ROLE_KEY = { participant: 'members_role_participant', teacher: 'members_role_teacher', jury: 'members_role_jury' };

const LABELS = {
  en: {
    membersAll: 'Members & staff', role: 'Role', usosId: 'USOS ID', demote: 'Demote', demoted: 'Demoted', unknownId: 'unknown',
    usosImport: 'Import USOS IDs', usosImportBtn: 'Import USOS IDs', usosImportHint: 'One login,usos_id per line (header optional).',
    usosPaste: 'Paste at least one login,usos_id row.', usosImported: 'USOS IDs updated', usosSkipped: 'skipped (not members)',
    extend: 'Extension', extendDays: 'Days', apply: 'Apply', extUntil: 'until', extSaved: 'Extension rows saved',
    badDays: 'Enter days (+/-) for the extension.', extHint: 'Per-student deadline extension in days from the current deadline. Changes are audited.',
  },
  pl: {
    membersAll: 'Uczestnicy i kadra', role: 'Rola', usosId: 'ID USOS', demote: 'Zdegraduj', demoted: 'Zdegradowano', unknownId: 'nieznany',
    usosImport: 'Import ID USOS', usosImportBtn: 'Importuj ID USOS', usosImportHint: 'Jeden login,id_usos na linię (nagłówek opcjonalny).',
    usosPaste: 'Wklej co najmniej jeden wiersz login,id_usos.', usosImported: 'Zaktualizowano ID USOS', usosSkipped: 'pominięto (nie są członkami)',
    extend: 'Przedłużenie', extendDays: 'Dni', apply: 'Zastosuj', extUntil: 'do', extSaved: 'Zapisano przedłużenia',
    badDays: 'Podaj liczbę dni (+/-) przedłużenia.', extHint: 'Przedłużenie terminu dla studenta w dniach od obecnego terminu. Zmiany trafiają do audytu.',
  },
};

function fmtUntil(at) {
  if (!at) return '';
  try { return new Date(at).toLocaleDateString(getLang() === 'pl' ? 'pl-PL' : undefined); }
  catch { return String(at); }
}

export default function ManageMembersPage({ params }) {
  const t = STR[getLang()];
  const L = LABELS[getLang()] || LABELS.en;
  const { contest, reload } = useManage();
  const [mem, setMem] = useState(null);
  const [teams, setTeams] = useState([]);
  const [usos, setUsos] = useState({});
  const [ext, setExt] = useState({});
  const [extDays, setExtDays] = useState({});
  const [q, setQ] = useState('');
  const [csv, setCsv] = useState('');
  const [usosCsv, setUsosCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [role, setRole] = useState('participant');
  const [roleLogin, setRoleLogin] = useState('');

  async function load() {
    try { setMem(await api(`/api/contests/${params.id}/members`)); } catch { setMem({ members: [], pending: [] }); }
    try { setTeams((await api(`/api/contests/${params.id}/teams`)).items || []); } catch { setTeams([]); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

  // The members route does not expose USOS IDs yet; the grade matrix does (manager-only).
  // The same response now carries per-student extensions for the control below.
  async function loadUsos() {
    try {
      const m = await api(`/api/contests/${params.id}/grade/matrix`);
      setUsos(Object.fromEntries((m.rows || []).map((r) => [String(r.id), r.usosId || ''])));
      const map = {};
      for (const e of m.extensions || []) {
        const k = String(e.userId);
        if (!map[k] || new Date(e.until) > new Date(map[k])) map[k] = e.until;
      }
      setExt(map);
    } catch { setUsos({}); setExt({}); }
  }
  useEffect(() => { loadUsos(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

  const adminIds = useMemo(() => new Set(((contest && contest.admins) || []).map(String)), [contest]);
  const memberLogin = useMemo(() => Object.fromEntries(((mem && mem.members) || []).map((u) => [String(u.id), u.login])), [mem]);

  function roleOf(u) {
    if (u.role && ROLE_KEY[u.role]) return u.role;
    return adminIds.has(String(u.id)) ? 'teacher' : 'participant';
  }

  const pendingFiltered = useMemo(() => {
    const ql = q.toLowerCase();
    return ((mem?.pending) || []).filter((u) => !ql || (u.login || '').toLowerCase().includes(ql));
  }, [mem, q]);

  async function approve(ids, approve = true) {
    setBusy(true);
    try {
      await api(`/api/contests/${params.id}/members/approve`, { method: 'POST', body: JSON.stringify({ userIds: ids, approve }) });
      toast(`${approve ? t.members_approved : t.members_rejected} ${ids.length}.`, approve ? 'success' : 'warn');
      await load(); await reload();
    } catch (e) { toast(`${t.manage_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function approveAll() {
    setBusy(true);
    try {
      await api(`/api/contests/${params.id}/members/approve`, { method: 'POST', body: JSON.stringify({ approveAllByFilter: true, q: q || undefined }) });
      toast(t.members_approved_all, 'success');
      await load(); await reload();
    } catch (e) { toast(`${t.manage_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function importCsv() {
    if (!csv.trim()) { toast(t.members_paste_login, 'warn'); return; }
    setBusy(true);
    try {
      const r = await api(`/api/contests/${params.id}/members/csv`, { method: 'POST', body: JSON.stringify({ csv }) });
      toast(`${t.members_imported} ${r.added ?? 0}${r.unknown?.length ? `, ${t.members_unknown} ${r.unknown.join(', ')}` : ''}.`, 'success');
      setCsv('');
      await load(); await reload();
    } catch (e) { toast(`${t.members_import_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function importUsos() {
    if (!usosCsv.trim()) { toast(L.usosPaste, 'warn'); return; }
    setBusy(true);
    try {
      const r = await api(`/api/contests/${params.id}/grade/usos-import`, { method: 'POST', body: JSON.stringify({ csv: usosCsv }) });
      const extra = [
        r.unknown?.length ? `${t.members_unknown} ${r.unknown.join(', ')}` : '',
        r.skipped?.length ? `${L.usosSkipped} ${r.skipped.join(', ')}` : '',
        r.invalid?.length ? `${t.members_unknown} ${r.invalid.join(', ')}` : '',
      ].filter(Boolean).join(' · ');
      toast(`${L.usosImported} ${r.updated ?? 0}${extra ? ` · ${extra}` : ''}.`, r.updated ? 'success' : 'warn');
      setUsosCsv('');
      await loadUsos();
    } catch (e) { toast(`${t.manage_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function removeMember(id) {
    setBusy(true);
    try {
      await api(`/api/contests/${params.id}/members/${id}`, { method: 'DELETE' });
      toast(t.members_removed, 'success');
      await load(); await reload();
    } catch (e) { toast(`${t.manage_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  // Demote removes contest-admin rights while keeping the user as a participant.
  // Server follow-up: persist teacher/jury roles and remove from `admins` in the members API.
  async function demote(u) {
    if (!contest) return;
    setBusy(true);
    try {
      const admins = (contest.admins || []).filter((id) => String(id) !== String(u.id));
      await api(`/api/contests/${params.id}`, { method: 'PATCH', body: JSON.stringify({ admins }) });
      toast(`${L.demoted} ${u.login}.`, 'success');
      await load(); await reload();
    } catch (e) { toast(`${t.manage_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function addRole() {
    if (!roleLogin.trim()) { toast(t.members_enter_login, 'warn'); return; }
    setBusy(true);
    try {
      await api(`/api/contests/${params.id}/members`, { method: 'POST', body: JSON.stringify({ login: roleLogin.trim(), role }) });
      toast(`${t.members_added} ${roleLogin} ${t.members_as} ${t[ROLE_KEY[role]] || role}.`, 'success');
      setRoleLogin('');
      await load(); await reload();
    } catch (e) { toast(`${t.manage_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  // Per-student deadline extension (D3). Days are added to each current deadline
  // server-side; the grade matrix shows the resulting until date.
  async function extendUser(u) {
    const days = Number(extDays[String(u.id)]);
    if (!Number.isFinite(days) || days === 0) { toast(L.badDays, 'warn'); return; }
    setBusy(true);
    try {
      const r = await api(`/api/contests/${params.id}/grade/extend-selected`, { method: 'POST', body: JSON.stringify({ userIds: [u.id], days }) });
      toast(`${L.extSaved} (${r.updated ?? 0}).`, 'success');
      setExtDays((prev) => ({ ...prev, [String(u.id)]: '' }));
      await loadUsos();
    } catch (e) { toast(`${t.manage_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function createTeam() {
    if (!teamName.trim()) { toast(t.members_team_required, 'warn'); return; }
    setBusy(true);
    try {
      await api(`/api/contests/${params.id}/teams`, { method: 'POST', body: JSON.stringify({ name: teamName.trim() }) });
      toast(`${t.members_team_created} "${teamName.trim()}".`, 'success');
      setTeamName('');
      await load();
    } catch (e) { toast(`${t.manage_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  if (mem === null) return <Skeleton lines={6} />;

  return (
    <div className="w-full min-w-0 max-w-4xl">
      <PageHeader title={t.members_title} description={t.members_subtitle} />

      <PageSection title={t.members_pending_title} actions={<span className="type-mono text-xs" style={{ color: 'var(--muted)' }}>{pendingFiltered.length}</span>}>
        <div className="flex gap-2 flex-wrap">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.members_search_ph} className="!w-44" aria-label={t.members_search_aria} />
          <Button variant="secondary" onClick={approveAll} disabled={busy || !pendingFiltered.length}>{t.members_approve_all} ({pendingFiltered.length})</Button>
        </div>
        <div className="mt-3">
          {pendingFiltered.length ? (
            <Table
              columns={[
                { key: 'login', label: 'Login' },
                {
                  key: 'act', label: t.prob_actions, align: 'right', render: (u) => (
                    <span className="flex gap-1 justify-end">
                      <Button variant="secondary" className="!py-0.5" disabled={busy} onClick={() => approve([u.id])}>{t.members_approve}</Button>
                      <Button variant="danger" className="!py-0.5" disabled={busy} onClick={() => approve([u.id], false)}>{t.integrity_reject}</Button>
                    </span>
                  ),
                },
              ]}
              rows={pendingFiltered.map((u) => ({ ...u, key: u.id }))}
            />
          ) : <EmptyState line={q ? t.members_no_pending_match : t.members_no_pending} />}
        </div>
      </PageSection>

      <PageSection title={L.membersAll} hint={L.extHint} actions={<span className="type-mono text-xs" style={{ color: 'var(--muted)' }}>{mem.members.length}</span>}>
        {mem.members.length ? (
          <Table
            columns={[
              { key: 'login', label: 'Login', render: (u) => <span className="type-mono">{u.login}</span> },
              { key: 'role', label: L.role, render: (u) => <span>{t[ROLE_KEY[roleOf(u)]] || roleOf(u)}</span> },
              { key: 'usosId', label: L.usosId, render: (u) => <span className="type-mono">{u.usosId || usos[String(u.id)] || '—'}</span> },
              {
                key: 'extension', label: L.extend, render: (u) => {
                  if (roleOf(u) !== 'participant') return <span style={{ color: 'var(--muted)' }}>—</span>;
                  return (
                    <span className="flex gap-1 items-center justify-end">
                      {ext[String(u.id)] ? <span className="text-[11px] type-mono" style={{ color: 'var(--ok-text)' }}>{L.extUntil} {fmtUntil(ext[String(u.id)])}</span> : null}
                      <input
                        type="number"
                        step="1"
                        value={extDays[String(u.id)] ?? ''}
                        onChange={(e) => setExtDays((prev) => ({ ...prev, [String(u.id)]: e.target.value }))}
                        className="rounded px-1.5 py-0.5 text-sm focus-ring"
                        style={{ width: 64, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)' }}
                        aria-label={`${L.extendDays} ${u.login}`}
                        placeholder={L.extendDays}
                      />
                      <Button variant="secondary" className="!py-0.5" disabled={busy} onClick={() => extendUser(u)}>{L.apply}</Button>
                    </span>
                  );
                },
              },
              {
                key: 'actions', label: t.prob_actions, align: 'right', render: (u) => (
                  <span className="flex gap-1 justify-end">
                    {roleOf(u) !== 'participant' ? (
                      <Button variant="secondary" className="!py-0.5" disabled={busy} onClick={() => demote(u)}>{L.demote}</Button>
                    ) : null}
                    <Button variant="danger" className="!py-0.5" disabled={busy} onClick={() => removeMember(u.id)}>{t.common_remove}</Button>
                  </span>
                ),
              },
            ]}
            rows={mem.members.map((u) => ({ ...u, key: u.id }))}
          />
        ) : <p className="text-sm" style={{ color: 'var(--muted)' }}>{t.members_empty}</p>}
        <div className="mt-4">
          <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>{t.members_add_hint}</p>
          <div className="flex gap-2 items-end flex-wrap">
            <Input value={roleLogin} onChange={(e) => setRoleLogin(e.target.value)} placeholder="login" className="!w-40" aria-label={t.members_login_aria} />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              aria-label={t.members_role_aria}
              className="rounded px-2 py-2 text-sm focus-ring"
              style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)' }}
            >
              <option value="participant">{t.members_role_participant}</option><option value="teacher">{t.members_role_teacher}</option><option value="jury">{t.members_role_jury}</option>
            </select>
            <Button variant="secondary" onClick={addRole} disabled={busy}>{t.common_add}</Button>
          </div>
        </div>
      </PageSection>

      <PageSection title={t.members_csv_title} hint={t.members_csv_hint}>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={3}
          placeholder={'jan_kowalski\nanna_nowak'}
          className="w-full rounded px-3 py-2 text-sm focus-ring"
          style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'var(--font-mono)' }}
        />
        <Button variant="secondary" className="mt-2" onClick={importCsv} disabled={busy}>{t.members_import_btn}</Button>
      </PageSection>

      <PageSection title={L.usosImport} hint={L.usosImportHint}>
        <textarea
          value={usosCsv}
          onChange={(e) => setUsosCsv(e.target.value)}
          rows={3}
          placeholder={'jan_kowalski,123456\nanna_nowak,234567'}
          className="w-full rounded px-3 py-2 text-sm focus-ring"
          style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'var(--font-mono)' }}
        />
        <Button variant="secondary" className="mt-2" onClick={importUsos} disabled={busy}>{L.usosImportBtn}</Button>
      </PageSection>

      <PageSection title={t.me_teams_title} actions={<span className="type-mono text-xs" style={{ color: 'var(--muted)' }}>{teams.length}</span>}>
        <div className="flex gap-2 flex-wrap">
          <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder={t.members_team_ph} className="!w-56" aria-label={t.members_team_aria} />
          <Button variant="secondary" onClick={createTeam} disabled={busy}>{t.members_create_team}</Button>
        </div>
        <div className="mt-3">
          {teams.length ? (
            <Table
              columns={[
                { key: 'name', label: t.members_scoreboard_name, render: (team) => team.scoreboardName || team.name },
                { key: 'identity', label: t.members_login_identity, render: (team) => <span className="type-mono">{team.loginIdentity || team.name || '—'}</span> },
                {
                  key: 'members', label: t.members_col_members, render: (team) => {
                    const ids = team.members || team.memberIds || [];
                    if (!ids.length) return '—';
                    return <span className="type-mono text-xs">{ids.map((id) => memberLogin[String(id)] || `${L.unknownId} #${id}`).join(', ')}</span>;
                  },
                },
              ]}
              rows={teams.map((team) => ({ ...team, key: team.id || team.name }))}
            />
          ) : <EmptyState line={t.members_no_teams} />}
        </div>
      </PageSection>
    </div>
  );
}
