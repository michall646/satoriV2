// Manage → Settings. Grouped form (Basics · Schedule · Access · Scoring · Judging · Exam).
// Saves preserve unknown settings/scoring keys; grade scale is the single source for all grades.
'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, STR, getLang } from '../../../../../lib/client';
import { Button, Skeleton } from '../../../../../components/ui';
import { toast } from '../../../../../components/ui/Toast';
import ScoringTweaks from '../../../../../components/ScoringTweaks';
import { Section, FInput, FSelect, FTextarea, Info } from '../../../../../components/contest/Field';
import { goalForMode } from '../../../../../components/contest/settingDefs';
import { PageHeader } from '../../../../../components/manage';
import { useManage } from '../../../../../components/manage/context';

const DEFAULT_GRADE_SCALE = '90:5,75:4,50:3,0:2';

const LABELS = {
  en: {
    gradeScale: 'Grade scale (pct:grade)', gradeScaleHint: 'Used by the student page, teacher preview, LABS board and CSV.',
    dropWorst: 'Drop worst N', scoringModeHint: 'Ranking mode follows the contest template.',
    badScale: 'Grade scale must look like 90:5,75:4,50:3,0:2 (percent:grade).',
    badDropWorst: 'Drop worst N must be a whole number ≥ 0.', badBestOfK: 'Best-of-K must be a whole number ≥ 1.',
    badFloor: 'Late floor must be between 0 and 100.', saveFailed: 'Save failed:',
  },
  pl: {
    gradeScale: 'Skala ocen (pkt:ocena)', gradeScaleHint: 'Używana przez stronę studenta, podgląd, tablicę LABS i CSV.',
    dropWorst: 'Odrzuć najgorsze N', scoringModeHint: 'Tryb rankingu wynika z szablonu konkursu.',
    badScale: 'Skala ocen musi wyglądać jak 90:5,75:4,50:3,0:2 (procent:ocena).',
    badDropWorst: 'Odrzuć najgorsze N musi być liczbą całkowitą ≥ 0.', badBestOfK: 'Najlepsze z K musi być liczbą całkowitą ≥ 1.',
    badFloor: 'Dolny limit kary musi być między 0 a 100.', saveFailed: 'Zapis nieudany:',
  },
};

function scaleToText(raw) {
  if (Array.isArray(raw)) return raw.map((s) => `${s.min}:${s.grade}`).join(',');
  return String(raw || '');
}

function parseScaleText(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const out = [];
  for (const part of text.split(',')) {
    const [min, grade] = part.split(':').map((x) => Number(String(x).trim()));
    if (!Number.isFinite(min) || !Number.isFinite(grade) || min < 0 || min > 100) return null;
    out.push({ min, grade });
  }
  return out.length ? out.sort((a, b) => b.min - a.min) : null;
}

