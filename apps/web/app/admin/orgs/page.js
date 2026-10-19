// Admin → Organizations (G6). Uses /api/me/orgs for access: superadmins see every
// organization, org admins see only theirs, everyone else gets an honest 403 panel.
'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, getLang } from '../../../lib/client';
import { Badge, Button, EmptyState, ErrorState, Input, Modal, Skeleton, Table, Textarea } from '../../../components/ui';
import { toast } from '../../../components/ui/Toast';
import { ConfirmButton, DangerStrip, PageHeader, PageSection, Stat, StatRow } from '../../../components/manage';

const COPY = {
  en: {
    title: 'Organizations',
    subtitle: 'Create organizations, manage members and organization admins.',
    newOrg: 'New organization',
    orgs: 'Organizations',
    members: 'Members',
    admins: 'Admins',
    organization: 'Organization',
    noOrgs: 'No organizations yet.',
    name: 'Name',
    shortName: 'Short name',
    country: 'Country',
    website: 'Website',
    description: 'Description',
    save: 'Save changes',
    saved: 'Organization saved.',
    created: 'Organization created.',
    deleted: 'Organization deleted.',
    createTitle: 'New organization',
    create: 'Create',
    editTitle: 'Edit organization',
    selectOrg: 'Select an organization.',
    noAdmins: 'No organization admins. Only superadmins can manage this organization.',
    addAdmin: 'Add admin by login',
    removeAdmin: 'Remove admin',
    adminAdded: 'Organization admin added.',
    adminRemoved: 'Organization admin removed.',
    login: 'Login',
    addMember: 'Add member',
    memberAdded: 'Member added.',
    memberRemoved: 'Member removed.',
    removeMember: 'Remove member',
    moveMember: 'Move from another organization',
    memberCount: 'members',
    membersEmpty: 'No members in this organization.',
    account: 'Account',
    email: 'E-mail',
    roles: 'Global roles',
    actions: 'Actions',
    deleteOrg: 'Delete organization',
    deleteConfirm: 'Delete this organization?',
    forceHint: 'This organization still has members. Deleting it detaches every member and cannot be undone.',
    forceDelete: 'Delete anyway and detach members',
    dangerHint: 'Deleting an organization cannot be undone.',
    failed: 'Request failed:',
    loadFailed: 'Could not load organization:',
    loginRequired: 'Sign in to manage organizations.',
    loginAction: 'Go to login',
    noAccessTitle: 'No organization access',
    noAccessLine: 'Your account is not a superadmin or an organization admin.',
    backHome: 'Back to home',
    selectHint: 'Pick an organization on the left.',
    orgListAria: 'Organization list',
  },
  pl: {
    title: 'Organizacje',
    subtitle: 'Twórz organizacje, zarządzaj członkami i administratorami organizacji.',
    newOrg: 'Nowa organizacja',
    orgs: 'Organizacje',
    members: 'Członkowie',
    admins: 'Administratorzy',
    organization: 'Organizacja',
    noOrgs: 'Brak organizacji.',
    name: 'Nazwa',
    shortName: 'Nazwa skrócona',
    country: 'Kraj',
    website: 'Strona internetowa',
    description: 'Opis',
    save: 'Zapisz zmiany',
    saved: 'Organizacja zapisana.',
    created: 'Organizacja utworzona.',
    deleted: 'Organizacja usunięta.',
    createTitle: 'Nowa organizacja',
    create: 'Utwórz',
    editTitle: 'Edytuj organizację',
    selectOrg: 'Wybierz organizację.',
    noAdmins: 'Brak administratorów organizacji. Tylko superadmin może zarządzać tą organizacją.',
    addAdmin: 'Dodaj administratora po loginie',
    removeAdmin: 'Usuń administratora',
    adminAdded: 'Administrator organizacji dodany.',
    adminRemoved: 'Administrator organizacji usunięty.',
    login: 'Login',
    addMember: 'Dodaj członka',
    memberAdded: 'Członek dodany.',
    memberRemoved: 'Członek usunięty.',
    removeMember: 'Usuń członka',
    moveMember: 'Przenieś z innej organizacji',
    memberCount: 'członków',
    membersEmpty: 'Brak członków w tej organizacji.',
    account: 'Konto',
    email: 'E-mail',
    roles: 'Role globalne',
    actions: 'Akcje',
    deleteOrg: 'Usuń organizację',
    deleteConfirm: 'Usunąć tę organizację?',
    forceHint: 'Ta organizacja ma jeszcze członków. Usunięcie odłączy wszystkich członków i jest nieodwracalne.',
    forceDelete: 'Usuń mimo to i odłącz członków',
    dangerHint: 'Usunięcia organizacji nie można cofnąć.',
    failed: 'Żądanie nie powiodło się:',
    loadFailed: 'Nie udało się wczytać organizacji:',
    loginRequired: 'Zaloguj się, aby zarządzać organizacjami.',
    loginAction: 'Przejdź do logowania',
    noAccessTitle: 'Brak dostępu do organizacji',
    noAccessLine: 'Twoje konto nie jest superadminem ani administratorem organizacji.',
    backHome: 'Wróć do strony głównej',
    selectHint: 'Wybierz organizację po lewej.',
    orgListAria: 'Lista organizacji',
  },
};

