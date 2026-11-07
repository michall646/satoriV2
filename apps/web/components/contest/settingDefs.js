// Single source for contest settings: labels + hover info + per-template defaults.
// Backend stores `settings` object wholesale via POST/PATCH /api/contests (no API change needed).
// Engine (ranking.js) reads: scoring.{rule,wrongTryMin,exemptCE,floorPct,dropWorstN,tiebreak},
// deadlinePolicy.{enabled,lateMode,penaltyKind,penaltyValue,graceMin,capZeroAfterDays}, bestOfK, board.
'use client';

export const INFO = {
  name: 'sdef_i_name',
  description: 'sdef_i_description',
  mode: 'sdef_i_mode',
  scoreboardMode: 'sdef_i_scoreboardMode',
  scoreRule: 'sdef_i_scoreRule',
  registration: 'sdef_i_registration',
  contestVisibility: 'sdef_i_contestVisibility',
  autoApproveRegex: 'sdef_i_autoApproveRegex',
  startAt: 'sdef_i_startAt',
  stopAt: 'sdef_i_stopAt',
  freezeAt: 'sdef_i_freezeAt',
  freezeLastMin: 'sdef_i_freezeLastMin',
  boardMode: 'sdef_i_boardMode',
  defaultDeadline: 'sdef_i_defaultDeadline',
  enabled: 'sdef_i_enabled',
  lateMode: 'sdef_i_lateMode',
  penaltyKind: 'sdef_i_penaltyKind',
  penaltyValue: 'sdef_i_penaltyValue',
  graceMin: 'sdef_i_graceMin',
  capZeroAfterDays: 'sdef_i_capZeroAfterDays',
  floorPct: 'sdef_i_floorPct',
  missDeduction: 'sdef_i_missDeduction',
  missAccrue: 'sdef_i_missAccrue',
  tiers: 'sdef_i_tiers',
  maxTries: 'sdef_i_maxTries',
  weight: 'sdef_i_weight',
  wrongTryMin: 'sdef_i_wrongTryMin',
  exemptCE: 'sdef_i_exemptCE',
  bestOfK: 'sdef_i_bestOfK',
  latePenaltyPerDay: 'sdef_i_latePenaltyPerDay',
  verdictVisibility: 'sdef_i_verdictVisibility',
  allowSampleRun: 'sdef_i_allowSampleRun',
  tiebreak: 'sdef_i_tiebreak',
  examFullscreen: 'sdef_i_examFullscreen',
  examPasteBlock: 'sdef_i_examPasteBlock',
  examShuffle: 'sdef_i_examShuffle',
  examIpAllow: 'sdef_i_examIpAllow',
  duplicateFrom: 'sdef_i_duplicateFrom',
  csv: 'sdef_i_csv',
};

export const SCORE_RULES = [
  { id: 'best', labelKey: 'sdef_rule_best' },
  { id: 'latest', labelKey: 'sdef_rule_latest' },
  { id: 'solved-count', labelKey: 'sdef_rule_solved' },
];

export const TIEBREAK_KEYS = [
  { id: 'solves', labelKey: 'sdef_tie_solves' },
  { id: 'time', labelKey: 'sdef_tie_time' },
  { id: 'attempts', labelKey: 'sdef_tie_attempts' },
  { id: 'lastSolve', labelKey: 'sdef_tie_lastsolve' },
];

