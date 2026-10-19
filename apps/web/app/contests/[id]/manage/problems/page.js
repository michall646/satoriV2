// Manage → Problems list. Searchable, visibility-filtered, dense table with inline actions.
'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, STR, getLang } from '../../../../../lib/client';
import { Badge, Button, EmptyState, Input, Modal, Segmented, Skeleton, Table, Textarea } from '../../../../../components/ui';
import { toast } from '../../../../../components/ui/Toast';
import { PageHeader } from '../../../../../components/manage';

// Static key strings per option so the i18n scanner sees real references; resolved at render.
const VIS_OPTIONS = [
  { value: 'all', key: 'mprob_vis_all' },
  { value: 'draft', key: 'mprob_vis_draft' },
  { value: 'hidden', key: 'mprob_vis_hidden' },
  { value: 'visible', key: 'mprob_vis_visible' },
  { value: 'quarantined', key: 'mprob_vis_quarantined' },
];

const VIS_TONE = { visible: 'accent', quarantined: 'danger', draft: 'neutral', hidden: 'warn' };

export default function ManageProblemsPage({ params }) {
  const t = STR[getLang()];
  const [items, setItems] = useState(null);
  const [q, setQ] = useState('');
  const [vis, setVis] = useState('all');
  const [action, setAction] = useState(null); // { type, problem, value }
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const d = await api(`/api/contests/${params.id}/problems?all=1`);
      setItems(d.items || []);
    } catch { setItems([]); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

  const dupLetters = useMemo(() => {
    const seen = {}; const dupes = [];
    for (const p of (items || [])) {
      const l = p.alias || p.code?.[0];
      if (!l) continue;
      if (seen[l]) dupes.push(l);
      seen[l] = true;
    }
    return dupes;
  }, [items]);

  const shown = useMemo(() => {
    const ql = q.toLowerCase();
    return (items || []).filter((p) => {
      if (vis !== 'all' && (p.visibility || 'visible') !== vis) return false;
      if (ql && !`${p.code} ${p.name}`.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [items, vis, q]);

  const visLabel = (v) => t[VIS_OPTIONS.find((o) => o.value === v)?.key] || v;

  async function rejudge(p) {
    setBusy(true);
    try {
      const r = await api(`/api/problems/${p.id}/rejudge`, { method: 'POST', body: JSON.stringify({}) });
      toast(`${p.code}: ${t.mprob_requeued} ${r.requeued ?? 0}.`, 'success');
    } catch (e) { toast(`${t.mprob_rejudge_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function setWeight(p, weight) {
    const w = Number(weight);
    if (!Number.isFinite(w) || w <= 0) { toast(t.mprob_weight_invalid, 'warn'); load(); return; }
    if (w === Number(p.weight ?? 1)) return;
    try {
      await api(`/api/problems/${p.id}`, { method: 'PATCH', body: JSON.stringify({ weight: w }) });
      toast(`${p.code} ${t.mprob_weight_set} ${w}.`, 'success');
      load();
    } catch (e) { toast(`${t.manage_failed} ${e.message}`, 'danger'); }
  }

  async function submitAction() {
    if (!action) return;
    const { type, problem: p, value } = action;
    setBusy(true);
    try {
      if (type === 'quarantine') {
        await api(`/api/problems/${p.id}`, { method: 'PATCH', body: JSON.stringify({ visibility: 'quarantined', quarantineReason: value || 'jury decision' }) });
        toast(`${p.code} ${t.mprob_quarantined}`, 'warn');
      } else if (type === 'clone') {
        await api(`/api/problems/${p.id}/clone`, { method: 'POST', body: JSON.stringify({ contestId: value || params.id }) });
        toast(`${p.code} ${t.mprob_cloned} ${value || params.id}.`, 'success');
      } else if (type === 'alias') {
        await api(`/api/problems/${p.id}`, { method: 'PATCH', body: JSON.stringify({ aliasLetters: { [params.id]: value } }) });
        toast(`${p.code} alias → ${value}.`, 'success');
      }
      setAction(null);
      load();
    } catch (e) { toast(`${t.manage_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  if (items === null) return <Skeleton lines={6} />;

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title={t.problems}
        description={`${(items || []).length} ${t.mprob_count} ${t.mprob_in_contest}`}
        actions={<Link href={`/contests/${params.id}/manage/problems/new`} prefetch className="btn btn-primary focus-ring">+ {t.mprob_new}</Link>}
      />

      {dupLetters.length ? (
        <p role="alert" className="text-sm mb-3 px-3 py-2 rounded" style={{ background: 'var(--tle-soft)', color: 'var(--tle-text)', border: '1px solid var(--tle-line)' }}>
          ⚠ {t.mprob_conflict_1} <strong>{[...new Set(dupLetters)].join(', ')}</strong> {t.mprob_conflict_2}
        </p>
      ) : null}

      <div className="flex items-center gap-3 flex-wrap mb-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.mprob_filter_ph} className="!w-56" aria-label={t.mprob_filter_aria} />
        <Segmented options={VIS_OPTIONS.map((o) => ({ value: o.value, label: t[o.key] || o.value }))} value={vis} onChange={setVis} ariaLabel={t.mprob_vis_aria} />
        <span className="text-xs" style={{ color: 'var(--muted)' }}>{shown.length} {t.mprob_shown}</span>
      </div>

      {shown.length ? (
        <Table
          stickyHeader
          columns={[
            { key: 'code', label: t.prob_code, render: (p) => <span className="prob-code">{p.alias || p.code} <span className="type-mono" style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>({p.code})</span></span> },
            { key: 'name', label: t.prob_name, render: (p) => <Link className="underline focus-ring rounded" href={`/contests/${params.id}/manage/problems/${p.id}`} prefetch>{p.name}</Link> },
            { key: 'vis', label: t.mprob_col_visibility, render: (p) => <Badge tone={VIS_TONE[p.visibility || 'visible'] || 'neutral'}>{visLabel(p.visibility || 'visible')}</Badge> },
            { key: 'solves', label: t.mprob_col_solves, render: (p) => <span className="type-mono">{p.solvesPct ?? '—'}% / {p._tries ?? p.tries ?? 0}</span> },
            {
              key: 'weight', label: t.mprob_col_weight, align: 'center', render: (p) => (
                <input
                  key={p.weight ?? 1}
                  aria-label={`${t.mprob_weight_for} ${p.code}`}
                  defaultValue={p.weight ?? 1}
                  type="number"
                  min="0"
                  className="rounded px-2 py-1 text-sm focus-ring !w-20"
                  style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)' }}
                  onBlur={(e) => setWeight(p, e.target.value)}
                />
              ),
            },
            {
              key: 'act', label: t.prob_actions, align: 'right', render: (p) => (
                <span className="flex gap-1 justify-end flex-wrap">
                  <Button variant="secondary" className="!py-0.5" disabled={busy} onClick={() => rejudge(p)}>{t.mprob_rejudge}</Button>
                  <Button variant="secondary" className="!py-0.5" onClick={() => setAction({ type: 'quarantine', problem: p, value: '' })}>{t.mprob_quarantine}</Button>
                  <Button variant="secondary" className="!py-0.5" onClick={() => setAction({ type: 'clone', problem: p, value: params.id })}>{t.mprob_clone}</Button>
                  <Button variant="secondary" className="!py-0.5" onClick={() => setAction({ type: 'alias', problem: p, value: p.alias || p.code })}>Alias</Button>
                </span>
              ),
            },
          ]}
          rows={shown.map((p) => ({ ...p, key: p.id }))}
        />
      ) : (
        <EmptyState line={q || vis !== 'all' ? t.mprob_no_match : t.mprob_empty} action={<Link href={`/contests/${params.id}/manage/problems/new`} prefetch className="btn btn-primary focus-ring">+ {t.mprob_add_first}</Link>} />
      )}

      <Modal
        open={!!action}
        onClose={() => setAction(null)}
        title={action ? { quarantine: `${t.mprob_quarantine} ${action.problem.code}`, clone: `${t.mprob_clone} ${action.problem.code}`, alias: `Alias ${action.problem.code}` }[action.type] : ''}
        onSubmit={submitAction}
        submitLabel={action ? { quarantine: t.mprob_quarantine, clone: t.mprob_clone, alias: t.mprob_save_alias }[action.type] : t.common_save}
      >
        {action?.type === 'quarantine' ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm" style={{ color: 'var(--muted)' }}>{t.mprob_quarantine_hint}</p>
            <Textarea label={t.mprob_reason} value={action.value} onChange={(e) => setAction({ ...action, value: e.target.value })} rows={2} placeholder={t.mprob_reason_ph} />
          </div>
        ) : null}
        {action?.type === 'clone' ? (
          <div className="flex flex-col gap-2">
            <Input label={t.mprob_target_id} value={action.value} onChange={(e) => setAction({ ...action, value: e.target.value })} placeholder={String(params.id)} />
            <p className="text-xs" style={{ color: 'var(--muted)' }}>{t.mprob_same_id}</p>
          </div>
        ) : null}
        {action?.type === 'alias' ? (
          <Input label={t.mprob_alias_label} value={action.value} onChange={(e) => setAction({ ...action, value: e.target.value })} placeholder="A" />
        ) : null}
      </Modal>
    </div>
  );
}
