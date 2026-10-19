// Ranking engines: AAA, positive+negative.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rankICPC, rankIOI, gradeLabs } = require('../apps/api/src/lib/ranking');

test('ICPC orders by solves then time, cell text matches V1 (positive)', () => {
  // Arrange
  const contestants = [{ id: 'u:1', name: 'a' }, { id: 'u:2', name: 'b' }];
  const problems = [{ id: 1 }, { id: 2 }];
  const submits = [
    { contestantId: 'u:1', problemId: 1, status: 'WA', createdAt: '2025-10-25T10:05:00Z' },
    { contestantId: 'u:1', problemId: 1, status: 'OK', createdAt: '2025-10-25T11:41:00Z' },
    { contestantId: 'u:2', problemId: 1, status: 'OK', createdAt: '2025-10-25T10:30:00Z' },
  ];
  // Act
  const rows = rankICPC({ contestants, submits, problems, contestStart: '2025-10-25T10:00:00Z' });
  // Assert
  assert.equal(rows[0].contestantId, 'u:2'); // fewer minutes wins tie on solves
  assert.equal(rows[1].cells[1].text, '2 (1:41)'); // N (H:MM) format
  assert.equal(rows[0].cells[2].text, '-'); // never tried
});

test('ICPC ignores sample-only submits (negative guard)', () => {
  const contestants = [{ id: 'u:1', name: 'a' }];
  const rows = rankICPC({
    contestants, problems: [{ id: 1 }], contestStart: '2025-10-25T10:00:00Z',
    submits: [{ contestantId: 'u:1', problemId: 1, status: 'OK', sampleOnly: true, createdAt: '2025-10-25T10:01:00Z' }],
  });
  assert.equal(rows[0].solved, 0);
});

test('IOI sums best points (positive)', () => {
  const rows = rankIOI({
    contestants: [{ id: 'u:1', name: 'a' }], problems: [{ id: 1 }, { id: 2 }],
    submits: [
      { contestantId: 'u:1', problemId: 1, status: 'WA', points: 30 },
      { contestantId: 'u:1', problemId: 1, status: 'OK', points: 72 },
      { contestantId: 'u:1', problemId: 2, status: 'OK', points: 100 },
    ],
  });
  assert.equal(rows[0].total, 172);
});

test('LABS grade with late penalty + best-of-K (positive)', () => {
  const g = gradeLabs({
    weights: { 1: 1, 2: 1, 3: 1 }, scores: { 1: 100, 2: 80, 3: 10 },
    bestOfK: 2, latePenaltyPerDay: 5,
    deadlines: { 1: '2024-01-01T00:00:00Z' }, submittedAt: { 1: '2024-01-03T00:00:00Z' },
  });
  // problem1: 100-2*5=90, best 90+80 -> avg 85 -> 4.5
  assert.equal(g.grade, 4.5);
});

test('LABS empty weights -> 2.0 (negative)', () => {
  assert.equal(gradeLabs({ weights: {}, scores: {} }).grade, 2.0);
});

test('ICPC honors configurable penaltyMin (positive)', () => {
  const contestants = [{ id: 'u:1', name: 'a' }];
  const problems = [{ id: 1 }];
  const submits = [
    { contestantId: 'u:1', problemId: 1, status: 'WA', createdAt: '2025-10-25T10:05:00Z' },
    { contestantId: 'u:1', problemId: 1, status: 'OK', createdAt: '2025-10-25T11:00:00Z' },
  ];
  const dflt = rankICPC({ contestants, submits, problems, contestStart: '2025-10-25T10:00:00Z' });
  const custom = rankICPC({ contestants, submits, problems, contestStart: '2025-10-25T10:00:00Z', penaltyMin: 10 });
  assert.equal(dflt[0].time, 60 + 20); // 1 wrong x default 20
  assert.equal(custom[0].time, 60 + 10); // 1 wrong x custom 10
});

test('ICPC exempts CE from tries (positive)', () => {
  const contestants = [{ id: 'u:1', name: 'a' }];
  const problems = [{ id: 1 }];
  const submits = [
    { contestantId: 'u:1', problemId: 1, status: 'CE', createdAt: '2025-10-25T10:05:00Z' },
    { contestantId: 'u:1', problemId: 1, status: 'OK', createdAt: '2025-10-25T10:30:00Z' },
  ];
  const rows = rankICPC({ contestants, submits, problems, contestStart: '2025-10-25T10:00:00Z' });
  assert.equal(rows[0].cells[1].text, '1 (0:30)'); // CE did not count as try
  assert.equal(rows[0].attempts, 1);
});

test('ICPC tiebreak falls to attempts (positive)', () => {
  const contestants = [{ id: 'u:1', name: 'a' }, { id: 'u:2', name: 'b' }];
  const problems = [{ id: 1 }];
  const submits = [
    { contestantId: 'u:1', problemId: 1, status: 'WA', createdAt: '2025-10-25T10:05:00Z' },
    { contestantId: 'u:1', problemId: 1, status: 'WA', createdAt: '2025-10-25T10:06:00Z' },
    { contestantId: 'u:1', problemId: 1, status: 'OK', createdAt: '2025-10-25T10:20:00Z' },
    { contestantId: 'u:2', problemId: 1, status: 'OK', createdAt: '2025-10-25T10:20:00Z' },
  ];
  const rows = rankICPC({
    contestants, submits, problems, contestStart: '2025-10-25T10:00:00Z', penaltyMin: 0,
    tiebreak: ['solves', 'time', 'attempts'],
  });
  assert.equal(rows[0].contestantId, 'u:2'); // same time, fewer attempts wins
});

