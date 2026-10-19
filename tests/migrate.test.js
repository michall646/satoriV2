// Migration script: normalize legacy fields, keep a backup, stay idempotent.
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
let dir;
let parent;

function write(name, rows) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(rows, null, 2));
}
function read(name) {
  return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
}
function run(args) {
  return spawnSync(process.execPath, ['scripts/migrate-v2.js', `--data-dir=${dir}`, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

before(() => {
  parent = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-migrate-'));
  dir = path.join(parent, 'data');
  fs.mkdirSync(dir, { recursive: true });
  write('contests.json', [{
    id: 1,
    name: 'Legacy exam',
    mode: 'EXAM',
    lifecycle: 'archived',
    stopAt: '2026-01-01T10:00:00Z',
    settings: { ips: ['10.0.0.1'], tokens: '09:00-11:00', scoring: {} },
  }]);
  write('teams.json', [{ id: 1, contestId: 1, memberIds: ['3', '4'] }]);
  write('users.json', [{ id: 1, login: 'legacy' }]);
  write('problems.json', [{
    id: 1,
    contestId: 1,
    limits: { timeMs: 1000, memoryMb: 256, perLang: { python: 2, cpp: 5000 } },
  }]);
});

after(() => {
  fs.rmSync(parent, { recursive: true, force: true });
});

test('migration: applies legacy field normalization and keeps a backup', () => {
  const r = run(['--apply']);
  assert.equal(r.status, 0, r.stderr || r.stdout);

  const c = read('contests.json')[0];
  assert.equal(c.endAt, '2026-01-01T10:00:00Z', 'stopAt -> endAt');
  assert.ok(!('stopAt' in c), 'stopAt removed');
  assert.equal(c.scoreboardMode, 'IOI', 'EXAM -> IOI');
  assert.equal(c.archived, true, 'archived lifecycle sets archived');
  assert.equal(c.settings.penaltyMin, 20, 'penaltyMin default');
  assert.ok(Array.isArray(c.settings.gradeScale) && c.settings.gradeScale.length, 'gradeScale default');
  assert.equal(c.settings.exam.ipAllow, '10.0.0.1', 'ips -> ipAllow');
  assert.equal(c.settings.exam.timeWindow, '09:00-11:00', 'tokens -> timeWindow');
  assert.ok(!('ips' in c.settings.exam) && !('tokens' in c.settings.exam), 'legacy exam keys removed');

  const team = read('teams.json')[0];
  assert.deepEqual(team.members, ['3', '4'], 'memberIds -> members');
  assert.equal(read('users.json')[0].usosId, '', 'usosId default');

  const p = read('problems.json')[0];
  const perLang = p.limits.perLang;
  assert.equal(perLang.Python, 2000, 'python multiplier 2 x 1000ms');
  assert.equal(perLang['C++17'], 5000, 'cpp key canonicalized');

  const backups = fs.readdirSync(parent).filter((n) => n.startsWith('data-backup-'));
  assert.equal(backups.length, 1, 'backup created');
});

test('migration: second run is idempotent', () => {
  const r = run(['--apply']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  assert.equal(out.contests.changed, 0, 'contests unchanged');
  assert.equal(out.teams.changed, 0, 'teams unchanged');
  assert.equal(out.users.changed, 0, 'users unchanged');
  assert.equal(out.problems.changed, 0, 'problems unchanged');
});
