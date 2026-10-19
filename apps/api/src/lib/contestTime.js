// Satori V2 — contest time canonicalization (D1: `endAt` is canonical, `stopAt` is an input alias).
// Pure helpers: no store access, safe to use from route writers and the ranking engine.
'use strict';

function toIso(value) {
  if (value == null || value === '') return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// Prefer the canonical `endAt`; fall back to the deprecated `stopAt` alias.
// Invalid/blank values resolve to null. Always returns an ISO string or null.
function resolveContestEnd(contest) {
  if (!contest || typeof contest !== 'object') return null;
  return toIso(contest.endAt) || toIso(contest.stopAt);
}

// Shallow copy with `endAt` canonicalized and `stopAt` removed.
// Writers call this before persisting a contest/patch. A patch that carries no
// time field is returned untouched so it cannot accidentally clear the end.
function normalizeContestTime(contest) {
  if (!contest || typeof contest !== 'object') return contest;
  const hasEnd = Object.prototype.hasOwnProperty.call(contest, 'endAt');
  const hasStop = Object.prototype.hasOwnProperty.call(contest, 'stopAt');
  if (!hasEnd && !hasStop) return { ...contest };
  const out = { ...contest, endAt: resolveContestEnd(contest) };
  delete out.stopAt;
  return out;
}

module.exports = { resolveContestEnd, normalizeContestTime };
