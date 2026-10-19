// Satori V2 — authentication, contest roles, board modes, and public submit projection.
'use strict';
const { store } = require('./store');
const { verifyJwt } = require('./crypto');
const { t } = require('./i18n');
const { send } = require('./http');

function authUser(req) {
  const h = req.headers.authorization || '';
  const p = verifyJwt(h);
  if (!p) return null;
  const u = store.get('users', p.sub);
  if (!u) return null;
  const sess = store.query('sessions', (s) => s.jti === p.jti && !s.revoked)[0];
  if (!sess) return null;
  return u;
}
function tokenClaims(req) {
  return verifyJwt(req.headers.authorization || '');
}
function audit(actorId, action, target, meta) {
  store.insert('audit', { actorId, action, target, at: new Date().toISOString(), meta: meta || {} });
}

function hasId(arr, id) { return (arr || []).map(String).includes(String(id)); }
function contestRole(contest, userId) {
  if (!contest || userId == null) return 'none';
  const u = store.get('users', userId);
  if (u && (u.rolesGlobal || []).includes('superadmin')) return 'superadmin';
  const explicit = (contest.roles || {})[String(userId)];
  if (explicit === 'teacher' || explicit === 'jury') return 'contest_admin';
  if (hasId(contest.admins, userId)) return 'contest_admin';
  if (hasId(contest.members, userId)) return 'participant';
  if (hasId(contest.pending, userId)) return 'pending';
  return 'none';
}
// Role shown by the members API. Legacy admins (no roles map) are labelled teacher.
function memberRole(contest, userId) {
  if (!contest || userId == null) return 'none';
  const key = String(userId);
  const explicit = (contest.roles || {})[key];
  if (explicit === 'participant' || explicit === 'teacher' || explicit === 'jury') return explicit;
  if (hasId(contest.admins, userId)) return 'teacher';
  if (hasId(contest.members, userId)) return 'participant';
  if (hasId(contest.pending, userId)) return 'pending';
  return 'none';
}
function isTeacher(contest, userId) {
  return memberRole(contest, userId) === 'teacher';
}
function teacherIds(contest) {
  const uids = new Set();
  for (const id of (contest && contest.members) || []) if (memberRole(contest, id) === 'teacher') uids.add(String(id));
  for (const id of (contest && contest.admins) || []) uids.add(String(id));
  for (const id of Object.keys((contest && contest.roles) || {})) if (contest.roles[id] === 'teacher') uids.add(String(id));
  return uids;
}
function needAuth(req, res) {
  const u = authUser(req);
  if (!u) { send(res, 401, { error: { code: 'AUTH', message: 'Login required.', hint: 'POST /api/auth/token.' } }); return null; }
  return u;
}
function forbid(res) {
  return send(res, 403, { error: { code: 'FORBIDDEN', message: 'Contest admins only.', hint: 'Ask a contest admin for access.' } });
}
function canManageContest(me, contest) {
  if (!me || !contest) return false;
  const role = contestRole(contest, me.id);
  return role === 'contest_admin' || role === 'superadmin';
}
function canManageProblem(me, problem) {
  if (!me || !problem || problem.contestId == null) return false;
  return canManageContest(me, store.get('contests', problem.contestId));
}
function contestVisibility(contest) {
  const v = String((contest && contest.visibility) || '').toLowerCase();
  if (v === 'private' || v === 'exam') return v;
  if (String((contest && contest.mode) || '').toUpperCase() === 'EXAM') return 'exam';
  return 'public';
}
function isContestMember(contest, userId) {
  if (!contest || userId == null) return false;
  return hasId(contest.members, userId) || hasId(contest.admins, userId) || Boolean((contest.roles || {})[String(userId)]);
}
// A8/D4: private and exam contests are unreadable to non-members, not just unsubmittable.
function canReadContest(contest, me) {
  if (!contest) return true;
  if (contestVisibility(contest) === 'public') return true;
  if (canManageContest(me, contest)) return true;
  return Boolean(me) && isContestMember(contest, me.id);
}
function sharesTeam(contest, aId, bId) {
  if (!contest || aId == null || bId == null) return false;
  const teams = store.query('teams', (t) => String(t.contestId) === String(contest.id));
  return teams.some((t) => {
    const ids = (t.members || t.memberIds || []).map(String);
    return ids.includes(String(aId)) && ids.includes(String(bId));
  });
}
function teamHasMember(team, userId) {
  if (!team || userId == null) return false;
  if ((team.members || []).map(String).includes(String(userId))) return true;
  if ((team.memberIds || []).map(String).includes(String(userId))) return true;
  return store.query('teamMembers', (r) => String(r.teamId) === String(team.id) && String(r.userId) === String(userId)).length > 0;
}