test('IOI latest rule takes most recent submit (positive)', () => {
  const rows = rankIOI({
    contestants: [{ id: 'u:1', name: 'a' }], problems: [{ id: 1 }],
    submits: [
      { contestantId: 'u:1', problemId: 1, status: 'OK', points: 100, createdAt: '2025-10-25T10:00:00Z' },
      { contestantId: 'u:1', problemId: 1, status: 'WA', points: 20, createdAt: '2025-10-25T11:00:00Z' },
    ],
    scoreRule: 'latest',
  });
  assert.equal(rows[0].total, 20);
});

test('IOI solved-count rule is binary (positive)', () => {
  const rows = rankIOI({
    contestants: [{ id: 'u:1', name: 'a' }], problems: [{ id: 1 }],
    submits: [{ contestantId: 'u:1', problemId: 1, status: 'WA', points: 40 }],
    scoreRule: 'solved-count',
  });
  assert.equal(rows[0].total, 0);
});

test('Late floor keeps minimum credit (positive)', () => {
  const rows = rankIOI({
    contestants: [{ id: 'u:1', name: 'a' }], problems: [{ id: 1 }],
    submits: [{ contestantId: 'u:1', problemId: 1, status: 'OK', points: 100, createdAt: '2025-01-10T00:00:00Z' }],
    deadlines: { 1: '2025-01-01T00:00:00Z' },
    policy: { enabled: true, lateMode: 'soft', penaltyKind: 'perDay', penaltyValue: 30, graceMin: 0 },
    floorPct: 50,
  });
  assert.equal(rows[0].total, 50); // 100-9*30 floors at 50% of raw
});

test('LABS dropWorstN drops lowest (positive)', () => {
  const g = gradeLabs({
    weights: { 1: 1, 2: 1, 3: 1 }, scores: { 1: 100, 2: 80, 3: 10 }, dropWorstN: 1,
  });
  assert.equal(g.total, 90); // (100+80)/2
});

test('Stepped tiers override linear penalty (positive)', () => {
  const rows = rankIOI({
    contestants: [{ id: 'u:1', name: 'a' }], problems: [{ id: 1 }],
    submits: [{ contestantId: 'u:1', problemId: 1, status: 'OK', points: 100, createdAt: '2025-01-02T06:00:00Z' }],
    deadlines: { 1: '2025-01-01T00:00:00Z' }, // 1.25 days late -> tier 2 (-15%)
    policy: { enabled: true, lateMode: 'soft', penaltyKind: 'perDay', penaltyValue: 50, graceMin: 0, tiers: [{ days: 0.5, pct: 5 }, { days: 2, pct: 15 }] },
  });
  assert.equal(rows[0].total, 85);
});

test('Miss deduction on-solve only (positive)', () => {
  const subs = [
    { contestantId: 'u:1', problemId: 1, status: 'WA', points: 0, createdAt: '2025-10-25T10:00:00Z' },
    { contestantId: 'u:1', problemId: 1, status: 'OK', points: 100, createdAt: '2025-10-25T11:00:00Z' },
  ];
  const solved = rankIOI({
    contestants: [{ id: 'u:1', name: 'a' }], problems: [{ id: 1 }], submits: subs,
    missDeduction: { value: 10, accrue: 'on-solve' },
  });
  assert.equal(solved[0].total, 90);
  const never = rankIOI({
    contestants: [{ id: 'u:1', name: 'a' }], problems: [{ id: 1 }],
    submits: [{ contestantId: 'u:1', problemId: 1, status: 'WA', points: 0, createdAt: '2025-10-25T10:00:00Z' }],
    missDeduction: { value: 10, accrue: 'on-solve' },
  });
  assert.equal(never[0].total, 0); // never solved -> no deduction spiral
});

test('ICPC maxTries ignores extras (positive)', () => {
  const contestants = [{ id: 'u:1', name: 'a' }];
  const problems = [{ id: 1 }];
  const submits = [
    { contestantId: 'u:1', problemId: 1, status: 'WA', createdAt: '2025-10-25T10:01:00Z' },
    { contestantId: 'u:1', problemId: 1, status: 'WA', createdAt: '2025-10-25T10:02:00Z' },
    { contestantId: 'u:1', problemId: 1, status: 'WA', createdAt: '2025-10-25T10:03:00Z' },
    { contestantId: 'u:1', problemId: 1, status: 'OK', createdAt: '2025-10-25T10:04:00Z' },
  ];
  const rows = rankICPC({ contestants, submits, problems, contestStart: '2025-10-25T10:00:00Z', maxTries: 2, penaltyMin: 0 });
  assert.equal(rows[0].solved, 0); // solve came after the cap
  assert.equal(rows[0].attempts, 2);
});

test('LABS honors per-problem weights (positive)', () => {
  const g = gradeLabs({ weights: { 1: 2, 2: 1 }, scores: { 1: 100, 2: 0 } });
  assert.equal(g.total, 66.7);
});
