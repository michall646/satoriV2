// Integrity: Moss/JPlag-style similarity (token shingles) + timeline anomaly flags.
// Jury-only. Opt-in per contest: settings.integrity=true.
//
// F7 rules:
// - compare submissions only within the same problem;
// - never compare a user with themselves;
// - normalize local identifiers so renaming variables does not evade a match;
// - every similarity pair and timeline flag carries `problemId`.
'use strict';

// Common keywords are kept: they describe the program shape. Everything else that
// looks like an identifier collapses to `id`, so `int a` and `int score` match.
const KEYWORDS = new Set([
  // C / C++
  'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
  'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register', 'restrict', 'return',
  'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void',
  'volatile', 'while', 'class', 'namespace', 'template', 'typename', 'public', 'private', 'protected',
  'virtual', 'override', 'new', 'delete', 'this', 'using', 'try', 'catch', 'throw', 'bool', 'true',
  'false', 'nullptr', 'constexpr', 'noexcept', 'operator', 'friend', 'explicit', 'mutable',
  // Python
  'and', 'as', 'assert', 'async', 'await', 'def', 'del', 'elif', 'except', 'finally', 'from',
  'global', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'with',
  'yield', 'none', 'self', 'print', 'range', 'len',
  // Java
  'abstract', 'boolean', 'byte', 'extends', 'final', 'implements', 'instanceof', 'interface',
  'native', 'package', 'strictfp', 'super', 'synchronized', 'throws', 'transient', 'string',
  'system', 'main', 'args',
]);

// Tokenizer keeps operators and punctuation: `a+b` and `a-b` must not collapse to
// the same shingle. Multi-char operators are matched before single-char ones.
const TOKEN_RE = /[a-z_][a-z0-9_]*|\d+(?:\.\d+)?|==|!=|<=|>=|&&|\|\||\+\+|--|[+\-*/%<>=!&|^~?:;,.()[\]{}$#]/g;

function tokenize(code) {
  return String(code || '').toLowerCase().match(TOKEN_RE) || [];
}

function normalizeIdentifiers(tokens) {
  return tokens.map((tok) => {
    if (/^\d/.test(tok)) return tok;
    if (/^[a-z_]/.test(tok) && !KEYWORDS.has(tok)) return 'id';
    return tok;
  });
}

function shingles(code, k = 5) {
  const tokens = normalizeIdentifiers(tokenize(code));
  const set = new Set();
  for (let i = 0; i + k <= tokens.length; i++) set.add(tokens.slice(i, i + k).join(' '));
  return set;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function sameProblem(a, b) {
  return String(a.problemId ?? '') === String(b.problemId ?? '');
}

function sameUser(a, b) {
  return a.userId != null && b.userId != null && String(a.userId) === String(b.userId);
}

// submits: [{ id, userId, problemId, code, createdAt }]
// Returns only cross-user, same-problem pairs.
function similarityGraph(submits) {
  const rows = (submits || []).filter((s) => s && s.code != null);
  const grams = new Map(rows.map((s) => [String(s.id), shingles(s.code)]));
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (sameUser(a, b)) continue;
      if (!sameProblem(a, b)) continue;
      const score = jaccard(grams.get(String(a.id)), grams.get(String(b.id)));
      if (score < 0.6) continue;
      out.push({
        a: a.id,
        b: b.id,
        problemId: a.problemId ?? null,
        score: Math.round(score * 100) / 100,
        flag: score >= 0.85 ? 'high' : 'medium',
      });
    }
  }
  return out;
}

// Flags a submit posted <60s after another user's submit for the same problem.
// Submissions for different problems are never compared: the old global scan
// produced false positives on a normal contest pace.
function timelineFlags(submits) {
  const flags = [];
  const byProblem = new Map();
  for (const s of submits || []) {
    if (!s) continue;
    const key = String(s.problemId ?? '');
    if (!byProblem.has(key)) byProblem.set(key, []);
    byProblem.get(key).push(s);
  }
  for (const rows of byProblem.values()) {
    const sorted = [...rows].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (sameUser(prev, cur)) continue;
      const dt = new Date(cur.createdAt) - new Date(prev.createdAt);
      if (!Number.isFinite(dt) || dt < 0 || dt >= 60000) continue;
      flags.push({
        submitId: cur.id,
        peerSubmitId: prev.id,
        problemId: cur.problemId ?? null,
        reason: 'rapid-after-peer',
        dtMs: dt,
        at: cur.createdAt,
      });
    }
  }
  flags.sort((a, b) => new Date(a.at) - new Date(b.at));
  return flags;
}

module.exports = { shingles, jaccard, similarityGraph, timelineFlags, tokenize, normalizeIdentifiers };
