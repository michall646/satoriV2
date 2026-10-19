// Satori V2 — contest lifecycle, members, teams, problems, ranking, and deadlines.
'use strict';
const { store } = require('../lib/store');
const { send, sendText, readBody, rateLimited } = require('../lib/http');
const { authUser, needAuth, forbid, audit, contestRole, canManageContest, sharesTeam } = require('../lib/authz');
const { contestDeadlines, enrichProblemWithDeadline, computeLabsGrade, buildRanking, csvCell, icsText } = require('../lib/contestAccess');
const { isAccepted } = require('../lib/ranking');

async function handle(req, res, url, p, m) {
  const u = url;
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
    return send(res, 200, { items, total: items.length });
  }
  if (p === '/api/contests' && m === 'POST') {
    const me = needAuth(req, res);
    if (!me) return true;
    const b = await readBody(req);
    if (!b.name) return send(res, 422, { error: { code: 'NAME', message: 'Name required.', hint: 'e.g. UZI, 2026.' } });
    const c = store.insert('contests', {
      name: b.name, description: b.description || '', mode: b.mode || 'ICPC',
      lifecycle: 'draft', registration: b.registration || 'approval', archived: false,
      startAt: b.startAt || null, endAt: b.endAt || null, freezeAt: b.freezeAt || null,
      settings: b.settings || { penaltyMin: 20, verdictVisibility: 'all', allowSampleRun: true, deadlinePolicy: { enabled: false, lateMode: 'soft', penaltyKind: 'perDay', penaltyValue: 5, graceMin: 0 } },
      members: [], pending: [], admins: [me.id], template: b.template || null,
    });
    audit(me.id, 'contest.create', `contest:${c.id}`, {});
    return send(res, 201, c);
  }

  // contest sub-routes
  let mt = p.match(/^\/api\/contests\/(\d+)\/(apply|members|members\/approve|members\/csv|duplicate|teams|problems|rankings\/live|ranking|ranking\.csv|grade|grade\.ics|deadlines\/bulk-extend|audit|clarifications|news|subpages)$/);
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
      const users = (c.members || []).map((id) => { const x = store.get('users', id); return x ? { id: x.id, login: x.login } : { id }; });
      const pending = (c.pending || []).map((id) => { const x = store.get('users', id); return x ? { id: x.id, login: x.login } : { id }; });
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
      if (wanted === 'participant') {
        if ((c.members || []).map(String).includes(String(u.id))) return send(res, 200, { ok: true, already: true, role: wanted, userId: u.id });
        store.update('contests', c.id, {
          members: [...(c.members || []), u.id],
          pending: (c.pending || []).filter((x) => String(x) !== String(u.id)),
        });
        audit(me.id, 'contest.member.add', `contest:${c.id}`, { login, role: wanted });
        return send(res, 201, { ok: true, role: wanted, userId: u.id });
      }
      if ((c.admins || []).map(String).includes(String(u.id))) return send(res, 200, { ok: true, already: true, role: wanted, userId: u.id });
      store.update('contests', c.id, {
        admins: [...(c.admins || []), u.id],
        members: [...(c.members || []).filter((x) => String(x) !== String(u.id)), u.id],
        pending: (c.pending || []).filter((x) => String(x) !== String(u.id)),
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
      const tm = store.insert('teams', { name: b.name, contestId: c.id, memberIds: b.memberIds || [me.id], loginIdentity: b.loginIdentity || b.name, scoreboardName: b.name });
      return send(res, 201, tm);
    }
    if (act === 'problems' && m === 'GET') {
      const q = (u.searchParams.get('q') || '').toLowerCase();
      const tag = u.searchParams.get('tag') || '';
      const statusF = u.searchParams.get('status') || 'all';
      const me = authUser(req);
      const sets = store.query('problemSets', (x) => String(x.contestId) === String(c.id)).sort((a, b) => (a.order || 0) - (b.order || 0));
      let probs = store.query('problems', (x) => String(x.contestId) === String(c.id));
      const canManage = canManageContest(me, c);
      if (!canManage) probs = probs.filter((x) => (x.visibility || 'visible') === 'visible');
      if (q) probs = probs.filter((x) => (x.code + ' ' + x.name).toLowerCase().includes(q));
      if (tag) probs = probs.filter((x) => (x.tags || []).includes(tag));
      // solvesPct: unique accepted solvers / contest members (real difficulty signal)
      const acceptedBy = new Map();
      for (const s of store.query('submits', (x) => String(x.contestId) === String(c.id) && !x.sampleOnly)) {
        if (!isAccepted(s.status)) continue;
        const k = String(s.problemId);
        if (!acceptedBy.has(k)) acceptedBy.set(k, new Set());
        acceptedBy.get(k).add(String(s.userId));
      }
      const memberDenom = Math.max(1, (c.members || []).length);
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
            if (isAccepted(s.status)) { best = s.status; break; }
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
      if (me && statusF === 'solved') return send(res, 200, { sets, items: items.filter((x) => x._best && isAccepted(x._best)), deadlinePolicy: dl.policy });
      if (me && statusF === 'todo') return send(res, 200, { sets, items: items.filter((x) => !x._best || !isAccepted(x._best)), deadlinePolicy: dl.policy });
      return send(res, 200, { sets, items, deadlinePolicy: dl.policy });
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
      const boardMode = ((c.settings || {}).board || {}).mode || 'everyone';
      if (boardMode === 'hidden' && !canManageContest(me, c)) {
        return send(res, 403, { error: { code: 'BOARD_HIDDEN', message: 'The scoreboard is hidden during this contest.', hint: 'It becomes visible after the contest.' } });
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      const snap = () => {
        try {
          const body = buildRanking(c, me);
          res.write(`data: ${JSON.stringify({ at: Date.now(), rows: body.rows, problems: body.problems, mode: body.mode, freezeAt: body.freezeAt, unfreezeAt: body.unfreezeAt, me: body.me })}\n\n`);
        } catch { /* client gone */ }
      };
      snap();
      const iv = setInterval(snap, 15000);
      req.on('close', () => clearInterval(iv));
      return true;
    }
    if ((act === 'ranking' || act === 'ranking.csv') && m === 'GET') {
      const me = authUser(req);
      const boardMode = ((c.settings || {}).board || {}).mode || 'everyone';
      if (boardMode === 'hidden' && !canManageContest(me, c)) {
        return send(res, 403, { error: { code: 'BOARD_HIDDEN', message: 'The scoreboard is hidden during this contest.', hint: 'It becomes visible after the contest.' } });
      }
      const body = buildRanking(c, me);
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
        const at = dl.deadlines[pr.id] || pr.deadlineAt || ((c.settings || {}).defaultDeadline) || c.endAt;
        if (!at) continue;
        ev(`problem-${pr.id}`, at, `${c.name} — ${pr.code} ${pr.name} due`, dl.policy.enabled ? `Late policy ${dl.policy.lateMode} ${dl.policy.penaltyKind} ${dl.policy.penaltyValue}` : 'Default deadline');
      }
      if (c.startAt) ev('contest-start', c.startAt, `${c.name} — start`, '');
      if (c.endAt) ev('contest-end', c.endAt, `${c.name} — end`, '');
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
      if (c.endAt) patch.endAt = shift(c.endAt);
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
    if ((act === 'clarifications' || act === 'news' || act === 'subpages') && m === 'GET') {
      const col = act === 'clarifications' ? 'clarifications' : act;
      return send(res, 200, { items: store.query(col, (x) => String(x.contestId) === String(c.id)) });
    }
    if ((act === 'clarifications' || act === 'news' || act === 'subpages') && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return true;
      if (act !== 'clarifications' && !canManageContest(me, c)) return forbid(res);
      if (rateLimited(`${act}:${me.id}`, act === 'clarifications' ? 5 : 20, 60000)) return send(res, 429, { error: { code: 'THROTTLE', message: 'Too many posts.', hint: 'Slow down and retry in a minute.' } });
      const b = await readBody(req);
      const col = act === 'clarifications' ? 'clarifications' : act;
      const row = store.insert(col, { contestId: c.id, authorId: me.id, ...b, createdAt: new Date().toISOString() });
      return send(res, 201, row);
    }
  }

  // contest-scoped members / news / webhooks management
  mt = p.match(/^\/api\/contests\/(\d+)\/members\/(\d+)$/);
  if (mt && m === 'DELETE') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const uid = mt[2];
    const members = (c.members || []).filter((x) => String(x) !== String(uid));
    const pending = (c.pending || []).filter((x) => String(x) !== String(uid));
    store.update('contests', c.id, { members, pending });
    audit(me.id, 'contest.member.remove', `contest:${c.id}`, { uid });
    return send(res, 200, { ok: true, members: members.length });
  }
  mt = p.match(/^\/api\/contests\/(\d+)\/news\/(\d+)$/);
  if (mt && m === 'DELETE') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const row = store.get('news', mt[2]);
    if (!row || String(row.contestId) !== String(c.id)) return send(res, 404, { error: { code: 'NO_NEWS', message: 'Announcement not found.', hint: '' } });
    store.remove('news', row.id);
    audit(me.id, 'contest.news.delete', `contest:${c.id}`, { newsId: row.id });
    return send(res, 200, { ok: true, deleted: true });
  }

  // single contest get/patch/delete (DELETE: archive-first, second call purges)
  mt = p.match(/^\/api\/contests\/(\d+)$/);
  if (mt && (m === 'GET' || m === 'PATCH' || m === 'DELETE')) {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Not found.', hint: '' } });
    if (m === 'GET') return send(res, 200, c);
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
    const out = store.update('contests', c.id, b);
    audit(me.id, 'contest.update', `contest:${c.id}`, b);
    return send(res, 200, out);
  }
  return false;
}

module.exports = { handle };
