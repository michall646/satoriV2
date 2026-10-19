// Manage → Grading console. Client-built students×problems matrix, at-risk, heatmap, exports.
'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, API, STR, getLang } from '../../../../../lib/client';
import { Button, EmptyState, Input, Select, Skeleton, Table, Textarea } from '../../../../../components/ui';
import { toast } from '../../../../../components/ui/Toast';
import { PageHeader, PageSection, StatRow, Stat } from '../../../../../components/manage';
import { useManage } from '../../../../../components/manage/context';

function isAccept(status) { return status === 'OK' || status === 'ANS'; }

export default function ManageGradePage({ params }) {
  const t = STR[getLang()];
  const { contest } = useManage();
  const [problems, setProblems] = useState(null);
  const [members, setMembers] = useState(null);
  const [subs, setSubs] = useState(null);
  const [heat, setHeat] = useState({});
  const [formula, setFormula] = useState({ bestOfK: '', latePenalty: '5', penaltyKind: 'perDay', graceMin: '60', capZeroAfterDays: '14', floorPct: '50', previewStudent: '' });
  const [feedback, setFeedback] = useState({ filter: 'WA', text: '' });
  const [preview, setPreview] = useState(null);
  const [scale, setScale] = useState('50:3,75:4,90:5');

  useEffect(() => {
    api(`/api/contests/${params.id}/problems?all=1`).then((d) => setProblems(d.items || [])).catch(() => setProblems([]));
    api(`/api/contests/${params.id}/members`).then(setMembers).catch(() => setMembers({ members: [], pending: [] }));
    (async () => {
      const acc = [];
      let offset = 0;
      let total = Infinity;
      while (acc.length < total && offset < 20000) {
        const d = await api(`/api/submits?contest=${params.id}&limit=500&offset=${offset}`);
        const got = d.items || [];
        acc.push(...got);
        total = Number(d.total ?? acc.length);
        if (got.length === 0) break;
        offset += got.length;
      }
      setSubs(acc);
    })().catch(() => setSubs([]));
    try {
      const s = contest.settings?.deadlinePolicy;
      const sc = contest.settings?.scoring || {};
      setFormula((f) => ({
        ...f,
        bestOfK: contest.settings?.bestOfK ?? '',
        latePenalty: sc.wrongTryMin ?? s?.penaltyValue ?? 5,
        penaltyKind: s?.penaltyKind || 'perDay',
        graceMin: s?.graceMin ?? 60,
        capZeroAfterDays: s?.capZeroAfterDays ?? 14,
        floorPct: sc.floorPct ?? 50,
      }));
    } catch { /* keep defaults */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  useEffect(() => {
    if (!problems) return;
    problems.slice(0, 12).forEach(async (lab) => {
      try {
        const h = await api(`/api/problems/${lab.id}/heatmap`);
        setHeat((prev) => ({ ...prev, [lab.id]: h.fails || h }));
      } catch { /* best-effort */ }
    });
  }, [problems]);

  const labs = problems || [];
  const students = members?.members || [];

  const matrix = useMemo(() => {
    if (!problems || !members || !subs) return null;
    const byUser = new Map();
    for (const s of subs) {
      if (s.sampleOnly) continue;
      const key = String(s.userId);
      if (!byUser.has(key)) byUser.set(key, {});
      const cell = byUser.get(key);
      const cur = cell[s.problemId] || { best: 0, tries: 0, lastAt: null };
      const pts = Number(s.points ?? (isAccept(s.status) ? 100 : 0));
      if (pts >= cur.best) cur.best = pts;
      cur.tries += 1;
      if (!cur.lastAt || new Date(s.createdAt) > new Date(cur.lastAt)) cur.lastAt = s.createdAt;
      cell[s.problemId] = cur;
    }
    const rows = students.map((u) => {
      const cell = byUser.get(String(u.id)) || {};
      let total = 0; let maxTotal = 0;
      for (const lab of labs) {
        const w = Number(lab.weight ?? 1);
        maxTotal += 100 * w;
        total += (cell[lab.id]?.best || 0) * w;
      }
      let lastAt = null;
      for (const lab of labs) { const l = cell[lab.id]?.lastAt; if (l && (!lastAt || new Date(l) > new Date(lastAt))) lastAt = l; }
      const pct = maxTotal ? Math.round((total / maxTotal) * 100) : 0;
      return { id: u.id, login: u.login, cell, total, maxTotal, pct, lastAt };
    }).sort((a, b) => b.total - a.total);
    return rows;
  }, [problems, members, subs]);

  const classAvg = useMemo(() => {
    if (!matrix?.length) return 0;
    return Math.round(matrix.reduce((acc, r) => acc + r.pct, 0) / matrix.length);
  }, [matrix]);

  const atRisk = useMemo(() => {
    if (!matrix) return [];
    const now = Date.now();
    return matrix.filter((r) => {
      const stale = !r.lastAt || now - new Date(r.lastAt).getTime() > 7 * 864e5;
      return stale || r.pct < 50;
    });
  }, [matrix]);

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
      const res = await fetch(`${API}/api/contests/${params.id}/grade/export.csv?scale=${encodeURIComponent(scale)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const csv = await res.text();
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `grades-${params.id}.csv`;
      a.click();
      toast(t.grade_csv_done, 'success');
    } catch (e) { toast(`${t.grade_export_failed} ${e.message}`, 'danger'); }
  }

  if (problems === null || members === null || subs === null) return <Skeleton lines={6} />;

  if (!labs.length) {
    return (
      <div className="w-full max-w-xl">
        <PageHeader title={t.grade_title} description={t.grade_subtitle} />
        <EmptyState line={t.grade_no_problems} />
      </div>
    );
  }

  const heatRows = labs.slice(0, 12);

  return (
    <div className="w-full min-w-0">
      <PageHeader title={t.grade_title} description={t.grade_subtitle2} />

      <StatRow>
        <Stat label={t.grade_students} value={students.length} />
        <Stat label={t.problems} value={labs.length} />
        <Stat label={t.grade_average} value={`${classAvg}%`} tone={classAvg >= 50 ? 'ok' : 'warn'} />
        <Stat label={t.grade_at_risk} value={atRisk.length} hint={t.grade_at_risk_hint} tone={atRisk.length ? 'warn' : 'neutral'} />
      </StatRow>

      <div className="mt-6">
        <PageSection title={t.grade_matrix} hint={t.grade_matrix_hint}>
          {matrix.length ? (
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
                    const c = r.cell[l.id];
                    if (!c) return <span className="inline-block px-1.5 rounded" style={{ background: 'var(--wa-soft)', color: 'var(--wa-text)' }} title={t.grade_no_submit}>—</span>;
                    return <span className="type-mono" title={`${c.tries} ${t.prob_tries.toLowerCase()}`}>{c.best}</span>;
                  },
                })),
                { key: 'total', label: t.grade_total, align: 'right', stickyRight: true, render: (r) => <span className="type-mono">{r.total} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({r.pct}%)</span></span> },
              ]}
              rows={matrix.map((r) => ({ ...r, key: r.id }))}
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
                      <span style={{ color: 'var(--muted)' }}>{r.pct}%{!r.lastAt ? ` · ${t.grade_no_submits}` : ''}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm" style={{ color: 'var(--muted)' }}>{t.grade_nobody_flagged}</p>}
            </div>
            <div>
              <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>{t.grade_per_test}</p>
              {heatRows.some((l) => heat[l.id]) ? (
                <ul className="text-xs">
                  {heatRows.filter((l) => heat[l.id]).map((l) => (
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

        <PageSection title={t.grade_formula} actions={<span className="type-mono text-xs" style={{ color: 'var(--muted)' }}>{t.grade_whatif}</span>} hint={t.grade_formula_hint}>
          <div className="grid md:grid-cols-4 gap-3">
            <Input label={t.grade_best_of_k} value={formula.bestOfK} onChange={(e) => setFormula({ ...formula, bestOfK: e.target.value })} placeholder="3" />
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

        <PageSection title={t.grade_bulk}>
          <div className="grid md:grid-cols-2 gap-3">
            <Input label={t.grade_feedback_filter} value={feedback.filter} onChange={(e) => setFeedback({ ...feedback, filter: e.target.value })} />
            <Textarea label={t.grade_comment} value={feedback.text} onChange={(e) => setFeedback({ ...feedback, text: e.target.value })} rows={2} />
            <Input label={t.grade_scale} value={scale} onChange={(e) => setScale(e.target.value)} placeholder="50:3,75:4,90:5" />
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
