// Satori V2 — authentication, contest roles, and public submit projection.
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

function contestRole(contest, userId) {
  if (!contest || userId == null) return 'none';
  const u = store.get('users', userId);
  if (u && (u.rolesGlobal || []).includes('superadmin')) return 'superadmin';
  if ((contest.admins || []).map(String).includes(String(userId))) return 'contest_admin';
  if ((contest.members || []).map(String).includes(String(userId))) return 'participant';
  if ((contest.pending || []).map(String).includes(String(userId))) return 'pending';
  return 'none';
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
function sharesTeam(contest, aId, bId) {
  if (!contest || aId == null || bId == null) return false;
  const teams = store.query('teams', (t) => String(t.contestId) === String(contest.id));
  return teams.some((t) => {
    const ids = (t.memberIds || []).map(String);
    return ids.includes(String(aId)) && ids.includes(String(bId));
  });
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
function submitView(s, me) {
  const contest = s.contestId ? store.get('contests', s.contestId) : null;
  const problem = s.problemId ? store.get('problems', s.problemId) : null;
  const limits = (problem && problem.limits) || {};
  const team = s.teamId ? store.get('teams', s.teamId) : null;
  const members = team
    ? (team.members || []).map((id) => { const u = store.get('users', id); return u ? u.login : null; }).filter(Boolean)
    : undefined;
  const decorate = (o) => {
    const out = { ...o, limitMs: limits.timeMs ?? null, limitMb: limits.memoryMb ?? null };
    if (members) out.members = members;
    return out;
  };
  if (contest && canManageContest(me, contest)) return decorate(s);
  const teamMember = me != null && team && (team.members || []).map(String).includes(String(me.id));
  const isOwner = me != null && (String(s.userId) === String(me.id) || teamMember);
  if (!isOwner) { const { code, perTestFull, ...rest } = s; return decorate(rest); }
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

module.exports = { authUser, tokenClaims, audit, contestRole, needAuth, forbid, canManageContest, canManageProblem, sharesTeam, reqLang, localizeRow, submitView };
