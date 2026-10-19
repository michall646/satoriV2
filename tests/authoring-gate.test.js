// Batch 2 Lane H — authoring & checker gate.
// C4 custom checker program, C6 test manager (edit/delete/import/export),
// C7 zero-test gate + sample checker, C10 editor fields/_best, C11 clone,
// C12 limit history + versions.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let h;
let teacher;
let student;

// Solutions / checkers run as JavaScript: node is guaranteed wherever the API runs.
const SUM_JS = "const fs=require('fs');const a=fs.readFileSync(0,'utf8').trim().split(/\\s+/).map(Number);console.log(a[0]+a[1]);";
const ALT_ANSWER = "process.stdout.write('forty-two\\n');";
const FLOAT_ANSWER = "process.stdout.write('1.0005\\n');";

const CUSTOM_CHECKER = [
  "const fs = require('fs');",
  'const [inPath, expPath, outPath] = process.argv.slice(2);',
  '',
  "const expected = fs.readFileSync(expPath, 'utf8').trim();",
  "const output = fs.readFileSync(outPath, 'utf8').trim();",
  "if (output === expected || (expected === '42' && output === 'forty-two')) process.exit(0);",
  "process.stderr.write('wrong answer: expected ' + expected + ' got ' + output + '\\n');",
  'process.exit(1);',
].join('\n');

const CRASH_CHECKER = [
  "process.stderr.write('checker exploded\\n');",
  'process.exit(2);',
].join('\n');

let seq = 0;
async function mkContest(name = 'Authoring') {
  seq += 1;
  return h.createContest(teacher, { name: `${name} #${seq}`, mode: 'ICPC' });
}
async function mkProblem(cid, code = 'A', body = {}) {
  return h.createProblem(cid, teacher, { code, name: `Problem ${code}`, visibility: 'draft', ...body });
}
async function submit(pid, code, filename = 'solution.js', extra = {}) {
  const r = await h.api('/api/submits', { method: 'POST', body: JSON.stringify({ problemId: pid, filename, code, ...extra }) }, teacher);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const judged = await h.waitJudged(r.body.id, teacher);
  assert.ok(judged, 'submit judged in time');
  return judged;
}
async function testsOf(pid) {
  const r = await h.api(`/api/problems/${pid}/tests`, {}, teacher);
  assert.equal(r.status, 200);
  return r.body.items;
}

before(async () => {
  delete process.env.SATORI_DEMO_TRIGGERS;
  h = await startServer({ prefix: 'satori-authoring-' });
  teacher = await h.loginAs('g_herman', 'teacher123');
  student = await h.loginAs('jan_kowalski', 'student123');
});
after(async () => { if (h) await h.close(); });

test('C4: custom checker accepts an alternative answer and rejects a wrong one', async () => {
  const c = await mkContest('Custom checker');
  const p = await mkProblem(c.id, 'A', { visibility: 'visible' });
  const g = await h.addGroup(p.id, teacher, {
    name: 'custom', points: 100, checker: 'custom', checkerLang: 'JavaScript', checkerCode: CUSTOM_CHECKER,
  });
  assert.equal(g.checker, 'custom');
  await h.addCase(p.id, teacher, { groupId: g.id, name: 'alt', input: '0\n', expected: '42\n' });
  await h.addCase(p.id, teacher, { groupId: g.id, name: 'wrong', input: '0\n', expected: '7\n' });

  const judged = await submit(p.id, ALT_ANSWER);
  assert.equal(judged.status, 'WA', 'second test is wrong');
  assert.equal(judged.perTest[0].verdict, 'OK', 'forty-two accepted as an alternative answer');
  assert.equal(judged.perTest[1].verdict, 'WA');
  assert.match(judged.perTest[1].msg, /wrong answer/i, 'checker message is surfaced');
  assert.equal(judged.perTest[1].checker.kind, 'custom');
});

test('C4: checker error fails closed (WA with a message), never an exception', async () => {
  const c = await mkContest('Checker error');
  const p = await mkProblem(c.id, 'A', { visibility: 'visible' });
  const g = await h.addGroup(p.id, teacher, {
    name: 'custom', points: 100, checker: 'custom', checkerLang: 'JavaScript', checkerCode: CRASH_CHECKER,
  });
  await h.addCase(p.id, teacher, { groupId: g.id, input: '0\n', expected: '42\n' });

  const judged = await submit(p.id, ALT_ANSWER);
  assert.equal(judged.status, 'WA', 'bad checker must not accept');
  assert.equal(judged.perTest[0].verdict, 'WA');
  assert.match(judged.perTest[0].msg, /checker error/i);
  assert.equal(judged.perTest[0].checker.error, true);
  assert.equal(g.checker, 'custom');
});

