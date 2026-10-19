// Satori V2 data migration: normalize fields without changing behavior first.
// Dry-run by default. Use --apply to write (creates a backup first).
//
//   node scripts/migrate-v2.js
//   node scripts/migrate-v2.js --apply
//   SATORI_DATA_DIR=/path/to/data node scripts/migrate-v2.js --apply
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dataDirArg = args.find((a) => a.startsWith('--data-dir='));
if (dataDirArg) process.env.SATORI_DATA_DIR = dataDirArg.slice('--data-dir='.length);

const { store, DATA_DIR } = require('../apps/api/src/lib/store');

const GRADE_SCALE = [{ min: 90, grade: 5 }, { min: 75, grade: 4 }, { min: 50, grade: 3 }, { min: 0, grade: 2 }];
const LANG = {
  c: 'C', cpp: 'C++17', 'c++': 'C++17', 'c++17': 'C++17', cc: 'C++17', cxx: 'C++17',
  java: 'Java', python: 'Python', py: 'Python', rust: 'Rust', rs: 'Rust',
  javascript: 'JavaScript', js: 'JavaScript', node: 'JavaScript',
};

const stats = {
  contests: 0, teams: 0, users: 0, problems: 0,
  endAt: 0, scoreboardMode: 0, penaltyMin: 0, gradeScale: 0, exam: 0,
  archived: 0, perLangKey: 0, perLangMultiplier: 0,
};

function isObj(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }

function deriveScoreboardMode(mode) {
  const m = String(mode || '').toUpperCase();
  if (m === 'IOI' || m === 'EXAM' || m === 'TAKEHOME' || m === 'PLAYGROUND') return 'IOI';
  if (m === 'LABS' || m === 'COURSE') return 'LABS';
  return 'ICPC';
}

function canonicalLang(k) {
  const key = String(k || '').toLowerCase();
  return LANG[key] || k;
}

function normalizeExam(settings) {
  if (!isObj(settings)) return false;
  const e = isObj(settings.exam) ? { ...settings.exam } : {};
  let changed = false;
  if (e.ipAllow == null && e.ips != null) { e.ipAllow = e.ips; changed = true; }
  if (e.timeWindow == null && e.tokens != null) { e.timeWindow = e.tokens; changed = true; }
  if (e.ipAllow == null && settings.ips != null) { e.ipAllow = settings.ips; changed = true; }
  if (e.timeWindow == null && settings.tokens != null) { e.timeWindow = settings.tokens; changed = true; }
  if ('ips' in e) { delete e.ips; changed = true; }
  if ('tokens' in e) { delete e.tokens; changed = true; }
  if ('ips' in settings) { delete settings.ips; changed = true; }
  if ('tokens' in settings) { delete settings.tokens; changed = true; }
  if (!isObj(settings.exam) || changed) {
    settings.exam = {
      fullscreen: Boolean(e.fullscreen),
      pasteBlock: Boolean(e.pasteBlock),
      shuffle: Boolean(e.shuffle),
      ipAllow: String(e.ipAllow ?? '').trim(),
      timeWindow: String(e.timeWindow ?? '').trim(),
    };
    return true;
  }
  return false;
}

function normalizePerLang(limits) {
  if (!isObj(limits) || !isObj(limits.perLang)) return false;
  const out = {};
  let changed = false;
  for (const [rawKey, rawValue] of Object.entries(limits.perLang)) {
    const key = canonicalLang(rawKey);
    if (key !== rawKey) { stats.perLangKey += 1; changed = true; }
    let value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) { continue; }
    // Heuristic: values <= 10 were authored as a multiplier in the old UI.
    const timeMs = Number(limits.timeMs) || 0;
    if (timeMs > 0 && value > 0 && value <= 10) {
      value = Math.round(timeMs * value);
      stats.perLangMultiplier += 1;
      changed = true;
    }
    if (out[key] == null || value > out[key]) out[key] = value;
    if (out[key] !== Number(rawValue)) changed = true;
  }
  if (changed) limits.perLang = out;
  return changed;
}

function normalizeContest(c) {
  let changed = false;
  if (c.stopAt && !c.endAt) { c.endAt = c.stopAt; stats.endAt += 1; changed = true; }
  if ('stopAt' in c) { delete c.stopAt; changed = true; }

  const settings = isObj(c.settings) ? { ...c.settings } : {};
  const scoring = isObj(settings.scoring) ? { ...settings.scoring } : {};

  if (!c.scoreboardMode) {
    c.scoreboardMode = deriveScoreboardMode(c.mode);
    stats.scoreboardMode += 1;
    changed = true;
  }

  if (settings.penaltyMin == null) {
    settings.penaltyMin = Number(scoring.wrongTryMin ?? c.penalty ?? 20);
    stats.penaltyMin += 1;
    changed = true;
  }

  if (!Array.isArray(settings.gradeScale) || !settings.gradeScale.length) {
    settings.gradeScale = GRADE_SCALE;
    stats.gradeScale += 1;
    changed = true;
  }

  if (normalizeExam(settings)) { stats.exam += 1; changed = true; }

  if (isObj(settings.scoring) && ('dropWorstN' in settings.scoring)) {
    // keep explicit dropWorstN
  } else if (!isObj(settings.scoring)) {
    settings.scoring = scoring;
  }

  if (String(c.lifecycle || '').toLowerCase() === 'archived' && !c.archived) {
    c.archived = true;
    stats.archived += 1;
    changed = true;
  }

  if (changed) {
    c.settings = settings;
    stats.contests += 1;
  }
  return changed;
}

function normalizeTeam(t) {
  let changed = false;
  if (!Array.isArray(t.members) && Array.isArray(t.memberIds)) {
    t.members = t.memberIds.map(String);
    changed = true;
  }
  // Keep memberIds for the current code until the team workstream lands.
  if (changed) stats.teams += 1;
  return changed;
}

function normalizeUser(u) {
  if (u.usosId != null) return false;
  u.usosId = '';
  stats.users += 1;
  return true;
}

function normalizeProblem(p) {
  let changed = false;
  if (isObj(p.limits) && normalizePerLang(p.limits)) changed = true;
  if (changed) stats.problems += 1;
  return changed;
}

function backup() {
  if (!fs.existsSync(DATA_DIR)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(path.dirname(DATA_DIR), `data-backup-${stamp}`);
  fs.cpSync(DATA_DIR, dest, { recursive: true });
  return dest;
}

function migrateCollection(name, fn) {
  const rows = store.all(name);
  let changed = 0;
  for (const row of rows) {
    try { if (fn(row)) changed += 1; } catch (e) { console.warn(`skip ${name}#${row.id}: ${e.message}`); }
  }
  if (apply && changed) store.replaceAll(name, rows);
  return { total: rows.length, changed };
}

function main() {
  console.log(`data dir: ${DATA_DIR}`);
  console.log(apply ? 'mode: APPLY' : 'mode: DRY RUN (pass --apply to write)');

  if (apply) {
    const dest = backup();
    console.log(dest ? `backup: ${dest}` : 'backup: skipped (data dir missing)');
  }

  const result = {
    contests: migrateCollection('contests', normalizeContest),
    teams: migrateCollection('teams', normalizeTeam),
    users: migrateCollection('users', normalizeUser),
    problems: migrateCollection('problems', normalizeProblem),
  };

  console.log(JSON.stringify({ ...result, stats }, null, 2));
  if (!apply) console.log('No files written. Re-run with --apply.');
}

main();
