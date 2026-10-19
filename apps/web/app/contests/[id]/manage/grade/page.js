// Manage → Grading console. Server-built matrix (same formula as /grade and CSV),
// analytics, per-test heatmap, what-if preview, manual overrides, extensions,
// release control, bulk rejudge and code export.
'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, API, STR, getLang } from '../../../../../lib/client';
import { Badge, Button, EmptyState, Input, Select, Skeleton, Table, Textarea } from '../../../../../components/ui';
import { toast } from '../../../../../components/ui/Toast';
import { PageHeader, PageSection, StatRow, Stat } from '../../../../../components/manage';
import { useManage } from '../../../../../components/manage/context';

const LABELS = {
  en: {
    distribution: 'Score distribution', quality: 'Problem quality', attempts: 'Attempts',
    solves: 'Solvers', fails: 'Failed', solveRate: 'Solve %', firstBlood: 'First blood',
    none: 'no submits', idle: '7d idle', low: 'below 50%', scaleFromSettings: 'Grade scale comes from Settings.',
    noAnalytics: 'No analytics data yet.', loadFailed: 'Could not load grades:', dropWorst: 'Drop worst N',
    select: 'Select', selected: 'selected', clear: 'Clear',
    overrides: 'Manual overrides', overridesHint: 'A cell override is the final points for that problem; a total override is the final percentage. Every change is audited.',
    noOverrides: 'No manual overrides yet.', override: 'Override', overrideCell: 'Cell', overrideFinal: 'Final total',
    finalTotal: 'Final total', points: 'Points', reason: 'Reason', badPoints: 'Points must be between 0 and 100.',
    overrideSaved: 'Override saved.', overrideRemoved: 'Override removed.',
    extensions: 'Extensions', extensionsHint: 'A student extension replaces the deadline chain. Days extend each problem deadline; an until date sets one absolute deadline.',
    extend: 'Extend', extendSelected: 'Extend selected', extendDays: 'Days', extendUntil: 'Until (optional)',
    extUntil: 'until', extSaved: 'Extension rows saved', badDays: 'Enter days (+/-) or an until date.',
    selectFirst: 'Select students in the matrix first.',
    release: 'Grade release', releaseHint: 'Students see their grades only after release. The matrix and export stay available to staff.',
    releaseOn: 'Released', releaseOff: 'Hidden', releaseBtn: 'Release grades', unreleaseBtn: 'Hide grades', releasedAt: 'Released at',
    rejudge: 'Bulk rejudge', rejudgeProblem: 'Problem code/id', rejudgeVerdict: 'Verdict (e.g. WA)',
    rejudgeDo: 'Rejudge matching', rejudgeDone: 'Requeued', filterRequired: 'Enter a problem code/id or a verdict.',
    codesZip: 'Download all codes (ZIP)', zipDone: 'Codes ZIP downloaded.', zipNone: 'No codes to download yet.',
    extensionLog: 'Extension log', by: 'by',
  },
  pl: {
    distribution: 'Rozkład wyników', quality: 'Jakość zadań', attempts: 'Próby',
    solves: 'Rozwiązania', fails: 'Błędy', solveRate: 'Skuteczność', firstBlood: 'Pierwsze rozwiązanie',
    none: 'brak zgłoszeń', idle: '7 dni bezczynności', low: 'poniżej 50%', scaleFromSettings: 'Skala ocen pochodzi z Ustawień.',
    noAnalytics: 'Brak danych analitycznych.', loadFailed: 'Nie udało się wczytać ocen:', dropWorst: 'Odrzuć najgorsze N',
    select: 'Wybierz', selected: 'wybranych', clear: 'Wyczyść',
    overrides: 'Ręczne korekty', overridesHint: 'Korekta komórki to końcowe punkty za zadanie; korekta sumy to końcowy procent. Każda zmiana trafia do audytu.',
    noOverrides: 'Brak ręcznych korekt.', override: 'Korekta', overrideCell: 'Komórka', overrideFinal: 'Suma końcowa',
    finalTotal: 'Suma końcowa', points: 'Punkty', reason: 'Powód', badPoints: 'Punkty muszą być między 0 a 100.',
    overrideSaved: 'Korekta zapisana.', overrideRemoved: 'Korekta usunięta.',
    extensions: 'Przedłużenia', extensionsHint: 'Przedłużenie zastępuje łańcuch terminów. Dni przesuwają termin każdego zadania; data ustawia jeden termin.',
    extend: 'Przedłuż', extendSelected: 'Przedłuż wybranym', extendDays: 'Dni', extendUntil: 'Do (opcjonalnie)',
    extUntil: 'do', extSaved: 'Zapisano przedłużenia', badDays: 'Podaj dni (+/-) lub datę.',
    selectFirst: 'Najpierw zaznacz studentów w macierzy.',
    release: 'Publikacja ocen', releaseHint: 'Studenci widzą oceny dopiero po publikacji. Macierz i eksport działają niezależnie.',
    releaseOn: 'Opublikowane', releaseOff: 'Ukryte', releaseBtn: 'Opublikuj oceny', unreleaseBtn: 'Ukryj oceny', releasedAt: 'Opublikowano',
    rejudge: 'Masowe ocenianie ponowne', rejudgeProblem: 'Kod/id zadania', rejudgeVerdict: 'Werdykt (np. WA)',
    rejudgeDo: 'Oceń ponownie', rejudgeDone: 'W kolejce', filterRequired: 'Podaj kod/id zadania lub werdykt.',
    codesZip: 'Pobierz wszystkie kody (ZIP)', zipDone: 'Pobrano ZIP z kodami.', zipNone: 'Brak kodów do pobrania.',
    extensionLog: 'Dziennik przedłużeń', by: 'przez',
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
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState(null);
  const [extend, setExtend] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [rejudge, setRejudge] = useState({ problem: '', verdict: '' });

  async function loadAll() {
    const [m, a] = await Promise.all([
      api(`/api/contests/${params.id}/grade/matrix`),
      api(`/api/contests/${params.id}/grade/analytics`),
    ]);
    setMatrix(m);
    setAnalytics(a);
    return m;
  }

  useEffect(() => {
    let alive = true;
    loadAll().catch((e) => {
      if (!alive) return;
      toast(`${L.loadFailed} ${e.message}`, 'danger');
      setMatrix({ problems: [], rows: [], summary: { students: 0, average: 0 }, overrides: [], extensions: [], release: { released: false, at: null } });
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
  const overrides = matrix?.overrides || [];
  const extensions = matrix?.extensions || [];
  const release = matrix?.release || { released: false, at: null };
  const maxBucket = useMemo(() => Math.max(1, ...dist.map((d) => d.count)), [dist]);
  const problemLabel = (id) => {
    const p = labs.find((l) => String(l.id) === String(id));
    return p ? (p.alias || p.code) : `#${id}`;
  };

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

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(String(id))) next.delete(String(id));
      else next.add(String(id));
      return next;
    });
  }

  function openCellOverride(r, l, cell) {
    setOverride({
      userId: r.id, login: r.login, problemId: l.id, label: l.alias || l.code,
      points: cell ? cell.points : 0,
      reason: (cell && cell.override && cell.override.reason) || '',
      overrideId: (cell && cell.override && cell.override.id) || null,
    });
    setExtend(null);
  }

  function openFinalOverride(r) {
    setOverride({
      userId: r.id, login: r.login, problemId: null, label: L.finalTotal,
      points: r.total,
      reason: (r.finalOverride && r.finalOverride.reason) || '',
      overrideId: (r.finalOverride && r.finalOverride.id) || null,
    });
    setExtend(null);
  }

  function openExtension(r) {
    setExtend({ userIds: [String(r.id)], label: r.login, days: '7', until: '' });
    setOverride(null);
  }

  function openBulkExtension() {
    if (!selected.size) { toast(L.selectFirst, 'warn'); return; }
    setExtend({ userIds: [...selected], label: `${selected.size} ${L.selected}`, days: '7', until: '' });
    setOverride(null);
  }

  async function saveOverride() {
    if (!override) return;
    const points = Number(override.points);
    if (!Number.isFinite(points) || points < 0 || points > 100) { toast(L.badPoints, 'warn'); return; }
    setBusy(true);
    try {
      await api(`/api/contests/${params.id}/grade/overrides`, {
        method: 'POST',
        body: JSON.stringify({ userId: override.userId, problemId: override.problemId, points, reason: override.reason }),
      });
      toast(L.overrideSaved, 'success');
      setOverride(null);
      await loadAll();
    } catch (e) { toast(`${t.manage_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function removeOverride() {
    if (!override || !override.overrideId) return;
    setBusy(true);
    try {
      await api(`/api/contests/${params.id}/grade/overrides/${override.overrideId}`, { method: 'DELETE' });
      toast(L.overrideRemoved, 'success');
      setOverride(null);
      await loadAll();
    } catch (e) { toast(`${t.manage_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function saveExtension() {
    if (!extend) return;
    const body = { userIds: extend.userIds };
    const until = String(extend.until || '').trim();
    if (until) body.until = until;
    else {
      const days = Number(extend.days);
      if (!Number.isFinite(days) || days === 0) { toast(L.badDays, 'warn'); return; }
      body.days = days;
    }
    setBusy(true);
    try {
      const r = await api(`/api/contests/${params.id}/grade/extend-selected`, { method: 'POST', body: JSON.stringify(body) });
      toast(`${L.extSaved} (${r.updated ?? 0}).`, 'success');
      setExtend(null);
      await loadAll();
    } catch (e) { toast(`${t.manage_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function setReleased(released) {
    setBusy(true);
    try {
      await api(`/api/contests/${params.id}/grade/release`, { method: 'POST', body: JSON.stringify({ released }) });
      toast(released ? L.releaseOn : L.releaseOff, 'success');
      await loadAll();
    } catch (e) { toast(`${t.manage_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function bulkRejudge() {
    const filter = {};
    if (rejudge.problem.trim()) filter.problem = rejudge.problem.trim();
    if (rejudge.verdict.trim()) filter.verdict = rejudge.verdict.trim().toUpperCase();
    if (!filter.problem && !filter.verdict) { toast(L.filterRequired, 'warn'); return; }
    setBusy(true);
    try {
      const r = await api(`/api/contests/${params.id}/grade/rejudge`, { method: 'POST', body: JSON.stringify({ filter }) });
      toast(`${L.rejudgeDone} ${r.requeued ?? 0}.`, r.requeued ? 'success' : 'warn');
      await loadAll();
    } catch (e) { toast(`${t.manage_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function downloadCodes() {
    setBusy(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('SATORI_TOKEN') : null;
      const res = await fetch(`${API}/api/contests/${params.id}/grade/codes.zip`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body?.error?.code === 'NO_CODES') { toast(L.zipNone, 'warn'); return; }
        const msg = [body?.error?.message, body?.error?.hint].filter(Boolean).join(' ') || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `codes-${params.id}.zip`;
      a.click();
      URL.revokeObjectURL(href);
      toast(L.zipDone, 'success');
    } catch (e) { toast(`${t.grade_export_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
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
        <PageSection
          title={t.grade_matrix}
          hint={t.grade_matrix_hint}
          actions={(
            <span className="flex gap-2 items-center flex-wrap justify-end">
              <span className="type-mono text-xs" style={{ color: 'var(--muted)' }}>{selected.size} {L.selected}</span>
              <Button variant="secondary" className="!py-1" disabled={busy || !selected.size} onClick={openBulkExtension}>{L.extendSelected}</Button>
              <Button variant="ghost" className="!py-1" disabled={!selected.size} onClick={() => setSelected(new Set())}>{L.clear}</Button>
            </span>
          )}
        >
          {rows.length ? (
            <Table
              stickyHeader
              stickyFirstCols
              columns={[
                {
                  key: 'select',
                  label: L.select,
                  render: (r) => (
                    <input
                      type="checkbox"
                      className="focus-ring"
                      checked={selected.has(String(r.id))}
                      onChange={() => toggleSelect(r.id)}
                      aria-label={`${L.select} ${r.login}`}
                    />
                  ),
                },
                {
                  key: 'login',
                  label: 'Student',
                  render: (r) => (
                    <span className="flex flex-col">
                      <span className="type-mono">{r.login}</span>
                      {r.extension ? <span className="text-[11px]" style={{ color: 'var(--ok-text)' }}>{L.extUntil} {fmtAt(r.extension.until)}</span> : null}
                    </span>
                  ),
                },
                ...labs.map((l) => ({
                  key: `lab-${l.id}`,
                  label: l.alias || l.code,
                  align: 'center',
                  render: (r) => {
                    const cell = r.cells[l.id];
                    const missing = !cell;
                    const text = cell ? `${cell.points}${cell.late ? ' †' : ''}` : '—';
                    const title = cell
                      ? `${cell.raw} raw · weight ${cell.weight}${cell.lateUnits ? ` · ${cell.lateUnits} late` : ''}`
                      : t.grade_no_submit;
                    return (
                      <span className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openCellOverride(r, l, cell)}
                          className="focus-ring rounded px-1.5 py-0.5 type-mono"
                          style={missing ? { background: 'var(--wa-soft)', color: 'var(--wa-text)' } : undefined}
                          title={title}
                          aria-label={`${L.overrideCell} ${r.login} ${l.alias || l.code}`}
                        >
                          {text}
                        </button>
                        {cell && cell.overridden ? <Badge tone="warn" title={cell.override?.reason || ''}>ov</Badge> : null}
                        {cell && cell.extension ? <span className="text-[11px]" style={{ color: 'var(--ok-text)' }} title={`${L.extUntil} ${fmtAt(cell.extension.until)}`}>ext</span> : null}
                      </span>
                    );
                  },
                })),
                {
                  key: 'total',
                  label: t.grade_total,
                  align: 'right',
                  render: (r) => (
                    <span className="inline-flex items-center gap-1 justify-end">
                      <button type="button" onClick={() => openFinalOverride(r)} className="focus-ring rounded px-1 type-mono" aria-label={`${L.overrideFinal} ${r.login}`}>
                        {r.total} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({Math.round(r.pct)}%)</span>
                      </button>
                      {r.finalOverride ? <Badge tone="warn" title={r.finalOverride.reason || ''}>F</Badge> : null}
                    </span>
                  ),
                },
                {
                  key: 'extend',
                  label: '',
                  align: 'right',
                  render: (r) => <Button variant="secondary" className="!py-0.5" disabled={busy} onClick={() => openExtension(r)}>{L.extend}</Button>,
                },
                { key: 'grade', label: t.grade_grade, align: 'right', stickyRight: true, render: (r) => <span className="type-mono">{r.grade}</span> },
              ]}
              rows={rows.map((r) => ({ ...r, key: r.id }))}
            />
          ) : <EmptyState line={t.grade_no_students} />}
        </PageSection>

        {override ? (
          <PageSection
            title={`${L.override} · ${override.login} · ${override.label}`}
            hint={L.overridesHint}
            actions={<Button variant="ghost" onClick={() => setOverride(null)}>{t.common_cancel}</Button>}
          >
            <div className="grid md:grid-cols-4 gap-3 items-end">
              <Input label={L.points} type="number" min="0" max="100" step="0.5" value={override.points} onChange={(e) => setOverride({ ...override, points: e.target.value })} />
              <Input label={L.reason} value={override.reason} onChange={(e) => setOverride({ ...override, reason: e.target.value })} placeholder={t.grade_comment} />
              <Button variant="primary" disabled={busy} onClick={saveOverride}>{t.common_save}</Button>
              {override.overrideId ? <Button variant="danger" disabled={busy} onClick={removeOverride}>{t.common_remove}</Button> : null}
            </div>
          </PageSection>
        ) : null}

        {extend ? (
          <PageSection
            title={`${L.extend} · ${extend.label}`}
            hint={L.extensionsHint}
            actions={<Button variant="ghost" onClick={() => setExtend(null)}>{t.common_cancel}</Button>}
          >
            <div className="grid md:grid-cols-4 gap-3 items-end">
              <Input label={L.extendDays} type="number" step="1" value={extend.days} onChange={(e) => setExtend({ ...extend, days: e.target.value })} placeholder="7" />
              <Input label={L.extendUntil} value={extend.until} onChange={(e) => setExtend({ ...extend, until: e.target.value })} placeholder="2026-11-01T23:59:00Z" />
              <Button variant="primary" disabled={busy} onClick={saveExtension}>{t.common_save}</Button>
            </div>
          </PageSection>
        ) : null}

        {overrides.length ? (
          <PageSection title={L.overrides} hint={L.overridesHint}>
            <ul className="text-xs">
              {overrides.map((o) => (
                <li key={o.id} className="py-1 flex justify-between gap-2 border-t" style={{ borderColor: 'var(--border)' }}>
                  <span className="type-mono truncate">
                    {o.login || `#${o.userId}`} · {o.problemId == null ? L.finalTotal : problemLabel(o.problemId)} · {o.points}
                    {o.reason ? ` · ${o.reason}` : ''}
                  </span>
                  <span className="type-mono" style={{ color: 'var(--muted)' }}>{o.byLogin || `#${o.by}`} · {fmtAt(o.at)}</span>
                </li>
              ))}
            </ul>
          </PageSection>
        ) : null}

        {extensions.length ? (
          <PageSection title={L.extensionLog} hint={L.extensionsHint}>
            <ul className="text-xs">
              {extensions.map((e) => (
                <li key={e.id} className="py-1 flex justify-between gap-2 border-t" style={{ borderColor: 'var(--border)' }}>
                  <span className="type-mono truncate">{e.login || `#${e.userId}`} · {e.problemId == null ? L.finalTotal : problemLabel(e.problemId)} · {L.extUntil} {fmtAt(e.until)}</span>
                  <span className="type-mono" style={{ color: 'var(--muted)' }}>{e.byLogin || `#${e.by}`} · {fmtAt(e.at)}</span>
                </li>
              ))}
            </ul>
          </PageSection>
        ) : null}

        <PageSection
          title={L.release}
          hint={L.releaseHint}
          actions={<Badge tone={release.released ? 'signal' : 'neutral'}>{release.released ? L.releaseOn : L.releaseOff}</Badge>}
        >
          <div className="flex gap-2 flex-wrap items-center">
            {release.released
              ? <Button variant="secondary" disabled={busy} onClick={() => setReleased(false)}>{L.unreleaseBtn}</Button>
              : <Button variant="primary" disabled={busy} onClick={() => setReleased(true)}>{L.releaseBtn}</Button>}
            {release.at ? <span className="text-xs type-mono" style={{ color: 'var(--muted)' }}>{L.releasedAt} {fmtAt(release.at)}</span> : null}
          </div>
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

          <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>{L.rejudge}</p>
            <div className="grid md:grid-cols-4 gap-3 items-end">
              <Input label={L.rejudgeProblem} value={rejudge.problem} onChange={(e) => setRejudge({ ...rejudge, problem: e.target.value })} placeholder="A" />
              <Input label={L.rejudgeVerdict} value={rejudge.verdict} onChange={(e) => setRejudge({ ...rejudge, verdict: e.target.value })} placeholder="WA" />
              <Button variant="secondary" disabled={busy} onClick={bulkRejudge}>{L.rejudgeDo}</Button>
              <Button variant="secondary" disabled={busy} onClick={downloadCodes}>{L.codesZip}</Button>
            </div>
          </div>
        </PageSection>
      </div>
    </div>
  );
}
