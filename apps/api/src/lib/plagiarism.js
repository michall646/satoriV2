// Satori V2 — MOSS / JPlag external plagiarism detection adapter.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { store } = require('./store');
const { similarityGraph } = require('./integrity');
const { runProcess } = require('../../../../packages/judge/src/run');

function isMossAvailable() {
  const custom = process.env.MOSS_SCRIPT;
  if (custom && fs.existsSync(custom)) return true;
  const probe = runProcess(process.platform === 'win32' ? 'where.exe' : 'which', ['moss'], { timeMs: 2000 });
  return probe.exitCode === 0;
}

function isJPlagAvailable() {
  const jar = process.env.JPLAG_JAR;
  if (jar && fs.existsSync(jar)) return true;
  const probe = runProcess(process.platform === 'win32' ? 'where.exe' : 'which', ['jplag'], { timeMs: 2000 });
  return probe.exitCode === 0;
}

function getAvailableTools() {
  return {
    builtin: true,
    moss: isMossAvailable(),
    jplag: isJPlagAvailable(),
  };
}

// Prepares submission files in a temporary directory tree structured by user login
function exportProblemSubmissions(contestId, problemId, targetDir) {
  const query = (s) => String(s.contestId) === String(contestId)
    && (problemId == null || problemId === 'all' || String(s.problemId) === String(problemId))
    && !s.sampleOnly
    && Boolean(s.code);
  const submits = store.query('submits', query);
  const users = new Map(store.all('users').map((u) => [String(u.id), u.login]));
  const exported = [];

  for (const s of submits) {
    const login = users.get(String(s.userId)) || `user_${s.userId}`;
    const userDir = path.join(targetDir, login);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    const ext = path.extname(s.filename || '') || (s.language === 'Python' ? '.py' : s.language === 'Java' ? '.java' : '.cpp');
    const filePath = path.join(userDir, `sub_${s.id}${ext}`);
    fs.writeFileSync(filePath, s.code, 'utf8');
    exported.push({ submitId: s.id, userId: s.userId, login, filePath });
  }

  return { submits, exported };
}

async function runPlagiarismCheck(contestId, problemId, opts = {}) {
  const threshold = Number(opts.threshold) || 0.6;
  const requestedTool = (opts.tool || 'auto').toLowerCase();
  const tools = getAvailableTools();

  const query = (s) => String(s.contestId) === String(contestId)
    && (problemId == null || problemId === 'all' || String(s.problemId) === String(problemId))
    && !s.sampleOnly
    && Boolean(s.code);
  const submits = store.query('submits', query);
  const users = new Map(store.all('users').map((u) => [String(u.id), u.login]));

  let selectedTool = 'builtin';
  let reportUrl = null;

  if (requestedTool === 'moss' && tools.moss) {
    selectedTool = 'moss';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-moss-'));
    try {
      exportProblemSubmissions(contestId, problemId, tmpDir);
      const mossCmd = process.env.MOSS_SCRIPT || 'moss';
      const r = runProcess(mossCmd, ['-d', path.join(tmpDir, '*', '*')], { timeMs: 30000 });
      if (r.stdout) {
        const urlMatch = r.stdout.match(/https?:\/\/moss\.stanford\.edu\/results\/\S+/);
        if (urlMatch) reportUrl = urlMatch[0];
      }
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  } else if (requestedTool === 'jplag' && tools.jplag) {
    selectedTool = 'jplag';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-jplag-'));
    try {
      exportProblemSubmissions(contestId, problemId, tmpDir);
      // Run JPlag CLI if installed
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }

  // Normalized pair comparison (combines with built-in AST shingles)
  const rawPairs = similarityGraph(submits);
  const pairs = rawPairs
    .filter((p) => (p.score ?? 0) >= threshold)
    .map((p) => {
      const a = submits.find((s) => String(s.id) === String(p.a)) || {};
      const b = submits.find((s) => String(s.id) === String(p.b)) || {};
      return {
        a: p.a,
        b: p.b,
        problemId: p.problemId,
        score: p.score,
        userA: users.get(String(a.userId)) || '?',
        userB: users.get(String(b.userId)) || '?',
        codeA: a.code || '',
        codeB: b.code || '',
        flag: p.flag || (p.score >= 0.85 ? 'high' : 'medium'),
      };
    })
    .sort((x, y) => y.score - x.score);

  return {
    tool: selectedTool,
    requestedTool,
    threshold,
    problemId: problemId || 'all',
    scannedCount: submits.length,
    matchCount: pairs.length,
    pairs,
    reportUrl,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = {
  isMossAvailable,
  isJPlagAvailable,
  getAvailableTools,
  exportProblemSubmissions,
  runPlagiarismCheck,
};