function emptyForm() {
  return { name: '', shortName: '', country: '', website: '', description: '' };
}
function formFrom(org) {
  return {
    name: org.name || '',
    shortName: org.shortName || '',
    country: org.country || '',
    website: org.website || '',
    description: org.description || '',
  };
}
function errorText(error) {
  return String((error && error.message) || error || '');
}

export default function AdminOrgsPage() {
  const copy = COPY[getLang()] || COPY.en;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [superadmin, setSuperadmin] = useState(false);
  const [orgs, setOrgs] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [members, setMembers] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyForm());
  const [createError, setCreateError] = useState('');
  const [editForm, setEditForm] = useState(emptyForm());
  const [editError, setEditError] = useState('');

  const [memberLogin, setMemberLogin] = useState('');
  const [moveMember, setMoveMember] = useState(false);
  const [adminLogin, setAdminLogin] = useState('');
  const [forceDelete, setForceDelete] = useState(false);

  const loadOrgs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api('/api/me/orgs');
      setSuperadmin(Boolean(data.superadmin));
      setOrgs(Array.isArray(data.items) ? data.items : []);
      return data;
    } catch (e) {
      setError(e);
      setSuperadmin(false);
      setOrgs([]);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  useEffect(() => {
    if (loading) return;
    if (!orgs.length) { setSelectedId(null); return; }
    const exists = orgs.some((org) => String(org.id) === String(selectedId));
    if (!exists) setSelectedId(orgs[0].id);
  }, [loading, orgs, selectedId]);

  const refreshDetail = useCallback(async (id) => {
    if (!id) { setDetail(null); setMembers([]); return null; }
    const [org, list] = await Promise.all([
      api(`/api/orgs/${id}`),
      api(`/api/orgs/${id}/members`),
    ]);
    setDetail(org);
    setEditForm(formFrom(org));
    setEditError('');
    setMembers(Array.isArray(list.items) ? list.items : []);
    return org;
  }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(null); setMembers([]); return undefined; }
    let live = true;
    setDetailLoading(true);
    setForceDelete(false);
    setMemberLogin('');
    setAdminLogin('');
    Promise.all([api(`/api/orgs/${selectedId}`), api(`/api/orgs/${selectedId}/members`)])
      .then(([org, list]) => {
        if (!live) return;
        setDetail(org);
        setEditForm(formFrom(org));
        setEditError('');
        setMembers(Array.isArray(list.items) ? list.items : []);
      })
      .catch((e) => { if (live) toast(`${copy.loadFailed} ${errorText(e)}`, 'danger'); })
      .finally(() => { if (live) setDetailLoading(false); });
    return () => { live = false; };
    // copy.loadFailed is a localized constant, stable for a given locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const canManage = Boolean(selectedId) && orgs.some((org) => String(org.id) === String(selectedId));

  async function createOrg() {
    setBusy(true);
    setCreateError('');
    try {
      const org = await api('/api/orgs', { method: 'POST', body: JSON.stringify(createForm) });
      setCreateOpen(false);
      setCreateForm(emptyForm());
      await loadOrgs();
      setSelectedId(org.id);
      toast(copy.created, 'success');
    } catch (e) {
      setCreateError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveOrg() {
    if (!canManage) return;
    setBusy(true);
    setEditError('');
    try {
      const org = await api(`/api/orgs/${selectedId}`, { method: 'PATCH', body: JSON.stringify(editForm) });
      setDetail(org);
      setEditForm(formFrom(org));
      await loadOrgs();
      toast(copy.saved, 'success');
    } catch (e) {
      setEditError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function addMember() {
    if (!canManage || !memberLogin.trim()) return;
    setBusy(true);
    try {
      await api(`/api/orgs/${selectedId}/members`, { method: 'POST', body: JSON.stringify({ login: memberLogin.trim(), ...(moveMember ? { move: true } : {}) }) });
      setMemberLogin('');
      setMoveMember(false);
      await refreshDetail(selectedId);
      await loadOrgs();
      toast(copy.memberAdded, 'success');
    } catch (e) {
      toast(`${copy.failed} ${errorText(e)}`, 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member) {
    if (!canManage) return;
    setBusy(true);
    try {
      await api(`/api/orgs/${selectedId}/members/${member.id}`, { method: 'DELETE' });
      await refreshDetail(selectedId);
      await loadOrgs();
      toast(copy.memberRemoved, 'success');
    } catch (e) {
      toast(`${copy.failed} ${errorText(e)}`, 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function addAdmin() {
    if (!canManage || !adminLogin.trim()) return;
    setBusy(true);
    try {
      await api(`/api/orgs/${selectedId}/admins`, { method: 'POST', body: JSON.stringify({ login: adminLogin.trim() }) });
      setAdminLogin('');
      await refreshDetail(selectedId);
      toast(copy.adminAdded, 'success');
    } catch (e) {
      toast(`${copy.failed} ${errorText(e)}`, 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function removeAdmin(login) {
    if (!canManage) return;
    setBusy(true);
    try {
      await api(`/api/orgs/${selectedId}/admins`, { method: 'POST', body: JSON.stringify({ login, remove: true }) });
      await refreshDetail(selectedId);
      toast(copy.adminRemoved, 'success');
    } catch (e) {
      toast(`${copy.failed} ${errorText(e)}`, 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function deleteOrg(force) {
    if (!superadmin || !detail) return;
    setBusy(true);
    try {
      await api(`/api/orgs/${detail.id}${force ? '?force=true' : ''}`, { method: 'DELETE' });
      toast(copy.deleted, 'success');
      setSelectedId(null);
      setDetail(null);
      setMembers([]);
      setForceDelete(false);
      await loadOrgs();
    } catch (e) {
      if (e && e.code === 'ORG_HAS_MEMBERS') {
        setForceDelete(true);
        toast(`${copy.failed} ${errorText(e)}`, 'warn');
      } else {
        toast(`${copy.failed} ${errorText(e)}`, 'danger');
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Skeleton lines={6} />;

  if (error) {
    if (error.status === 401) {
      return (
        <div className="w-full min-w-0 max-w-4xl">
          <PageHeader title={copy.title} description={copy.subtitle} />
          <ErrorState
            title={copy.loginRequired}
            line={copy.noAccessLine}
            action={<Link href="/login" className="btn btn-primary focus-ring">{copy.loginAction}</Link>}
          />
        </div>
      );
    }
    return (
      <div className="w-full min-w-0 max-w-4xl">
        <PageHeader title={copy.title} description={copy.subtitle} />
        <ErrorState title={copy.noAccessTitle} line={errorText(error)} action={<Link href="/" className="btn btn-secondary focus-ring">{copy.backHome}</Link>} />
      </div>
    );
  }

  if (!superadmin && orgs.length === 0) {
    return (
      <div className="w-full min-w-0 max-w-4xl">
        <PageHeader title={copy.title} description={copy.subtitle} />
        <ErrorState
          title={copy.noAccessTitle}
          line={copy.noAccessLine}
          action={<Link href="/" className="btn btn-secondary focus-ring">{copy.backHome}</Link>}
        />
      </div>
    );
  }

  const totalMembers = orgs.reduce((sum, org) => sum + Number(org.memberCount || 0), 0);
  const columns = [
    { key: 'login', label: copy.account, render: (row) => <span className="type-mono">{row.login}</span> },
    { key: 'name', label: copy.name, render: (row) => [row.firstName, row.lastName].filter(Boolean).join(' ') || '—' },
    { key: 'email', label: copy.email, render: (row) => row.email || '—' },
    { key: 'roles', label: copy.roles, render: (row) => <span className="flex gap-1 flex-wrap">{(row.rolesGlobal || []).map((role) => <Badge key={role}>{role}</Badge>)}</span> },
    {
      key: 'actions',
      label: copy.actions,
      render: (row) => (
        <Button variant="ghost" disabled={busy} onClick={() => removeMember(row)}>{copy.removeMember}</Button>
      ),
    },
  ];

  return (
    <div className="w-full min-w-0 max-w-5xl">
      <PageHeader
        title={copy.title}
        description={copy.subtitle}
        actions={superadmin ? <Button onClick={() => { setCreateForm(emptyForm()); setCreateError(''); setCreateOpen(true); }}>{copy.newOrg}</Button> : null}
      />

      <StatRow>
        <Stat label={copy.orgs} value={orgs.length} />
        <Stat label={copy.members} value={totalMembers} />
        <Stat label={copy.admins} value={orgs.reduce((sum, org) => sum + (org.admins || []).length, 0)} />
      </StatRow>

      <div className="flex flex-wrap gap-6 items-start mt-6">
        <div className="w-full md:w-64 shrink-0">
          <PageSection title={copy.orgs}>
            {orgs.length ? (
              <ul className="flex flex-col" aria-label={copy.orgListAria}>
                {orgs.map((org) => {
                  const active = String(org.id) === String(selectedId);
                  return (
                    <li key={org.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(org.id)}
                        aria-current={active ? 'true' : undefined}
                        className="w-full text-left px-3 py-2 rounded focus-ring"
                        style={{
                          background: active ? 'var(--hover-wash)' : 'transparent',
                          borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                          color: 'var(--fg)',
                        }}
                      >
                        <span className="block text-sm font-semibold truncate">{org.name}</span>
                        <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                          {org.shortName ? `${org.shortName} · ` : ''}{org.memberCount || 0} {copy.memberCount}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : <EmptyState line={copy.noOrgs} />}
          </PageSection>
        </div>

        <div className="flex-1 min-w-0">
          {!selectedId ? <EmptyState line={copy.selectHint} /> : null}

          {selectedId && detailLoading && !detail ? <Skeleton lines={6} /> : null}

          {selectedId && detail ? (
            <>
              <PageSection
                title={detail.name}
                actions={<Badge tone="neutral">{detail.memberCount || 0} {copy.memberCount}</Badge>}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label={copy.name} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} maxLength={120} />
                  <Input label={copy.shortName} value={editForm.shortName} onChange={(e) => setEditForm({ ...editForm, shortName: e.target.value })} maxLength={20} />
                  <Input label={copy.country} value={editForm.country} onChange={(e) => setEditForm({ ...editForm, country: e.target.value })} maxLength={64} />
                  <Input label={copy.website} value={editForm.website} onChange={(e) => setEditForm({ ...editForm, website: e.target.value })} placeholder="https://" maxLength={300} />
                  <div className="sm:col-span-2">
                    <Textarea label={copy.description} rows={3} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} maxLength={4000} />
                  </div>
                </div>
                {editError ? <p role="alert" className="text-xs mt-2" style={{ color: 'var(--wa-text)' }}>{editError}</p> : null}
                <div className="mt-3">
                  <Button onClick={saveOrg} disabled={busy}>{copy.save}</Button>
                </div>
              </PageSection>

              <PageSection title={`${copy.members} · ${members.length}`}>
                <div className="flex flex-wrap gap-2 items-end mb-3">
                  <Input label={copy.login} value={memberLogin} onChange={(e) => setMemberLogin(e.target.value)} placeholder="jan_kowalski" />
                  <label className="flex items-center gap-2 text-xs pb-2" style={{ color: 'var(--muted)' }}>
                    <input type="checkbox" checked={moveMember} onChange={(e) => setMoveMember(e.target.checked)} />
                    {copy.moveMember}
                  </label>
                  <div className="pb-2">
                    <Button onClick={addMember} disabled={busy || !memberLogin.trim()}>{copy.addMember}</Button>
                  </div>
                </div>
                {members.length ? <Table columns={columns} rows={members.map((m) => ({ ...m, key: m.id }))} /> : <EmptyState line={copy.membersEmpty} />}
              </PageSection>

              <PageSection title={`${copy.admins} · ${(detail.admins || []).length}`}>
                {(detail.admins || []).length ? (
                  <ul className="flex flex-col">
                    {(detail.admins || []).map((login) => (
                      <li key={login} className="flex items-center justify-between gap-3 py-2 border-t" style={{ borderColor: 'var(--border)' }}>
                        <span className="type-mono text-sm">{login}</span>
                        <Button variant="ghost" disabled={busy} onClick={() => removeAdmin(login)}>{copy.removeAdmin}</Button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm" style={{ color: 'var(--muted)' }}>{copy.noAdmins}</p>}
                <div className="flex flex-wrap gap-2 items-end mt-3">
                  <Input label={copy.addAdmin} value={adminLogin} onChange={(e) => setAdminLogin(e.target.value)} placeholder="g_herman" />
                  <div className="pb-2">
                    <Button variant="secondary" onClick={addAdmin} disabled={busy || !adminLogin.trim()}>{copy.addAdmin}</Button>
                  </div>
                </div>
              </PageSection>

              {superadmin ? (
                <DangerStrip title={copy.deleteOrg} hint={copy.dangerHint}>
                  <ConfirmButton onConfirm={() => deleteOrg(false)} busy={busy} confirmLabel={copy.deleteConfirm}>{copy.deleteOrg}</ConfirmButton>
                  {forceDelete ? (
                    <>
                      <p className="text-xs" style={{ color: 'var(--wa-text)' }}>{copy.forceHint}</p>
                      <ConfirmButton onConfirm={() => deleteOrg(true)} busy={busy} confirmLabel={copy.deleteConfirm}>{copy.forceDelete}</ConfirmButton>
                    </>
                  ) : null}
                </DangerStrip>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={copy.createTitle}
        onSubmit={createOrg}
        submitLabel={copy.create}
      >
        <div className="grid gap-3">
          <Input label={copy.name} value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} maxLength={120} autoFocus />
          <Input label={copy.shortName} value={createForm.shortName} onChange={(e) => setCreateForm({ ...createForm, shortName: e.target.value })} maxLength={20} />
          <Input label={copy.country} value={createForm.country} onChange={(e) => setCreateForm({ ...createForm, country: e.target.value })} maxLength={64} />
          <Input label={copy.website} value={createForm.website} onChange={(e) => setCreateForm({ ...createForm, website: e.target.value })} placeholder="https://" maxLength={300} />
          <Textarea label={copy.description} rows={3} value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} maxLength={4000} />
          {createError ? <p role="alert" className="text-xs" style={{ color: 'var(--wa-text)' }}>{createError}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