export const TEMPLATE_SETTINGS = {
  ICPC: {
    scoring: { enabled: false, lateMode: 'soft', penaltyKind: 'perDay', penaltyValue: 0, graceMin: 0, capZeroAfterDays: null, penaltyMin: 20, wrongTryMin: 20, exemptCE: true, rule: 'best', floorPct: '', bestOfK: '', latePenaltyPerDay: 0, tiebreak: ['solves', 'time', 'attempts'] },
    judging: { verdictVisibility: 'first-failed', allowSampleRun: true },
    exam: { fullscreen: false, pasteBlock: false, shuffle: false, ipAllow: '' },
    board: { mode: 'everyone', freezeLastMin: 60 },
  },
  IOI: {
    scoring: { enabled: false, lateMode: 'soft', penaltyKind: 'perDay', penaltyValue: 10, graceMin: 0, capZeroAfterDays: null, penaltyMin: 0, wrongTryMin: 0, exemptCE: true, rule: 'best', floorPct: '', bestOfK: '', latePenaltyPerDay: 10, tiebreak: ['solves', 'attempts', 'lastSolve'] },
    judging: { verdictVisibility: 'first-failed', allowSampleRun: true },
    exam: { fullscreen: false, pasteBlock: false, shuffle: false, ipAllow: '' },
    board: { mode: 'everyone', freezeLastMin: '' },
  },
  LABS: {
    scoring: { enabled: true, lateMode: 'soft', penaltyKind: 'perDay', penaltyValue: 5, graceMin: 60, capZeroAfterDays: 14, penaltyMin: 0, wrongTryMin: 0, exemptCE: true, rule: 'best', floorPct: 50, bestOfK: 6, latePenaltyPerDay: 5, tiebreak: ['solves', 'attempts'] },
    judging: { verdictVisibility: 'all', allowSampleRun: true },
    exam: { fullscreen: false, pasteBlock: false, shuffle: false, ipAllow: '' },
    board: { mode: 'everyone', freezeLastMin: '' },
  },
  EXAM: {
    scoring: { enabled: true, lateMode: 'hard', penaltyKind: 'perDay', penaltyValue: 0, graceMin: 0, capZeroAfterDays: null, penaltyMin: 0, wrongTryMin: 0, exemptCE: true, rule: 'best', floorPct: '', bestOfK: '', latePenaltyPerDay: 0, tiebreak: ['solves', 'time'] },
    judging: { verdictVisibility: 'none', allowSampleRun: false },
    exam: { fullscreen: true, pasteBlock: true, shuffle: true, ipAllow: '' },
    board: { mode: 'hidden', freezeLastMin: '' },
  },
  PLAYGROUND: {
    scoring: { enabled: false, lateMode: 'soft', penaltyKind: 'perDay', penaltyValue: 0, graceMin: 0, capZeroAfterDays: null, penaltyMin: 0, wrongTryMin: 0, exemptCE: true, rule: 'best', floorPct: '', bestOfK: '', latePenaltyPerDay: 0, tiebreak: ['solves'] },
    judging: { verdictVisibility: 'all', allowSampleRun: true },
    exam: { fullscreen: false, pasteBlock: false, shuffle: false, ipAllow: '' },
    board: { mode: 'everyone', freezeLastMin: '' },
  },
  VIRTUAL: {
    scoring: { enabled: false, lateMode: 'soft', penaltyKind: 'perDay', penaltyValue: 0, graceMin: 0, capZeroAfterDays: null, penaltyMin: 20, wrongTryMin: 20, exemptCE: true, rule: 'best', floorPct: '', bestOfK: '', latePenaltyPerDay: 0, tiebreak: ['solves', 'time'] },
    judging: { verdictVisibility: 'first-failed', allowSampleRun: true },
    exam: { fullscreen: false, pasteBlock: false, shuffle: false, ipAllow: '' },
    board: { mode: 'everyone', freezeLastMin: 60 },
  },
  SPRINT: {
    scoring: { enabled: false, lateMode: 'soft', penaltyKind: 'perDay', penaltyValue: 0, graceMin: 0, capZeroAfterDays: null, penaltyMin: 10, wrongTryMin: 10, exemptCE: true, rule: 'best', floorPct: '', bestOfK: '', latePenaltyPerDay: 0, tiebreak: ['solves', 'time', 'attempts'], maxTries: '' },
    judging: { verdictVisibility: 'first-failed', allowSampleRun: true },
    exam: { fullscreen: false, pasteBlock: false, shuffle: false, ipAllow: '' },
    board: { mode: 'everyone', freezeLastMin: '' },
  },
  TEAM: {
    scoring: { enabled: false, lateMode: 'soft', penaltyKind: 'perDay', penaltyValue: 0, graceMin: 0, capZeroAfterDays: null, penaltyMin: 20, wrongTryMin: 20, exemptCE: true, rule: 'best', floorPct: '', bestOfK: '', latePenaltyPerDay: 0, tiebreak: ['solves', 'time'] },
    judging: { verdictVisibility: 'first-failed', allowSampleRun: true },
    exam: { fullscreen: false, pasteBlock: false, shuffle: false, ipAllow: '' },
    board: { mode: 'everyone', freezeLastMin: 120 },
  },
  QUIZ: {
    scoring: { enabled: true, lateMode: 'hard', penaltyKind: 'perDay', penaltyValue: 0, graceMin: 0, capZeroAfterDays: null, penaltyMin: 0, wrongTryMin: 0, exemptCE: true, rule: 'best', floorPct: '', bestOfK: '', latePenaltyPerDay: 0, tiebreak: ['solves', 'attempts'] },
    judging: { verdictVisibility: 'first-failed', allowSampleRun: true },
    exam: { fullscreen: false, pasteBlock: false, shuffle: true, ipAllow: '' },
    board: { mode: 'me-only', freezeLastMin: '' },
  },
  TAKEHOME: {
    scoring: { enabled: true, lateMode: 'soft', penaltyKind: 'percent', penaltyValue: 25, graceMin: 30, capZeroAfterDays: 2, penaltyMin: 0, wrongTryMin: 0, exemptCE: true, rule: 'latest', floorPct: '', bestOfK: '', latePenaltyPerDay: 0, tiebreak: ['solves', 'lastSolve'] },
    judging: { verdictVisibility: 'first-failed', allowSampleRun: true },
    exam: { fullscreen: false, pasteBlock: false, shuffle: true, ipAllow: '' },
    board: { mode: 'me-only', freezeLastMin: '' },
  },
  REPLAY: {
    scoring: { enabled: false, lateMode: 'soft', penaltyKind: 'perDay', penaltyValue: 0, graceMin: 0, capZeroAfterDays: null, penaltyMin: 20, wrongTryMin: 20, exemptCE: true, rule: 'best', floorPct: '', bestOfK: '', latePenaltyPerDay: 0, tiebreak: ['solves', 'time'] },
    judging: { verdictVisibility: 'first-failed', allowSampleRun: true },
    exam: { fullscreen: false, pasteBlock: false, shuffle: false, ipAllow: '' },
    board: { mode: 'everyone', freezeLastMin: 60 },
  },
};

