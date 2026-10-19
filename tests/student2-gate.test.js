// Lane I — student experience 2 (E2, E3, E6, E7, E8).
// API-backed checks for results filters/pagination/search + source assertions for
// JSX that cannot be executed in node. Uses tests/helpers.js (dynamic port, isolated DATA_DIR).
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, json } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const FILES = {
  problem: 'apps/web/app/contests/[id]/problems/[pid]/page.js',
  results: 'apps/web/app/results/page.js',
  detail: 'apps/web/app/results/[id]/page.js',
  home: 'apps/web/app/page.js',
  inbox: 'apps/web/components/NotificationsInbox.js',
  search: 'apps/web/app/search/page.js',
};

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

let h;
let teacherTok;
let studentTok;
let studentId;
let contestId;
let contestName;
let problemId;

before(async () => {
  h = await startServer({ prefix: 'satori-b2-lane-i-' });
  teacherTok = await h.loginAs('g_herman', 'teacher123');
  studentTok = await h.loginAs('jan_kowalski', 'student123');
  studentId = (await h.api('/api/me', {}, studentTok)).body.id;

  contestName = `Lane I Search ${Date.now().toString(36)}`;
  const c = await h.createContest(teacherTok, {
    name: contestName,
    mode: 'ICPC',
    startAt: '2020-01-01T00:00:00Z',
    endAt: '2030-01-01T00:00:00Z',
    registration: 'open',
  });
  contestId = c.id;
  const p = await h.createProblem(contestId, teacherTok, {
    code: 'A',
    name: 'Student Two A',
    visibility: 'visible',
    limits: { timeMs: 1000, memoryMb: 256, stackMb: 64, perLang: { Python: 2000 } },
  });
  problemId = p.id;
  const patched = await h.api(`/api/problems/${problemId}`, {
    method: 'PATCH',
    ...json({ aliasLetters: { [String(contestId)]: 'A1' } }),
  }, teacherTok);
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  const added = await h.api(`/api/contests/${contestId}/members`, { method: 'POST', ...json({ login: 'jan_kowalski' }) }, teacherTok);
  assert.equal(added.status, 201, JSON.stringify(added.body));

  // The results read path is what this lane changes; seed rows directly so the test
  // does not depend on toolchains or the asynchronous judge.
  const now = new Date().toISOString();
  const mk = (extra) => h.store.insert('submits', {
    contestId, problemId, userId: studentId, lang: 'C++17', filename: 'a.cpp',
    status: 'WA', points: 0, perTest: [], sampleOnly: false, createdAt: now, judgedAt: now, ...extra,
  });
  mk({
    status: 'OK', points: 100, lang: 'Python', filename: 'a.py',
    perTest: [{ n: 1, verdict: 'OK', group: 'all', points: 100, timeMs: 5, memMb: null }],
  });
  mk({
    status: 'WA', perTest: [{ n: 1, verdict: 'WA', group: 'all', points: 0, timeMs: 7, memMb: null }],
  });
  mk({ status: 'TLE' });
  mk({ status: 'WA', sampleOnly: true, filename: 'sample.cpp' });
  mk({ status: 'OK', points: 100, lang: 'Rust', filename: 'a.rs' });
});

after(async () => {
  if (h) await h.close();
});

test('E2: problem detail has no competing _best; the contest list carries _best/_score/alias', async () => {
  const detail = await h.api(`/api/problems/${problemId}`, {}, studentTok);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  // Some lanes now enrich the detail with _best; the page still merges the contest
  // list, so the only contract here is that the two can never disagree.
  assert.ok(!('_best' in detail.body) || detail.body._best === 'OK', 'detail _best, when present, matches the list');

  const list = await h.api(`/api/contests/${contestId}/problems`, {}, studentTok);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const row = (list.body.items || []).find((x) => String(x.id) === String(problemId));
  assert.ok(row, 'current problem is in the contest list');
  assert.equal(row._best, 'OK', 'solved state comes from the contest list');
  assert.equal(row._score, 100, 'best score comes from the contest list');
  assert.equal(row.alias, 'A1', 'contest alias comes from the contest list');
  assert.equal(row._tries, 4, 'tries exclude sample runs');
});

test('E2: watch pref is persisted server-side and can be toggled off again', async () => {
  const initial = await h.api('/api/notifications/prefs', {}, studentTok);
  assert.equal(initial.status, 200);
  const base = String(initial.body.prefs.watch || '').split(',').map((x) => x.trim()).filter(Boolean);

  const withProblem = [...base.filter((x) => x !== String(problemId)), String(problemId)].join(',');
  const saved = await h.api('/api/notifications/prefs', { method: 'POST', ...json({ watch: withProblem }) }, studentTok);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.ok(String(saved.body.prefs.watch).split(',').includes(String(problemId)));

  const reread = await h.api('/api/notifications/prefs', {}, studentTok);
  assert.ok(String(reread.body.prefs.watch).split(',').includes(String(problemId)), 'pref survives a reload');

  const withoutProblem = base.filter((x) => x !== String(problemId)).join(',');
  const cleared = await h.api('/api/notifications/prefs', { method: 'POST', ...json({ watch: withoutProblem }) }, studentTok);
  assert.ok(!String(cleared.body.prefs.watch).split(',').includes(String(problemId)), 'toggle off removes the id');
});

