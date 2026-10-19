// Lane B / Gate A: contest time (B1), scoreboard mode (B2), freeze (B3),
// grade scale (B4), team identity (B5) and penalty source (B6).
// Server-backed cases use tests/helpers.js (dynamic port, isolated DATA_DIR).
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let h;
let engine;
let time;
let student;

const iso = (ms) => new Date(ms).toISOString();

before(async () => {
  h = await startServer({ prefix: 'satori-lane-b-' });
  // Require after startServer: the store reads SATORI_DATA_DIR at module load.
  engine = require('../apps/api/src/lib/contestAccess');
  time = require('../apps/api/src/lib/contestTime');
  student = h.store.query('users', (u) => u.login === 'jan_kowalski')[0];
});

after(async () => {
  if (h) await h.close();
});

function makeContest(overrides = {}) {
  return h.store.insert('contests', {
    name: `Lane B ${Date.now()}-${Math.random().toString(16).slice(2)}`,
    mode: 'ICPC', lifecycle: 'running', archived: false,
    startAt: '2025-01-01T00:00:00Z', endAt: '2025-01-01T05:00:00Z',
    freezeAt: null, teamMode: false,
    settings: { penaltyMin: 20 },
    members: [student.id], pending: [], admins: [],
    ...overrides,
  });
}

function makeProblem(contest, overrides = {}) {
  return h.store.insert('problems', {
    contestId: contest.id, code: 'A', name: 'Problem A', visibility: 'visible',
    limits: { timeMs: 1000, memoryMb: 256, stackMb: 64, perLang: {} },
    ...overrides,
  });
}

function makeSubmit(contest, problem, overrides = {}) {
  return h.store.insert('submits', {
    contestId: contest.id, problemId: problem.id, userId: student.id,
    status: 'OK', points: 100, sampleOnly: false,
    createdAt: '2025-01-01T01:00:00Z',
    ...overrides,
  });
}

test('B1 resolveContestEnd prefers endAt and falls back to legacy stopAt', () => {
  assert.equal(
    time.resolveContestEnd({ endAt: '2026-01-02T03:04:05Z', stopAt: '2020-01-01T00:00:00Z' }),
    '2026-01-02T03:04:05.000Z',
  );
  assert.equal(
    time.resolveContestEnd({ stopAt: '2025-10-25T15:00:00Z' }),
    '2025-10-25T15:00:00.000Z',
  );
  assert.equal(time.resolveContestEnd({ endAt: null, stopAt: null }), null);
  assert.equal(time.resolveContestEnd({}), null);
  assert.equal(time.resolveContestEnd({ endAt: 'not-a-date', stopAt: '2025-10-25T15:00:00Z' }), '2025-10-25T15:00:00.000Z');
});

test('B1 normalizeContestTime canonicalizes stopAt and drops the alias', () => {
  const out = time.normalizeContestTime({ name: 'C', stopAt: '2025-10-25T15:00:00Z' });
  assert.equal(out.endAt, '2025-10-25T15:00:00.000Z');
  assert.equal('stopAt' in out, false);
  assert.equal(out.name, 'C');
  // A patch without time fields must not clear an existing end.
  const patch = time.normalizeContestTime({ name: 'renamed' });
  assert.equal('endAt' in patch, false);
});

test('B1 contestDeadlines uses endAt even when the contest only has stopAt', () => {
  const c = makeContest({ endAt: null, stopAt: '2025-01-01T05:00:00Z', settings: { penaltyMin: 20 } });
  const p = makeProblem(c);
  const dl = engine.contestDeadlines(c);
  assert.equal(dl.deadlines[p.id], '2025-01-01T05:00:00.000Z');
});

test('B2 resolveScoreboardMode maps every template explicitly', () => {
  const cases = [
    ['ICPC', 'ICPC'],
    ['IOI', 'IOI'],
    ['LABS', 'LABS'],
    ['COURSE', 'LABS'],
    ['EXAM', 'IOI'],
    ['TAKEHOME', 'IOI'],
    ['PLAYGROUND', 'IOI'],
    ['VIRTUAL', 'ICPC'],
  ];
  for (const [mode, expected] of cases) {
    assert.equal(engine.resolveScoreboardMode({ mode }), expected, `mode ${mode}`);
  }
  // Canonical scoreboardMode wins over the template; invalid values fall back.
  assert.equal(engine.resolveScoreboardMode({ mode: 'EXAM', scoreboardMode: 'ICPC' }), 'ICPC');
  assert.equal(engine.resolveScoreboardMode({ mode: 'ICPC', scoreboardMode: 'LABS' }), 'LABS');
  assert.equal(engine.resolveScoreboardMode({ mode: 'EXAM', scoreboardMode: 'bogus' }), 'IOI');
  assert.equal(engine.resolveScoreboardMode({ mode: 'COURSE', scoreboardMode: 'course' }), 'LABS');
});

test('B2 EXAM ranks by IOI points, not ICPC solves', () => {
  const c = makeContest({ mode: 'EXAM', settings: { penaltyMin: 20 }, scoreboardMode: null });
  const p = makeProblem(c);
  makeSubmit(c, p, { status: 'WA', points: 30, createdAt: '2025-01-01T01:00:00Z' });
  makeSubmit(c, p, { status: 'OK', points: 72, createdAt: '2025-01-01T02:00:00Z' });

  const board = engine.buildRanking(c, null);
  assert.equal(board.mode, 'IOI');
  assert.equal(board.contestMode, 'EXAM');
  assert.equal(board.rows[0].total, 72);
  assert.equal(board.rows[0].cells[p.id].points, 72);
});