test('D7: float tolerance works from checkerTolerance and from float:1e-3', async () => {
  const c = await mkContest('Float tolerance');
  const p = await mkProblem(c.id, 'A', { visibility: 'visible' });
  const g = await h.addGroup(p.id, teacher, { name: 'float', points: 100, checker: 'float', checkerTolerance: 1e-3 });
  const tc = await h.addCase(p.id, teacher, { groupId: g.id, input: '0\n', expected: '1.0\n' });

  const loose = await submit(p.id, FLOAT_ANSWER);
  assert.equal(loose.status, 'OK', '1.0005 within 1e-3');

  const strict = await h.api(`/api/problems/${p.id}/tests/cases/${tc.id}`, {
    method: 'PATCH', body: JSON.stringify({ checker: 'float:1e-9' }),
  }, teacher);
  assert.equal(strict.status, 200);
  const bad = await submit(p.id, FLOAT_ANSWER);
  assert.equal(bad.status, 'WA', 'float:1e-9 rejects 1.0005');

  const clear = await h.api(`/api/problems/${p.id}/tests/cases/${tc.id}`, {
    method: 'PATCH', body: JSON.stringify({ checker: '' }),
  }, teacher);
  assert.equal(clear.status, 200);
  const group = await h.api(`/api/problems/${p.id}/tests/groups/${g.id}`, {
    method: 'PATCH', body: JSON.stringify({ checkerTolerance: 1e-2 }),
  }, teacher);
  assert.equal(group.status, 200);
  const looseAgain = await submit(p.id, FLOAT_ANSWER);
  assert.equal(looseAgain.status, 'OK', 'group tolerance applies after clearing the case override');
});

test('C6: group points/name, case edit/delete and cross-problem negatives', async () => {
  const c = await mkContest('Test manager');
  const p = await mkProblem(c.id, 'A');
  const g = await h.addGroup(p.id, teacher, { name: 'g1', points: 10 });
  const c1 = await h.addCase(p.id, teacher, { groupId: g.id, name: 'c1', input: '1 1\n', expected: '2\n' });
  const c2 = await h.addCase(p.id, teacher, { groupId: g.id, name: 'c2', input: '2 2\n', expected: '4\n' });

  const gp = await h.api(`/api/problems/${p.id}/tests/groups/${g.id}`, {
    method: 'PATCH', body: JSON.stringify({ name: 'renamed', points: 30 }),
  }, teacher);
  assert.equal(gp.status, 200);
  assert.equal(gp.body.name, 'renamed');
  assert.equal(gp.body.points, 30);

  const cp = await h.api(`/api/problems/${p.id}/tests/cases/${c1.id}`, {
    method: 'PATCH', body: JSON.stringify({ name: 'edited', input: '4 4\n', expected: '8\n', timeMs: 1500, memoryMb: 128 }),
  }, teacher);
  assert.equal(cp.status, 200);
  assert.equal(cp.body.input, '4 4\n');
  assert.equal(cp.body.timeMs, 1500);

  let list = await testsOf(p.id);
  assert.equal(list[0].name, 'renamed');
  assert.equal(list[0].points, 30);
  const edited = list[0].cases.find((x) => String(x.id) === String(c1.id));
  assert.equal(edited.expected, '8\n');

  const del = await h.api(`/api/problems/${p.id}/tests/cases/${c2.id}`, { method: 'DELETE' }, teacher);
  assert.equal(del.status, 200);
  list = await testsOf(p.id);
  assert.equal(list[0].cases.length, 1, 'one case deleted');

  // Cross-problem ids are rejected: an admin of A cannot write B's tests.
  const p2 = await mkProblem(c.id, 'B');
  const g2 = await h.addGroup(p2.id, teacher, { name: 'b-only', points: 100 });
  const c3 = await h.addCase(p2.id, teacher, { groupId: g2.id, input: '1\n', expected: '1\n' });

  const foreignGroup = await h.api(`/api/problems/${p.id}/tests/groups/${g2.id}`, {
    method: 'PATCH', body: JSON.stringify({ points: 99 }),
  }, teacher);
  assert.equal(foreignGroup.status, 403);
  assert.equal(foreignGroup.body.error.code, 'GROUP_MISMATCH');

  const foreignCase = await h.api(`/api/problems/${p.id}/tests/cases/${c3.id}`, {
    method: 'PATCH', body: JSON.stringify({ expected: '9\n' }),
  }, teacher);
  assert.equal(foreignCase.status, 403);
  assert.equal(foreignCase.body.error.code, 'CASE_MISMATCH');

  const foreignDelete = await h.api(`/api/problems/${p.id}/tests/cases/${c3.id}`, { method: 'DELETE' }, teacher);
  assert.equal(foreignDelete.status, 403);

  const studentGroup = await h.api(`/api/problems/${p.id}/tests/groups/${g.id}`, {
    method: 'PATCH', body: JSON.stringify({ points: 1 }),
  }, student);
  assert.equal(studentGroup.status, 403);
});

