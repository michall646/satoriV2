// Batch 3 Lane M — C5 validators + reference solution + stress gate.
// Covers: invalid input blocks publish, valid input publishes, the validator
// run endpoint, reference run/diff, generate-empty-only, stress mismatch
// reporting, auth negatives, and the reference/validator secret not leaking
// to non-managers.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let h;
let teacher;
let student;
let seq = 0;

// Validator contract: input file path is the first user argument, exit 0/1.
const VALIDATOR_JS = [
  "const fs = require('fs');",
  "const text = fs.readFileSync(process.argv[2], 'utf8').trim();",
  "if (!/^-?\\d+ -?\\d+$/.test(text)) { process.stderr.write('expected two integers'); process.exit(1); }",
  'process.exit(0);',
].join('\n');

// Reference reads stdin (the authoring runner pipes case input there).
const REF_JS = "const fs=require('fs');const [a,b]=fs.readFileSync(0,'utf8').trim().split(/\\s+/).map(Number);process.stdout.write(String(a+b)+'\\n');";
const BRUTE_JS = "const fs=require('fs');const [a,b]=fs.readFileSync(0,'utf8').trim().split(/\\s+/).map(Number);process.stdout.write(String(a-b)+'\\n');";
const GEN_JS = "process.stdout.write('5 2\\n');";

async function mkProblem(visibility = 'draft') {
  seq += 1;
  const c = await h.createContest(teacher, { name: `Validator ${seq}`, mode: 'ICPC' });
  return h.createProblem(c.id, teacher, { code: 'A', name: `Problem ${seq}`, visibility });
}
function patch(pid, body, token = teacher) {
  return h.api(`/api/problems/${pid}`, { method: 'PATCH', body: JSON.stringify(body) }, token);
}
function runRoute(pid, route, body, token = teacher) {
  return h.api(`/api/problems/${pid}/${route}`, { method: 'POST', body: JSON.stringify(body || {}) }, token);
}
async function testsOf(pid) {
  const r = await h.api(`/api/problems/${pid}/tests`, {}, teacher);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.items;
}
function findCase(items, id) {
  for (const g of items) {
    const tc = (g.cases || []).find((c) => String(c.id) === String(id));
    if (tc) return tc;
  }
  return null;
}

before(async () => {
  delete process.env.SATORI_DEMO_TRIGGERS;
  h = await startServer({ prefix: 'satori-validator-' });
  teacher = await h.loginAs('g_herman', 'teacher123');
  student = await h.loginAs('jan_kowalski', 'student123');
});
after(async () => { if (h) await h.close(); });

test('C5: invalid case input blocks publish with INVALID_TESTS and names the case', async () => {
  const p = await mkProblem();
  const g = await h.addGroup(p.id, teacher, { name: 'all', points: 100 });
  const bad = await h.addCase(p.id, teacher, { groupId: g.id, name: 'bad-input', input: 'not numbers\n', expected: '0\n' });

  const cfg = await patch(p.id, { validator: 'custom', validatorLang: 'JavaScript', validatorCode: VALIDATOR_JS });
  assert.equal(cfg.status, 200, JSON.stringify(cfg.body));

  const pub = await patch(p.id, { visibility: 'visible' });
  assert.equal(pub.status, 422, JSON.stringify(pub.body));
  assert.equal(pub.body.error.code, 'INVALID_TESTS');
  assert.equal(String(pub.body.error.caseId), String(bad.id), 'failing case id is reported');
  assert.match(pub.body.error.message, /bad-input/, 'failing case name is reported');
  assert.match(pub.body.error.message, /two integers/, 'validator message is surfaced');

  const get = await h.api(`/api/problems/${p.id}`, {}, teacher);
  assert.equal(get.body.visibility, 'draft', 'the problem did not become visible');
});

test('C5: valid case inputs pass the publish gate and the validator run endpoint', async () => {
  const p = await mkProblem();
  const g = await h.addGroup(p.id, teacher, { name: 'all', points: 100 });
  await h.addCase(p.id, teacher, { groupId: g.id, name: 'ok-1', input: '2 3\n', expected: '5\n' });
  await h.addCase(p.id, teacher, { groupId: g.id, name: 'ok-2', input: '10 20\n', expected: '30\n' });
  const cfg = await patch(p.id, { validator: 'custom', validatorLang: 'JavaScript', validatorCode: VALIDATOR_JS });
  assert.equal(cfg.status, 200, JSON.stringify(cfg.body));

  const run = await runRoute(p.id, 'validators/run', {
    validator: 'custom', validatorLang: 'JavaScript', validatorCode: VALIDATOR_JS,
  });
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.body.ok, true);
  assert.equal(run.body.cases.length, 2);
  for (const c of run.body.cases) {
    assert.equal(c.valid, true);
    assert.equal(c.message, '');
  }

  const pub = await patch(p.id, { visibility: 'visible' });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal(pub.body.visibility, 'visible');
});

