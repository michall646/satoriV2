// Gate A / B3: freeze, unfreeze and replay for ICPC + IOI, plus the shared filter helper.
// Pure unit tests — AAA, positive + negative. No server needed.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rankICPC, rankIOI, filterFrozenSubmits, isFrozen } = require('../apps/api/src/lib/ranking');

const START = '2025-10-25T10:00:00Z';
const FREEZE_AT = '2025-10-25T12:00:00Z';
const UNFREEZE_AT = '2025-10-25T14:00:00Z';
const FROZEN_NOW = Date.parse('2025-10-25T12:30:00Z'); // between freeze and unfreeze
const THAWED_NOW = Date.parse('2025-10-25T15:00:00Z'); // after unfreeze

const CONTESTANTS = [{ id: 'u:1', name: 'a' }, { id: 'u:2', name: 'b' }];
const PROBLEMS = [{ id: 1 }];
const row = (rows, id) => rows.find((r) => r.contestantId === id);

test('ICPC freeze hides a later solve; unfreeze and replay include it (positive)', () => {
  const submits = [
    { contestantId: 'u:1', problemId: 1, status: 'OK', createdAt: '2025-10-25T11:00:00Z' },
    { contestantId: 'u:2', problemId: 1, status: 'OK', createdAt: '2025-10-25T13:00:00Z' },
  ];
  const base = { contestants: CONTESTANTS, submits, problems: PROBLEMS, contestStart: START };
  const opts = { freezeAtIso: FREEZE_AT, unfreezeAtIso: UNFREEZE_AT };
  const frozen = rankICPC({ ...base, ...opts, nowMs: FROZEN_NOW });
  const thawed = rankICPC({ ...base, ...opts, nowMs: THAWED_NOW });
  const replay = rankICPC({ ...base, ...opts, nowMs: FROZEN_NOW, unfrozenView: true });

  assert.equal(row(frozen, 'u:2').solved, 0); // post-freeze solve hidden
  assert.equal(row(frozen, 'u:2').cells[1].text, '-');
  assert.equal(row(frozen, 'u:1').solved, 1);
  assert.equal(row(thawed, 'u:2').solved, 1); // appears after unfreeze
  assert.equal(row(thawed, 'u:2').cells[1].text, '1 (3:00)');
  assert.equal(row(replay, 'u:2').solved, 1); // replay includes it while still frozen
});

test('ICPC freeze without unfreezeAtIso stays frozen (negative guard)', () => {
  const submits = [
    { contestantId: 'u:1', problemId: 1, status: 'OK', createdAt: '2025-10-25T11:00:00Z' },
    { contestantId: 'u:2', problemId: 1, status: 'OK', createdAt: '2025-10-25T13:00:00Z' },
  ];
  // only freezeAtIso given -> legacy behavior: post-freeze submits hidden, no auto-lift
  const rows = rankICPC({
    contestants: CONTESTANTS, submits, problems: PROBLEMS, contestStart: START,
    freezeAtIso: FREEZE_AT, nowMs: THAWED_NOW,
  });
  assert.equal(row(rows, 'u:2').solved, 0);
});

test('ICPC per-submit _unfrozenView bypasses the freeze filter (positive)', () => {
  const submits = [
    { contestantId: 'u:1', problemId: 1, status: 'OK', createdAt: '2025-10-25T11:00:00Z' },
    { contestantId: 'u:2', problemId: 1, status: 'OK', createdAt: '2025-10-25T13:00:00Z', _unfrozenView: true },
  ];
  const rows = rankICPC({
    contestants: CONTESTANTS, submits, problems: PROBLEMS, contestStart: START,
    freezeAtIso: FREEZE_AT, unfreezeAtIso: UNFREEZE_AT, nowMs: FROZEN_NOW,
  });
  assert.equal(row(rows, 'u:2').solved, 1);
});

