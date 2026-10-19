// Manage → Grading console. Server-built matrix (same formula as /grade and CSV),
// analytics, per-test heatmap, what-if preview, and exports.
'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, API, STR, getLang } from '../../../../../lib/client';
import { Button, EmptyState, Input, Select, Skeleton, Table, Textarea } from '../../../../../components/ui';
import { toast } from '../../../../../components/ui/Toast';
import { PageHeader, PageSection, StatRow, Stat } from '../../../../../components/manage';
import { useManage } from '../../../../../components/manage/context';

const LABELS = {
  en: {
    distribution: 'Score distribution', quality: 'Problem quality', attempts: 'Attempts',
    solves: 'Solvers', fails: 'Failed', solveRate: 'Solve %', firstBlood: 'First blood',
    none: 'no submits', idle: '7d idle', low: 'below 50%', scaleFromSettings: 'Grade scale comes from Settings.',
    noAnalytics: 'No analytics data yet.', loadFailed: 'Could not load grades:', dropWorst: 'Drop worst N',
  },
  pl: {
    distribution: 'Rozkład wyników', quality: 'Jakość zadań', attempts: 'Próby',
    solves: 'Rozwiązania', fails: 'Błędy', solveRate: 'Skuteczność', firstBlood: 'Pierwsze rozwiązanie',
    none: 'brak zgłoszeń', idle: '7 dni bezczynności', low: 'poniżej 50%', scaleFromSettings: 'Skala ocen pochodzi z Ustawień.',
    noAnalytics: 'Brak danych analitycznych.', loadFailed: 'Nie udało się wczytać ocen:', dropWorst: 'Odrzuć najgorsze N',
  },
};

