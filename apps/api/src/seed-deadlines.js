// Satori V2 — additive seed: test contest with deadlines (C++ oriented).
// Run: node apps/api/src/seed-deadlines.js  (never wipes, skips if exists)
// What seed.js is: apps/api/src/seed.js is the canonical demo-DB factory.
// It RESETS all JSON collections in apps/api/data/*.json, then inserts
// organizations, users (admin/g_herman/jan_kowalski), 3 contests
// (Playground 251519, Rust LABS 8677128, UZI ICPC 10193118), plus
// problemSets/problems/testGroups/testCases/news/subpages. This file does
// the same shape but ADDITIVELY for one LABS contest, so your data survives.
'use strict';
const { store } = require('./lib/store');

const NAME = 'Deadlines Lab 2026 (C++)';

function findUser(login) {
  return store.query('users', (u) => u.login === login)[0];
}

function mkTestData(problemId, cases) {
  const g = store.insert('testGroups', { problemId, name: 'all', points: 100, subtask: 1 });
  for (const c of cases) store.insert('testCases', { groupId: g.id, input: c.input, expected: c.expected, checker: 'token', timeMs: 1000, memoryMb: 256 });
}

function pMj({ title, body }) {
  return `# ${title}\n\n${body}\n`;
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
    description: 'Test LABS contest — staggered deadlines, C++ statements + samples. Soft late: -10/d, grace 30m, cap 7d.',
    mode: 'LABS', lifecycle: 'running', registration: 'invite',
    archived: false, startAt: iso(now - 86400000), endAt, freezeAt: null,
    settings: {
      penaltyMin: 0, verdictVisibility: 'all', allowSampleRun: true,
      bestOfK: 3, latePenaltyPerDay: 10, defaultDeadline: endAt,
      deadlinePolicy: { enabled: true, lateMode: 'soft', penaltyKind: 'perDay', penaltyValue: 10, graceMin: 30, capZeroAfterDays: 7 },
    },
    members: [student.id], pending: [], admins: [teacher.id],
  });

  const warmup = store.insert('problemSets', { contestId: contest.id, title: 'Warmup', order: 1 });
  const labs1 = store.insert('problemSets', { contestId: contest.id, title: 'Labs 1', order: 2 });
  const lim = { timeMs: 1000, memoryMb: 256, stackMb: 64, perLang: { Python: 2000 } };

  const defs = [
    {
      setId: warmup.id, code: 'A', name: 'Sum Arrays', difficulty: 1, tags: ['intro', 'cpp'],
      deadlineAt: iso(now - 2 * 86400000),
      samples: [{ input: '5\n1 2 3 4 5\n', output: '15\n' }, { input: '3\n-1 0 1\n', output: '0\n' }],
      body: `## Task\nGiven \`n\` followed by \`n\` integers, print their sum.\n\n## Input\n- Line 1: integer \`n\` (1 ≤ n ≤ 100000)\n- Line 2: \`n\` integers, each |a| ≤ 10^9 (may span lines)\n\n## Output\nSingle integer — the sum (fits in 64-bit).\n\n## Example\nInput:\n\`\`\`\n5\n1 2 3 4 5\n\`\`\`\nOutput:\n\`\`\`\n15\n\`\`\`\n\n## C++ starter\n\`\`\`cpp\n#include <bits/stdc++.h>\nusing namespace std;\nint main() {\n  ios::sync_with_stdio(false);\n  cin.tie(nullptr);\n  int n; if (!(cin >> n)) return 0;\n  long long s = 0, x;\n  for (int i = 0; i < n; ++i) { cin >> x; s += x; }\n  cout << s << '\\n';\n}\n\`\`\`\n\n## Limits\n1.0s (x2 Python) / 256 MB. O(n) expected.`,
    },
    {
      setId: warmup.id, code: 'B', name: 'Palindrome Check', difficulty: 2, tags: ['strings', 'cpp'],
      deadlineAt: iso(now + 20 * 3600000),
      samples: [{ input: 'kayak\n', output: 'YES\n' }, { input: 'hello\n', output: 'NO\n' }],
      body: `## Task\nCheck if the given word is a palindrome (reads same forward/backward). Case-sensitive, lowercase a-z.\n\n## Input\nSingle word \`s\` (1 ≤ |s| ≤ 100000).\n\n## Output\n\`YES\` if palindrome, else \`NO\`.\n\n## Example\nInput: \`kayak\` → Output: \`YES\`\n\n## C++ starter\n\`\`\`cpp\n#include <bits/stdc++.h>\nusing namespace std;\nint main() {\n  ios::sync_with_stdio(false);\n  cin.tie(nullptr);\n  string s; if (!(cin >> s)) return 0;\n  string r = s; reverse(r.begin(), r.end());\n  cout << (s == r ? \"YES\" : \"NO\") << '\\n';\n}\n\`\`\`\n\n## Limits\n1.0s / 256 MB. O(|s|) expected.`,
    },
    {
      setId: labs1.id, code: 'C', name: 'Binary Search', difficulty: 3, tags: ['binary-search', 'cpp'],
      deadlineAt: iso(now + 6 * 86400000),
      samples: [{ input: '5 3\n1 2 3 4 5\n', output: '2\n' }, { input: '4 9\n1 2 3 4\n', output: '-1\n' }],
      body: `## Task\nSorted array, find index of \`q\` (0-based) or -1.\n\n## Input\n- Line 1: \`n q\` (1 ≤ n ≤ 200000)\n- Line 2: \`n\` sorted integers ascending\n\n## Output\nIndex of \`q\` or \`-1\`.\n\n## Example\nInput:\n\`\`\`\n5 3\n1 2 3 4 5\n\`\`\`\nOutput:\n\`\`\`\n2\n\`\`\`\n\n## C++ starter\n\`\`\`cpp\n#include <bits/stdc++.h>\nusing namespace std;\nint main() {\n  ios::sync_with_stdio(false);\n  cin.tie(nullptr);\n  int n; long long q; if (!(cin >> n >> q)) return 0;\n  vector<long long> a(n);\n  for (int i = 0; i < n; ++i) cin >> a[i];\n  cout << (lower_bound(a.begin(), a.end(), q) != a.end() && *lower_bound(a.begin(), a.end(), q) == q ? (int)(lower_bound(a.begin(), a.end(), q) - a.begin()) : -1) << '\\n';\n}\n\`\`\`\n\n## Limits\n1.0s / 256 MB. O(log n) expected (std::binary_search / lower_bound).`,
    },
    {
      setId: labs1.id, code: 'D', name: 'FizzBuzz', difficulty: 1, tags: ['intro', 'cpp'],
      deadlineAt: null,
      samples: [{ input: '5\n', output: '1\n2\nFizz\n4\nBuzz\n' }],
      body: `## Task\nClassic FizzBuzz 1..n. Multiples of 3 → Fizz, 5 → Buzz, both → FizzBuzz.\n\n## Input\nInteger \`n\` (1 ≤ n ≤ 100000).\n\n## Output\n\`n\` lines, one per i = 1..n.\n\n## Example (n=5)\n\`\`\`\n1\n2\nFizz\n4\nBuzz\n\`\`\`\n\n## C++ starter\n\`\`\`cpp\n#include <bits/stdc++.h>\nusing namespace std;\nint main() {\n  ios::sync_with_stdio(false);\n  cin.tie(nullptr);\n  int n; if (!(cin >> n)) return 0;\n  for (int i = 1; i <= n; ++i) {\n    if (i % 15 == 0) cout << \"FizzBuzz\\n\";\n    else if (i % 3 == 0) cout << \"Fizz\\n\";\n    else if (i % 5 == 0) cout << \"Buzz\\n\";\n    else cout << i << '\\n';\n  }\n}\n\`\`\`\n\n## Deadline\nNone on problem — falls back to contest end (tests header fallback + problems-table \\u2014 case).\n\n## Limits\n1.0s / 256 MB. O(n) output.`,
    },
  ];

  for (const d of defs) {
    const md = pMj({ title: `${d.code} — ${d.name}`, body: d.body });
    const p = store.insert('problems', {
      contestId: contest.id, setId: d.setId, code: d.code, name: d.name,
      statementMd: md, statementHtml: `<h1>${d.name}</h1>`,
      samples: d.samples, limits: lim, visibility: 'visible',
      tags: d.tags, difficulty: d.difficulty, pdfBadge: 'HTML',
      version: 1, aliasLetters: {}, deadlineAt: d.deadlineAt,
    });
    mkTestData(p.id, d.samples);
  }
  store.insert('news', { contestId: contest.id, title: 'Deadlines on', bodyMd: 'A overdue, B <24h, C future, D fallback to contest end. Soft late -10/d.', createdAt: new Date().toISOString() });
  console.log(`Seeded contest "${NAME}" id=${contest.id} (4 problems, C++).`);
}

if (require.main === module) main();
module.exports = { main };