test('C7: zero-case problems cannot publish or take a real submit; samples still run', async () => {
  const c = await mkContest('No tests');
  const p = await mkProblem(c.id, 'A', { visibility: 'draft' });

  const real = await h.api(`/api/problems/${p.id}/submit`, {
    method: 'POST', body: JSON.stringify({ code: SUM_JS, filename: 'solution.js', language: 'JavaScript' }),
  }, teacher);
  assert.equal(real.status, 409);
  assert.equal(real.body.error.code, 'NO_TESTS');

  const publish = await h.api(`/api/problems/${p.id}`, { method: 'PATCH', body: JSON.stringify({ visibility: 'visible' }) }, teacher);
  assert.equal(publish.status, 422);
  assert.equal(publish.body.error.code, 'NO_TESTS');

  // Sample runs stay allowed on a zero-case problem (samples come from the statement).
  const sample = await h.api(`/api/problems/${p.id}/submit`, {
    method: 'POST', body: JSON.stringify({ code: SUM_JS, filename: 'solution.js', language: 'JavaScript', sampleOnly: true }),
  }, teacher);
  assert.equal(sample.status, 201, JSON.stringify(sample.body));
  const sampleJudged = await h.waitJudged(sample.body.id, teacher);
  assert.ok(sampleJudged, 'sample run is processed');
  assert.equal(sampleJudged.testsTotal, 0);

  const g = await h.addGroup(p.id, teacher, { name: 'all', points: 100 });
  await h.addCase(p.id, teacher, { groupId: g.id, input: '2 3\n', expected: '5\n' });

  const published = await h.api(`/api/problems/${p.id}`, { method: 'PATCH', body: JSON.stringify({ visibility: 'visible' }) }, teacher);
  assert.equal(published.status, 200);

  const ok = await h.api(`/api/problems/${p.id}/submit`, {
    method: 'POST', body: JSON.stringify({ code: SUM_JS, filename: 'solution.js', language: 'JavaScript' }),
  }, teacher);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const judged = await h.waitJudged(ok.body.id, teacher);
  assert.equal(judged.status, 'OK');
});