export function blankSettings(template = 'LABS') {
  const t = TEMPLATE_SETTINGS[template] || TEMPLATE_SETTINGS.LABS;
  return JSON.parse(JSON.stringify(t));
}

// Goal = teacher-facing choice. Variants share engine modes with different presets.
export const GOALS = [
  { id: 'contest', group: 'sdef_g_race', label: 'sdef_goal_contest', desc: 'sdef_goal_contest_d', mode: 'ICPC', scoreboardMode: 'ICPC', registration: 'approval', template: 'ICPC' },
  { id: 'sprint', group: 'sdef_g_race', label: 'sdef_goal_sprint', desc: 'sdef_goal_sprint_d', mode: 'ICPC', scoreboardMode: 'ICPC', registration: 'open', template: 'SPRINT' },
  { id: 'team', group: 'sdef_g_race', label: 'sdef_goal_team', desc: 'sdef_goal_team_d', mode: 'ICPC', scoreboardMode: 'ICPC', registration: 'approval', template: 'TEAM' },
  { id: 'points', group: 'sdef_g_points', label: 'sdef_goal_points', desc: 'sdef_goal_points_d', mode: 'IOI', scoreboardMode: 'IOI', registration: 'open', template: 'IOI' },
  { id: 'course', group: 'sdef_g_course', label: 'sdef_goal_course', desc: 'sdef_goal_course_d', mode: 'LABS', scoreboardMode: 'course', registration: 'open', template: 'LABS' },
  { id: 'quiz', group: 'sdef_g_course', label: 'sdef_goal_quiz', desc: 'sdef_goal_quiz_d', mode: 'LABS', scoreboardMode: 'course', registration: 'open', template: 'QUIZ' },
  { id: 'exam', group: 'sdef_g_exam', label: 'sdef_goal_exam', desc: 'sdef_goal_exam_d', mode: 'EXAM', scoreboardMode: 'IOI', registration: 'invite', template: 'EXAM' },
  { id: 'takehome', group: 'sdef_g_exam', label: 'sdef_goal_takehome', desc: 'sdef_goal_takehome_d', mode: 'EXAM', scoreboardMode: 'IOI', registration: 'invite', template: 'TAKEHOME' },
  { id: 'practice', group: 'sdef_g_practice', label: 'sdef_goal_practice', desc: 'sdef_goal_practice_d', mode: 'PLAYGROUND', scoreboardMode: 'IOI', registration: 'open', template: 'PLAYGROUND' },
  { id: 'replay', group: 'sdef_g_practice', label: 'sdef_goal_replay', desc: 'sdef_goal_replay_d', mode: 'VIRTUAL', scoreboardMode: 'ICPC', registration: 'open', template: 'REPLAY' },
];