// Board modes: everyone | hidden | me-only. Server-side gates (A10).
function boardModeOf(contest) {
  const board = (contest && contest.settings && contest.settings.board) || {};
  const mode = String(board.mode || 'everyone').toLowerCase();
  return ['hidden', 'me-only'].includes(mode) ? mode : 'everyone';
}
function isMyContestantRow(row, contest, me) {
  if (!row || !me) return false;
  if (String(row.contestantId) === `u:${me.id}`) return true;
  if (String(row.contestantId).startsWith('t:')) {
    const team = store.get('teams', String(row.contestantId).slice(2));
    if (team && teamHasMember(team, me.id)) return true;
  }
  return String(row.name || '') === String(me.login || '');
}
function isTeacherRow(row, contest) {
  const teachers = teacherIds(contest);
  const cid = String((row && row.contestantId) || '');
  if (cid.startsWith('u:')) return teachers.has(cid.slice(2));
  if (cid.startsWith('t:')) {
    const team = store.get('teams', cid.slice(2));
    if (!team) return false;
    return (team.members || team.memberIds || []).some((id) => teachers.has(String(id)));
  }
  return false;
}
function submitVisibleOnBoard(contest, me, submit) {
  if (!contest) return true;
  const mode = boardModeOf(contest);
  if (mode === 'everyone') return true;
  if (canManageContest(me, contest)) return true;
  if (mode === 'hidden') return false;
  return Boolean(me) && String(submit.userId) === String(me.id);
}

function reqLang(req, url) {
  const q = url && url.searchParams.get('lang');
  if (q === 'pl' || q === 'en') return q;
  const first = String(req.headers['accept-language'] || '').split(',')[0].trim().toLowerCase();
  return first.startsWith('pl') ? 'pl' : 'en';
}
function localizeRow(row, lang) {
  if (!row || !row.explainKey) return row;
  const { explainKey, explainArgs, ...rest } = row;
  return { ...rest, explain: t(lang, explainKey, ...(explainArgs || [])) };
}
// Non-owners get no code, compile log, per-test detail, expected/got or full results.
const PUBLIC_SUBMIT_FIELDS = [
  'id', 'contestId', 'problemId', 'userId', 'teamId', 'lang', 'filename',
  'status', 'testsTotal', 'testsDone', 'points', 'cpuMs', 'sampleOnly',
  'isLate', 'lateUnits', 'createdAt', 'judgedAt', 'simulated', 'explainKey', 'explainArgs',
];
function publicSubmitView(s) {
  const out = {};
  for (const f of PUBLIC_SUBMIT_FIELDS) if (s[f] !== undefined) out[f] = s[f];
  return out;
}
function submitView(s, me) {
  const contest = s.contestId ? store.get('contests', s.contestId) : null;
  const problem = s.problemId ? store.get('problems', s.problemId) : null;
  const limits = (problem && problem.limits) || {};
  const team = s.teamId ? store.get('teams', s.teamId) : null;
  const members = team
    ? (team.members || team.memberIds || []).map((id) => { const u = store.get('users', id); return u ? u.login : null; }).filter(Boolean)
    : undefined;
  const decorate = (o) => {
    const out = { ...o, limitMs: limits.timeMs ?? null, limitMb: limits.memoryMb ?? null };
    if (members) out.members = members;
    return out;
  };
  if (contest && canManageContest(me, contest)) return decorate(s);
  const teamMember = me != null && team && teamHasMember(team, me.id);
  const isOwner = me != null && (String(s.userId) === String(me.id) || teamMember);
  if (!isOwner) return decorate(publicSubmitView(s));
  const vis = (contest && contest.settings && contest.settings.verdictVisibility) || 'all';
  const running = Boolean(contest) && ['draft', 'registration', 'running'].includes(contest.lifecycle);
  if (running && vis !== 'all') { const { perTestFull, ...rest } = s; return decorate(rest); }
  const fail = (s.perTest || []).find((x) => x.expected != null || x.got != null);
  return decorate({
    ...s,
    expected: fail && fail.expected != null ? fail.expected : null,
    got: fail && fail.got != null ? fail.got : null,
  });
}

module.exports = {
  authUser, tokenClaims, audit, contestRole, memberRole, isTeacher, teacherIds,
  needAuth, forbid, canManageContest, canManageProblem, sharesTeam, teamHasMember,
  contestVisibility, isContestMember, canReadContest,
  boardModeOf, isMyContestantRow, isTeacherRow, submitVisibleOnBoard,
  reqLang, localizeRow, submitView,
};