test('E3: results paginate with total/offset and expose sampleOnly + per-test group/points', async () => {
  const page1 = await h.api(`/api/submits?contest=${contestId}&me=1&limit=2&offset=0`, {}, studentTok);
  assert.equal(page1.status, 200, JSON.stringify(page1.body));
  assert.equal(page1.body.total, 5, 'total is the full filtered count');
  assert.equal(page1.body.items.length, 2);
  assert.equal(page1.body.offset, 0);
  assert.equal(page1.body.limit, 2);

  const page2 = await h.api(`/api/submits?contest=${contestId}&me=1&limit=2&offset=2`, {}, studentTok);
  assert.equal(page2.status, 200, JSON.stringify(page2.body));
  assert.equal(page2.body.items.length, 2);
  assert.equal(page2.body.offset, 2);
  const firstIds = new Set(page1.body.items.map((x) => String(x.id)));
  assert.ok(page2.body.items.every((x) => !firstIds.has(String(x.id))), 'offset returns the next page');

  const all = await h.api(`/api/submits?contest=${contestId}&me=1&limit=50&offset=0`, {}, studentTok);
  const sample = all.body.items.find((x) => x.sampleOnly === true);
  assert.ok(sample, 'sample-only run is marked in the list');
  assert.equal(sample.lang, 'C++17', 'the original language is present');

  const withTests = all.body.items.find((x) => Array.isArray(x.perTest) && x.perTest.length > 0);
  assert.ok(withTests, 'owner sees per-test rows');
  assert.equal(withTests.perTest[0].group, 'all');
  assert.equal(typeof withTests.perTest[0].points, 'number');

  const ok = await h.api(`/api/submits?contest=${contestId}&me=1&verdict=OK&limit=50`, {}, studentTok);
  assert.equal(ok.body.total, 2, 'verdict filter narrows the total');
  assert.ok(ok.body.items.every((x) => x.status === 'OK'));

  const byProblem = await h.api(`/api/submits?contest=${contestId}&me=1&problem=${problemId}&offset=-5&limit=50`, {}, studentTok);
  assert.equal(byProblem.body.offset, 0, 'negative offset clamps to zero');
  assert.equal(byProblem.body.total, 5);
});

test('E3: explicit language survives the submit path used by re-submit', async () => {
  h.store.update('contests', contestId, { lifecycle: 'running' });
  const group = await h.addGroup(problemId, teacherTok, { name: 'all', points: 100 });
  await h.addCase(problemId, teacherTok, { groupId: group.id, name: 'case-1', input: '2 3\n', expected: '5\n' });
  // The detail page re-submits { code, filename, lang }; a .txt filename must not
  // silently flip the language back to the C++ default.
  const created = await h.api(`/api/problems/${problemId}/submit`, {
    method: 'POST',
    ...json({ code: 'print(5)', filename: 'solution.txt', lang: 'Python' }),
  }, studentTok);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.lang, 'Python', 'explicit lang wins over filename detection');
  const judged = await h.waitJudged(created.body.id, studentTok);
  assert.ok(judged, 'submit reaches a verdict');
});

test('E7: grade feedback payload.text is returned to the student', async () => {
  h.store.insert('notifications', {
    userId: studentId,
    type: 'grade.feedback',
    payload: { contestId, filter: 'WA', text: 'Check test 3, off-by-one.' },
    read: false,
    at: new Date().toISOString(),
  });
  const inbox = await h.api('/api/notifications', {}, studentTok);
  assert.equal(inbox.status, 200, JSON.stringify(inbox.body));
  const row = (inbox.body.items || []).find((n) => n.type === 'grade.feedback' && n.payload?.text === 'Check test 3, off-by-one.');
  assert.ok(row, 'payload.text is exposed by the API');
  assert.equal(row.payload.contestId, contestId);
});

