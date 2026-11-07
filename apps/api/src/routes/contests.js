// Satori V2 — contest lifecycle, members, teams, problems, ranking, and deadlines.
'use strict';
const { store } = require('../lib/store');
const { send, sendText, readBody } = require('../lib/http');
const {
  authUser, needAuth, forbid, audit, contestRole, memberRole, canManageContest,
  sharesTeam, boardModeOf, isMyContestantRow, isTeacherRow, teacherIds, canReadContest,
  canListContest, contestVisibility, normalizeContestVisibility,
  isContestMember, teamHasMember,
} = require('../lib/authz');
const { contestDeadlines, enrichProblemWithDeadline, computeLabsGrade, buildRanking, csvCell, icsText, normalizeExam } = require('../lib/contestAccess');
const { normalizeContestTime, resolveContestEnd } = require('../lib/contestTime');
const { isAccepted } = require('../lib/ranking');
const { releaseState, computeRowGrade } = require('./grades');
const comms = require('./comms');

const LIVE_INTERVAL_MS = Number(process.env.SATORI_LIVE_INTERVAL_MS || 15000);
const LIFECYCLES = ['draft', 'registration', 'running', 'finished', 'archived'];

// Lifecycle moves in both directions. The `archived` flag follows the stage so
// archived contests disappear from lists and reappear when restored.
function normalizeLifecycle(body) {
  if (!Object.prototype.hasOwnProperty.call(body, 'lifecycle')) return body;
  const lifecycle = String(body.lifecycle == null ? '' : body.lifecycle).trim();
  if (!LIFECYCLES.includes(lifecycle)) return null;
  return { ...body, lifecycle, archived: lifecycle === 'archived' };
}

// A11: public contests never expose member/admin IDs or exam IP/time settings.
function publicContestView(c) {
  const { members, pending, admins, settings, gradeOverrides, extensions, ...rest } = c;
  const safeSettings = { ...(settings || {}) };
  delete safeSettings.exam;
  delete safeSettings.ips;
  delete safeSettings.tokens;
  return { ...rest, visibility: contestVisibility(c), settings: safeSettings, memberCount: (members || []).length };
}
function contestView(c, me) {
  const base = canManageContest(me, c) ? c : publicContestView(c);
  const access = canReadContest(c, me) ? 'open' : 'locked';
  const role = me ? contestRole(c, me.id) : 'none';
  const membership = !me
    ? 'other'
    : role === 'contest_admin' || role === 'superadmin' ? 'managed'
      : role === 'participant' ? 'joined' : role === 'pending' ? 'pending' : 'other';
  // A locked contest exposes only the card: name, description, registration and
  // lifecycle. Scoring, board and deadline settings stay behind membership.
  if (access === 'locked') {
    const { settings, ...rest } = base;
    return { ...rest, visibility: contestVisibility(c), access, membership };
  }
  return { ...base, visibility: contestVisibility(c), access, membership };
}
// A10/A12: hide rows the board mode forbids and never rank teachers.
function filterBoard(c, me, body) {
  const mode = boardModeOf(c);
  let rows = (body && body.rows) || [];
  if (mode === 'me-only' && !canManageContest(me, c)) rows = rows.filter((r) => isMyContestantRow(r, c, me));
  rows = rows.filter((r) => !isTeacherRow(r, c));
  const meRow = me ? rows.find((r) => String(r.contestantId) === `u:${me.id}` || String(r.name) === String(me.login)) : null;
  const meOut = meRow ? { rank: meRow.rank, name: meRow.name, total: meRow.total ?? meRow.points ?? meRow.solved ?? null } : null;
  return { ...body, rows, me: meOut };
}

// ---- S4-4 team lifecycle -------------------------------------------------
// `members` is canonical; `memberIds` is the legacy alias kept for one release (D5/D12).
// Captains are stored explicitly; legacy teams without one fall back to the first member.
const TEAM_DEFAULT_MAX_SIZE = 3;

function teamMemberIds(team) {
  const list = Array.isArray(team.members) && team.members.length ? team.members : team.memberIds;
  return (list || []).map(String);
}
function teamCaptainId(team) {
  const ids = teamMemberIds(team);
  if (!ids.length) return null;
  const explicit = team.captainId != null ? String(team.captainId) : '';
  return explicit && ids.includes(explicit) ? explicit : ids[0];
}
function teamView(team, me) {
  const ids = teamMemberIds(team);
  const captainId = teamCaptainId(team);
  const roster = ids.map((id) => {
    const u = store.get('users', id);
    return {
      id: u ? u.id : id,
      login: u ? u.login : null,
      name: u ? [u.firstName, u.lastName].filter(Boolean).join(' ') : '',
    };
  });
  const captain = captainId ? store.get('users', captainId) : null;
  return {
    ...team,
    members: ids,
    memberIds: ids,
    captainId,
    captainLogin: captain ? captain.login : null,
    roster,
    memberLogins: roster.map((x) => x.login).filter(Boolean),
    isMember: Boolean(me) && ids.includes(String(me.id)),
    isCaptain: Boolean(me) && captainId === String(me.id),
  };
}
function maxTeamSize(c) {
  const raw = (c.settings || {}).maxTeamSize ?? c.maxTeamSize;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : TEAM_DEFAULT_MAX_SIZE;
}
function contestTeam(c, tid) {
  const team = store.get('teams', tid);
  if (!team || String(team.contestId) !== String(c.id)) return null;
  return team;
}
function isContestMemberId(c, id) {
  if (id == null) return false;
  const key = String(id);
  if ((c.members || []).some((x) => String(x) === key)) return true;
  if ((c.admins || []).some((x) => String(x) === key)) return true;
  return Boolean((c.roles || {})[key]);
}
function normalizeTeamUserId(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : s;
}
function isTeamManager(me, c, team) {
  return canManageContest(me, c) || (Boolean(me) && teamCaptainId(team) === String(me.id));
}
function teamForbidden(res, message = 'Team captain or contest admin required.') {
  return send(res, 403, { error: { code: 'TEAM_FORBIDDEN', message, hint: 'Ask the team captain or a contest admin.' } });
}
function teamActor(req, res, c) {
  const me = needAuth(req, res);
  if (!me) return null;
  if (!isContestMember(c, me.id) && !canManageContest(me, c)) {
    send(res, 403, { error: { code: 'NOT_MEMBER', message: 'Contest membership required.', hint: 'Join the contest before using teams.' } });
    return null;
  }
  return me;
}
function removeTeamUserRows(teamId, userId) {
  for (const row of store.query('teamMembers', (r) => String(r.teamId) === String(teamId)
    && (userId == null || String(r.userId) === String(userId)))) {
    store.remove('teamMembers', row.id);
  }
}
function updateTeamMembers(team, ids, patch = {}) {
  const members = ids.map(String);
  return store.update('teams', team.id, { ...patch, members, memberIds: members });
}

