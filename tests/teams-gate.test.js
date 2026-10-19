// Batch 3 / S4-4 — team lifecycle: membership, captain vs admin, max size,
// canonical `members`/legacy `memberIds`, audit, and teamMode ranking.
// Uses tests/helpers.js (dynamic port, isolated DATA_DIR).
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, json } = require('./helpers');

let h;
let teacherTok;
let s1Tok;
let s2Tok;
let s3Tok;
let outsiderTok;
let s1Id;
let s2Id;
let s3Id;
let outsiderId;
let s1Login;
let s2Login;
let s3Login;
let outsiderLogin;

async function patchContest(id, body) {
  return h.api(`/api/contests/${id}`, { method: 'PATCH', ...json(body) }, teacherTok);
}

async function addMember(contestId, login) {
  return h.api(`/api/contests/${contestId}/members`, { method: 'POST', ...json({ login, role: 'participant' }) }, teacherTok);
}

async function register(prefix) {
  const login = `${prefix}_${Date.now().toString(36)}`;
  const reg = await h.api('/api/auth/register', {
    method: 'POST',
    ...json({ login, email: `${login}@uj.edu.pl`, password: 'secret12' }),
  });
  assert.equal(reg.status, 201, `register ${login}: ${JSON.stringify(reg.body)}`);
  const tok = await h.loginAs(login, 'secret12');
  const me = await h.api('/api/me', {}, tok);
  return { login, tok, id: me.body.id };
}

before(async () => {
  h = await startServer({ prefix: 'satori-teams-gate-' });
  teacherTok = await h.loginAs('g_herman', 'teacher123');
  s1Login = 'jan_kowalski';
  s1Tok = await h.loginAs(s1Login, 'student123');
  s1Id = (await h.api('/api/me', {}, s1Tok)).body.id;

  const s2 = await register('team_s2');
  s2Tok = s2.tok;
  s2Id = s2.id;
  s2Login = s2.login;
  const s3 = await register('team_s3');
  s3Tok = s3.tok;
  s3Id = s3.id;
  s3Login = s3.login;
  const out = await register('team_out');
  outsiderTok = out.tok;
  outsiderId = out.id;
  outsiderLogin = out.login;
});

after(async () => {
  if (h) await h.close();
});