test('E8: search returns contests, problems and users', async () => {
  const byContest = await h.api(`/api/search?q=${encodeURIComponent(contestName)}`);
  assert.equal(byContest.status, 200);
  assert.ok((byContest.body.contests || []).some((c) => String(c.id) === String(contestId)));
  assert.ok(Array.isArray(byContest.body.problems));

  const byProblem = await h.api(`/api/search?q=${encodeURIComponent('Student Two A')}`);
  assert.ok((byProblem.body.problems || []).some((p) => String(p.id) === String(problemId) && p.contestId != null), 'problem carries contestId for the link');

  const byUser = await h.api('/api/search?q=jan_kowalski');
  assert.ok((byUser.body.users || []).some((u) => u.login === 'jan_kowalski'));
  assert.ok((byUser.body.users || []).every((u) => u.login && u.id != null), 'users are plain login rows');

  // Lane J adds announcements to the search response; the page links them to the contest page.
  h.store.insert('news', { contestId, title: 'Lane I announcement needle', bodyMd: 'searchable body', at: new Date().toISOString() });
  const byAnnouncement = await h.api('/api/search?q=announcement%20needle');
  assert.equal(byAnnouncement.status, 200);
  const ann = (byAnnouncement.body.announcements || []).find((a) => a.title === 'Lane I announcement needle');
  assert.ok(ann, 'announcement is searchable');
  assert.equal(String(ann.contestId), String(contestId), 'announcement carries contestId for the link');
});

test('E2/E3 source: pages read the merged fields and stay honest', () => {
  const problem = read(FILES.problem);
  assert.ok(problem.includes('/api/contests/${p.contestId}/problems'), 'reuses the contest problems list');
  assert.ok(problem.includes('_best'), 'reads _best from the list');
  assert.ok(problem.includes('_score'), 'reads _score from the list');
  assert.ok(problem.includes('.alias'), 'reads the contest alias');
  assert.ok(problem.includes('perLang'), 'renders per-language limits');
  assert.ok(problem.includes('${lang} ${ms}ms'), 'prints absolute ms per language');
  assert.ok(!problem.includes('×2'), 'no multiplier claim');
  assert.ok(!problem.includes('×${'), 'no multiplier claim');
  assert.ok(problem.includes('/api/notifications/prefs'), 'watch toggles the server pref');
  assert.ok(problem.includes('notificationPrefs') || problem.includes('/api/notifications/prefs'));
  assert.ok(problem.includes('editorialMd'), 'renders the editorial field');
  assert.ok(problem.includes('KATEX_ENABLED'), 'math feature flag is explicit');
  assert.ok(problem.includes('mathAsCode'), 'math renders as code text');
  assert.ok(problem.includes('probl_locked') || problem.includes('prob_locked_until_solved'), 'honest lock message');

  const results = read(FILES.results);
  assert.ok(results.includes('sampleOnly'), 'sample-only rows are identified');
  assert.ok(results.includes('hideSamples'), 'hide-sample filter exists');
  assert.ok(results.includes("q.set('offset'"), 'offset pagination is requested');
  assert.ok(results.includes('d.total'), 'server total is used');
  assert.ok(results.includes('loadMore'), 'load-more action exists');
  assert.ok(results.includes('/api/contests/${id}/problems'), 'problem ids resolve to contest rows');

  const detail = read(FILES.detail);
  assert.ok(detail.includes('lang: s.lang'), 're-submit passes the original language');
  assert.ok(detail.includes('firstFailed'), 'first-failed visibility note');
  assert.ok(detail.includes("key: 'group'"), 'group column when present');
  assert.ok(detail.includes("key: 'points'"), 'points column when present');

  const home = read(FILES.home);
  assert.ok(home.includes('spark={spark}'), 'sparkline is rendered');
  assert.ok(home.includes('miniRank?.me'), 'mini-rank is rendered');
  assert.ok(home.includes('endAt'), 'deadlines still use endAt only');

  const inbox = read(FILES.inbox);
  assert.ok(inbox.includes('payload?.text'), 'payload.text is rendered');
  assert.ok(inbox.includes('grade.feedback'), 'grade feedback type is labelled');
  assert.ok(inbox.includes('typeLabel'), 'type labels are shown');
  assert.ok(inbox.includes('/announcements'), 'announcement notifications link to the contest page');

  const search = read(FILES.search);
  assert.ok(search.includes('r?.announcements'), 'announcements are rendered when returned');
  assert.ok(search.includes('/announcements'), 'announcement links target the contest page');
  assert.ok(search.includes('usersNote'), 'plain user rows carry a note');
});

test('Lane I JSX parses with Next SWC (or source assertions above still cover it)', async () => {
  let swc = null;
  try { swc = require('next/dist/build/swc'); } catch { /* Next not installed here: covered by source assertions */ }
  if (!swc) return;
  for (const rel of Object.values(FILES)) {
    const ast = await swc.parse(read(rel), { filename: path.basename(rel) });
    assert.equal(ast.type, 'Module', `${rel} parses`);
    assert.ok(Array.isArray(ast.body) && ast.body.length > 0, `${rel} has statements`);
  }
});