test('C7: sample-only runs use the problem/group checker, not a hardcoded token', async () => {
  const c = await mkContest('Sample checker');
  // Group checker is token: a sample run must reject the alternative answer.
  const p = await mkProblem(c.id, 'A', {
    visibility: 'visible',
    samples: [{ input: '0\n', output: '42\n' }],
  });
  await h.addGroup(p.id, teacher, { name: 'all', points: 100, checker: 'token' });
  const tokenRun = await h.api('/api/submits/sample-run', {
    method: 'POST', body: JSON.stringify({ problemId: p.id, filename: 'solution.js', code: ALT_ANSWER }),
  }, teacher);
  assert.equal(tokenRun.status, 201, JSON.stringify(tokenRun.body));
  const tokenJudged = await h.waitJudged(tokenRun.body.id, teacher);
  assert.equal(tokenJudged.status, 'WA', 'token group checker rejects forty-two');

  // Problem-level checker wins over the group and accepts the alternative answer.
  const patch = await h.api(`/api/problems/${p.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ checker: 'custom', checkerLang: 'JavaScript', checkerCode: CUSTOM_CHECKER }),
  }, teacher);
  assert.equal(patch.status, 200);
  const customRun = await h.api('/api/submits/sample-run', {
    method: 'POST', body: JSON.stringify({ problemId: p.id, filename: 'solution.js', code: ALT_ANSWER }),
  }, teacher);
  assert.equal(customRun.status, 201);
  const customJudged = await h.waitJudged(customRun.body.id, teacher);
  assert.equal(customJudged.status, 'OK', 'custom problem checker accepts forty-two');
  assert.equal(customJudged.perTest[0].verdict, 'OK');

  // Without a problem checker, the first group's checker drives the samples.
  const p2 = await mkProblem(c.id, 'B', { visibility: 'visible', samples: [{ input: '0\n', output: '42\n' }] });
  await h.addGroup(p2.id, teacher, { name: 'all', points: 100, checker: 'custom', checkerLang: 'JavaScript', checkerCode: CUSTOM_CHECKER });
  const groupRun = await h.api('/api/submits/sample-run', {
    method: 'POST', body: JSON.stringify({ problemId: p2.id, filename: 'solution.js', code: ALT_ANSWER }),
  }, teacher);
  assert.equal(groupRun.status, 201);
  const groupJudged = await h.waitJudged(groupRun.body.id, teacher);
  assert.equal(groupJudged.status, 'OK', 'group checker is the sample fallback');
});

test('C10: problem fields PATCH, set validation, alias and _best', async () => {
  const c = await mkContest('Editor fields');
  const p = await mkProblem(c.id, 'A');
  const g = await h.addGroup(p.id, teacher, { name: 'all', points: 100 });
  await h.addCase(p.id, teacher, { groupId: g.id, input: '2 3\n', expected: '5\n' });

  const upd = await h.api(`/api/problems/${p.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'Renamed', code: 'RN', tags: ['dp', 'math'], difficulty: 3, deadlineAt: '2030-05-01T12:00:00Z', statementMdEn: 'English statement' }),
  }, teacher);
  assert.equal(upd.status, 200, JSON.stringify(upd.body));
  assert.equal(upd.body.name, 'Renamed');
  assert.equal(upd.body.code, 'RN');
  assert.deepEqual(upd.body.tags, ['dp', 'math']);
  assert.equal(upd.body.difficulty, 3);
  assert.equal(upd.body.statementMdEn, 'English statement');
  assert.equal(upd.body.deadlineAt, '2030-05-01T12:00:00.000Z');

  const other = await mkContest('Foreign sets');
  const foreignSet = h.store.insert('problemSets', { contestId: other.id, name: 'foreign', order: 1 });
  const badSet = await h.api(`/api/problems/${p.id}`, { method: 'PATCH', body: JSON.stringify({ setId: foreignSet.id }) }, teacher);
  assert.equal(badSet.status, 422);
  assert.equal(badSet.body.error.code, 'SET_MISMATCH');

  const judged = await submit(p.id, SUM_JS);
  assert.equal(judged.status, 'OK');

  const detail = await h.api(`/api/problems/${p.id}`, {}, teacher);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.alias, 'RN');
  assert.equal(detail.body._best, 'OK');
  assert.equal(detail.body._bestScore, 100);

  const studentPatch = await h.api(`/api/problems/${p.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'hacked' }) }, student);
  assert.equal(studentPatch.status, 403);
});

test('C11: clone copies tests/checker/limits and remaps or drops the set', async () => {
  const c = await mkContest('Clone source');
  const set = h.store.insert('problemSets', { contestId: c.id, name: 'main', order: 1 });
  const p = await mkProblem(c.id, 'A');
  const setPatch = await h.api(`/api/problems/${p.id}`, { method: 'PATCH', body: JSON.stringify({ setId: set.id, tags: ['graphs'], difficulty: 4 }) }, teacher);
  assert.equal(setPatch.status, 200);
  const g = await h.addGroup(p.id, teacher, { name: 'all', points: 10, checker: 'token' });
  await h.addCase(p.id, teacher, { groupId: g.id, input: '2 3\n', expected: '5\n' });

  const clone = await h.api(`/api/problems/${p.id}/clone`, { method: 'POST', body: JSON.stringify({ code: 'CL', name: 'Clone' }) }, teacher);
  assert.equal(clone.status, 201, JSON.stringify(clone.body));
  assert.notEqual(clone.body.id, p.id);
  assert.equal(clone.body.cloned.groups, 1);
  assert.equal(clone.body.cloned.cases, 1);
  assert.equal(String(clone.body.setId), String(set.id), 'set remapped inside the same contest');
  assert.deepEqual(clone.body.tags, ['graphs']);
  assert.equal(clone.body.difficulty, 4);

  const clonedTests = await testsOf(clone.body.id);
  assert.equal(clonedTests[0].points, 10);
  assert.equal(clonedTests[0].cases[0].expected, '5\n');

  const judged = await submit(clone.body.id, SUM_JS);
  assert.equal(judged.status, 'OK', 'cloned problem judges');
  assert.equal(judged.points, 10);

  const other = await mkContest('Clone target');
  const clone2 = await h.api(`/api/problems/${p.id}/clone`, { method: 'POST', body: JSON.stringify({ contestId: other.id, code: 'CL2' }) }, teacher);
  assert.equal(clone2.status, 201, JSON.stringify(clone2.body));
  assert.equal(clone2.body.setId, null, 'no matching set in the target -> dropped');
  const clone2Tests = await testsOf(clone2.body.id);
  assert.equal(clone2Tests[0].cases.length, 1);
});

test('C12: limit history and version snapshots are stored and readable', async () => {
  const c = await mkContest('History');
  const p = await mkProblem(c.id, 'A');

  const first = await h.api(`/api/problems/${p.id}`, { method: 'PATCH', body: JSON.stringify({ statementMd: 'first statement' }) }, teacher);
  assert.equal(first.status, 200);
  const second = await h.api(`/api/problems/${p.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ limits: { timeMs: 2500, memoryMb: 256, stackMb: 64, perLang: { Python: 2000 } } }),
  }, teacher);
  assert.equal(second.status, 200);

  const limitHistory = await h.api(`/api/problems/${p.id}/limitHistory`, {}, teacher);
  assert.equal(limitHistory.status, 200);
  assert.ok(limitHistory.body.items.length >= 1);
  assert.equal(limitHistory.body.items[0].to.timeMs, 2500);

  const versions = await h.api(`/api/problems/${p.id}/versions`, {}, teacher);
  assert.equal(versions.status, 200);
  assert.ok(versions.body.items.length >= 1);
  assert.ok(versions.body.items.some((v) => v.snapshot && v.snapshot.statementMd === 'first statement'));
  const newest = versions.body.items[0];
  assert.ok(newest.version >= 1);
  assert.ok(Array.isArray(newest.changed) && newest.changed.length >= 1);

  const studentHistory = await h.api(`/api/problems/${p.id}/limitHistory`, {}, student);
  assert.equal(studentHistory.status, 403);
  const studentVersions = await h.api(`/api/problems/${p.id}/versions`, {}, student);
  assert.equal(studentVersions.status, 403);
});