test('C5: reference run reports per-case verdicts and the first diff (WA)', async () => {
  const p = await mkProblem();
  const g = await h.addGroup(p.id, teacher, { name: 'all', points: 100 });
  await h.addCase(p.id, teacher, { groupId: g.id, name: 'correct', input: '2 3\n', expected: '5\n' });
  await h.addCase(p.id, teacher, { groupId: g.id, name: 'broken-expected', input: '10 20\n', expected: '99\n' });
  const cfg = await patch(p.id, { referenceLang: 'JavaScript', referenceCode: REF_JS });
  assert.equal(cfg.status, 200, JSON.stringify(cfg.body));

  const run = await runRoute(p.id, 'reference/run', {});
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.body.ok, false);
  assert.equal(run.body.cases.length, 2);
  assert.equal(run.body.cases[0].verdict, 'OK');
  assert.equal(run.body.cases[1].verdict, 'WA');
  assert.equal(run.body.firstDiff.n, 2);
  assert.equal(String(run.body.firstDiff.caseId), String(run.body.cases[1].caseId));
  assert.equal(run.body.firstDiff.expected.trim(), '99');
  assert.equal(run.body.firstDiff.got.trim(), '30');
});

test('C5: generate fills only empty expected outputs and never overwrites', async () => {
  const p = await mkProblem();
  const g = await h.addGroup(p.id, teacher, { name: 'all', points: 100 });
  const empty1 = await h.addCase(p.id, teacher, { groupId: g.id, name: 'empty-1', input: '2 3\n', expected: '' });
  const kept = await h.addCase(p.id, teacher, { groupId: g.id, name: 'kept', input: '2 3\n', expected: '5\n' });
  const empty2 = await h.addCase(p.id, teacher, { groupId: g.id, name: 'empty-2', input: '10 20\n', expected: '' });
  const cfg = await patch(p.id, { referenceLang: 'JavaScript', referenceCode: REF_JS });
  assert.equal(cfg.status, 200, JSON.stringify(cfg.body));

  const gen = await runRoute(p.id, 'reference/generate', {});
  assert.equal(gen.status, 200, JSON.stringify(gen.body));
  assert.equal(gen.body.ok, true);
  assert.equal(gen.body.changed, 2, 'only the two empty cases are filled');
  assert.equal(gen.body.considered, 2);

  const items = await testsOf(p.id);
  assert.equal(findCase(items, empty1.id).expected.trim(), '5');
  assert.equal(findCase(items, empty2.id).expected.trim(), '30');
  assert.equal(findCase(items, kept.id).expected.trim(), '5', 'existing expected output is untouched');

  const again = await runRoute(p.id, 'reference/generate', {});
  assert.equal(again.status, 200);
  assert.equal(again.body.changed, 0, 'nothing is left empty');

  const overwrite = await runRoute(p.id, 'reference/generate', { overwrite: true });
  assert.equal(overwrite.status, 422);
  assert.equal(overwrite.body.error.code, 'OVERWRITE');
});

test('C5: stress compares reference and brute on generated inputs and reports mismatches', async () => {
  const p = await mkProblem('visible');
  await patch(p.id, { referenceLang: 'JavaScript', referenceCode: REF_JS });

  const run = await runRoute(p.id, 'stress', {
    bruteCode: BRUTE_JS, bruteLang: 'JavaScript', generatorCode: GEN_JS, rounds: 2,
  });
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.body.ok, false);
  assert.equal(run.body.mismatches.length, 2);
  assert.equal(run.body.mismatches[0].reference.trim(), '7');
  assert.equal(run.body.mismatches[0].brute.trim(), '3');
  assert.equal(run.body.mismatches[0].input.trim(), '5 2');

  const tooLarge = await runRoute(p.id, 'stress', {
    bruteCode: BRUTE_JS, bruteLang: 'JavaScript', generatorCode: GEN_JS, rounds: 999,
  });
  assert.equal(tooLarge.status, 422);
  assert.equal(tooLarge.body.error.code, 'TOO_LARGE');
});