test('B3 freeze hides later submits; unfreeze and replay reveal them', () => {
  const now = Date.now();
  const c = makeContest({
    mode: 'ICPC',
    startAt: iso(now - 3 * 3600000),
    endAt: iso(now + 3600000), // default unfreezeAt = endAt
    freezeAt: iso(now - 3600000),
    settings: { penaltyMin: 20 },
  });
  const p1 = makeProblem(c, { code: 'A' });
  const p2 = makeProblem(c, { code: 'B' });
  makeSubmit(c, p1, { status: 'OK', createdAt: iso(now - 2 * 3600000) });
  makeSubmit(c, p2, { status: 'OK', createdAt: iso(now - 10 * 60000) });

  const frozen = engine.buildRanking(c, null, { nowMs: now });
  assert.equal(frozen.frozen, true);
  assert.equal(frozen.unfreezeAt, c.endAt);
  assert.equal(frozen.rows[0].solved, 1); // post-freeze solve hidden

  const thawed = engine.buildRanking(c, null, { nowMs: now + 2 * 3600000 });
  assert.equal(thawed.frozen, false);
  assert.equal(thawed.rows[0].solved, 2); // appears after unfreeze

  const replay = engine.buildRanking(c, null, { nowMs: now, unfrozen: true });
  assert.equal(replay.frozen, false);
  assert.equal(replay.rows[0].solved, 2); // replay view while still frozen
});

test('B5 teamMode false keeps individuals when a team row exists', () => {
  const c = makeContest({ mode: 'ICPC', teamMode: false, settings: { penaltyMin: 20 } });
  const p = makeProblem(c);
  const team = h.store.insert('teams', {
    contestId: c.id, name: 'Team One', scoreboardName: 'Team One', memberIds: [student.id],
  });
  makeSubmit(c, p, { teamId: team.id, status: 'OK', createdAt: '2025-01-01T01:00:00Z' });

  const board = engine.buildRanking(c, null);
  assert.equal(board.rows.length, 1);
  assert.equal(board.rows[0].contestantId, `u:${student.id}`);
  assert.equal(board.rows[0].solved, 1);
});

test('B5 teamMode true uses teams, reads members || memberIds, ignores foreign teamIds', () => {
  const c = makeContest({ mode: 'ICPC', teamMode: true, settings: { penaltyMin: 20 } });
  const p1 = makeProblem(c, { code: 'A' });
  const p2 = makeProblem(c, { code: 'B' });
  const team = h.store.insert('teams', {
    contestId: c.id, name: 'Team A', scoreboardName: 'Team A', memberIds: [student.id],
  });
  makeSubmit(c, p1, { teamId: team.id, status: 'OK', createdAt: '2025-01-01T01:00:00Z' });
  makeSubmit(c, p2, { teamId: 999999, status: 'OK', createdAt: '2025-01-01T02:00:00Z' });

  const board = engine.buildRanking(c, null);
  assert.equal(board.rows.length, 1);
  assert.equal(board.rows[0].contestantId, `t:${team.id}`);
  assert.deepEqual(board.rows[0].members, ['jan_kowalski']);
  assert.equal(board.rows[0].solved, 1); // foreign-team submit ignored
});

test('B4 85% maps through settings.gradeScale consistently', () => {
  const scale = [{ min: 90, grade: 5 }, { min: 80, grade: 4.5 }, { min: 50, grade: 3 }, { min: 0, grade: 2 }];
  const c = makeContest({
    mode: 'LABS',
    settings: { penaltyMin: 0, gradeScale: scale, deadlinePolicy: { enabled: false } },
  });
  const p = makeProblem(c);
  makeSubmit(c, p, { status: 'OK', points: 85, createdAt: '2025-01-01T01:00:00Z' });

  const board = engine.buildRanking(c, null);
  assert.equal(board.mode, 'LABS');
  assert.equal(board.rows[0].total, 85);
  assert.equal(board.rows[0].grade, 4.5);

  const direct = engine.computeLabsGrade(c, [p], (s) => String(s.userId) === String(student.id));
  assert.equal(direct.out.grade, 4.5);
  assert.equal(engine.gradeFromScale(engine.resolveGradeScale(c), direct.out.total), 4.5);

  // Default scale (D3) is used when the contest has none.
  assert.deepEqual(engine.resolveGradeScale({ settings: {} }), [
    { min: 90, grade: 5 }, { min: 75, grade: 4 }, { min: 50, grade: 3 }, { min: 0, grade: 2 },
  ]);
});

test('B6 penaltyMin prefers settings.penaltyMin and falls back to scoring.wrongTryMin', () => {
  const mk = (settings) => {
    const c = makeContest({ settings });
    const p = makeProblem(c);
    makeSubmit(c, p, { status: 'WA', points: 0, createdAt: '2025-01-01T01:00:00Z' });
    makeSubmit(c, p, { status: 'OK', points: 100, createdAt: '2025-01-01T02:00:00Z' });
    return engine.buildRanking(c, null);
  };
  assert.equal(mk({ penaltyMin: 7, scoring: { wrongTryMin: 3 } }).penaltyMin, 7);
  assert.equal(mk({ scoring: { wrongTryMin: 3 } }).penaltyMin, 3);
  assert.equal(mk({ penaltyMin: 7, scoring: { wrongTryMin: 3 } }).rows[0].time, 120 + 7);
  assert.equal(mk({ scoring: { wrongTryMin: 3 } }).rows[0].time, 120 + 3);
});