test('C6: export/import JSON round-trip appends groups and cases', async () => {
  const c = await mkContest('Export import');
  const src = await mkProblem(c.id, 'A');
  const g = await h.addGroup(src.id, teacher, { name: 'all', points: 100, checker: 'token' });
  await h.addCase(src.id, teacher, { groupId: g.id, input: '2 3\n', expected: '5\n' });

  const exported = await h.api(`/api/problems/${src.id}/tests/export`, {}, teacher);
  assert.equal(exported.status, 200);
  assert.equal(exported.body.format, 'satori-tests-v1');
  assert.equal(exported.body.groups.length, 1);
  assert.equal(exported.body.groups[0].cases.length, 1);
  assert.equal(exported.body.problem.code, 'A');

  const dst = await mkProblem(c.id, 'B');
  const imported = await h.api(`/api/problems/${dst.id}/tests/import`, { method: 'POST', body: JSON.stringify(exported.body) }, teacher);
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  assert.deepEqual(imported.body.imported, { groups: 1, cases: 1 });

  const dstTests = await testsOf(dst.id);
  assert.equal(dstTests.length, 1);
  assert.equal(dstTests[0].cases.length, 1);
  assert.equal(dstTests[0].cases[0].expected, '5\n');

  const judged = await submit(dst.id, SUM_JS);
  assert.equal(judged.status, 'OK', 'imported tests judge');

  const studentExport = await h.api(`/api/problems/${src.id}/tests/export`, {}, student);
  assert.equal(studentExport.status, 403);
  const studentImport = await h.api(`/api/problems/${dst.id}/tests/import`, { method: 'POST', body: JSON.stringify(exported.body) }, student);
  assert.equal(studentImport.status, 403);
});