test('S4-4: team create/join/invite/leave/delete, permissions, audit and teamMode ranking', async () => {
  const contest = await h.createContest(teacherTok, {
    name: 'Team Gate', mode: 'ICPC', teamMode: true,
    startAt: '2020-01-01T00:00:00Z', endAt: '2030-01-01T00:00:00Z',
    settings: { maxTeamSize: 2, penaltyMin: 0, verdictVisibility: 'all' },
  });
  const run = await patchContest(contest.id, { lifecycle: 'running' });
  assert.equal(run.status, 200, JSON.stringify(run.body));

  for (const login of [s1Login, s2Login, s3Login]) {
    const added = await addMember(contest.id, login);
    assert.equal(added.status, 201, `add ${login}: ${JSON.stringify(added.body)}`);
  }

  const problem = await h.createProblem(contest.id, teacherTok, { code: 'A', name: 'Team Problem', visibility: 'visible' });
  const group = await h.addGroup(problem.id, teacherTok);
  await h.addCase(problem.id, teacherTok, { groupId: group.id, input: '1\n', expected: '1\n' });

  // Non-members cannot read, create or join teams.
  const anonList = await h.api(`/api/contests/${contest.id}/teams`);
  assert.equal(anonList.status, 401);
  const deniedList = await h.api(`/api/contests/${contest.id}/teams`, {}, outsiderTok);
  assert.equal(deniedList.status, 403);
  assert.equal(deniedList.body.error.code, 'NOT_MEMBER');
  const deniedCreate = await h.api(`/api/contests/${contest.id}/teams`, {
    method: 'POST', ...json({ name: 'Outsider Team', members: [outsiderId] }),
  }, outsiderTok);
  assert.equal(deniedCreate.status, 403);
  assert.equal(deniedCreate.body.error.code, 'NOT_MEMBER');

  // A member creates a team; canonical `members` and legacy `memberIds` agree.
  const created = await h.api(`/api/contests/${contest.id}/teams`, {
    method: 'POST', ...json({ name: 'Alpha', members: [s1Id] }),
  }, s1Tok);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const teamId = created.body.id;
  assert.deepEqual(created.body.members, [String(s1Id)]);
  assert.deepEqual(created.body.memberIds, [String(s1Id)]);
  assert.equal(created.body.captainId, String(s1Id));
  assert.ok(created.body.memberLogins.includes(s1Login));

  const deniedJoin = await h.api(`/api/contests/${contest.id}/teams/${teamId}/join`, { method: 'POST', body: '{}' }, outsiderTok);
  assert.equal(deniedJoin.status, 403);
  assert.equal(deniedJoin.body.error.code, 'NOT_MEMBER');

  // Duplicate member IDs and canonical non-members are rejected.
  const duplicate = await h.api(`/api/contests/${contest.id}/teams`, {
    method: 'POST', ...json({ name: 'Dup', members: [s1Id, s1Id] }),
  }, s1Tok);
  assert.equal(duplicate.status, 422);
  assert.equal(duplicate.body.error.code, 'DUPLICATE_MEMBER');

  const nonMember = await h.api(`/api/contests/${contest.id}/teams`, {
    method: 'POST', ...json({ name: 'Bad', members: [s1Id, outsiderId] }),
  }, s1Tok);
  assert.equal(nonMember.status, 422);
  assert.equal(nonMember.body.error.code, 'MEMBER_NOT_IN_CONTEST');

  // D12: the legacy `memberIds` alias is accepted, normalized, and non-members
  // are dropped with a report instead of poisoning the canonical roster.
  const legacy = await h.api(`/api/contests/${contest.id}/teams`, {
    method: 'POST', ...json({ name: 'Legacy', memberIds: [s1Id, outsiderId] }),
  }, s1Tok);
  assert.equal(legacy.status, 201, JSON.stringify(legacy.body));
  assert.deepEqual(legacy.body.members, [String(s1Id)]);
  assert.deepEqual(legacy.body.droppedMembers, [outsiderId]);
  const legacyDelete = await h.api(`/api/contests/${contest.id}/teams/${legacy.body.id}`, { method: 'DELETE' }, teacherTok);
  assert.equal(legacyDelete.status, 200);

  // Managers may create an empty shell; the first member to join becomes captain.
  const shell = await h.api(`/api/contests/${contest.id}/teams`, {
    method: 'POST', ...json({ name: 'Shell', members: [] }),
  }, teacherTok);
  assert.equal(shell.status, 201, JSON.stringify(shell.body));
  assert.equal(shell.body.captainId, null);
  const shellJoin = await h.api(`/api/contests/${contest.id}/teams/${shell.body.id}/join`, { method: 'POST', body: '{}' }, s1Tok);
  assert.equal(shellJoin.status, 200, JSON.stringify(shellJoin.body));
  assert.equal(shellJoin.body.team.captainId, String(s1Id));
  const shellDelete = await h.api(`/api/contests/${contest.id}/teams/${shell.body.id}`, { method: 'DELETE' }, teacherTok);
  assert.equal(shellDelete.status, 200);

  // Join, duplicate join and max size (2).
  const joined = await h.api(`/api/contests/${contest.id}/teams/${teamId}/join`, { method: 'POST', body: '{}' }, s2Tok);
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.deepEqual(joined.body.team.members.map(String).sort(), [String(s1Id), String(s2Id)].sort());

  const duplicateJoin = await h.api(`/api/contests/${contest.id}/teams/${teamId}/join`, { method: 'POST', body: '{}' }, s2Tok);
  assert.equal(duplicateJoin.status, 409);
  assert.equal(duplicateJoin.body.error.code, 'ALREADY_MEMBER');

  const full = await h.api(`/api/contests/${contest.id}/teams/${teamId}/join`, { method: 'POST', body: '{}' }, s3Tok);
  assert.equal(full.status, 409);
  assert.equal(full.body.error.code, 'TEAM_FULL');

  // Members see the roster with logins.
  const listed = await h.api(`/api/contests/${contest.id}/teams`, {}, s2Tok);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.teamMode, true);
  assert.equal(listed.body.maxTeamSize, 2);
  const alpha = listed.body.items.find((x) => String(x.id) === String(teamId));
  assert.ok(alpha);
  assert.ok(alpha.memberLogins.includes(s1Login));
  assert.ok(alpha.memberLogins.includes(s2Login));

  // Captain and admin can edit; a plain member cannot.
  const memberEdit = await h.api(`/api/contests/${contest.id}/teams/${teamId}`, {
    method: 'PATCH', ...json({ name: 'Nope' }),
  }, s2Tok);
  assert.equal(memberEdit.status, 403);
  assert.equal(memberEdit.body.error.code, 'TEAM_FORBIDDEN');
  const captainEdit = await h.api(`/api/contests/${contest.id}/teams/${teamId}`, {
    method: 'PATCH', ...json({ name: 'Alpha Prime', scoreboardName: 'alpha', loginIdentity: 'alpha' }),
  }, s1Tok);
  assert.equal(captainEdit.status, 200, JSON.stringify(captainEdit.body));
  assert.equal(captainEdit.body.team.name, 'Alpha Prime');
  assert.equal(captainEdit.body.team.scoreboardName, 'alpha');
  const adminEdit = await h.api(`/api/contests/${contest.id}/teams/${teamId}`, {
    method: 'PATCH', ...json({ scoreboardName: 'alpha-admin' }),
  }, teacherTok);
  assert.equal(adminEdit.status, 200);
  assert.equal(adminEdit.body.team.scoreboardName, 'alpha-admin');

  // Invites: captain-only, contest-member-only, max-size-aware.
  const memberInvite = await h.api(`/api/contests/${contest.id}/teams/${teamId}/invite`, {
    method: 'POST', ...json({ login: s3Login }),
  }, s2Tok);
  assert.equal(memberInvite.status, 403);
  assert.equal(memberInvite.body.error.code, 'TEAM_FORBIDDEN');
  const outsiderInvite = await h.api(`/api/contests/${contest.id}/teams/${teamId}/invite`, {
    method: 'POST', ...json({ login: outsiderLogin }),
  }, s1Tok);
  assert.equal(outsiderInvite.status, 422);
  assert.equal(outsiderInvite.body.error.code, 'MEMBER_NOT_IN_CONTEST');
  const removeByMember = await h.api(`/api/contests/${contest.id}/teams/${teamId}/members/${s2Id}`, { method: 'DELETE' }, s3Tok);
  assert.equal(removeByMember.status, 403);

  const removed = await h.api(`/api/contests/${contest.id}/teams/${teamId}/members/${s2Id}`, { method: 'DELETE' }, s1Tok);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.deepEqual(removed.body.team.members, [String(s1Id)]);
  const invited = await h.api(`/api/contests/${contest.id}/teams/${teamId}/invite`, {
    method: 'POST', ...json({ login: s3Login }),
  }, s1Tok);
  assert.equal(invited.status, 200, JSON.stringify(invited.body));
  assert.ok(invited.body.team.memberLogins.includes(s3Login));
  const fullInvite = await h.api(`/api/contests/${contest.id}/teams/${teamId}/invite`, {
    method: 'POST', ...json({ userId: s2Id }),
  }, s1Tok);
  assert.equal(fullInvite.status, 409);
  assert.equal(fullInvite.body.error.code, 'TEAM_FULL');

  // A team member (not on the team) cannot submit with that teamId.
  const badSubmit = await h.api('/api/submits', {
    method: 'POST',
    ...json({ contestId: contest.id, problemId: problem.id, teamId, filename: 'solution.cpp', code: 'int main(){ return 0; }' }),
  }, s2Tok);
  assert.equal(badSubmit.status, 403);
  assert.equal(badSubmit.body.error.code, 'TEAM_MEMBERSHIP');

  // Captain leaves -> the remaining member is promoted.
  const left = await h.api(`/api/contests/${contest.id}/teams/${teamId}/leave`, { method: 'POST', body: '{}' }, s1Tok);
  assert.equal(left.status, 200, JSON.stringify(left.body));
  assert.equal(left.body.left, true);
  assert.equal(left.body.team.captainId, String(s3Id));
  const leftAgain = await h.api(`/api/contests/${contest.id}/teams/${teamId}/leave`, { method: 'POST', body: '{}' }, s1Tok);
  assert.equal(leftAgain.status, 409);
  assert.equal(leftAgain.body.error.code, 'NOT_MEMBER');

  // The new captain can delete; teamMode:true ranking renders team rows.
  const ranking = await h.api(`/api/contests/${contest.id}/ranking`, {}, teacherTok);
  assert.equal(ranking.status, 200);
  assert.ok(ranking.body.rows.some((r) => r.contestantId === `t:${teamId}`), 'team appears on the team board');

  // The promoted captain can invite; a plain member still cannot delete the team.
  const reinvite = await h.api(`/api/contests/${contest.id}/teams/${teamId}/invite`, {
    method: 'POST', ...json({ login: s2Login }),
  }, s3Tok);
  assert.equal(reinvite.status, 200, JSON.stringify(reinvite.body));
  const memberDelete = await h.api(`/api/contests/${contest.id}/teams/${teamId}`, { method: 'DELETE' }, s2Tok);
  assert.equal(memberDelete.status, 403);
  assert.equal(memberDelete.body.error.code, 'TEAM_FORBIDDEN');

  const deleted = await h.api(`/api/contests/${contest.id}/teams/${teamId}`, { method: 'DELETE' }, s3Tok);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted, true);
  const gone = await h.api(`/api/contests/${contest.id}/teams`, {}, s1Tok);
  assert.ok(!gone.body.items.some((x) => String(x.id) === String(teamId)));

  // Mutations are audited.
  const auditRows = h.store.all('audit');
  for (const action of ['team.create', 'team.join', 'team.update', 'team.invite', 'team.member.remove', 'team.leave', 'team.delete']) {
    assert.ok(auditRows.some((a) => a.action === action), `audit ${action}`);
  }
  const contestAudit = await h.api(`/api/contests/${contest.id}/audit?action=team.create`, {}, teacherTok);
  assert.equal(contestAudit.status, 200);
  assert.ok(contestAudit.body.items.some((a) => a.action === 'team.create'), 'team audit is visible in the contest audit log');
});