async function listTeams(req, res, c) {
  const me = teamActor(req, res, c);
  if (!me) return true;
  const items = store.query('teams', (x) => String(x.contestId) === String(c.id)).map((t) => teamView(t, me));
  return send(res, 200, {
    items,
    teamMode: c.teamMode === true,
    maxTeamSize: maxTeamSize(c),
    rankingNotice: c.teamMode === true ? null : 'Teams are recorded, but this contest ranks individual participants.',
  });
}

async function createTeam(req, res, c) {
  const me = teamActor(req, res, c);
  if (!me) return true;
  const b = await readBody(req);
  const name = String(b.name || '').trim();
  if (!name) return send(res, 422, { error: { code: 'NAME', message: 'Team name required.', hint: 'e.g. uj7.' } });

  const canonicalInput = Array.isArray(b.members);
  const legacyInput = !canonicalInput && Array.isArray(b.memberIds);
  const rawMembers = canonicalInput ? b.members : legacyInput ? b.memberIds : [me.id];
  const ids = [];
  const seen = new Set();
  for (const raw of rawMembers) {
    const id = normalizeTeamUserId(raw);
    if (id == null) return send(res, 422, { error: { code: 'MEMBER_ID', message: 'Every team member needs a user ID.', hint: 'Send numeric user IDs.' } });
    const key = String(id);
    if (seen.has(key)) return send(res, 422, { error: { code: 'DUPLICATE_MEMBER', message: 'A user appears twice in the team.', hint: 'Remove the duplicate member ID.' } });
    seen.add(key);
    ids.push(id);
  }

  // Canonical `members` is strict. The legacy `memberIds` alias is normalized and
  // non-members are dropped with a report so old clients keep working (D12).
  const valid = [];
  const dropped = [];
  for (const id of ids) {
    if (isContestMemberId(c, id)) valid.push(id);
    else if (canonicalInput) {
      return send(res, 422, {
        error: { code: 'MEMBER_NOT_IN_CONTEST', message: 'Every team member must be a contest member.', hint: 'Add them to the contest first.' },
        memberId: id,
      });
    } else {
      dropped.push(id);
    }
  }
  const validKeys = valid.map(String);
  if (!canManageContest(me, c) && !validKeys.includes(String(me.id))) {
    return send(res, 422, { error: { code: 'CREATOR_NOT_MEMBER', message: 'You must be on the team you create.', hint: 'Include your user ID or let the captain create it.' } });
  }
  if (valid.length > maxTeamSize(c)) {
    return send(res, 409, { error: { code: 'TEAM_FULL', message: `Teams may have at most ${maxTeamSize(c)} members.`, hint: 'Remove a member or ask the contest admin.' } });
  }

  let captain = b.captainId != null ? normalizeTeamUserId(b.captainId) : null;
  if (captain != null && !validKeys.includes(String(captain))) {
    return send(res, 422, { error: { code: 'CAPTAIN', message: 'The captain must be a team member.', hint: 'Pick a captain from the member list.' } });
  }
  if (captain == null) captain = validKeys.includes(String(me.id)) ? me.id : (valid[0] || null);

  const team = store.insert('teams', {
    name,
    contestId: c.id,
    members: valid,
    memberIds: valid,
    captainId: captain,
    loginIdentity: String(b.loginIdentity || '').trim() || name,
    scoreboardName: String(b.scoreboardName || '').trim() || name,
    createdAt: new Date().toISOString(),
  });
  audit(me.id, 'team.create', `contest:${c.id}/team:${team.id}`, { contestId: c.id, members: valid.length, teamMode: c.teamMode === true });
  const out = teamView(team, me);
  out.teamMode = c.teamMode === true;
  if (dropped.length) out.droppedMembers = dropped;
  if (c.teamMode !== true) out.rankingNotice = 'Teams are recorded, but this contest ranks individual participants (teamMode is off).';
  return send(res, 201, out);
}

async function patchTeam(req, res, c, tid) {
  const me = teamActor(req, res, c);
  if (!me) return true;
  const team = contestTeam(c, tid);
  if (!team) return send(res, 404, { error: { code: 'NO_TEAM', message: 'Team not found in this contest.', hint: 'Refresh the team list.' } });
  if (!isTeamManager(me, c, team)) return teamForbidden(res);

  const b = await readBody(req);
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(b, 'name')) {
    const name = String(b.name || '').trim();
    if (!name) return send(res, 422, { error: { code: 'NAME', message: 'Team name cannot be empty.', hint: 'Send a non-empty name.' } });
    patch.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(b, 'scoreboardName')) patch.scoreboardName = String(b.scoreboardName || '').trim();
  if (Object.prototype.hasOwnProperty.call(b, 'loginIdentity')) {
    const identity = String(b.loginIdentity || '').trim();
    if (!identity) return send(res, 422, { error: { code: 'LOGIN_IDENTITY', message: 'Login identity cannot be empty.', hint: 'Use the team login, e.g. uj7.' } });
    patch.loginIdentity = identity;
  }
  if (!Object.keys(patch).length) return send(res, 422, { error: { code: 'NO_FIELDS', message: 'Nothing to update.', hint: 'Send name, scoreboardName or loginIdentity.' } });

  const updated = store.update('teams', team.id, patch);
  audit(me.id, 'team.update', `contest:${c.id}/team:${team.id}`, { contestId: c.id, fields: Object.keys(patch) });
  return send(res, 200, { ok: true, team: teamView(updated, me) });
}

async function deleteTeam(req, res, c, tid) {
  const me = teamActor(req, res, c);
  if (!me) return true;
  const team = contestTeam(c, tid);
  if (!team) return send(res, 404, { error: { code: 'NO_TEAM', message: 'Team not found in this contest.', hint: 'Refresh the team list.' } });
  if (!isTeamManager(me, c, team)) return teamForbidden(res);
  removeTeamUserRows(team.id, null);
  store.remove('teams', team.id);
  audit(me.id, 'team.delete', `contest:${c.id}/team:${team.id}`, { contestId: c.id, name: team.name });
  return send(res, 200, { ok: true, deleted: true, id: team.id });
}

