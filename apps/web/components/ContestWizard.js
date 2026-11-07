// Visual contest creation — goal-driven wizard. Only settings that matter for the
// chosen goal render. Backend stores settings wholesale (no API change).
'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, STR, getLang } from '../lib/client';
import { Badge, Button } from './ui';
import { toast } from './ui/Toast';
import ScoringTweaks from './ScoringTweaks';
import { Field, FInput, FSelect, FTextarea, Info, Section } from './contest/Field';
import { GOALS, TEMPLATE_SETTINGS, goalForMode, summarize } from './contest/settingDefs';
import EyebrowFx from './EyebrowFx';

const DRAFT_KEY = 'satori-new-contest-draft';
const STEPS = ['wiz_step_goal', 'wiz_step_basics', 'wiz_step_when', 'wiz_step_rules', 'wiz_step_access', 'wiz_step_review'];

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* noop */ }
  return null;
}

function blankForm() {
  return {
    goal: 'course', name: '', description: '', mode: 'LABS', scoreboardMode: 'course',
    visibility: 'members', registration: 'open', autoApproveRegex: '', startAt: '', stopAt: '', freezeAt: '', defaultDeadline: '',
    penalty: 0, duplicateFrom: '',
    scoring: { ...TEMPLATE_SETTINGS.LABS.scoring },
    judging: { ...TEMPLATE_SETTINGS.LABS.judging },
    exam: { ...TEMPLATE_SETTINGS.LABS.exam },
    board: { ...TEMPLATE_SETTINGS.LABS.board },
    showAdvanced: false,
  };
}