test('S4-4: teamMode false keeps individual ranking; teams are recorded with a notice', async () => {
  const contest = await h.createContest(teacherTok, {
    name: 'Individual Gate', mode: 'ICPC', teamMode: false,
    startAt: '2020-01-01T00:00:00Z', endAt: '2030-01-01T00:00:00Z',
  });
  await patchContest(contest.id, { lifecycle: 'running' });
  for (const login of [s1Login, s2Login]) {
    const added = await addMember(contest.id, login);
    assert.equal(added.status, 201, JSON.stringify(added.body));
  }

  const created = await h.api(`/api/contests/${contest.id}/teams`, {
    method: 'POST', ...json({ name: 'Unranked', members: [s1Id] }),
  }, s1Tok);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.ok(created.body.rankingNotice, 'create reports that ranking stays individual');

  const listed = await h.api(`/api/contests/${contest.id}/teams`, {}, s1Tok);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.teamMode, false);
  assert.ok(listed.body.rankingNotice);

  const ranking = await h.api(`/api/contests/${contest.id}/ranking`, {}, teacherTok);
  assert.equal(ranking.status, 200);
  assert.ok(ranking.body.rows.some((r) => r.contestantId === `u:${s1Id}`), 'individual row kept');
  assert.ok(ranking.body.rows.some((r) => r.contestantId === `u:${s2Id}`), 'second individual kept');
  assert.ok(!ranking.body.rows.some((r) => String(r.contestantId).startsWith('t:')), 'no team rows');
});