test('C5: authoring routes are admin-only and reference/validator secrets do not leak', async () => {
  const p = await mkProblem('visible');
  const g = await h.addGroup(p.id, teacher, { name: 'all', points: 100 });
  await h.addCase(p.id, teacher, { groupId: g.id, input: '2 3\n', expected: '5\n' });
  await patch(p.id, {
    validator: 'custom', validatorLang: 'JavaScript', validatorCode: VALIDATOR_JS,
    referenceLang: 'JavaScript', referenceCode: REF_JS,
  });

  // Reject matrix: students are forbidden, anonymous is unauthenticated.
  for (const route of ['validators/run', 'reference/run', 'reference/generate', 'stress']) {
    const denied = await runRoute(p.id, route, {}, student);
    assert.equal(denied.status, 403, `${route} must reject a student`);
    const anon = await runRoute(p.id, route, {}, null);
    assert.equal(anon.status, 401, `${route} must reject anonymous callers`);
  }
  const studentPatch = await patch(p.id, { referenceCode: 'process.exit(0)' }, student);
  assert.equal(studentPatch.status, 403);

  // Positive control: the manager receives the authoring programs.
  const own = await h.api(`/api/problems/${p.id}`, {}, teacher);
  assert.equal(own.status, 200);
  assert.equal(own.body.referenceCode, REF_JS);
  assert.equal(own.body.validatorCode, VALIDATOR_JS);

  // Students read the problem but never the model solution or validator.
  const asStudent = await h.api(`/api/problems/${p.id}`, {}, student);
  assert.equal(asStudent.status, 200, JSON.stringify(asStudent.body));
  assert.equal(asStudent.body.referenceCode, undefined);
  assert.equal(asStudent.body.validatorCode, undefined);
  assert.equal(asStudent.body.validatorFile, undefined);

  // The contest problem list must not become a side channel for the same secrets.
  const contestId = p.contestId || own.body.contestId;
  const list = await h.api(`/api/contests/${contestId}/problems`, {}, student);
  assert.equal(list.status, 200);
  const row = (list.body.items || []).find((x) => String(x.id) === String(p.id));
  assert.ok(row, 'problem is listed');
  assert.equal(row.referenceCode, undefined);
  assert.equal(row.validatorCode, undefined);
  assert.equal(row.validatorFile, undefined);
  assert.equal(row.checkerCode, undefined);
});

test('C5: a group-level validator participates in the publish gate', async () => {
  const p = await mkProblem();
  const g = await h.addGroup(p.id, teacher, {
    name: 'strict', points: 100,
    validator: 'custom', validatorLang: 'JavaScript', validatorCode: VALIDATOR_JS,
  });
  await h.addCase(p.id, teacher, { groupId: g.id, name: 'bad-group', input: 'oops\n', expected: '0\n' });

  const pub = await patch(p.id, { visibility: 'visible' });
  assert.equal(pub.status, 422, JSON.stringify(pub.body));
  assert.equal(pub.body.error.code, 'INVALID_TESTS');
  assert.match(pub.body.error.message, /bad-group/);
});

test('C5: a crashing validator fails closed on publish', async () => {
  const p = await mkProblem();
  const g = await h.addGroup(p.id, teacher, { name: 'all', points: 100 });
  await h.addCase(p.id, teacher, { groupId: g.id, name: 'valid-looking', input: '2 3\n', expected: '5\n' });
  await patch(p.id, {
    validator: 'custom', validatorLang: 'JavaScript',
    validatorCode: "process.stderr.write('boom'); process.exit(2);",
  });

  const pub = await patch(p.id, { visibility: 'visible' });
  assert.equal(pub.status, 422, JSON.stringify(pub.body));
  assert.equal(pub.body.error.code, 'INVALID_TESTS');
  assert.match(pub.body.error.message, /validator error/);
  assert.match(pub.body.error.message, /boom/);
});

test('C5: unknown validator/reference languages are rejected by PATCH', async () => {
  const p = await mkProblem();
  const badValidator = await patch(p.id, { validatorLang: 'COBOL' });
  assert.equal(badValidator.status, 422);
  assert.equal(badValidator.body.error.code, 'VALIDATOR_LANG');
  const badReference = await patch(p.id, { referenceLang: 'COBOL' });
  assert.equal(badReference.status, 422);
  assert.equal(badReference.body.error.code, 'REFERENCE_LANG');
});
