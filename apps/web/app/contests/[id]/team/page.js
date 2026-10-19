// Contest team page (S4-4): my team, create/join, captain invite/remove, leave.
// When the contest is not in teamMode the page says so instead of showing dead controls.
'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, getLang } from '../../../../lib/client';
import { Badge, Button, EmptyState, ErrorState, Input, Skeleton } from '../../../../components/ui';
import { toast } from '../../../../components/ui/Toast';

const L = {
  en: {
    title: 'Team',
    subtitle: 'Create a team, join one, or manage your roster.',
    individualTitle: 'Individual contest',
    individualBody: 'This contest ranks individual participants. Teams are not used for scoring, so team controls are hidden.',
    loginRequired: 'Log in to see and manage contest teams.',
    joinContest: 'Join this contest before creating or joining a team.',
    loadFailed: 'Could not load teams.',
    retry: 'Retry',
    myTeam: 'My team',
    captain: 'captain',
    teamName: 'Team name',
    create: 'Create team',
    nameRequired: 'Enter a team name.',
    created: 'Team created.',
    join: 'Join',
    joined: 'Joined the team.',
    joinNote: 'Teams already formed',
    noTeams: 'No teams yet. Create the first one.',
    roster: 'Roster',
    noRoster: 'No members yet.',
    invite: 'Invite a contest member by login',
    inviteBtn: 'Invite',
    invited: 'Member invited.',
    remove: 'Remove',
    removed: 'Member removed.',
    leave: 'Leave team',
    left: 'You left the team.',
    leaveConfirm: 'Leave this team?',
    removeConfirm: 'Remove this member from the team?',
    members: 'members',
    scoreboardName: 'Scoreboard name',
    loginIdentity: 'Login identity',
    captainOnly: 'Only the captain can invite or remove members.',
    inTeamNote: 'You are already on a team. Leave it before joining another one.',
    noOtherTeams: 'No other teams to join.',
    maxSize: 'max',
  },
  pl: {
    title: 'Drużyna',
    subtitle: 'Utwórz drużynę, dołącz do istniejącej lub zarządzaj składem.',
    individualTitle: 'Konkurs indywidualny',
    individualBody: 'Ten konkurs rankuje uczestników indywidualnie. Drużyny nie są używane do punktacji, więc sterowanie drużynami jest ukryte.',
    loginRequired: 'Zaloguj się, aby zobaczyć drużyny konkursu i nimi zarządzać.',
    joinContest: 'Zapisz się do konkursu, zanim utworzysz lub dołączysz do drużyny.',
    loadFailed: 'Nie udało się wczytać drużyn.',
    retry: 'Ponów',
    myTeam: 'Moja drużyna',
    captain: 'kapitan',
    teamName: 'Nazwa drużyny',
    create: 'Utwórz drużynę',
    nameRequired: 'Podaj nazwę drużyny.',
    created: 'Utworzono drużynę.',
    join: 'Dołącz',
    joined: 'Dołączono do drużyny.',
    joinNote: 'Drużyny już utworzone',
    noTeams: 'Brak drużyn. Utwórz pierwszą.',
    roster: 'Skład',
    noRoster: 'Brak członków.',
    invite: 'Zaproś członka konkursu po loginie',
    inviteBtn: 'Zaproś',
    invited: 'Zaproszono członka.',
    remove: 'Usuń',
    removed: 'Usunięto członka.',
    leave: 'Opuść drużynę',
    left: 'Opuszczono drużynę.',
    leaveConfirm: 'Opuścić tę drużynę?',
    removeConfirm: 'Usunąć tego członka z drużyny?',
    members: 'członków',
    scoreboardName: 'Nazwa na tablicy',
    loginIdentity: 'Login drużyny',
    captainOnly: 'Tylko kapitan może zapraszać i usuwać członków.',
    inTeamNote: 'Jesteś już w drużynie. Opuść ją, aby dołączyć do innej.',
    noOtherTeams: 'Brak innych drużyn do dołączenia.',
    maxSize: 'maks.',
  },
};

