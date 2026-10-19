// Satori V2 — contest lifecycle, members, teams, problems, ranking, and deadlines.
'use strict';
const { store } = require('../lib/store');
const { send, sendText, readBody } = require('../lib/http');
const {
  authUser, needAuth, forbid, audit, contestRole, memberRole, canManageContest,
  sharesTeam, boardModeOf, isMyContestantRow, isTeacherRow, teacherIds, canReadContest,
} = require('../lib/authz');
const { contestDeadlines, enrichProblemWithDeadline, computeLabsGrade, buildRanking, csvCell, icsText, normalizeExam } = require('../lib/contestAccess');
const { normalizeContestTime, resolveContestEnd } = require('../lib/contestTime');
const { isAccepted } = require('../lib/ranking');
const comms = require('./comms');

const LIVE_INTERVAL_MS = Number(process.env.SATORI_LIVE_INTERVAL_MS || 15000);

// A11: public contests never expose member/admin IDs or exam IP/time settings.
function publicContestView(c) {
  const { members, pending, admins, settings, ...rest } = c;
  const safeSettings = { ...(settings || {}) };
  delete safeSettings.exam;
  delete safeSettings.ips;
  delete safeSettings.tokens;
  return { ...rest, settings: safeSettings, memberCount: (members || []).length };
}
function contestView(c, me) {
  return canManageContest(me, c) ? c : publicContestView(c);
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

async function handle(req, res, url, p, m) {
  const u = url;
  // Communications were extracted to routes/comms.js; delegate before contest routes.
  if (/^\/api\/contests\/\d+\/(clarifications|news|subpages)(\/|$)/.test(p)) {
    return comms.handle(req, res, url, p, m);
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
    if (q) items = items.filter((c) => (c.name + ' ' + (c.description || '')).toLowerCase().includes(q));
    const has = (arr, id) => (arr || []).map(String).includes(String(id));
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
    const time = normalizeContestTime(b);
    const c = store.insert('contests', {
      name: b.name, description: b.description || '', mode: b.mode || 'ICPC',
      lifecycle: 'draft', registration: b.registration || 'approval', archived: false,
      startAt: time.startAt || null, endAt: time.endAt || null, freezeAt: time.freezeAt || null,
      scoreboardMode: b.scoreboardMode || null, teamMode: Boolean(b.teamMode),
      settings: b.settings || { penaltyMin: 20, verdictVisibility: 'all', allowSampleRun: true, deadlinePolicy: { enabled: false, lateMode: 'soft', penaltyKind: 'perDay', penaltyValue: 5, graceMin: 0 } },
      members: [], pending: [], admins: [me.id], template: b.template || null,
    });
    audit(me.id, 'contest.create', `contest:${c.id}`, {});
    return send(res, 201, c);
  }

  // contest sub-routes
  let mt = p.match(/^\/api\/contests\/(\d+)\/(apply|members|members\/approve|members\/csv|duplicate|teams|problems|rankings\/live|ranking|ranking\.csv|grade|grade\.ics|deadlines\/bulk-extend|audit)$/);
  if (mt && (m === 'GET' || m === 'POST')) {
    const cid = mt[1];
    const act = mt[2];
    const c = store.get('contests', cid);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: 'Check /api/contests.' } });
    if (act === 'apply' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return true;
      if ((c.members || []).map(String).includes(String(me.id))) return send(res, 200, { ok: true, state: 'joined' });
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
    if (act === 'teams' && m === 'GET') return send(res, 200, { items: store.query('teams', (x) => String(x.contestId) === String(c.id)) });
    if (act === 'teams' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return true;
      const b = await readBody(req);
      if (!b.name) return send(res, 422, { error: { code: 'NAME', message: 'Team name required.', hint: '' } });
      const teamMembers = b.members || b.memberIds || [me.id];
      const tm = store.insert('teams', { name: b.name, contestId: c.id, members: teamMembers, memberIds: teamMembers, loginIdentity: b.loginIdentity || b.name, scoreboardName: b.name });
      return send(res, 201, tm);
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
        return {
          ...enrichProblemWithDeadline(x, c),
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
        visibility: b.visibility || 'draft', tags: b.tags || [], difficulty: b.difficulty || 1,
        pdfBadge: b.pdfBadge || 'HTML', version: 1, aliasLetters: {}, deadlineAt: b.deadlineAt || null,
      });
      audit(me.id, 'problem.create', `problem:${pr.id}`, {});
      return send(res, 201, pr);
    }
    if (act === 'rankings/live' && m === 'GET') {
      const me = authUser(req);
      if (boardModeOf(c) === 'hidden' && !canManageContest(me, c)) {
        return send(res, 403, { error: { code: 'BOARD_HIDDEN', message: 'The scoreboard is hidden during this contest.', hint: 'It becomes visible after the contest.' } });
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      let iv = null;
      const snap = () => {
        try {
          // Re-read on every tick: a mid-stream hide/me-only change must apply.
          const cur = store.get('contests', c.id) || c;
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
      const uid = u.searchParams.get('user') || me.id;
      if (String(uid) !== String(me.id) && !canManageContest(me, c) && !sharesTeam(c, me.id, uid)) return forbid(res);
      const probs = store.query('problems', (x) => String(x.contestId) === String(c.id));
      const { out, deadlines, policy, submittedAt } = computeLabsGrade(c, probs, (s) => String(s.userId) === String(uid));
      return send(res, 200, { ...out, deadlines, deadlinePolicy: policy, submittedAt });
    }
    if (act === 'grade.ics' && m === 'GET') {
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
      return send(res, 200, { items: store.query('audit', (a) => String(a.target).includes(String(c.id))).slice(-200) });
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
    if (m === 'GET') return send(res, 200, contestView(c, authUser(req)));
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
    const out = store.update('contests', c.id, normalizeContestTime(b));
    audit(me.id, 'contest.update', `contest:${c.id}`, b);
    return send(res, 200, out);
  }
  return false;
}

module.exports = { handle };