function intOrNull(raw, fallback = null) {
  if (raw === '' || raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function initSettings(contest) {
  const s = contest.settings || {};
  const sc = s.scoring || {};
  const dp = s.deadlinePolicy || {};
  const penaltyMin = s.penaltyMin ?? sc.penaltyMin ?? sc.wrongTryMin ?? contest.penalty ?? 20;
  return {
    name: contest.name || '',
    description: contest.description || '',
    mode: contest.mode || '',
    visibility: ['public', 'members', 'hidden'].includes(contest.visibility) ? contest.visibility : 'members',
    registration: contest.registration || 'open',
    autoApproveRegex: contest.autoApproveRegex || '',
    startAt: contest.startAt || '',
    stopAt: contest.endAt || contest.stopAt || '',
    freezeAt: contest.freezeAt || '',
    defaultDeadline: s.defaultDeadline || '',
    penalty: penaltyMin,
    gradeScale: scaleToText(s.gradeScale) || DEFAULT_GRADE_SCALE,
    judging: { verdictVisibility: s.verdictVisibility || 'all', allowSampleRun: s.allowSampleRun !== false },
    exam: s.exam || { fullscreen: false, pasteBlock: false, shuffle: false, ipAllow: '' },
    board: s.board || { mode: 'everyone', freezeLastMin: '' },
    scoring: {
      enabled: !!dp.enabled,
      lateMode: dp.lateMode || 'soft',
      penaltyKind: dp.penaltyKind || 'perDay',
      penaltyValue: dp.penaltyValue ?? s.latePenaltyPerDay ?? 5,
      graceMin: dp.graceMin ?? 0,
      capZeroAfterDays: dp.capZeroAfterDays ?? null,
      floorPct: sc.floorPct ?? '',
      rule: sc.rule || 'best',
      tiebreak: sc.tiebreak || ['solves', 'time'],
      maxTries: sc.maxTries ?? '',
      missDeduction: sc.missDeduction || {},
      tiers: dp.tiers || [],
      exemptCE: sc.exemptCE !== false,
      penaltyMin,
      wrongTryMin: sc.wrongTryMin ?? penaltyMin,
      bestOfK: s.bestOfK ?? sc.bestOfK ?? '',
      dropWorstN: sc.dropWorstN ?? '',
      latePenaltyPerDay: s.latePenaltyPerDay ?? dp.penaltyValue ?? 5,
    },
  };
}

export default function ManageSettingsPage({ params }) {
  const t = STR[getLang()];
  const L = LABELS[getLang()] || LABELS.en;
  const { contest, reload } = useManage();
  const [settings, setSettings] = useState(() => initSettings(contest));
  const [baseline, setBaseline] = useState(() => JSON.stringify(initSettings(contest)));
  const [saving, setSaving] = useState(false);
  const dirty = useMemo(() => JSON.stringify(settings) !== baseline, [settings, baseline]);

  useEffect(() => {
    if (!dirty) return undefined;
    function warn(e) { e.preventDefault(); e.returnValue = ''; }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save() {
    const sc = settings.scoring || {};
    const scale = parseScaleText(settings.gradeScale);
    if (!scale) { toast(L.badScale, 'danger'); return; }
    const dropWorstN = intOrNull(sc.dropWorstN, undefined);
    if (dropWorstN !== undefined && (!Number.isInteger(dropWorstN) || dropWorstN < 0)) { toast(L.badDropWorst, 'danger'); return; }
    const bestOfK = intOrNull(sc.bestOfK, undefined);
    if (bestOfK !== undefined && (!Number.isInteger(bestOfK) || bestOfK < 1)) { toast(L.badBestOfK, 'danger'); return; }
    const floorPct = intOrNull(sc.floorPct, undefined);
    if (floorPct !== undefined && (floorPct < 0 || floorPct > 100)) { toast(L.badFloor, 'danger'); return; }

    const baseSettings = contest.settings || {};
    const baseScoring = baseSettings.scoring || {};
    const penaltyMin = Number(sc.penaltyMin ?? sc.wrongTryMin ?? settings.penalty) || 0;
    const payload = {
      name: settings.name, description: settings.description, mode: settings.mode,
      visibility: settings.visibility || 'members',
      registration: settings.registration, autoApproveRegex: settings.autoApproveRegex,
      startAt: settings.startAt, stopAt: settings.stopAt, freezeAt: settings.freezeAt,
      // Canonical scoring mode follows the contest template; the old free-text field is gone.
      scoreboardMode: settings.mode || contest.scoreboardMode || contest.mode,
      penalty: penaltyMin,
      settings: {
        ...baseSettings,
        penaltyMin,
        defaultDeadline: settings.defaultDeadline || undefined,
        gradeScale: scale.map((x) => `${x.min}:${x.grade}`).join(','),
        verdictVisibility: settings.judging?.verdictVisibility || baseSettings.verdictVisibility || 'all',
        allowSampleRun: settings.judging?.allowSampleRun ?? baseSettings.allowSampleRun ?? true,
        deadlinePolicy: {
          ...(baseSettings.deadlinePolicy || {}),
          enabled: !!sc.enabled, lateMode: sc.lateMode || 'soft',
          penaltyKind: sc.penaltyKind || 'perDay', penaltyValue: Number(sc.penaltyValue ?? 0),
          graceMin: Number(sc.graceMin ?? 0),
          capZeroAfterDays: sc.capZeroAfterDays === '' || sc.capZeroAfterDays == null ? null : Number(sc.capZeroAfterDays),
          tiers: Array.isArray(sc.tiers) && sc.tiers.length ? sc.tiers : undefined,
        },
        latePenaltyPerDay: Number(sc.latePenaltyPerDay ?? sc.penaltyValue ?? 0),
        bestOfK: bestOfK === undefined ? undefined : bestOfK,
        scoring: {
          ...baseScoring,
          rule: sc.rule || 'best',
          wrongTryMin: Number(sc.wrongTryMin ?? penaltyMin),
          penaltyMin,
          exemptCE: sc.exemptCE !== false,
          floorPct: floorPct === undefined ? undefined : floorPct,
          tiebreak: sc.tiebreak || ['solves', 'time'],
          maxTries: intOrNull(sc.maxTries, undefined),
          missDeduction: sc.missDeduction?.value > 0 ? { value: Number(sc.missDeduction.value), accrue: sc.missDeduction.accrue || 'on-solve' } : undefined,
          dropWorstN: dropWorstN === undefined ? undefined : dropWorstN,
        },
        board: { ...(baseSettings.board || {}), ...(settings.board || {}) },
        exam: settings.exam || baseSettings.exam || {},
      },
    };
    setSaving(true);
    try {
      await api(`/api/contests/${params.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      setBaseline(JSON.stringify(settings));
      toast(t.mset_saved, 'success');
      await reload();
    } catch (e) { toast(`${L.saveFailed} ${e.message}`, 'danger'); }
    finally { setSaving(false); }
  }

  if (!settings) return <Skeleton lines={6} />;

  return (
    <div className="w-full max-w-3xl min-w-0">
      <PageHeader
        title={t.mset_title}
        description={t.mset_subtitle}
        actions={<Button onClick={save} disabled={saving || !dirty}>{saving ? t.common_saving : t.mset_save_changes}</Button>}
      />

      <div>
        <Section title={t.mset_basics}>
          <FInput infoKey="name" label={t.mset_name} value={settings.name} onChange={(e) => setSettings({ ...settings, name: e.target.value })} placeholder="UZI 2026 / Labs 3" />
          <FSelect infoKey="mode" label={t.mset_mode} value={settings.mode} onChange={(e) => setSettings({ ...settings, mode: e.target.value })}>
            <option value="">—</option>{['ICPC', 'IOI', 'LABS', 'EXAM', 'PLAYGROUND', 'VIRTUAL'].map((m) => <option key={m} value={m}>{m}</option>)}
          </FSelect>
          <FTextarea infoKey="description" label={t.mset_description} value={settings.description} onChange={(e) => setSettings({ ...settings, description: e.target.value })} rows={2} />
          <p className="text-xs md:col-span-2" style={{ color: 'var(--muted)' }}>{L.scoringModeHint}</p>
        </Section>

        <Section title={t.mset_schedule}>
          <FInput infoKey="startAt" label="Start" type="datetime-local" value={settings.startAt} onChange={(e) => setSettings({ ...settings, startAt: e.target.value })} />
          <FInput infoKey="stopAt" label={t.mset_stop} type="datetime-local" value={settings.stopAt} onChange={(e) => setSettings({ ...settings, stopAt: e.target.value })} />
          <FInput infoKey="freezeAt" label={t.mset_freeze} type="datetime-local" value={settings.freezeAt} onChange={(e) => setSettings({ ...settings, freezeAt: e.target.value })} hint={t.mset_freeze_hint} />
          <FInput infoKey="defaultDeadline" label={t.mset_deadline} type="datetime-local" value={settings.defaultDeadline} onChange={(e) => setSettings({ ...settings, defaultDeadline: e.target.value })} hint={t.mset_deadline_hint} />
          <FSelect infoKey="boardMode" label={t.mset_board_who} value={settings.board?.mode || 'everyone'} onChange={(e) => setSettings({ ...settings, board: { ...(settings.board || {}), mode: e.target.value } })}>
            <option value="everyone">{t.mset_board_everyone}</option><option value="me-only">{t.mset_board_me_only}</option><option value="hidden">{t.mset_board_hidden}</option>
          </FSelect>
        </Section>

        <Section title={t.mset_access}>
          <FSelect infoKey="contestVisibility" label={t.mset_visibility} value={settings.visibility || 'members'} onChange={(e) => setSettings({ ...settings, visibility: e.target.value })}>
            <option value="members">{t.mset_vis_members}</option>
            <option value="public">{t.mset_vis_public}</option>
            <option value="hidden">{t.mset_vis_hidden}</option>
          </FSelect>
          <FSelect infoKey="registration" label={t.mset_registration} value={settings.registration} onChange={(e) => setSettings({ ...settings, registration: e.target.value })}>
            <option value="open">{t.mset_reg_open}</option><option value="approval">{t.mset_reg_approval}</option><option value="invite">{t.mset_reg_invite}</option>
          </FSelect>
          <FInput infoKey="autoApproveRegex" label={t.mset_autoapprove} value={settings.autoApproveRegex} onChange={(e) => setSettings({ ...settings, autoApproveRegex: e.target.value })} placeholder=".*@uni\.edu" />
        </Section>

        <Section title={t.mset_scoring}>
          <FInput infoKey="wrongTryMin" label={t.mset_penalty} value={settings.scoring?.wrongTryMin ?? settings.penalty} onChange={(e) => setSettings({ ...settings, penalty: Number(e.target.value), scoring: { ...(settings.scoring || {}), wrongTryMin: Number(e.target.value), penaltyMin: Number(e.target.value) } })} hint={t.mset_penalty_hint} />
          <FInput label={L.dropWorst} value={settings.scoring?.dropWorstN ?? ''} onChange={(e) => setSettings({ ...settings, scoring: { ...(settings.scoring || {}), dropWorstN: e.target.value } })} placeholder="1" />
          <FInput label={L.gradeScale} value={settings.gradeScale} onChange={(e) => setSettings({ ...settings, gradeScale: e.target.value })} placeholder={DEFAULT_GRADE_SCALE} />
          <p className="text-xs md:col-span-2" style={{ color: 'var(--muted)' }}>{L.gradeScaleHint}</p>
        </Section>
      </div>

      <div className="mt-4">
        <ScoringTweaks value={settings.scoring} goal={goalForMode(contest.mode)} onChange={(scoring) => setSettings({ ...settings, scoring, penalty: scoring.wrongTryMin ?? scoring.penaltyMin ?? settings.penalty })} />
      </div>

      <div className="mt-4">
        <h2 style={{ fontSize: 15, fontWeight: 650, letterSpacing: '-0.01em' }}>{t.mset_judging_exam}</h2>
        <div className="grid md:grid-cols-2 gap-x-6 gap-y-4 mt-4">
          <FSelect infoKey="verdictVisibility" label={t.mset_verdict_detail} value={settings.judging?.verdictVisibility || 'all'} onChange={(e) => setSettings({ ...settings, judging: { ...(settings.judging || {}), verdictVisibility: e.target.value } })}>
            <option value="all">{t.mset_verdict_all}</option><option value="first-failed">{t.mset_verdict_first}</option><option value="none">{t.mset_verdict_none}</option>
          </FSelect>
          <label className="text-sm flex gap-2 items-center md:mt-6">
            <input type="checkbox" checked={settings.judging?.allowSampleRun !== false} onChange={(e) => setSettings({ ...settings, judging: { ...(settings.judging || {}), allowSampleRun: e.target.checked } })} />
            <span style={{ fontSize: 13 }} className="font-medium">{t.sample_run}<Info for="allowSampleRun" /></span>
          </label>
          <label className="text-sm flex gap-2 items-center"><input type="checkbox" checked={!!settings.exam?.fullscreen} onChange={(e) => setSettings({ ...settings, exam: { ...(settings.exam || {}), fullscreen: e.target.checked } })} /><span style={{ fontSize: 13 }} className="font-medium">{t.mset_exam_fullscreen}<Info for="examFullscreen" /></span></label>
          <label className="text-sm flex gap-2 items-center"><input type="checkbox" checked={!!settings.exam?.pasteBlock} onChange={(e) => setSettings({ ...settings, exam: { ...(settings.exam || {}), pasteBlock: e.target.checked } })} /><span style={{ fontSize: 13 }} className="font-medium">{t.mset_exam_paste}<Info for="examPasteBlock" /></span></label>
          <label className="text-sm flex gap-2 items-center"><input type="checkbox" checked={!!settings.exam?.shuffle} onChange={(e) => setSettings({ ...settings, exam: { ...(settings.exam || {}), shuffle: e.target.checked } })} /><span style={{ fontSize: 13 }} className="font-medium">{t.mset_exam_shuffle}<Info for="examShuffle" /></span></label>
          <FInput infoKey="examIpAllow" label={t.mset_exam_ip} value={settings.exam?.ipAllow || ''} onChange={(e) => setSettings({ ...settings, exam: { ...(settings.exam || {}), ipAllow: e.target.value } })} placeholder={t.integrity_exam_ip_hint} />
          <FInput infoKey="examIpAllow" label={t.mset_exam_time} value={settings.exam?.timeWindow || ''} onChange={(e) => setSettings({ ...settings, exam: { ...(settings.exam || {}), timeWindow: e.target.value } })} placeholder={t.integrity_exam_time_hint} />
        </div>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <Button onClick={save} disabled={saving || !dirty}>{saving ? t.common_saving : t.mset_save_changes}</Button>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>{t.mset_usos_note}</span>
      </div>
    </div>
  );
}