export default function TeamPage({ params }) {
  const txt = L[getLang() === 'pl' ? 'pl' : 'en'];
  const [contest, setContest] = useState(undefined);
  const [data, setData] = useState(undefined);
  const [loadError, setLoadError] = useState(null);
  const [name, setName] = useState('');
  const [inviteLogin, setInviteLogin] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    let c = null;
    try { c = await api(`/api/contests/${params.id}`, { noCache: true }); } catch { c = null; }
    setContest(c);
    if (!c) { setData(null); setLoadError(null); return; }
    if (c.teamMode !== true) { setData(null); setLoadError(null); return; }
    try {
      setData(await api(`/api/contests/${params.id}/teams`, { noCache: true }));
      setLoadError(null);
    } catch (e) {
      setData(null);
      setLoadError(e);
    }
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  async function run(fn, success) {
    setBusy(true);
    try {
      await fn();
      if (success) toast(success, 'success');
      await load();
    } catch (e) {
      toast(e.message || txt.loadFailed, 'danger');
    } finally {
      setBusy(false);
    }
  }

  function createTeam(e) {
    e.preventDefault();
    const value = name.trim();
    if (!value) { toast(txt.nameRequired, 'warn'); return; }
    run(async () => {
      await api(`/api/contests/${params.id}/teams`, { method: 'POST', body: JSON.stringify({ name: value }) });
      setName('');
    }, txt.created);
  }

  function joinTeam(team) {
    run(() => api(`/api/contests/${params.id}/teams/${team.id}/join`, { method: 'POST', body: '{}' }), txt.joined);
  }

  function leaveTeam(team) {
    if (typeof window !== 'undefined' && !window.confirm(txt.leaveConfirm)) return;
    run(() => api(`/api/contests/${params.id}/teams/${team.id}/leave`, { method: 'POST', body: '{}' }), txt.left);
  }

  function invite(team, e) {
    e.preventDefault();
    const login = inviteLogin.trim();
    if (!login) return;
    run(async () => {
      await api(`/api/contests/${params.id}/teams/${team.id}/invite`, { method: 'POST', body: JSON.stringify({ login }) });
      setInviteLogin('');
    }, txt.invited);
  }

  function removeMember(team, member) {
    if (typeof window !== 'undefined' && !window.confirm(txt.removeConfirm)) return;
    run(() => api(`/api/contests/${params.id}/teams/${team.id}/members/${member.id}`, { method: 'DELETE' }), txt.removed);
  }

  if (contest === undefined) return <Skeleton lines={5} />;
  if (contest === null) {
    return (
      <div className="max-w-2xl">
        <h1 className="type-h1">{txt.title}</h1>
        <div className="mt-3"><ErrorState line={txt.loadFailed} action={<Button onClick={load}>{txt.retry}</Button>} /></div>
      </div>
    );
  }

  if (contest.teamMode !== true) {
    return (
      <div className="max-w-2xl">
        <h1 className="type-h1">{txt.title}</h1>
        <div className="card p-4 mt-3">
          <h2 className="type-h2">{txt.individualTitle}</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{txt.individualBody}</p>
        </div>
      </div>
    );
  }

  if (data === undefined) return <Skeleton lines={6} />;
  if (loadError) {
    const status = loadError.status;
    const line = status === 401 ? txt.loginRequired : status === 403 ? txt.joinContest : txt.loadFailed;
    return (
      <div className="max-w-2xl">
        <h1 className="type-h1">{txt.title}</h1>
        <div className="mt-3"><ErrorState line={line} action={<Button onClick={load}>{txt.retry}</Button>} /></div>
      </div>
    );
  }

  const teams = data.items || [];
  const myTeam = teams.find((team) => team.isMember) || null;
  const others = teams.filter((team) => !team.isMember);
  const max = data.maxTeamSize || 3;

  return (
    <div className="max-w-2xl">
      <h1 className="type-h1">{txt.title}</h1>
      <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{txt.subtitle}</p>
      {data.rankingNotice ? <p className="text-xs mt-2" style={{ color: 'var(--warn)' }}>{data.rankingNotice}</p> : null}

      {myTeam ? (
        <section className="card p-4 mt-4" aria-labelledby="my-team-title">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 id="my-team-title" className="type-h2">{txt.myTeam}: {myTeam.name}</h2>
            <Badge tone="accent">{myTeam.members.length}/{max} {txt.members}</Badge>
          </div>
          <dl className="mt-2 text-sm grid sm:grid-cols-2 gap-x-6 gap-y-1">
            <div><dt className="inline" style={{ color: 'var(--muted)' }}>{txt.scoreboardName}: </dt><dd className="inline type-mono">{myTeam.scoreboardName || myTeam.name}</dd></div>
            <div><dt className="inline" style={{ color: 'var(--muted)' }}>{txt.loginIdentity}: </dt><dd className="inline type-mono">{myTeam.loginIdentity || '—'}</dd></div>
          </dl>

          <h3 className="text-sm font-semibold mt-3">{txt.roster}</h3>
          {(myTeam.roster || []).length ? (
            <ul className="mt-1 flex flex-col gap-1">
              {(myTeam.roster || []).map((member) => (
                <li key={member.id} className="flex items-center gap-2 text-sm">
                  <span className="type-mono">{member.login || `#${member.id}`}</span>
                  {member.name ? <span className="text-xs" style={{ color: 'var(--muted)' }}>{member.name}</span> : null}
                  {String(member.id) === String(myTeam.captainId) ? <Badge tone="warn">{txt.captain}</Badge> : null}
                  {myTeam.isCaptain && String(member.id) !== String(myTeam.captainId) ? (
                    <Button variant="danger" className="!py-0 !px-2 ml-auto" disabled={busy} onClick={() => removeMember(myTeam, member)}>{txt.remove}</Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm" style={{ color: 'var(--muted)' }}>{txt.noRoster}</p>}

          {myTeam.isCaptain ? (
            <form className="mt-3 flex gap-2 items-end flex-wrap" onSubmit={(e) => invite(myTeam, e)}>
              <Input value={inviteLogin} onChange={(e) => setInviteLogin(e.target.value)} placeholder="login" aria-label={txt.invite} className="!w-48" />
              <Button type="submit" variant="secondary" disabled={busy}>{txt.inviteBtn}</Button>
            </form>
          ) : <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>{txt.captainOnly}</p>}

          <div className="mt-4">
            <Button variant="danger" disabled={busy} onClick={() => leaveTeam(myTeam)}>{txt.leave}</Button>
          </div>
        </section>
      ) : (
        <>
          <section className="card p-4 mt-4">
            <h2 className="type-h2">{txt.create}</h2>
            <form className="mt-2 flex gap-2 items-end flex-wrap" onSubmit={createTeam}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={txt.teamName} aria-label={txt.teamName} className="!w-56" />
              <Button type="submit" disabled={busy}>{txt.create}</Button>
            </form>
          </section>

          <section className="mt-4" aria-labelledby="team-list-title">
            <h2 id="team-list-title" className="type-h2">{txt.joinNote}</h2>
            {others.length ? (
              <ul className="mt-2 flex flex-col gap-2">
                {others.map((team) => (
                  <li key={team.id} className="card p-3 flex items-center gap-3 flex-wrap">
                    <div className="min-w-0">
                      <strong className="block text-sm truncate" style={{ fontFamily: 'var(--font-display)' }}>{team.name}</strong>
                      <span className="block text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                        {(team.memberLogins || []).join(', ') || txt.noRoster} · {team.members.length}/{max} {txt.maxSize}
                      </span>
                    </div>
                    <Button variant="secondary" className="ml-auto" disabled={busy} onClick={() => joinTeam(team)}>{txt.join}</Button>
                  </li>
                ))}
              </ul>
            ) : <div className="mt-2"><EmptyState line={txt.noOtherTeams} /></div>}
          </section>
        </>
      )}

      {myTeam ? <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>{txt.inTeamNote}</p> : null}
      {!myTeam && !others.length ? <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>{txt.noTeams}</p> : null}
    </div>
  );
}