export function goalForMode(mode) {
  const m = String(mode || '').toUpperCase();
  if (m === 'ICPC' || m === 'VIRTUAL') return 'contest';
  if (m === 'IOI') return 'points';
  if (m === 'LABS' || m === 'COURSE') return 'course';
  if (m === 'EXAM') return 'exam';
  return 'practice';
}

// Plain-language summary of what the settings mean for students. Pass the dict `t`.
export function summarize(form, t) {
  const out = [];
  const sc = form.scoring || {};
  const goal = form.goal || goalForMode(form.mode);
  const race = goal === 'contest' || goal === 'sprint' || goal === 'team';
  const course = goal === 'course' || goal === 'quiz';
  const exam = goal === 'exam' || goal === 'takehome';
  const fill = (s, obj) => Object.entries(obj).reduce((a, [k, v]) => a.replace(`{${k}}`, v), s);
  if (race) {
    out.push(fill(t.sdef_sum_race, { n: sc.wrongTryMin ?? sc.penaltyMin ?? 20, ce: sc.exemptCE !== false ? t.sdef_sum_ce : '' }));
    if (sc.maxTries) out.push(fill(t.sdef_sum_maxtries, { n: sc.maxTries }));
    const flm = form.board?.freezeLastMin;
    if (flm) out.push(fill(t.sdef_sum_freeze_last, { n: flm }));
    else if (form.freezeAt) out.push(t.sdef_sum_freeze_at);
    else out.push(t.sdef_sum_live);
  } else if (goal === 'points') {
    const rule = { best: t.sdef_sum_r_best, latest: t.sdef_sum_r_latest, 'solved-count': t.sdef_sum_r_solved }[sc.rule] || t.sdef_sum_r_best;
    out.push(fill(t.sdef_sum_points, { rule }));
    if (sc.missDeduction?.value > 0) out.push(fill(t.sdef_sum_miss, { n: sc.missDeduction.value, acc: sc.missDeduction.accrue === 'always' ? `, ${t.score_always}` : `, ${t.score_only_solved}` }));
  } else if (course) {
    const parts = [];
    if (sc.enabled) {
      const tiers = Array.isArray(sc.tiers) && sc.tiers.length
        ? `${t.sdef_sum_steps} ${sc.tiers.map((x) => `${x.days}d −${x.pct}%`).join(', ')}`
        : fill(t.sdef_sum_late, { v: sc.penaltyValue ?? 5, unit: sc.penaltyKind === 'percent' ? '%' : sc.penaltyKind === 'perHour' ? t.score_unit_hour : t.score_unit_day });
      parts.push(tiers);
    }
    if (sc.bestOfK) parts.push(fill(t.sdef_sum_bestk, { n: sc.bestOfK }));
    if (sc.floorPct) parts.push(fill(t.sdef_sum_floor, { n: sc.floorPct }));
    if (sc.missDeduction?.value > 0) parts.push(fill(t.sdef_sum_misscost, { n: sc.missDeduction.value }));
    out.push(parts.length ? fill(t.sdef_sum_deadlines, { parts: parts.join(', ') }) : t.sdef_sum_nocost);
  } else if (exam) {
    out.push(goal === 'takehome' ? t.sdef_sum_takehome : t.sdef_sum_exam);
  } else {
    out.push(t.sdef_sum_practice);
  }
  out.push(fill(t.sdef_sum_joining, { v: form.registration || 'open' }));
  const vis = form.visibility || 'members';
  out.push(fill(t.sdef_sum_visibility, { v: t[`mset_vis_${vis}`] || vis }));
  return out;
}
