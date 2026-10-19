// Satori V2 — additive seed: example C++ contest with IOI ranking.
// Run: node apps/api/src/seed-ioi-cpp.js  (never wipes, skips if exists)
'use strict';
const { store } = require('./lib/store');

const NAME = 'Cpp IOI Example 2026';

function findUser(login) {
  return store.query('users', (u) => u.login === login)[0];
}

function mkTestData(problemId, cases) {
  const g = store.insert('testGroups', { problemId, name: 'all', points: 100, subtask: 1 });
  for (const c of cases) store.insert('testCases', { groupId: g.id, input: c.input, expected: c.expected, checker: 'token', timeMs: 1000, memoryMb: 256 });
}

function main() {
  if (store.query('contests', (c) => c.name === NAME)[0]) {
    console.log('Exists, skipping.');
    return;
  }
  const teacher = findUser('g_herman');
  const student = findUser('jan_kowalski');
  if (!teacher || !student) throw new Error('Base seed missing. Run: node apps/api/src/seed.js first.');
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const endAt = iso(now + 21 * 86400000);

  const contest = store.insert('contests', {
    name: NAME,
    description: 'Example C++ contest — IOI ranking, best points per problem summed.',
    mode: 'IOI', lifecycle: 'running', registration: 'invite',
    archived: false, startAt: iso(now - 86400000), endAt, freezeAt: null,
    settings: {
      penaltyMin: 0, verdictVisibility: 'all', allowSampleRun: true,
      deadlinePolicy: { enabled: false, lateMode: 'soft', penaltyKind: 'perDay', penaltyValue: 0, graceMin: 0 },
    },
    members: [student.id], pending: [], admins: [teacher.id],
  });

  const warmup = store.insert('problemSets', { contestId: contest.id, title: 'Warmup', order: 1 });
  const mainSet = store.insert('problemSets', { contestId: contest.id, title: 'Main', order: 2 });
  const lim = { timeMs: 1000, memoryMb: 256, stackMb: 64, perLang: { Python: 2000 } };

  const defs = [
    {
      setId: warmup.id, code: 'A', name: 'Sum', difficulty: 1, tags: ['intro', 'cpp'],
      samples: [{ input: '2 3\n', output: '5\n' }, { input: '10 20\n', output: '30\n' }],
      body: `## Task\nGiven two integers, print their sum.\n\n## C++ starter\n\`\`\`cpp\n#include <bits/stdc++.h>\nusing namespace std;\nint main() {\n  ios::sync_with_stdio(false);\n  cin.tie(nullptr);\n  long long a, b; if (!(cin >> a >> b)) return 0;\n  cout << a + b << '\\n';\n}\n\`\`\``,
    },
    {
      setId: warmup.id, code: 'B', name: 'MinMax', difficulty: 1, tags: ['intro', 'cpp'],
      samples: [{ input: '5\n1 2 3 4 5\n', output: '1 5\n' }, { input: '3\n-1 0 1\n', output: '-1 1\n' }],
      body: `## Task\nGiven n then n integers, print min and max.\n\n## C++ starter\n\`\`\`cpp\n#include <bits/stdc++.h>\nusing namespace std;\nint main() {\n  ios::sync_with_stdio(false);\n  cin.tie(nullptr);\n  int n; if (!(cin >> n)) return 0;\n  long long mn = LLONG_MAX, mx = LLONG_MIN, x;\n  for (int i = 0; i < n; ++i) { cin >> x; mn = min(mn, x); mx = max(mx, x); }\n  cout << mn << ' ' << mx << '\\n';\n}\n\`\`\``,
    },
    {
      setId: mainSet.id, code: 'C', name: 'Sort', difficulty: 2, tags: ['sort', 'cpp'],
      samples: [{ input: '3\n3 2 1\n', output: '1 2 3\n' }, { input: '4\n4 1 3 2\n', output: '1 2 3 4\n' }],
      body: `## Task\nGiven n then n integers, print them sorted ascending.\n\n## C++ starter\n\`\`\`cpp\n#include <bits/stdc++.h>\nusing namespace std;\nint main() {\n  ios::sync_with_stdio(false);\n  cin.tie(nullptr);\n  int n; if (!(cin >> n)) return 0;\n  vector<long long> a(n);\n  for (int i = 0; i < n; ++i) cin >> a[i];\n  sort(a.begin(), a.end());\n  for (int i = 0; i < n; ++i) { if (i) cout << ' '; cout << a[i]; }\n  cout << '\\n';\n}\n\`\`\``,
    },
    {
      setId: mainSet.id, code: 'D', name: 'Prime Check', difficulty: 2, tags: ['math', 'cpp'],
      samples: [{ input: '7\n', output: 'YES\n' }, { input: '8\n', output: 'NO\n' }],
      body: `## Task\nCheck if n is prime. Print YES/NO.\n\n## C++ starter\n\`\`\`cpp\n#include <bits/stdc++.h>\nusing namespace std;\nint main() {\n  ios::sync_with_stdio(false);\n  cin.tie(nullptr);\n  long long n; if (!(cin >> n)) return 0;\n  if (n < 2) { cout << "NO\\n"; return 0; }\n  for (long long d = 2; d * d <= n; ++d) if (n % d == 0) { cout << "NO\\n"; return 0; }\n  cout << "YES\\n";\n}\n\`\`\``,
    },
  ];

  for (const d of defs) {
    const md = `# ${d.code} — ${d.name}\n\n${d.body}\n`;
    const p = store.insert('problems', {
      contestId: contest.id, setId: d.setId, code: d.code, name: d.name,
      statementMd: md, statementHtml: `<h1>${d.name}</h1>`,
      samples: d.samples, limits: lim, visibility: 'visible',
      tags: d.tags, difficulty: d.difficulty, pdfBadge: 'HTML',
      version: 1, aliasLetters: {}, deadlineAt: null,
    });
    mkTestData(p.id, d.samples);
  }
  console.log(`Seeded contest "${NAME}" id=${contest.id} (4 problems, C++ IOI).`);
}

if (require.main === module) main();
module.exports = { main };