async function joinTeam(req, res, c, tid) {
  const me = teamActor(req, res, c);
  if (!me) return true;
  const team = contestTeam(c, tid);
  if (!team) return send(res, 404, { error: { code: 'NO_TEAM', message: 'Team not found in this contest.', hint: 'Refresh the team list.' } });
  if (teamHasMember(team, me.id)) return send(res, 409, { error: { code: 'ALREADY_MEMBER', message: 'You are already on this team.', hint: 'Leave it first to join another team.' } });
  const ids = teamMemberIds(team);
  if (ids.length >= maxTeamSize(c)) return send(res, 409, { error: { code: 'TEAM_FULL', message: `This team already has ${maxTeamSize(c)} members.`, hint: 'Ask the captain to free a slot or join another team.' } });
  const captain = teamCaptainId(team) || me.id;
  const updated = updateTeamMembers(team, [...ids, me.id], { captainId: captain });
  audit(me.id, 'team.join', `contest:${c.id}/team:${team.id}`, { contestId: c.id });
  return send(res, 200, { ok: true, team: teamView(updated, me) });
}

async function leaveTeam(req, res, c, tid) {
  const me = teamActor(req, res, c);
  if (!me) return true;
  const team = contestTeam(c, tid);
  if (!team) return send(res, 404, { error: { code: 'NO_TEAM', message: 'Team not found in this contest.', hint: 'Refresh the team list.' } });
  if (!teamHasMember(team, me.id)) return send(res, 409, { error: { code: 'NOT_MEMBER', message: 'You are not on this team.', hint: 'Refresh the team list.' } });
  const ids = teamMemberIds(team).filter((id) => id !== String(me.id));
  removeTeamUserRows(team.id, me.id);
  if (!ids.length) {
    store.remove('teams', team.id);
    audit(me.id, 'team.leave', `contest:${c.id}/team:${team.id}`, { contestId: c.id, deleted: true });
    return send(res, 200, { ok: true, left: true, deleted: true, id: team.id, team: null });
  }
  const wasCaptain = teamCaptainId(team) === String(me.id);
  const captainId = wasCaptain ? ids[0] : teamCaptainId(team);
  const updated = updateTeamMembers(team, ids, { captainId });
  audit(me.id, 'team.leave', `contest:${c.id}/team:${team.id}`, { contestId: c.id, promotedCaptain: wasCaptain ? captainId : undefined });
  return send(res, 200, { ok: true, left: true, team: teamView(updated, me) });
}

async function inviteToTeam(req, res, c, tid) {
  const me = teamActor(req, res, c);
  if (!me) return true;
  const team = contestTeam(c, tid);
  if (!team) return send(res, 404, { error: { code: 'NO_TEAM', message: 'Team not found in this contest.', hint: 'Refresh the team list.' } });
  if (!isTeamManager(me, c, team)) return teamForbidden(res);

  const b = await readBody(req);
  let user = null;
  if (b.userId != null) user = store.get('users', b.userId);
  else if (b.login) user = store.query('users', (x) => x.login === String(b.login).trim())[0];
  if (!user) return send(res, 404, { error: { code: 'NO_USER', message: 'No such user.', hint: 'They must register first.' } });
  if (!isContestMemberId(c, user.id)) {
    return send(res, 422, { error: { code: 'MEMBER_NOT_IN_CONTEST', message: 'That user is not a contest member.', hint: 'Add them to the contest first.' } });
  }
  if (teamHasMember(team, user.id)) return send(res, 409, { error: { code: 'ALREADY_MEMBER', message: 'That user is already on the team.', hint: 'Pick another contest member.' } });
  const ids = teamMemberIds(team);
  if (ids.length >= maxTeamSize(c)) return send(res, 409, { error: { code: 'TEAM_FULL', message: `Teams may have at most ${maxTeamSize(c)} members.`, hint: 'Remove a member first.' } });
  const captainId = teamCaptainId(team) || user.id;
  const updated = updateTeamMembers(team, [...ids, user.id], { captainId });
  audit(me.id, 'team.invite', `contest:${c.id}/team:${team.id}`, { contestId: c.id, userId: user.id, login: user.login });
  return send(res, 200, { ok: true, team: teamView(updated, me) });
}

async function removeTeamMember(req, res, c, tid, uid) {
  const me = teamActor(req, res, c);
  if (!me) return true;
  const team = contestTeam(c, tid);
  if (!team) return send(res, 404, { error: { code: 'NO_TEAM', message: 'Team not found in this contest.', hint: 'Refresh the team list.' } });
  if (!isTeamManager(me, c, team)) return teamForbidden(res);
  const target = normalizeTeamUserId(uid);
  if (!teamHasMember(team, target)) return send(res, 404, { error: { code: 'TEAM_MEMBER', message: 'That user is not on this team.', hint: 'Refresh the team roster.' } });
  const ids = teamMemberIds(team).filter((id) => id !== String(target));
  removeTeamUserRows(team.id, target);
  if (!ids.length) {
    store.remove('teams', team.id);
    audit(me.id, 'team.member.remove', `contest:${c.id}/team:${team.id}`, { contestId: c.id, userId: target, deleted: true });
    return send(res, 200, { ok: true, removed: target, deleted: true, team: null });
  }
  const wasCaptain = teamCaptainId(team) === String(target);
  const captainId = wasCaptain ? ids[0] : teamCaptainId(team);
  const updated = updateTeamMembers(team, ids, { captainId });
  audit(me.id, 'team.member.remove', `contest:${c.id}/team:${team.id}`, { contestId: c.id, userId: target, promotedCaptain: wasCaptain ? captainId : undefined });
  return send(res, 200, { ok: true, removed: target, team: teamView(updated, me) });
}

