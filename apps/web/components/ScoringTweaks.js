// Scoring settings — mode-driven. Only the controls that matter for the goal render.
// Groups are exported so the wizard can place them per step. Fine-tune hides extras.
'use client';
import { useState } from 'react';
import { Button } from './ui';
import { Field, FInput, FSelect, Info } from './contest/Field';
import { SCORE_RULES, TIEBREAK_KEYS } from './contest/settingDefs';
import { STR, getLang } from '../lib/client';

function num(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

export function exampleScore({ penaltyKind, penaltyValue, floorPct }) {
  const v = num(penaltyValue, 0);
  let ex;
  if (penaltyKind === 'percent') ex = Math.max(0, 100 * (1 - 2 * v / 100));
  else if (penaltyKind === 'perHour') ex = Math.max(0, 100 - 48 * v);
  else ex = Math.max(0, 100 - 2 * v);
  const f = Number(floorPct);
  if (Number.isFinite(f) && f > 0) ex = Math.max(ex, 100 * Math.min(f, 100) / 100);
  return Math.round(ex * 10) / 10;
}

function FineTune({ title, hint, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button onClick={() => setOpen(!open)} className="code-mini" aria-expanded={open}>{open ? '▾' : '▸'} {title}</button>
      {hint && !open ? <span className="text-xs text-muted ml-2">{hint}</span> : null}
      {open ? <div className="grid md:grid-cols-2 gap-3 mt-3">{children}</div> : null}
    </div>
  );
}

// ICPC-style: wrong-try cost + broken-build exemption + try cap. Only for race goals.
export function WrongTryFields({ value, onChange }) {
  const t = STR[getLang()];
  const v = value || {};
  const set = (patch) => onChange?.({ ...v, ...patch });
  return (
    <div className="grid md:grid-cols-3 gap-2 mt-2">
      <FInput infoKey="wrongTryMin" label={t.score_miss_cost} value={v.wrongTryMin ?? v.penaltyMin ?? 20} onChange={(e) => set({ wrongTryMin: Number(e.target.value), penaltyMin: Number(e.target.value) })} hint={t.score_hint_added_per_miss} />
      <FInput infoKey="maxTries" label={t.score_max_tries} value={v.maxTries ?? ''} onChange={(e) => set({ maxTries: e.target.value === '' ? '' : Number(e.target.value) })} hint={t.score_hint_empty_unlimited} />
      <label className="text-sm flex gap-2 items-center">
        <input type="checkbox" checked={v.exemptCE !== false} onChange={(e) => set({ exemptCE: e.target.checked })} />
        <span style={{ fontSize: 13 }} className="font-medium">{t.score_ignore_ce}<Info for="exemptCE" /></span>
      </label>
    </div>
  );
}

// Miss deduction for points/course: lose X pts per wrong try.
export function MissDeductionFields({ value, onChange }) {
  const t = STR[getLang()];
  const v = value || {};
  const md = v.missDeduction || {};
  const set = (patch) => onChange?.({ ...v, missDeduction: { ...md, ...patch } });
  const on = (md.value ?? 0) > 0;
  return (
    <div className="mt-2">
      <div className="grid md:grid-cols-3 gap-2">
        <FInput infoKey="missDeduction" label={t.score_miss_costs} value={md.value ?? ''} onChange={(e) => set({ value: e.target.value === '' ? 0 : Number(e.target.value) })} hint={t.score_hint_zero_free} />
        {on ? (
          <FSelect infoKey="missAccrue" label={t.score_applies} value={md.accrue || 'on-solve'} onChange={(e) => set({ accrue: e.target.value })}>
            <option value="on-solve">{t.score_only_solved}</option><option value="always">{t.score_always}</option>
          </FSelect>
        ) : null}
      </div>
    </div>
  );
}

// Stepped late table. Overrides the linear rule when at least one row exists.
export function TiersFields({ value, onChange }) {
  const t = STR[getLang()];
  const v = value || {};
  const tiers = Array.isArray(v.tiers) ? v.tiers : [];
  function setRow(i, patch) {
    onChange?.({ ...v, tiers: tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  }
  function add() {
    const last = tiers.length ? Number(tiers[tiers.length - 1].days) || 0 : 0;
    onChange?.({ ...v, tiers: [...tiers, { days: last + 1, pct: 15 }] });
  }
  function remove(i) {
    onChange?.({ ...v, tiers: tiers.filter((_, j) => j !== i) });
  }
  return (
    <div className="mt-2">
      <span className="block font-medium mb-1" style={{ fontSize: 13 }}>{t.score_steps}<Info for="tiers" /></span>
      {tiers.map((row, i) => (
        <div key={i} className="flex gap-2 items-end mt-2">
          <FInput label={null} aria-label={t.score_days_late} value={row.days} onChange={(e) => setRow(i, { days: Number(e.target.value) })} className="!w-24" placeholder={t.score_days_ph} hint={t.score_days_late} />
          <span className="text-xs text-muted pb-6">→ −</span>
          <FInput label={null} aria-label={t.score_pct_lost_aria} value={row.pct} onChange={(e) => setRow(i, { pct: Number(e.target.value) })} className="!w-24" placeholder="%" hint={t.score_pct_lost_hint} />
          <span className="pb-6"><Button variant="secondary" onClick={() => remove(i)} className="!py-1">{t.common_remove}</Button></span>
        </div>
      ))}
      <div className="mt-2"><Button variant="secondary" onClick={add} className="!py-1">{tiers.length ? t.score_add_step : t.score_use_steps}</Button></div>
    </div>
  );
}

// Late policy. Compact: toggle first, details only when on.
export function LateFields({ value, onChange, defaultOpen }) {
  const t = STR[getLang()];
  const v = value || {};
  const set = (patch) => onChange?.({ ...v, ...patch });
  const ex = exampleScore({ penaltyKind: v.penaltyKind || 'perDay', penaltyValue: v.penaltyValue ?? 5, floorPct: v.floorPct });
  return (
    <div className="mt-2">
      <label className="text-sm flex gap-2 items-center">
        <input type="checkbox" checked={!!v.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span style={{ fontSize: 13 }} className="font-medium">{t.score_late_rule_on}<Info for="enabled" /></span>
        <span className="text-xs text-muted">{t.score_sample} {ex}</span>
      </label>
      {v.enabled || defaultOpen ? (
        <div className="grid md:grid-cols-3 gap-2 mt-2">
          <FSelect infoKey="lateMode" label={t.score_if_late} value={v.lateMode || 'soft'} onChange={(e) => set({ lateMode: e.target.value })}>
            <option value="soft">{t.score_lose_points}</option><option value="hard">{t.score_block_upload}</option>
          </FSelect>
          <FSelect infoKey="penaltyKind" label={t.score_lose_per} value={v.penaltyKind || 'perDay'} onChange={(e) => set({ penaltyKind: e.target.value })}>
            <option value="perDay">{t.score_unit_day}</option><option value="perHour">{t.score_unit_hour}</option><option value="percent">{t.score_unit_percent}</option>
          </FSelect>
          <FInput infoKey="penaltyValue" label={t.score_lose_x} value={v.penaltyValue ?? 5} onChange={(e) => set({ penaltyValue: Number(e.target.value), latePenaltyPerDay: Number(e.target.value) })} hint={t.score_hint_pts_per_unit} />
          <FInput infoKey="graceMin" label={t.grade_grace} value={v.graceMin ?? 0} onChange={(e) => set({ graceMin: Number(e.target.value) })} hint={t.score_hint_free_window} />
          <FInput infoKey="floorPct" label={t.score_keep_at_least} value={v.floorPct ?? ''} onChange={(e) => set({ floorPct: e.target.value === '' ? '' : Number(e.target.value) })} hint={t.score_hint_late_floor} />
          <FInput infoKey="capZeroAfterDays" label={t.score_zero_after} value={v.capZeroAfterDays ?? ''} onChange={(e) => set({ capZeroAfterDays: e.target.value === '' ? null : Number(e.target.value) })} hint={t.score_hint_no_cap} />
        </div>
      ) : null}
      {v.enabled ? <TiersFields value={v} onChange={set} /> : null}
    </div>
  );
}

// Course-only: count K best.
export function CourseFields({ value, onChange }) {
  const t = STR[getLang()];
  const v = value || {};
  const set = (patch) => onChange?.({ ...v, ...patch });
  return (
    <div className="grid md:grid-cols-3 gap-2 mt-2">
      <FInput infoKey="bestOfK" label={t.score_count_k} value={v.bestOfK ?? ''} onChange={(e) => set({ bestOfK: e.target.value === '' ? '' : Number(e.target.value) })} hint={t.score_hint_drops_rest} />
      <FInput infoKey="latePenaltyPerDay" label={t.score_course_late_pts} value={v.latePenaltyPerDay ?? 5} onChange={(e) => set({ latePenaltyPerDay: Number(e.target.value), penaltyValue: Number(e.target.value) })} />
    </div>
  );
}

export function TiebreakFields({ value, onChange }) {
  const t = STR[getLang()];
  const v = value || {};
  const tiebreak = Array.isArray(v.tiebreak) ? v.tiebreak : ['solves', 'time'];
  function toggle(key) {
    const next = tiebreak.includes(key) ? tiebreak.filter((k) => k !== key) : [...tiebreak, key];
    onChange?.({ ...v, tiebreak: next.length ? next : ['solves'] });
  }
  return (
    <div className="flex gap-2 flex-wrap mt-2">
      {TIEBREAK_KEYS.map((tb) => (
        <label key={tb.id} className="text-xs flex gap-1 items-center border rounded px-2 py-1" style={{ borderColor: 'var(--border)' }}>
          <input type="checkbox" checked={tiebreak.includes(tb.id)} onChange={() => toggle(tb.id)} /> {tiebreak.indexOf(tb.id) >= 0 ? `${tiebreak.indexOf(tb.id) + 1}. ` : ''}{t[tb.labelKey]}
        </label>
      ))}
    </div>
  );
}

// Goal-driven assembly. goal: contest | sprint | team | points | course | quiz | exam | takehome | practice | replay.
export default function ScoringTweaks({ value, onChange, goal }) {
  const t = STR[getLang()];
  const v = value || {};
  const set = (patch) => onChange?.({ ...v, ...patch });
  const g = goal || 'course';
  const race = g === 'contest' || g === 'sprint' || g === 'team' || g === 'replay';
  const courseLike = g === 'course' || g === 'quiz' || g === 'takehome';

  if (g === 'exam') {
    return (
      <section className="mt-8 pt-6 border-t" style={{ borderColor: 'var(--border)' }}>
        <h2 style={{ fontSize: 15, fontWeight: 650, letterSpacing: '-0.01em' }}>{t.score_rules_locked}</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{t.score_rules_locked_desc}</p>
      </section>
    );
  }

  if (g === 'practice' || g === 'replay') {
    return (
      <section className="mt-8 pt-6 border-t" style={{ borderColor: 'var(--border)' }}>
        <h2 style={{ fontSize: 15, fontWeight: 650, letterSpacing: '-0.01em' }}>{t.score_rules_none}</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{t.score_practice_note}</p>
        <FineTune title={t.score_late_rule}>
          <LateFields value={v} onChange={set} />
        </FineTune>
      </section>
    );
  }

  if (race) {
    return (
      <section className="mt-8 pt-6 border-t" style={{ borderColor: 'var(--border)' }}>
        <h2 style={{ fontSize: 15, fontWeight: 650, letterSpacing: '-0.01em' }}>{t.score_winner_decided}</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{t.score_race_note}</p>
        <WrongTryFields value={v} onChange={set} />
        <h3 className="mt-6" style={{ fontSize: 13, fontWeight: 650 }}>{t.score_tie_break} <Info for="tiebreak" /></h3>
        <TiebreakFields value={v} onChange={set} />
        <FineTune title={t.score_late_rule}>
          <LateFields value={v} onChange={set} />
        </FineTune>
      </section>
    );
  }

  if (g === 'points') {
    return (
      <section className="mt-8 pt-6 border-t" style={{ borderColor: 'var(--border)' }}>
        <h2 style={{ fontSize: 15, fontWeight: 650, letterSpacing: '-0.01em' }}>{t.score_winner_decided}</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{t.score_points_note}</p>
        <div className="grid md:grid-cols-2 gap-x-6 gap-y-4 mt-4">
          <FSelect infoKey="scoreRule" label={t.score_score_rule} value={v.rule || 'best'} onChange={(e) => set({ rule: e.target.value })}>
            {SCORE_RULES.map((r) => <option key={r.id} value={r.id}>{t[r.labelKey]}</option>)}
          </FSelect>
        </div>
        <MissDeductionFields value={v} onChange={set} />
        <h3 className="mt-6" style={{ fontSize: 13, fontWeight: 650 }}>{t.score_tie_break} <Info for="tiebreak" /></h3>
        <TiebreakFields value={v} onChange={set} />
        <FineTune title={t.score_late_rule}>
          <LateFields value={v} onChange={set} />
        </FineTune>
      </section>
    );
  }

  // course | quiz | takehome
  return (
    <section className="mt-8 pt-6 border-t" style={{ borderColor: 'var(--border)' }}>
      <h2 style={{ fontSize: 15, fontWeight: 650, letterSpacing: '-0.01em' }}>{t.score_grades_note}</h2>
      <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{t.score_course_note}</p>
      <LateFields value={v} onChange={set} defaultOpen />
      <MissDeductionFields value={v} onChange={set} />
      <h3 className="mt-6" style={{ fontSize: 13, fontWeight: 650 }}>{t.sdef_g_course} <Info for="bestOfK" /></h3>
      <CourseFields value={v} onChange={set} />
      <div className="mt-4"><Field infoKey="floorPct" label={t.score_live_preview} hint={t.score_preview_sample.replace('{v}', String(exampleScore({ penaltyKind: v.penaltyKind || 'perDay', penaltyValue: v.penaltyValue ?? 5, floorPct: v.floorPct })))}><span /></Field></div>
    </section>
  );
}