function fmtAt(at) {
  if (!at) return '—';
  try { return new Date(at).toLocaleString(getLang() === 'pl' ? 'pl-PL' : undefined, { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return String(at); }
}

export default function ManageGradePage({ params }) {
  const t = STR[getLang()];
  const L = LABELS[getLang()] || LABELS.en;
  const { contest } = useManage();
  const [matrix, setMatrix] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [heat, setHeat] = useState({});
  const [formula, setFormula] = useState({ bestOfK: '', dropWorstN: '', latePenalty: '', penaltyKind: 'perDay', graceMin: '', capZeroAfterDays: '', floorPct: '', previewStudent: '' });
  const [feedback, setFeedback] = useState({ filter: 'WA', text: '' });
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api(`/api/contests/${params.id}/grade/matrix`),
      api(`/api/contests/${params.id}/grade/analytics`),
    ]).then(([m, a]) => {
      if (!alive) return;
      setMatrix(m);
      setAnalytics(a);
    }).catch((e) => {
      if (!alive) return;
      toast(`${L.loadFailed} ${e.message}`, 'danger');
      setMatrix({ problems: [], rows: [], summary: { students: 0, average: 0 } });
      setAnalytics(null);
    });
    return () => { alive = false; };
  }, [params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const s = contest?.settings?.deadlinePolicy || {};
    const sc = contest?.settings?.scoring || {};
    setFormula((f) => ({
      ...f,
      bestOfK: contest?.settings?.bestOfK ?? '',
      dropWorstN: sc.dropWorstN ?? '',
      latePenalty: s.penaltyValue ?? contest?.settings?.latePenaltyPerDay ?? '',
      penaltyKind: s.penaltyKind || 'perDay',
      graceMin: s.graceMin ?? '',
      capZeroAfterDays: s.capZeroAfterDays ?? '',
      floorPct: sc.floorPct ?? '',
    }));
  }, [contest?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const labs = matrix?.problems || [];
    if (!labs.length) return undefined;
    let alive = true;
    labs.slice(0, 12).forEach(async (lab) => {
      try {
        const h = await api(`/api/problems/${lab.id}/heatmap`);
        if (alive) setHeat((prev) => ({ ...prev, [lab.id]: h.fails || h }));
      } catch { /* best-effort */ }
    });
    return () => { alive = false; };
  }, [matrix]);

  const labs = matrix?.problems || [];
  const rows = matrix?.rows || [];
  const summary = matrix?.summary || { students: 0, average: 0 };
  const atRisk = analytics?.atRisk || [];
  const dist = analytics?.distribution || [];
  const quality = analytics?.problems || [];
  const maxBucket = useMemo(() => Math.max(1, ...dist.map((d) => d.count)), [dist]);

  async function previewFormula() {
    try {
      const r = await api(`/api/contests/${params.id}/grade/preview`, { method: 'POST', body: JSON.stringify({ ...formula, student: formula.previewStudent }) });
      setPreview(r);
      toast(r.student ? `${t.common_preview} ${r.student.login}: ${r.student.total}% → ${t.grade_word} ${r.student.grade}` : `${t.grade_preview_over} ${r.summary?.students ?? 0} ${t.grade_students_l} · ${t.grade_avg_w} ${r.summary?.avg ?? 0}%`, 'success');
    } catch (e) { toast(`${t.grade_preview_failed} ${e.message}`, 'danger'); }
  }

  async function bulkFeedback() {
    try {
      const r = await api(`/api/contests/${params.id}/grade/feedback`, { method: 'POST', body: JSON.stringify(feedback) });
      toast(`${t.grade_feedback_sent} ${r.users ?? 0} ${t.grade_users_w} (${r.count ?? 0} ${t.grade_submits_w}).`, 'success');
    } catch (e) { toast(`${t.grade_feedback_failed} ${e.message}`, 'danger'); }
  }

  async function usosCsv() {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('SATORI_TOKEN') : null;
      const res = await fetch(`${API}/api/contests/${params.id}/grade/export.csv`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = [body?.error?.message, body?.error?.hint].filter(Boolean).join(' ') || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const csv = await res.text();
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `grades-${params.id}.csv`;
      a.click();
      URL.revokeObjectURL(href);
      toast(t.grade_csv_done, 'success');
    } catch (e) { toast(`${t.grade_export_failed} ${e.message}`, 'danger'); }
  }

  if (matrix === null) return <Skeleton lines={6} />;

  if (!labs.length) {
    return (
      <div className="w-full max-w-xl">
        <PageHeader title={t.grade_title} description={t.grade_subtitle} />
        <EmptyState line={t.grade_no_problems} />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      <PageHeader title={t.grade_title} description={t.grade_subtitle2} />

      <StatRow>
        <Stat label={t.grade_students} value={summary.students} />
        <Stat label={t.problems} value={labs.length} />
        <Stat label={t.grade_average} value={`${summary.average}%`} tone={summary.average >= 50 ? 'ok' : 'warn'} />
        <Stat label={t.grade_at_risk} value={atRisk.length} hint={t.grade_at_risk_hint} tone={atRisk.length ? 'warn' : 'neutral'} />
      </StatRow>

      <div className="mt-6">
        <PageSection title={t.grade_matrix} hint={t.grade_matrix_hint}>
          {rows.length ? (
            <Table
              stickyHeader
              stickyFirstCols
              columns={[
                { key: 'login', label: 'Student' },
                ...labs.map((l) => ({
                  key: `lab-${l.id}`,
                  label: l.alias || l.code,
                  align: 'center',
                  render: (r) => {
                    const c = r.cells[l.id];
                    if (!c) return <span className="inline-block px-1.5 rounded" style={{ background: 'var(--wa-soft)', color: 'var(--wa-text)' }} title={t.grade_no_submit}>—</span>;
                    return (
                      <span className="type-mono" title={`${c.raw} raw · weight ${c.weight}${c.lateUnits ? ` · ${c.lateUnits} late` : ''}`}>
                        {c.points}{c.late ? ' †' : ''}
                      </span>
                    );
                  },
                })),
                { key: 'total', label: t.grade_total, align: 'right', render: (r) => <span className="type-mono">{r.total} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({Math.round(r.pct)}%)</span></span> },
                { key: 'grade', label: t.grade_grade, align: 'right', stickyRight: true, render: (r) => <span className="type-mono">{r.grade}</span> },
              ]}
              rows={rows.map((r) => ({ ...r, key: r.id }))}
            />
          ) : <EmptyState line={t.grade_no_students} />}
        </PageSection>

        <PageSection title={t.grade_signals}>
          <div className="grid md:grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>{t.grade_at_risk} · {atRisk.length}</p>
              {atRisk.length ? (
                <ul className="text-xs">
                  {atRisk.slice(0, 12).map((r) => (
                    <li key={r.id} className="py-1 flex justify-between gap-2 border-t" style={{ borderColor: 'var(--border)' }}>
                      <span className="type-mono truncate">{r.login}</span>
                      <span className="type-mono" style={{ color: 'var(--muted)' }}>
                        {r.total}% · {t.grade_word} {r.grade}
                        {r.reasons?.length ? ` · ${r.reasons.map((x) => (x === 'low' ? L.low : x === 'idle' ? L.idle : L.none)).join(', ')}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm" style={{ color: 'var(--muted)' }}>{t.grade_nobody_flagged}</p>}
            </div>
            <div>
              <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>{t.grade_per_test}</p>
              {labs.some((l) => heat[l.id]) ? (
                <ul className="text-xs">
                  {labs.filter((l) => heat[l.id]).map((l) => (
                    <li key={l.id} className="py-1 border-t" style={{ borderColor: 'var(--border)' }}>
                      <span className="prob-code">{l.alias || l.code}</span>{' '}
                      <span className="type-mono" style={{ color: 'var(--muted)' }}>{Object.entries(heat[l.id] || {}).map(([n, c]) => `t${n}:${c}`).join(' ')}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm" style={{ color: 'var(--muted)' }}>{t.grade_no_per_test}</p>}
            </div>
          </div>
        </PageSection>

        {analytics ? (
          <PageSection title={L.distribution}>
            <div className="max-w-xl">
              {dist.map((d) => (
                <div key={d.label} className="flex items-center gap-2 py-0.5">
                  <span className="type-mono text-xs" style={{ width: 64, color: 'var(--muted)' }}>{d.label}</span>
                  <span className="flex-1 h-2 rounded overflow-hidden" style={{ background: 'var(--border)' }}>
                    <span className="block h-full" style={{ width: `${Math.round((d.count / maxBucket) * 100)}%`, background: 'var(--accent)' }} />
                  </span>
                  <span className="type-mono text-xs text-right" style={{ width: 24 }}>{d.count}</span>
                </div>
              ))}
            </div>
          </PageSection>
        ) : null}

        {analytics ? (
          <PageSection
            title={L.quality}
            actions={analytics.firstBlood ? (
              <span className="type-mono text-xs" style={{ color: 'var(--muted)' }}>
                {L.firstBlood}: {analytics.firstBlood.login || '—'} · {analytics.firstBlood.code} · {fmtAt(analytics.firstBlood.at)}
              </span>
            ) : null}
          >
            {quality.length ? (
              <Table
                columns={[
                  { key: 'code', label: 'Problem', render: (p) => <span className="prob-code">{p.alias || p.code}</span> },
                  { key: 'attempts', label: L.attempts, align: 'right' },
                  { key: 'solvers', label: L.solves, align: 'right' },
                  { key: 'failedSubmits', label: L.fails, align: 'right' },
                  { key: 'solveRatePct', label: L.solveRate, align: 'right', render: (p) => `${p.solveRatePct}%` },
                  { key: 'firstBlood', label: L.firstBlood, render: (p) => (p.firstBlood ? `${p.firstBlood.login || '—'} · ${fmtAt(p.firstBlood.at)}` : '—') },
                ]}
                rows={quality.map((p) => ({ ...p, key: p.id }))}
              />
            ) : <p className="text-sm" style={{ color: 'var(--muted)' }}>{L.noAnalytics}</p>}
          </PageSection>
        ) : null}

        <PageSection title={t.grade_formula} actions={<span className="type-mono text-xs" style={{ color: 'var(--muted)' }}>{t.grade_whatif}</span>} hint={t.grade_formula_hint}>
          <div className="grid md:grid-cols-4 gap-3">
            <Input label={t.grade_best_of_k} value={formula.bestOfK} onChange={(e) => setFormula({ ...formula, bestOfK: e.target.value })} placeholder="3" />
            <Input label={L.dropWorst} value={formula.dropWorstN} onChange={(e) => setFormula({ ...formula, dropWorstN: e.target.value })} placeholder="1" />
            <Input label={t.grade_late_penalty} value={formula.latePenalty} onChange={(e) => setFormula({ ...formula, latePenalty: e.target.value })} />
            <Select label={t.grade_penalty_kind} value={formula.penaltyKind} onChange={(e) => setFormula({ ...formula, penaltyKind: e.target.value })}>
              <option value="perDay">{t.grade_per_day}</option><option value="perHour">{t.grade_per_hour}</option><option value="percent">{t.grade_percent}</option>
            </Select>
            <Input label={t.grade_grace} value={formula.graceMin} onChange={(e) => setFormula({ ...formula, graceMin: e.target.value })} />
            <Input label={t.grade_cap_zero} value={formula.capZeroAfterDays} onChange={(e) => setFormula({ ...formula, capZeroAfterDays: e.target.value })} />
            <Input label={t.grade_late_floor} value={formula.floorPct} onChange={(e) => setFormula({ ...formula, floorPct: e.target.value })} />
            <Input label={t.grade_preview_login} value={formula.previewStudent} onChange={(e) => setFormula({ ...formula, previewStudent: e.target.value })} />
            <div className="flex items-end"><Button variant="secondary" onClick={previewFormula}>{t.common_preview}</Button></div>
          </div>
          {preview ? (
            <div className="mt-3">
              <p className="text-xs" style={{ color: 'var(--muted)' }}>{t.grade_applied} {t.grade_best_of_k_l} {preview.applied?.bestOfK ?? '—'} · {t.grade_penalty_w} {preview.applied?.penaltyValue ?? '—'} {preview.applied?.penaltyKind || ''} · {t.grade_grace_w} {preview.applied?.graceMin ?? '—'} min · {t.grade_cap_w} {preview.applied?.capZeroAfterDays ?? '—'} d · {t.grade_floor_w} {preview.applied?.floorPct ?? '—'}% · {t.grade_drop_worst} {preview.applied?.dropWorstN ?? '—'}</p>
              {preview.student
                ? <p className="text-sm mt-1 font-medium">Student {preview.student.login}: {preview.student.total}% → {t.grade_word} {preview.student.grade}</p>
                : <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{t.grade_class_avg} {preview.summary?.avg ?? 0}% ({preview.summary?.students ?? 0} {t.grade_students_l})</p>}
              {preview.rows?.length ? (
                <div className="mt-2 max-h-56 overflow-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
                  <table className="w-full text-left text-xs">
                    <thead><tr><th className="p-2">Student</th><th className="p-2 text-right">{t.grade_total}</th><th className="p-2 text-right">{t.grade_grade}</th></tr></thead>
                    <tbody>
                      {preview.rows.slice(0, 30).map((row) => (
                        <tr key={row.login} className="border-t" style={{ borderColor: 'var(--border)' }}>
                          <td className="p-2 type-mono">{row.login}</td>
                          <td className="p-2 text-right type-mono">{row.total}</td>
                          <td className="p-2 text-right type-mono">{row.grade}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
        </PageSection>

        <PageSection title={t.grade_bulk} hint={L.scaleFromSettings}>
          <div className="grid md:grid-cols-2 gap-3">
            <Input label={t.grade_feedback_filter} value={feedback.filter} onChange={(e) => setFeedback({ ...feedback, filter: e.target.value })} />
            <Textarea label={t.grade_comment} value={feedback.text} onChange={(e) => setFeedback({ ...feedback, text: e.target.value })} rows={2} />
          </div>
          <div className="flex gap-2 mt-3 flex-wrap items-center">
            <Button variant="secondary" onClick={bulkFeedback}>{t.grade_post_feedback}</Button>
            <Button variant="secondary" onClick={usosCsv}>{t.grade_export_csv}</Button>
            <a className="text-sm underline focus-ring rounded self-center" href={`${API}/api/contests/${params.id}/grade.ics`}>{t.manage_ics}</a>
          </div>
        </PageSection>
      </div>
    </div>
  );
}