async function handleTeamRoutes(req, res, p, m) {
  let mm = p.match(/^\/api\/contests\/(\d+)\/teams$/);
  if (mm) {
    const c = store.get('contests', mm[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: 'Check /api/contests.' } });
    if (m === 'GET') return listTeams(req, res, c);
    if (m === 'POST') return createTeam(req, res, c);
    return false;
  }
  mm = p.match(/^\/api\/contests\/(\d+)\/teams\/(\d+)$/);
  if (mm) {
    const c = store.get('contests', mm[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: 'Check /api/contests.' } });
    if (m === 'PATCH') return patchTeam(req, res, c, mm[2]);
    if (m === 'DELETE') return deleteTeam(req, res, c, mm[2]);
    return false;
  }
  mm = p.match(/^\/api\/contests\/(\d+)\/teams\/(\d+)\/(join|leave|invite)$/);
  if (mm) {
    const c = store.get('contests', mm[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: 'Check /api/contests.' } });
    if (m !== 'POST') return false;
    if (mm[3] === 'join') return joinTeam(req, res, c, mm[2]);
    if (mm[3] === 'leave') return leaveTeam(req, res, c, mm[2]);
    return inviteToTeam(req, res, c, mm[2]);
  }
  mm = p.match(/^\/api\/contests\/(\d+)\/teams\/(\d+)\/members\/(\d+)$/);
  if (mm) {
    const c = store.get('contests', mm[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: 'Check /api/contests.' } });
    if (m === 'DELETE') return removeTeamMember(req, res, c, mm[2], mm[3]);
    return false;
  }
  return false;
}