export default function ContestWizard() {
  const t = STR[getLang()];
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(() => {
    const d = loadDraft();
    if (d && !d.goal) d.goal = goalForMode(d.mode);
    if (d && !['public', 'members', 'hidden'].includes(d.visibility)) d.visibility = 'members';
    return d || blankForm();
  });
  const [csv, setCsv] = useState('');
  const [msg, setMsg] = useState('');
  const [creating, setCreating] = useState(false);
  const goal = form.goal || 'course';

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(form)); } catch { /* noop */ }
  }, [form]);

  function applyGoal(id) {
    const g = GOALS.find((x) => x.id === id);
    if (!g) return;
    const s = TEMPLATE_SETTINGS[g.template];
    if (!s) return;
    setForm((f) => ({
      ...f, goal: id, mode: g.mode, scoreboardMode: g.scoreboardMode,
      penalty: s.scoring.wrongTryMin ?? s.scoring.penaltyMin ?? 0,
      registration: g.registration, scoring: { ...s.scoring }, judging: { ...s.judging }, exam: { ...s.exam },
      board: { ...(s.board || { mode: 'everyone', freezeLastMin: '' }) },
    }));
  }

  const csvPreview = useMemo(() => {
    const lines = csv.split('\n').map((s) => s.trim()).filter(Boolean);
    return { count: lines.length, sample: lines.slice(0, 3) };
  }, [csv]);

  const checks = useMemo(() => ([
    { ok: form.name.trim().length >= 3, labelKey: 'wiz_chk_name' },
    { ok: !!form.mode, labelKey: 'wiz_chk_goal' },
    { ok: !form.startAt || !form.stopAt || form.startAt < form.stopAt, labelKey: 'wiz_chk_start' },
    { ok: ['open', 'approval', 'invite'].includes(form.registration), labelKey: 'wiz_chk_access' },
    { ok: !form.scoring?.enabled || Number(form.scoring?.penaltyValue ?? 0) >= 0, labelKey: 'wiz_chk_penalty' },
  ]), [form]);

  const allOk = checks.every((c) => c.ok);
  const pct = Math.round(((step + 1) / STEPS.length) * 100);
  const lines = summarize(form, t);
  const needsFreezeBoard = goal === 'contest' || goal === 'sprint' || goal === 'team' || goal === 'points' || goal === 'replay';
  const needsDeadline = goal !== 'practice' && goal !== 'replay';
  const lockedChecking = goal === 'course' || goal === 'quiz' || goal === 'exam';
  const needsExamLocks = goal === 'exam' || goal === 'takehome';

  async function create() {
    if (!allOk) { setMsg(t.wiz_fix_checklist); return; }
    setCreating(true);
    setMsg('');
    try {
      const sc = form.scoring || {};
      let freezeAt = form.freezeAt || undefined;
      const flm = Number(form.board?.freezeLastMin);
      if (!freezeAt && Number.isFinite(flm) && flm > 0 && form.stopAt) {
        freezeAt = new Date(new Date(form.stopAt).getTime() - flm * 60000).toISOString();
      }
      const body = {
        name: form.name.trim(), description: form.description, mode: form.mode,
        visibility: form.visibility || 'members',
        scoreboardMode: form.scoreboardMode, registration: form.registration,
        autoApproveRegex: form.autoApproveRegex || undefined,
        startAt: form.startAt || undefined, stopAt: form.stopAt || undefined,
        freezeAt, penalty: Number(sc.wrongTryMin ?? sc.penaltyMin ?? form.penalty) || 0,
        settings: {
          defaultDeadline: form.defaultDeadline || undefined,
          verdictVisibility: form.judging?.verdictVisibility || 'all',
          allowSampleRun: form.judging?.allowSampleRun !== false,
          deadlinePolicy: {
            enabled: !!sc.enabled, lateMode: sc.lateMode || 'soft',
            penaltyKind: sc.penaltyKind || 'perDay', penaltyValue: Number(sc.penaltyValue ?? 0),
            graceMin: Number(sc.graceMin ?? 0), capZeroAfterDays: sc.capZeroAfterDays ?? null,
            tiers: Array.isArray(sc.tiers) && sc.tiers.length ? sc.tiers : undefined,
          },
          latePenaltyPerDay: Number(sc.latePenaltyPerDay ?? sc.penaltyValue ?? 0),
          bestOfK: sc.bestOfK === '' ? undefined : Number(sc.bestOfK),
          scoring: {
            rule: sc.rule || 'best',
            wrongTryMin: Number(sc.wrongTryMin ?? sc.penaltyMin ?? 0),
            exemptCE: sc.exemptCE !== false,
            floorPct: sc.floorPct === '' ? undefined : Number(sc.floorPct),
            tiebreak: sc.tiebreak || ['solves', 'time'],
            maxTries: sc.maxTries === '' ? undefined : Number(sc.maxTries),
            missDeduction: sc.missDeduction?.value > 0 ? { value: Number(sc.missDeduction.value), accrue: sc.missDeduction.accrue || 'on-solve' } : undefined,
          },
          board: { mode: form.board?.mode || 'everyone', freezeLastMin: form.board?.freezeLastMin === '' ? undefined : Number(form.board?.freezeLastMin) },
          exam: {
            fullscreen: !!form.exam?.fullscreen, pasteBlock: !!form.exam?.pasteBlock,
            shuffle: !!form.exam?.shuffle, ipAllow: form.exam?.ipAllow || '',
          },
        },
      };
      let contest;
      if ((form.duplicateFrom || '').trim()) {
        contest = await api(`/api/contests/${form.duplicateFrom.trim()}/duplicate`, { method: 'POST', body: JSON.stringify({}) });
        contest = await api(`/api/contests/${contest.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        contest = await api('/api/contests', { method: 'POST', body: JSON.stringify({ template: form.mode, ...body }) });
      }
      if (csvPreview.count > 0) {
        try {
          const r = await api(`/api/contests/${contest.id}/members/csv`, { method: 'POST', body: JSON.stringify({ csv }) });
          toast(`${t.wiz_created_members} ${r.added ?? csvPreview.count}.`);
        } catch { toast(t.wiz_csv_failed); }
      } else {
        toast(t.wiz_created_draft);
      }
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
      router.push(`/contests/${contest.id}/manage/problems`);
    } catch (e) { setMsg(`${t.wiz_create_failed} ${e.message}`); }
    finally { setCreating(false); }
  }

  const nav = (d) => setStep((s) => Math.min(STEPS.length - 1, Math.max(0, s + d)));
  const goalLabel = t[(GOALS.find((g) => g.id === goal) || {}).label] || goal;

  return (
    <div className="w-full max-w-4xl mx-auto pb-16">
      <header className="pt-2">
        <div className="wiz-top">
          <EyebrowFx text={t.wiz_contests_new} />
          <p className="type-mono" style={{ color: 'var(--muted)' }}>{t.wiz_draft_autosave}</p>
        </div>
        <input
          className="wiz-title-input focus-ring"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder={t.wiz_untitled}
          aria-label={t.wiz_name_aria}
          maxLength={120}
          autoComplete="off"
        />
        <div className="wiz-meta">
          <Badge>{goalLabel}</Badge>
          <Badge>{form.mode}</Badge>
          <Badge>{form.registration}</Badge>
          <span className="wiz-progress">{t.wiz_step_of.replace('{n}', step + 1).replace('{m}', STEPS.length)} · {pct}%</span>
        </div>
        <nav className="steps steps-connected mt-4" aria-label={t.wiz_steps_aria}>
          {STEPS.map((s, i) => (
            <Fragment key={s}>
              {i > 0 ? <span className={`step-conn${i <= step ? ' is-done' : ''}`} aria-hidden="true" /> : null}
              <button onClick={() => setStep(i)} className={`step focus-ring${step === i ? ' is-now' : i < step ? ' is-done' : ''}`} aria-current={step === i ? 'step' : undefined}>
                <span className="n" aria-hidden="true">{`0${i + 1}`}</span>{t[s]}
              </button>
            </Fragment>
          ))}
        </nav>
      </header>
      <div key={step} className="wiz-fade">
      {step === 0 ? (
        <div className="mt-2">
          <h2 style={{ fontSize: 15, fontWeight: 650, letterSpacing: '-0.01em' }}>{t.wiz_q_running}</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{t.wiz_q_running_sub}</p>
          {['sdef_g_race', 'sdef_g_points', 'sdef_g_course', 'sdef_g_exam', 'sdef_g_practice'].map((grp) => (
            <div key={grp} className="mt-6">
              <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>{t[grp]}</p>
              <div className="mt-1">
                {GOALS.filter((g) => g.group === grp).map((g) => (
                  <button key={g.id} onClick={() => applyGoal(g.id)} className={`goal-row focus-ring${goal === g.id ? ' is-sel' : ''}`} aria-pressed={goal === g.id}>
                    <span className="goal-radio" aria-hidden="true" />
                    <span>
                      <strong style={{ fontSize: 14, fontWeight: 650, letterSpacing: '-0.01em' }}>{t[g.label]}</strong>
                      <p className="text-xs mt-1" style={{ color: 'var(--muted)', lineHeight: 1.5 }}>{t[g.desc]}</p>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <Section title={t.wiz_or_dup}>
            <FInput infoKey="duplicateFrom" label={t.wiz_dup_id} value={form.duplicateFrom} onChange={(e) => setForm({ ...form, duplicateFrom: e.target.value })} placeholder={t.wiz_dup_ph} />
          </Section>
          <div className="mt-2 flex gap-2"><Button onClick={() => nav(1)}>{t.wiz_next_basics}</Button></div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="mt-3 max-w-2xl">
          <Section title={t.mset_basics}>
            <FInput infoKey="name" label={t.mset_name} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="UZI 2026 / Labs 3" />
            <div className="block text-sm">
              <span className="block font-medium mb-1" style={{ fontSize: 13 }}>{t.wiz_type}<Info for="mode" /></span>
              <span className="text-sm"><Badge>{goalLabel} ({form.mode})</Badge> <button className="underline text-sm ml-1" onClick={() => setStep(0)}>{t.wiz_change}</button></span>
            </div>
            <FTextarea infoKey="description" label={t.mset_description} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          </Section>
          <div className="mt-2 flex gap-2"><Button variant="secondary" onClick={() => nav(-1)}>{t.wiz_back}</Button><Button onClick={() => nav(1)}>{t.wiz_next_when}</Button></div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="mt-3 max-w-2xl">
          <Section title={t.wiz_when}>
            <FInput infoKey="startAt" label="Start" type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} />
            <FInput infoKey="stopAt" label={t.mset_stop} type="datetime-local" value={form.stopAt} onChange={(e) => setForm({ ...form, stopAt: e.target.value })} />
            {needsFreezeBoard ? (
              <>
                <FInput infoKey="freezeLastMin" label={t.wiz_freeze_last} value={form.board?.freezeLastMin ?? ''} onChange={(e) => setForm({ ...form, board: { ...(form.board || {}), freezeLastMin: e.target.value === '' ? '' : Number(e.target.value) } })} hint={t.wiz_zero_live} />
                <FSelect infoKey="boardMode" label={t.mset_board_who} value={form.board?.mode || 'everyone'} onChange={(e) => setForm({ ...form, board: { ...(form.board || {}), mode: e.target.value } })}>
                  <option value="everyone">{t.mset_board_everyone}</option><option value="me-only">{t.mset_board_me_only}</option><option value="hidden">{t.mset_board_hidden}</option>
                </FSelect>
              </>
            ) : null}
            {needsDeadline ? (
              <FInput infoKey="defaultDeadline" label={t.wiz_due} type="datetime-local" value={form.defaultDeadline} onChange={(e) => setForm({ ...form, defaultDeadline: e.target.value })} hint={t.wiz_due_hint} />
            ) : null}
          </Section>
          <p className="text-xs text-muted mt-1">{t.wiz_draft_guard}</p>
          <div className="mt-2 flex gap-2"><Button variant="secondary" onClick={() => nav(-1)}>{t.wiz_back}</Button><Button onClick={() => nav(1)}>{t.wiz_next_rules}</Button></div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="mt-3 max-w-2xl">
          <ScoringTweaks value={form.scoring} goal={goal} onChange={(scoring) => setForm({ ...form, scoring, penalty: scoring.wrongTryMin ?? scoring.penaltyMin ?? form.penalty })} />
          {lockedChecking ? (
            <p className="text-xs mt-6 pt-6 border-t" style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}>{t.wiz_check_locked} {goal === 'exam' ? t.wiz_checked_exam : t.wiz_checked_learn} <Info for="verdictVisibility" /></p>
          ) : (
            <Section title={t.wiz_checking}>
              <FSelect infoKey="verdictVisibility" label={t.wiz_show_students} value={form.judging?.verdictVisibility || 'all'} onChange={(e) => setForm({ ...form, judging: { ...form.judging, verdictVisibility: e.target.value } })}>
                <option value="all">{t.wiz_ver_all}</option><option value="first-failed">{t.wiz_ver_first}</option><option value="none">{t.wiz_ver_none}</option>
              </FSelect>
              <label className="text-sm flex gap-2 items-center">
                <input type="checkbox" checked={form.judging?.allowSampleRun !== false} onChange={(e) => setForm({ ...form, judging: { ...form.judging, allowSampleRun: e.target.checked } })} />
                <span style={{ fontSize: 13 }} className="font-medium">{t.wiz_free_trial}<Info for="allowSampleRun" /></span>
              </label>
            </Section>
          )}
          <div className="mt-2 flex gap-2"><Button variant="secondary" onClick={() => nav(-1)}>{t.wiz_back}</Button><Button onClick={() => nav(1)}>{t.wiz_next_access}</Button></div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="mt-3 max-w-2xl">
          <Section title={t.wiz_who_join}>
            <FSelect infoKey="contestVisibility" label={t.mset_visibility} value={form.visibility || 'members'} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
              <option value="members">{t.mset_vis_members}</option>
              <option value="public">{t.mset_vis_public}</option>
              <option value="hidden">{t.mset_vis_hidden}</option>
            </FSelect>
            <FSelect infoKey="registration" label={t.wiz_joining} value={form.registration} onChange={(e) => setForm({ ...form, registration: e.target.value })}>
              <option value="open">{t.wiz_reg_anyone}</option><option value="approval">{t.wiz_reg_approve}</option><option value="invite">{t.wiz_reg_invite}</option>
            </FSelect>
            <FInput infoKey="autoApproveRegex" label={t.wiz_autoapprove} value={form.autoApproveRegex} onChange={(e) => setForm({ ...form, autoApproveRegex: e.target.value })} placeholder=".*@uni.edu" />
            <FTextarea infoKey="csv" label={t.wiz_add_members} value={csv} onChange={(e) => setCsv(e.target.value)} rows={3} hint={csvPreview.count ? `${csvPreview.count} ${t.wiz_logins} (${csvPreview.sample.join(', ')})` : t.wiz_one_login} />
          </Section>
          {needsExamLocks ? (
            <Section title={t.wiz_exam_locks}>
              <label className="text-sm flex gap-2 items-center"><input type="checkbox" checked={!!form.exam?.fullscreen} onChange={(e) => setForm({ ...form, exam: { ...form.exam, fullscreen: e.target.checked } })} /><span style={{ fontSize: 13 }} className="font-medium">{t.wiz_fullscreen}<Info for="examFullscreen" /></span></label>
              <label className="text-sm flex gap-2 items-center"><input type="checkbox" checked={!!form.exam?.pasteBlock} onChange={(e) => setForm({ ...form, exam: { ...form.exam, pasteBlock: e.target.checked } })} /><span style={{ fontSize: 13 }} className="font-medium">{t.wiz_block_paste}<Info for="examPasteBlock" /></span></label>
              <label className="text-sm flex gap-2 items-center"><input type="checkbox" checked={!!form.exam?.shuffle} onChange={(e) => setForm({ ...form, exam: { ...form.exam, shuffle: e.target.checked } })} /><span style={{ fontSize: 13 }} className="font-medium">{t.wiz_shuffle}<Info for="examShuffle" /></span></label>
              <FInput infoKey="examIpAllow" label={t.wiz_room_ips} value={form.exam?.ipAllow || ''} onChange={(e) => setForm({ ...form, exam: { ...form.exam, ipAllow: e.target.value } })} placeholder={t.wiz_empty_anywhere} />
            </Section>
          ) : null}
          <div className="mt-2 flex gap-2"><Button variant="secondary" onClick={() => nav(-1)}>{t.wiz_back}</Button><Button onClick={() => nav(1)}>{t.wiz_next_review}</Button></div>
        </div>
      ) : null}

      {step === 5 ? (
        <div className="mt-3 max-w-2xl">
          <h2 style={{ fontSize: 15, fontWeight: 650, letterSpacing: '-0.01em' }}>{form.name || t.wiz_unnamed}</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{goalLabel}</p>
          <dl className="mt-4">
            {lines.map((l) => (
              <div key={l} className="flex gap-3 items-baseline py-2 border-t" style={{ borderColor: 'var(--border)' }}>
                <dt className="flex-1 text-sm">{l}</dt>
                <dd><span className="verdict verdict-OK">OK</span></dd>
              </div>
            ))}
            {checks.map((c) => (
              <div key={c.labelKey} className="flex gap-3 items-baseline py-2 border-t" style={{ borderColor: 'var(--border)' }}>
                <dt className="flex-1 text-sm">{t[c.labelKey]}</dt>
                <dd><span className={`verdict ${c.ok ? 'verdict-OK' : 'verdict-WA'}`}>{c.ok ? 'OK' : 'TODO'}</span></dd>
              </div>
            ))}
          </dl>
          {csvPreview.count ? <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>{t.wiz_members_count} {csvPreview.count}</p> : null}
          <div className="flex gap-2 mt-2">
            <Button variant="secondary" onClick={() => nav(-1)}>{t.wiz_back}</Button>
            <Button onClick={create} disabled={!allOk || creating}>{creating ? t.wiz_creating : t.wiz_create}</Button>
          </div>
          {msg ? <p role="status" className="text-sm mt-2">{msg}</p> : null}
          <Field infoKey="name" label={t.wiz_tip} hint={t.wiz_tip_hint}><span /></Field>
        </div>
      ) : null}
      </div>
    </div>
  );
}