test('IOI freeze hides later points; unfreeze and replay include them (positive)', () => {
  const submits = [
    { contestantId: 'u:1', problemId: 1, status: 'OK', points: 100, createdAt: '2025-10-25T11:00:00Z' },
    { contestantId: 'u:1', problemId: 1, status: 'OK', points: 140, createdAt: '2025-10-25T13:00:00Z' },
  ];
  const base = { contestants: [{ id: 'u:1', name: 'a' }], submits, problems: PROBLEMS };
  const opts = { freezeAtIso: FREEZE_AT, unfreezeAtIso: UNFREEZE_AT };
  const frozen = rankIOI({ ...base, ...opts, nowMs: FROZEN_NOW });
  const thawed = rankIOI({ ...base, ...opts, nowMs: THAWED_NOW });
  const replay = rankIOI({ ...base, ...opts, nowMs: FROZEN_NOW, unfrozenView: true });

  assert.equal(frozen[0].total, 100); // post-freeze 140 hidden
  assert.equal(frozen[0].attempts, 1);
  assert.equal(thawed[0].total, 140); // appears after unfreeze
  assert.equal(replay[0].total, 140); // replay includes it while still frozen
});

test('no freeze options -> ICPC and IOI count every submit (negative guard)', () => {
  const icpcRows = rankICPC({
    contestants: CONTESTANTS, problems: PROBLEMS, contestStart: START,
    submits: [
      { contestantId: 'u:1', problemId: 1, status: 'OK', createdAt: '2025-10-25T11:00:00Z' },
      { contestantId: 'u:2', problemId: 1, status: 'OK', createdAt: '2025-10-25T13:00:00Z' },
    ],
  });
  assert.equal(row(icpcRows, 'u:2').solved, 1); // no freezeAtIso -> no filtering

  const ioiRows = rankIOI({
    contestants: [{ id: 'u:1', name: 'a' }], problems: PROBLEMS,
    submits: [
      { contestantId: 'u:1', problemId: 1, status: 'OK', points: 100, createdAt: '2025-10-25T11:00:00Z' },
      { contestantId: 'u:1', problemId: 1, status: 'OK', points: 140, createdAt: '2025-10-25T13:00:00Z' },
    ],
  });
  assert.equal(ioiRows[0].total, 140);
});

test('filterFrozenSubmits: freeze window, unfreeze, replay and guards (positive+negative)', () => {
  const subs = [
    { id: 'pre', createdAt: '2025-10-25T11:00:00Z' },
    { id: 'post', createdAt: '2025-10-25T13:00:00Z' },
    { id: 'replay', createdAt: '2025-10-25T13:30:00Z', _unfrozenView: true },
    { id: 'bad', createdAt: 'not-a-date' },
  ];
  const opts = { freezeAtIso: FREEZE_AT, unfreezeAtIso: UNFREEZE_AT };

  assert.deepEqual(filterFrozenSubmits(subs, { ...opts, nowMs: FROZEN_NOW }).map((s) => s.id), ['pre', 'replay', 'bad']);
  assert.deepEqual(filterFrozenSubmits(subs, { ...opts, nowMs: THAWED_NOW }).map((s) => s.id), ['pre', 'post', 'replay', 'bad']);
  assert.deepEqual(filterFrozenSubmits(subs, { ...opts, nowMs: FROZEN_NOW, unfrozenView: true }).map((s) => s.id), ['pre', 'post', 'replay', 'bad']);
  // guards: no/unusable freeze time and missing list -> no filtering
  assert.equal(filterFrozenSubmits(subs, {}), subs);
  assert.equal(filterFrozenSubmits(subs, { freezeAtIso: 'garbage' }), subs);
  assert.equal(filterFrozenSubmits(subs, { nowMs: FROZEN_NOW }), subs);
  assert.deepEqual(filterFrozenSubmits(undefined, opts), []);
});

test('isFrozen reports the window state (positive+negative)', () => {
  assert.equal(isFrozen({ freezeAtIso: FREEZE_AT, unfreezeAtIso: UNFREEZE_AT, nowMs: FROZEN_NOW }), true);
  assert.equal(isFrozen({ freezeAtIso: FREEZE_AT, unfreezeAtIso: UNFREEZE_AT, nowMs: THAWED_NOW }), false);
  assert.equal(isFrozen({ freezeAtIso: FREEZE_AT }), true); // no unfreeze time -> frozen until replay
  assert.equal(isFrozen({ freezeAtIso: FREEZE_AT, unfrozenView: true }), false); // replay
  assert.equal(isFrozen({ freezeAtIso: FREEZE_AT, _unfrozenView: true }), false); // legacy replay flag
  assert.equal(isFrozen({}), false);
});