async function handle(req, res, url, p, m) {
  const u = url;
  // Communications were extracted to routes/comms.js; delegate before contest routes.
  if (/^\/api\/contests\/\d+\/(clarifications|news(?:\.rss)?|subpages)(\/|$)/.test(p)) {
    return comms.handle(req, res, url, p, m);
  }
  // Team lifecycle lives in its own block so legacy `/teams` GET/POST stays intact.
  if (/^\/api\/contests\/\d+\/teams(?:\/|$)/.test(p)) {
    const handled = await handleTeamRoutes(req, res, p, m);
    if (handled !== false) return handled;
  }
  // contests list/create
  if (p === '/api/contests' && m === 'GET') {
    const me = authUser(req);
    const role = u.searchParams.get('role') || '';
    const arch = String(u.searchParams.get('archived') || '').toLowerCase();
    const showArchived = ['yes', 'true', '1'].includes(arch);
    const q = (u.searchParams.get('q') || '').toLowerCase();
    let items = store.all('contests');
    if (!showArchived) items = items.filter((c) => !c.archived);
    // D4: hidden contests are invisible to everyone outside the member/admin set.
    items = items.filter((c) => canListContest(c, me));
    const has = (arr, id) => (arr || []).map(String).includes(String(id));
    // B10: drafts are only visible to their admins/members/pending users.
    items = items.filter((c) => c.lifecycle !== 'draft'
      || (me && (canManageContest(me, c) || has(c.members, me.id) || has(c.pending, me.id))));
    if (q) items = items.filter((c) => (c.name + ' ' + (c.description || '')).toLowerCase().includes(q));
    if (me && role === 'joined') items = items.filter((c) => has(c.members, me.id));
    if (me && role === 'pending') items = items.filter((c) => has(c.pending, me.id));
    if (me && role === 'managed') items = items.filter((c) => has(c.admins, me.id));
    if (me && role === 'other') items = items.filter((c) => !has(c.members, me.id) && !has(c.pending, me.id));
    return send(res, 200, { items: items.map((c) => contestView(c, me)), total: items.length });
  }
  if (p === '/api/contests' && m === 'POST') {
    const me = needAuth(req, res);
    if (!me) return true;
    const b = await readBody(req);
    if (!b.name) return send(res, 422, { error: { code: 'NAME', message: 'Name required.', hint: 'e.g. UZI, 2026.' } });
    // D4: new contests are members-only unless the creator opens them explicitly.
    const visibility = b.visibility == null ? 'members' : normalizeContestVisibility(b.visibility);
    if (!visibility) {
      return send(res, 422, {
        error: { code: 'INVALID_VISIBILITY', message: 'Visibility must be public, members or hidden.', hint: 'Omit the field for members-only.' },
      });
    }
    const time = normalizeContestTime(b);
    const c = store.insert('contests', {
      name: b.name, description: b.description || '', mode: b.mode || 'ICPC',
      lifecycle: 'draft', registration: b.registration || 'approval', archived: false,
      visibility,
      startAt: time.startAt || null, endAt: time.endAt || null, freezeAt: time.freezeAt || null,
      scoreboardMode: b.scoreboardMode || null, teamMode: Boolean(b.teamMode),
      settings: b.settings || { penaltyMin: 20, verdictVisibility: 'all', allowSampleRun: true, deadlinePolicy: { enabled: false, lateMode: 'soft', penaltyKind: 'perDay', penaltyValue: 5, graceMin: 0 } },
      members: [], pending: [], admins: [me.id], template: b.template || null,
    });
    audit(me.id, 'contest.create', `contest:${c.id}`, {});
    return send(res, 201, c);
  }

  // contest sub-routes
  let mt = p.match(/^\/api\/contests\/(\d+)\/(apply|members|members\/approve|members\/csv|duplicate|problems|rankings\/live|ranking|ranking\.csv|grade|grade\.ics|deadlines\/bulk-extend|audit)$/);
  if (mt && (m === 'GET' || m === 'POST')) {
    const cid = mt[1];
    const act = mt[2];
    const c = store.get('contests', cid);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: 'Check /api/contests.' } });
    if (act === 'apply' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return true;
      if ((c.members || []).map(String).includes(String(me.id))) return send(res, 200, { ok: true, state: 'joined' });
      // Invite-only contests are joined by the jury, never by self-service.
      if (c.registration === 'invite') {
        return send(res, 403, { error: { code: 'INVITE_ONLY', message: 'This contest is invite-only.', hint: 'Ask a contest admin to add you.' } });
      }
      if (c.registration === 'open') {
        c.members.push(me.id);
        store.update('contests', c.id, { members: c.members });
        return send(res, 200, { ok: true, state: 'joined' });
      }
      if (!(c.pending || []).map(String).includes(String(me.id))) {
        c.pending.push(me.id);
        store.update('contests', c.id, { pending: c.pending });
      }
      audit(me.id, 'contest.apply', `contest:${c.id}`, {});
      return send(res, 200, { ok: true, state: 'pending' });
    }
    if (act === 'members' && m === 'GET') {
      const me = needAuth(req, res);
      if (!me) return true;
      const role = contestRole(c, me.id);
      if (!['contest_admin', 'superadmin'].includes(role)) return send(res, 403, { error: { code: 'FORBIDDEN', message: 'Admins only.', hint: 'Ask contest admin.' } });
      const users = (c.members || []).map((id) => { const x = store.get('users', id); return x ? { id: x.id, login: x.login, role: memberRole(c, id) } : { id, role: memberRole(c, id) }; });
      const pending = (c.pending || []).map((id) => { const x = store.get('users', id); return x ? { id: x.id, login: x.login, role: 'pending' } : { id, role: 'pending' }; });
      return send(res, 200, { members: users, pending });
    }
    if (act === 'members' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return true;
      const role = contestRole(c, me.id);
      if (!['contest_admin', 'superadmin'].includes(role)) return forbid(res);
      const b = await readBody(req);
      const login = String(b.login || '').trim();
      const wanted = String(b.role || 'participant');
      if (!login) return send(res, 422, { error: { code: 'LOGIN', message: 'login required.', hint: '' } });
      if (!['participant', 'teacher', 'jury'].includes(wanted)) return send(res, 422, { error: { code: 'ROLE', message: 'role must be participant|teacher|jury.', hint: '' } });
      const u = store.query('users', (x) => x.login === login)[0];
      if (!u) return send(res, 404, { error: { code: 'NO_USER', message: `No user "${login}".`, hint: 'They must register first.' } });
      const roles = { ...(c.roles || {}), [String(u.id)]: wanted };
      if (wanted === 'participant') {
        const members = (c.members || []).map(String).includes(String(u.id)) ? (c.members || []) : [...(c.members || []), u.id];
        const admins = (c.admins || []).filter((x) => String(x) !== String(u.id));
        const same = (c.members || []).map(String).includes(String(u.id)) && !(c.admins || []).map(String).includes(String(u.id));
        store.update('contests', c.id, { members, admins, roles, pending: (c.pending || []).filter((x) => String(x) !== String(u.id)) });
        if (same && memberRole(c, u.id) === 'participant') return send(res, 200, { ok: true, already: true, role: wanted, userId: u.id });
        audit(me.id, 'contest.member.add', `contest:${c.id}`, { login, role: wanted });
        return send(res, 201, { ok: true, role: wanted, userId: u.id });
      }
      if ((c.admins || []).map(String).includes(String(u.id)) && memberRole(c, u.id) === wanted) return send(res, 200, { ok: true, already: true, role: wanted, userId: u.id });
      store.update('contests', c.id, {
        admins: [...(c.admins || []).filter((x) => String(x) !== String(u.id)), u.id],
        members: [...(c.members || []).filter((x) => String(x) !== String(u.id)), u.id],
        pending: (c.pending || []).filter((x) => String(x) !== String(u.id)),
        roles,
      });
      audit(me.id, 'contest.admin.grant', `contest:${c.id}`, { login, role: wanted });
      return send(res, 201, { ok: true, role: wanted, userId: u.id });
    }
    if (act === 'members/approve' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return true;
      const role = contestRole(c, me.id);
      if (!['contest_admin', 'superadmin'].includes(role)) return forbid(res);
      const b = await readBody(req);
      const ids = b.userIds || (b.userId ? [b.userId] : []) || [];
      const approve = b.approve !== false;
      let pend = c.pending || [];
      let mem = c.members || [];
      if (!approve) {
        for (const id of ids) pend = pend.filter((x) => String(x) !== String(id));
        store.update('contests', c.id, { pending: pend, members: mem });
        audit(me.id, 'contest.reject', `contest:${c.id}`, { ids });
        return send(res, 200, { ok: true, rejected: ids.length, members: mem.length, pending: pend.length });
      }
      if (b.approveAllByFilter) {
        const q = String(b.q || '').toLowerCase();
        const keep = [];
        for (const id of pend) {
          const u2 = store.get('users', id);
          const login = u2 ? String(u2.login) : '';
          if (q && !login.toLowerCase().includes(q)) { keep.push(id); continue; }
          if (!mem.map(String).includes(String(id))) mem.push(id);
        }
        pend = keep;
      } else {
        for (const id of ids) {
          pend = pend.filter((x) => String(x) !== String(id));
          if (!mem.map(String).includes(String(id))) mem.push(Number(id) || id);
        }
      }
      store.update('contests', c.id, { pending: pend, members: mem });
      audit(me.id, 'contest.approve', `contest:${c.id}`, { ids });
      return send(res, 200, { ok: true, members: mem.length, pending: pend.length });
    }
    if (act === 'members/csv' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return true;
      const role = contestRole(c, me.id);
      if (!['contest_admin', 'superadmin'].includes(role)) return forbid(res);
      const b = await readBody(req);
      const logins = String(b.csv || '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
      let added = 0;
      const unknown = [];
      const mem = c.members || [];
      for (const lg of logins) {
        const x = store.query('users', (u2) => u2.login === lg)[0];
        if (!x) { unknown.push(lg); continue; }
        if (!mem.map(String).includes(String(x.id))) { mem.push(x.id); added += 1; }
      }
      store.update('contests', c.id, { members: mem });
      audit(me.id, 'contest.members.csv', `contest:${c.id}`, { added, unknown: unknown.length });
      return send(res, 200, { ok: true, added, unknown });
    }
    if (act === 'duplicate' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return true;
      if (!canManageContest(me, c)) return forbid(res);
      const b = await readBody(req);
      const nc = store.insert('contests', { ...c, id: undefined, name: b.name || `${c.name} (copy)`, lifecycle: 'draft', members: [], pending: [], archived: false });
      const setMap = new Map();
      for (const ps of store.query('problemSets', (x) => String(x.contestId) === String(c.id))) {
        const nps = store.insert('problemSets', { ...ps, id: undefined, contestId: nc.id });
        setMap.set(String(ps.id), nps.id);
      }
      const probMap = new Map();
      for (const pr of store.query('problems', (x) => String(x.contestId) === String(c.id))) {
        const npr = store.insert('problems', { ...pr, id: undefined, contestId: nc.id, setId: pr.setId ? (setMap.get(String(pr.setId)) || null) : null });
        probMap.set(String(pr.id), npr.id);
      }
      for (const g of store.query('testGroups', (x) => probMap.has(String(x.problemId)))) {
        const ng = store.insert('testGroups', { ...g, id: undefined, problemId: probMap.get(String(g.problemId)) });
        for (const tc of store.query('testCases', (x) => String(x.groupId) === String(g.id))) {
          store.insert('testCases', { ...tc, id: undefined, groupId: ng.id });
        }
      }
      for (const nw of store.query('news', (x) => String(x.contestId) === String(c.id))) {
        store.insert('news', { ...nw, id: undefined, contestId: nc.id });
      }
      audit(me.id, 'contest.duplicate', `contest:${nc.id}`, { from: c.id, problems: probMap.size });
      return send(res, 201, nc);
    }
    if (act === 'problems' && m === 'GET') {
      const q = (u.searchParams.get('q') || '').toLowerCase();
      const tag = u.searchParams.get('tag') || '';
      const statusF = u.searchParams.get('status') || 'all';
      const me = authUser(req);
      // A8/D4: private and exam contests are not readable by non-members.
      if (!canReadContest(c, me)) return send(res, 403, { error: { code: 'NOT_MEMBER', message: 'Contest membership required.', hint: 'Apply to the contest or ask the teacher.' } });
      const sets = store.query('problemSets', (x) => String(x.contestId) === String(c.id)).sort((a, b) => (a.order || 0) - (b.order || 0));
      let probs = store.query('problems', (x) => String(x.contestId) === String(c.id));
      const canManage = canManageContest(me, c);
      if (!canManage) probs = probs.filter((x) => (x.visibility || 'visible') === 'visible');
      if (q) probs = probs.filter((x) => (x.code + ' ' + x.name).toLowerCase().includes(q));
      if (tag) probs = probs.filter((x) => (x.tags || []).includes(tag));
      // solvesPct: unique accepted solvers / contest members (real difficulty signal)
      // A12: teachers are not contestants — exclude their submits and the denominator.
      const teachers = teacherIds(c);
      const acceptedBy = new Map();
      for (const s of store.query('submits', (x) => String(x.contestId) === String(c.id) && !x.sampleOnly)) {
        if (!isAccepted(s.status)) continue;
        if (teachers.has(String(s.userId))) continue;
        const k = String(s.problemId);
        if (!acceptedBy.has(k)) acceptedBy.set(k, new Set());
        acceptedBy.get(k).add(String(s.userId));
      }
      const memberDenom = Math.max(1, (c.members || []).filter((id) => !teachers.has(String(id))).length);
      const setById = new Map(sets.map((x) => [String(x.id), x.name]));
      // inline verdict chip + score per problem for caller
      const items = probs.map((x) => {
        let best = null;
        let tries = 0;
        let score = 0;
        if (me) {
          const subs = store.query('submits', (s) => String(s.problemId) === String(x.id) && String(s.userId) === String(me.id) && !s.sampleOnly);
          tries = subs.length;
          for (const s of subs) {
            score = Math.max(score, Number(s.points || 0));
            if (!best && isAccepted(s.status)) best = s.status;
          }
          if (!best && subs.length) best = subs[subs.length - 1].status;
        }
        const solvesPct = Math.round((((acceptedBy.get(String(x.id)) || new Set()).size) / memberDenom) * 100);
        const setterUser = (x.setterId || x.by) ? store.get('users', x.setterId || x.by) : null;
        const row = enrichProblemWithDeadline(x, c);
        // Authoring programs are secrets: never include checker/validator/reference
        // source in a student-facing problem list.
        if (!canManage) {
          for (const f of ['checkerCode', 'checkerLang', 'checkerFile', 'validator', 'validatorLang', 'validatorCode', 'validatorFile', 'referenceCode', 'referenceLang']) delete row[f];
        }
        return {
          ...row,
          _best: best, _tries: tries, _score: score, solvesPct,
          alias: (x.aliasLetters || {})[String(c.id)] || x.code || null,
          setter: setterUser ? setterUser.login : null,
          group: setById.get(String(x.setId)) || null,
        };
      });
      const dl = contestDeadlines(c);
      const exam = normalizeExam(c);
      const shuffled = Boolean(!canManage && me && exam.shuffle);
      if (shuffled) {
        const hash = (s) => {
          let h = 2166136261;
          for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
          return h >>> 0;
        };
        items.sort((a, b) => hash(`${c.id}:${me.id}:${a.id}`) - hash(`${c.id}:${me.id}:${b.id}`));
      }
      if (me && statusF === 'solved') return send(res, 200, { sets, items: items.filter((x) => x._best && isAccepted(x._best)), deadlinePolicy: dl.policy, shuffle: shuffled });
      if (me && statusF === 'todo') return send(res, 200, { sets, items: items.filter((x) => !x._best || !isAccepted(x._best)), deadlinePolicy: dl.policy, shuffle: shuffled });
      return send(res, 200, { sets, items, deadlinePolicy: dl.policy, shuffle: shuffled });
    }
    if (act === 'problems' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return true;
      const role = contestRole(c, me.id);
      if (!['contest_admin', 'superadmin'].includes(role)) return send(res, 403, { error: { code: 'FORBIDDEN', message: 'Admins only.', hint: '' } });
      const b = await readBody(req);
      if (!b.name) return send(res, 422, { error: { code: 'NAME', message: 'Problem name required.', hint: '' } });
      const pr = store.insert('problems', {
        contestId: c.id, setId: b.setId || null, code: b.code || 'A', name: b.name,
        setterId: me.id,
        statementMd: b.statementMd || '', statementHtml: b.statementHtml || '',
        samples: b.samples || [], limits: b.limits || { timeMs: 1000, memoryMb: 256, stackMb: 64, perLang: {} },
        checker: b.checker || null, checkerLang: b.checkerLang || null, checkerCode: b.checkerCode || null, checkerTolerance: b.checkerTolerance ?? null,
        visibility: b.visibility || 'draft', tags: b.tags || [], difficulty: b.difficulty || 1,
        pdfBadge: b.pdfBadge || 'HTML', version: 1, aliasLetters: {}, deadlineAt: b.deadlineAt || null,
      });
      audit(me.id, 'problem.create', `problem:${pr.id}`, {});
      return send(res, 201, pr);
    }
    if (act === 'rankings/live' && m === 'GET') {
      const me = authUser(req);
      if (!canReadContest(c, me)) return send(res, 403, { error: { code: 'NOT_MEMBER', message: 'Contest membership required.', hint: 'Apply to the contest or ask the teacher.' } });
      if (boardModeOf(c) === 'hidden' && !canManageContest(me, c)) {
        return send(res, 403, { error: { code: 'BOARD_HIDDEN', message: 'The scoreboard is hidden during this contest.', hint: 'It becomes visible after the contest.' } });
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      let iv = null;
      const snap = () => {
        try {
          // Re-read on every tick: a mid-stream hide/me-only change must apply.
          const cur = store.get('contests', c.id) || c;
          if (!canReadContest(cur, me)) {
            res.write(`data: ${JSON.stringify({ error: { code: 'NOT_MEMBER', message: 'Contest membership required.' } })}\n\n`);
            res.end();
            clearInterval(iv);
            return;
          }
          if (boardModeOf(cur) === 'hidden' && !canManageContest(me, cur)) {
            res.write(`data: ${JSON.stringify({ error: { code: 'BOARD_HIDDEN', message: 'The scoreboard is hidden during this contest.' } })}\n\n`);
            res.end();
            clearInterval(iv);
            return;
          }
          const body = filterBoard(cur, me, buildRanking(cur, me, {
            mode: u.searchParams.get('mode'),
            unfrozen: u.searchParams.get('unfrozen') === '1',
          }));
          res.write(`data: ${JSON.stringify({ at: Date.now(), rows: body.rows, problems: body.problems, mode: body.mode, freezeAt: body.freezeAt, unfreezeAt: body.unfreezeAt, frozen: body.frozen, me: body.me })}\n\n`);
        } catch { /* client gone */ }
      };
      snap();
      iv = setInterval(snap, LIVE_INTERVAL_MS);
      req.on('close', () => clearInterval(iv));
      return true;
    }
    if ((act === 'ranking' || act === 'ranking.csv') && m === 'GET') {
      const me = authUser(req);
      if (!canReadContest(c, me)) return send(res, 403, { error: { code: 'NOT_MEMBER', message: 'Contest membership required.', hint: 'Apply to the contest or ask the teacher.' } });
      if (boardModeOf(c) === 'hidden' && !canManageContest(me, c)) {
        return send(res, 403, { error: { code: 'BOARD_HIDDEN', message: 'The scoreboard is hidden during this contest.', hint: 'It becomes visible after the contest.' } });
      }
      const body = filterBoard(c, me, buildRanking(c, me, {
        mode: u.searchParams.get('mode'),
        unfrozen: u.searchParams.get('unfrozen') === '1',
      }));
      if (act === 'ranking') return send(res, 200, body);
      const cellText = (cell) => (cell == null ? '' : typeof cell === 'object' ? String(cell.text ?? cell.points ?? '') : String(cell));
      const head = ['rank', 'contestant', ...body.problems.map((p2) => p2.code || `P${p2.id}`), 'total'];
      const lines = [head.join(',')];
      (body.rows || []).forEach((row, i) => {
        lines.push([
          row.rank ?? (i + 1),
          csvCell(row.name || row.contestantId || ''),
          ...body.problems.map((p2) => csvCell(cellText((row.cells || {})[p2.id]))),
          row.total ?? row.points ?? row.solved ?? '',
        ].join(','));
      });
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ranking-contest-${c.id}.csv"`, 'Access-Control-Allow-Origin': '*' });
      res.end(lines.join('\n'));
      return true;
    }
    if (act === 'grade' && m === 'GET') {
      const me = needAuth(req, res);
      if (!me) return true;
      if (!canReadContest(c, me)) return send(res, 403, { error: { code: 'NOT_MEMBER', message: 'Contest membership required.', hint: 'Apply to the contest or ask the teacher.' } });
      const uid = u.searchParams.get('user') || me.id;
      if (String(uid) !== String(me.id) && !canManageContest(me, c) && !sharesTeam(c, me.id, uid)) return forbid(res);
      if (!canManageContest(me, c) && !releaseState(c).released) {
        return send(res, 403, { error: { code: 'NOT_RELEASED', message: 'Grades are not released yet.', hint: 'Your teacher will publish them.' } });
      }
      const probs = store.query('problems', (x) => String(x.contestId) === String(c.id));
      const subs = store.query('submits', (s) => String(s.contestId) === String(c.id) && !s.sampleOnly);
      const { out, deadlines, policy, submittedAt, scale } = computeRowGrade(c, probs, uid, subs);
      return send(res, 200, { ...out, deadlines, deadlinePolicy: policy, submittedAt, scale });
    }
    if (act === 'grade.ics' && m === 'GET') {
      const me = authUser(req);
      if (!canReadContest(c, me)) return send(res, 403, { error: { code: 'NOT_MEMBER', message: 'Contest membership required.', hint: 'Apply to the contest or ask the teacher.' } });
      const dl = contestDeadlines(c);
      const probs = store.query('problems', (x) => String(x.contestId) === String(c.id));
      const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SatoriV2//grade//EN'];
      const stampOf = (at) => new Date(at).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      const ev = (uid, at, summary, desc) => {
        lines.push('BEGIN:VEVENT', `UID:${uid}@satori`, `DTSTAMP:${stampOf(at)}`, `DTSTART:${stampOf(at)}`, `SUMMARY:${icsText(summary)}`);
        if (desc) lines.push(`DESCRIPTION:${icsText(desc)}`);
        lines.push('END:VEVENT');
      };
      for (const pr of probs) {
        const at = dl.deadlines[pr.id] || pr.deadlineAt || ((c.settings || {}).defaultDeadline) || resolveContestEnd(c);
        if (!at) continue;
        ev(`problem-${pr.id}`, at, `${c.name} — ${pr.code} ${pr.name} due`, dl.policy.enabled ? `Late policy ${dl.policy.lateMode} ${dl.policy.penaltyKind} ${dl.policy.penaltyValue}` : 'Default deadline');
      }
      if (c.startAt) ev('contest-start', c.startAt, `${c.name} — start`, '');
      const contestEnd = resolveContestEnd(c);
      if (contestEnd) ev('contest-end', contestEnd, `${c.name} — end`, '');
      if (c.freezeAt) ev('contest-freeze', c.freezeAt, `${c.name} — scoreboard freeze`, '');
      lines.push('END:VCALENDAR');
      return sendText(res, 200, lines.join('\r\n') + '\r\n', 'text/calendar');
    }
    if (act === 'deadlines/bulk-extend' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return true;
      const role = contestRole(c, me.id);
      if (!['contest_admin', 'superadmin'].includes(role)) return send(res, 403, { error: { code: 'FORBIDDEN', message: 'Admins only.', hint: '' } });
      const b = await readBody(req);
      const days = Number(b.days || 0);
      if (!Number.isFinite(days) || days === 0) return send(res, 422, { error: { code: 'DAYS', message: 'days (+/-) required.', hint: 'e.g. {days: 7}.' } });
      const ms = days * 86400000;
      const shift = (iso) => (iso ? new Date(new Date(iso).getTime() + ms).toISOString() : null);
      const settings = { ...(c.settings || {}) };
      if (settings.defaultDeadline) settings.defaultDeadline = shift(settings.defaultDeadline);
      const patch = { settings };
      if (c.startAt) patch.startAt = shift(c.startAt);
      const existingEnd = resolveContestEnd(c);
      if (existingEnd) patch.endAt = shift(existingEnd);
      if (c.freezeAt) patch.freezeAt = shift(c.freezeAt);
      store.update('contests', c.id, patch);
      let shifted = 0;
      for (const ps of store.query('problemSets', (x) => String(x.contestId) === String(c.id))) {
        if (!ps.deadlineAt) continue;
        store.update('problemSets', ps.id, { deadlineAt: shift(ps.deadlineAt) });
        shifted += 1;
      }
      for (const pr of store.query('problems', (x) => String(x.contestId) === String(c.id))) {
        if (!pr.deadlineAt) continue;
        store.update('problems', pr.id, { deadlineAt: shift(pr.deadlineAt) });
        shifted += 1;
      }
      audit(me.id, 'contest.bulk-extend', `contest:${c.id}`, { days, shifted });
      return send(res, 200, { ok: true, shifted, days, startAt: patch.startAt || c.startAt || null, endAt: patch.endAt || c.endAt || null });
    }
    if (act === 'audit' && m === 'GET') {
      const me = needAuth(req, res);
      if (!me) return true;
      if (!canManageContest(me, c)) return forbid(res);
      const actorQ = String(u.searchParams.get('actor') || '').toLowerCase();
      const actionQ = String(u.searchParams.get('action') || '').toLowerCase();
      const targetQ = String(u.searchParams.get('target') || '').toLowerCase();
      const users = new Map(store.all('users').map((x) => [String(x.id), x.login]));
      let items = store.query('audit', (a) => String(a.target).includes(String(c.id)));
      if (actorQ) items = items.filter((a) => String(a.actorLogin || users.get(String(a.actorId)) || '').toLowerCase().includes(actorQ) || String(a.actorId) === actorQ);
      if (actionQ) items = items.filter((a) => String(a.action || '').toLowerCase().includes(actionQ));
      if (targetQ) items = items.filter((a) => String(a.target || '').toLowerCase().includes(targetQ));
      items = items.map((a) => ({ ...a, actorLogin: a.actorLogin || users.get(String(a.actorId)) || null }));
      return send(res, 200, { items: items.slice(-200) });
    }
  }

  // contest-scoped member management
  mt = p.match(/^\/api\/contests\/(\d+)\/members\/(\d+)$/);
  if (mt && m === 'DELETE') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const uid = mt[2];
    const wasAdmin = (c.admins || []).map(String).includes(String(uid));
    const members = (c.members || []).filter((x) => String(x) !== String(uid));
    const pending = (c.pending || []).filter((x) => String(x) !== String(uid));
    const admins = (c.admins || []).filter((x) => String(x) !== String(uid));
    const roles = { ...(c.roles || {}) };
    delete roles[String(uid)];
    store.update('contests', c.id, { members, pending, admins, roles });
    audit(me.id, 'contest.member.remove', `contest:${c.id}`, { uid, revokedAdmin: wasAdmin });
    return send(res, 200, { ok: true, members: members.length, revokedAdmin: wasAdmin });
  }

  // single contest get/patch/delete (DELETE: archive-first, second call purges)
  mt = p.match(/^\/api\/contests\/(\d+)$/);
  if (mt && (m === 'GET' || m === 'PATCH' || m === 'DELETE')) {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Not found.', hint: '' } });
    const viewer = authUser(req);
    if (m === 'GET') {
      // Hidden contests are indistinguishable from missing ones outside the member set.
      if (!canListContest(c, viewer)) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Not found.', hint: '' } });
      return send(res, 200, contestView(c, viewer));
    }
    const me = needAuth(req, res);
    if (!me) return true;
    if (m === 'DELETE') {
      if (!canManageContest(me, c)) return forbid(res);
      if (!c.archived && c.lifecycle !== 'archived') {
        store.update('contests', c.id, { archived: true });
        audit(me.id, 'contest.archive', `contest:${c.id}`, {});
        return send(res, 200, { ok: true, archived: true, hint: 'Call DELETE again to purge permanently.' });
      }
      for (const pr of store.query('problems', (x) => String(x.contestId) === String(c.id))) {
        for (const g of store.query('testGroups', (x) => String(x.problemId) === String(pr.id))) {
          for (const tc of store.query('testCases', (x) => String(x.groupId) === String(g.id))) store.remove('testCases', tc.id);
          store.remove('testGroups', g.id);
        }
        store.remove('problems', pr.id);
      }
      for (const ps of store.query('problemSets', (x) => String(x.contestId) === String(c.id))) store.remove('problemSets', ps.id);
      for (const t of store.query('teams', (x) => String(x.contestId) === String(c.id))) store.remove('teams', t.id);
      for (const col of ['news', 'subpages', 'clarifications']) {
        for (const r2 of store.query(col, (x) => String(x.contestId) === String(c.id))) store.remove(col, r2.id);
      }
      store.remove('contests', c.id);
      audit(me.id, 'contest.delete', `contest:${c.id}`, {});
      return send(res, 200, { ok: true, deleted: true });
    }
    const role = contestRole(c, me.id);
    if (!['contest_admin', 'superadmin'].includes(role)) return send(res, 403, { error: { code: 'FORBIDDEN', message: 'Admins only.', hint: '' } });
    const b = await readBody(req);
    const patch = normalizeLifecycle(normalizeContestTime(b));
    if (!patch) {
      return send(res, 422, {
        error: {
          code: 'INVALID_LIFECYCLE',
          message: `Lifecycle must be one of: ${LIFECYCLES.join(', ')}.`,
          hint: 'Send a lifecycle value or omit the field.',
        },
      });
    }
    if (Object.prototype.hasOwnProperty.call(b, 'visibility')) {
      const visibility = normalizeContestVisibility(b.visibility);
      if (!visibility) {
        return send(res, 422, {
          error: { code: 'INVALID_VISIBILITY', message: 'Visibility must be public, members or hidden.', hint: 'Omit the field to keep the current value.' },
        });
      }
      patch.visibility = visibility;
    }
    const out = store.update('contests', c.id, patch);
    audit(me.id, 'contest.update', `contest:${c.id}`, patch);
    return send(res, 200, out);
  }
  return false;
}

module.exports = { handle };
