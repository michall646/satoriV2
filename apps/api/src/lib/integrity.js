// Integrity: Moss/JPlag-style similarity (token shingles) + timeline anomaly flags.
// Jury-only. Opt-in per contest: settings.integrity=true.
'use strict';
function shingles(code, k = 5) {
  const toks = String(code).toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
  const set = new Set();
  for (let i = 0; i + k <= toks.length; i++) set.add(toks.slice(i, i + k).join(' '));
  return set;
}
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}
function similarityGraph(submits) {
  // submits: [{id,userId,code,createdAt}]
  const out = [];
  for (let i = 0; i < submits.length; i++) {
    for (let j = i + 1; j < submits.length; j++) {
      const s = jaccard(shingles(submits[i].code), shingles(submits[j].code));
      if (s >= 0.6) out.push({ a: submits[i].id, b: submits[j].id, score: Math.round(s * 100) / 100, flag: s >= 0.85 ? 'high' : 'medium' });
    }
  }
  return out;
}
function timelineFlags(submits) {
  // flag: solves <60s after another user's identical verdict pattern (leak hint)
  const flags = [];
  const sorted = [...submits].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  for (let i = 1; i < sorted.length; i++) {
    const dt = new Date(sorted[i].createdAt) - new Date(sorted[i - 1].createdAt);
    if (dt < 60000 && sorted[i].userId !== sorted[i - 1].userId) flags.push({ submitId: sorted[i].id, reason: 'rapid-after-peer', dtMs: dt });
  }
  return flags;
}
module.exports = { similarityGraph, timelineFlags };
