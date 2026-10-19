// Satori V2 — seed: Playground 251519, UZI series, Rust labs 8677128.
// Runnable: node apps/api/src/seed.js
'use strict';
const { store } = require('./lib/store');
const { hashPassword } = require('./lib/crypto');

function reset() {
  for (const c of ['organizations','users','teams','contests','problemSets','problems','testGroups','testCases','submits','clarifications','news','subpages','audit','notifications','webhooks','sessions','limitHistory','notes','appeals','violations','deliveries','problemVersions']) {
    store.replaceAll(c, []);
  }
}

function main() {
  reset();
  const uj = store.insert('organizations', { name: 'UJ', domainRegex: '@uj\\.edu\\.pl$' });
  store.insert('organizations', { name: 'AGH', domainRegex: '@agh\\.edu\\.pl$' });
  store.insert('organizations', { name: 'V LO Kraków', domainRegex: '' });

  const admin = store.insert('users', {
    login: 'admin', firstName: 'Admin', lastName: 'Satori',
    email: 'admin@uj.edu.pl', pass: hashPassword('admin123'),
    affiliationOrgId: uj.id, rolesGlobal: ['superadmin'], createdAt: new Date().toISOString(),
  });
  const teacher = store.insert('users', {
    login: 'g_herman', firstName: 'Grzegorz', lastName: 'Herman',
    email: 'gh@uj.edu.pl', pass: hashPassword('teacher123'),
    affiliationOrgId: uj.id, rolesGlobal: ['teacher'], createdAt: new Date().toISOString(),
  });
  const student = store.insert('users', {
    login: 'jan_kowalski', firstName: 'Jan', lastName: 'Kowalski',
    email: 'jan@uj.edu.pl', pass: hashPassword('student123'),
    affiliationOrgId: uj.id, rolesGlobal: ['student'], createdAt: new Date().toISOString(),
  });

  const playground = store.insert('contests', {
    id: 251519, name: 'Satori Playground', description: 'Open practice — old UZI tasks.',
    mode: 'PLAYGROUND', lifecycle: 'running', registration: 'approval',
    archived: false, startAt: '2011-10-01T00:00:00Z', endAt: null, freezeAt: null,
    settings: { penaltyMin: 20, verdictVisibility: 'all', allowSampleRun: true },
    members: [student.id], pending: [], admins: [teacher.id],
  });
  const rust = store.insert('contests', {
    id: 8677128, name: 'Rust, 2023/24', description: 'University course — Labs 1..8.',
    mode: 'LABS', lifecycle: 'running', registration: 'invite',
    archived: false, startAt: '2023-10-01T00:00:00Z', endAt: '2024-06-30T23:59:59Z', freezeAt: null,
    settings: { penaltyMin: 0, verdictVisibility: 'all', allowSampleRun: true, bestOfK: 6, latePenaltyPerDay: 5, defaultDeadline: '2024-06-30T23:59:59Z', deadlinePolicy: { enabled: true, lateMode: 'soft', penaltyKind: 'perDay', penaltyValue: 5, graceMin: 60, capZeroAfterDays: 14 } },
    members: [student.id], pending: [], admins: [teacher.id],
  });
  const uzi = store.insert('contests', {
    id: 10193118, name: 'UZI, 25.10.2025', description: 'ICPC-style team contest, 11 problems A-K.',
    mode: 'ICPC', lifecycle: 'finished', registration: 'invite',
    archived: false, startAt: '2025-10-25T10:00:00Z', endAt: '2025-10-25T15:00:00Z', freezeAt: '2025-10-25T14:00:00Z',
    settings: { penaltyMin: 20, verdictVisibility: 'first-failed', allowSampleRun: false },
    members: [], pending: [], admins: [teacher.id],
  });

  store.insert('teams', { id: 1, name: 'uj7 [Smolira, Bawołek, Salata]', contestId: uzi.id, memberIds: [student.id], loginIdentity: 'uj7', scoreboardName: 'uj7' });

  const mkSet = (contestId, title, order) => store.insert('problemSets', { contestId, title, order });
  const setA = mkSet(playground.id, 'Warmup', 1);
  const setB = mkSet(uzi.id, 'UZI Finals', 1);
  const setC = mkSet(rust.id, 'Labs 1', 1);

  const mkProblem = (contestId, setId, code, name, samples, deadlineAt) => {
    const p = store.insert('problems', {
      contestId, setId, code, name,
      statementMd: `# ${name}\n\nSolve ${name}. Limits: 1.0s (x2 Python) / 256 MB / stack 64 MB.\n\n## Sample\n`,
      statementHtml: `<h1>${name}</h1>`,
      samples: samples || [{ input: '2 3\n', output: '5\n' }],
      limits: { timeMs: 1000, memoryMb: 256, stackMb: 64, perLang: { Python: 2000 } },
      visibility: 'visible', tags: ['intro'], difficulty: 1, pdfBadge: 'HTML',
      version: 1, aliasLetters: {}, deadlineAt: deadlineAt || null,
    });
    const g = store.insert('testGroups', { problemId: p.id, name: 'all', points: 100, subtask: 1 });
    store.insert('testCases', { groupId: g.id, input: '2 3\n', expected: '5\n', checker: 'token', timeMs: 1000, memoryMb: 256 });
    store.insert('testCases', { groupId: g.id, input: '10 20\n', expected: '30\n', checker: 'token', timeMs: 1000, memoryMb: 256 });
    return p;
  };

  mkProblem(playground.id, setA.id, 'A', 'Sum', [{ input: '2 3\n', output: '5\n' }]);
  mkProblem(playground.id, setA.id, 'B', 'Sort', [{ input: '3 2 1\n', output: '1 2 3\n' }]);
  for (const code of ['A','B','C','D','E','F','G','H','I','J','K']) {
    mkProblem(uzi.id, setB.id, code, `UZI Problem ${code}`);
  }
  mkProblem(rust.id, setC.id, 'L1A', 'Ownership', [{ input: '', output: 'ok\n' }], '2023-10-15T23:59:59Z');
  mkProblem(rust.id, setC.id, 'L1B', 'Borrowing', [{ input: '', output: 'ok\n' }], '2023-10-22T23:59:59Z');

  store.insert('news', { contestId: playground.id, title: 'Zadania z UZI', bodyMd: 'Old tasks imported. Long list? Use search + hide solved.', createdAt: '2012-10-24T10:00:00Z' });
  store.insert('news', { contestId: rust.id, title: 'Slajdy z wykładu', bodyMd: 'Slides linked. Labs 1..8 as subpages.', createdAt: '2023-10-02T10:00:00Z' });
  store.insert('subpages', { id: 275018, contestId: playground.id, title: 'FAQ', bodyMd: 'Affiliation required. Write e-mail, approvals manual.', attachments: [] });
  store.insert('subpages', { id: 184196, contestId: null, title: 'Compile options', bodyMd: 'See /api/languages matrix (public in V2).', attachments: [] });
  store.insert('subpages', { id: 3864210, contestId: null, title: 'UZI info', bodyMd: 'ICPC-style, 3-person teams autumn.', attachments: [] });

  store.insert('audit', { actorId: admin.id, action: 'seed', target: 'db', at: new Date().toISOString(), meta: {} });
  console.log('Seeded: orgs=3 users=3 contests=3 (251519, 8677128, 10193118)');
}

if (require.main === module) main();
module.exports = { main };
