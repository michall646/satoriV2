// Manage → Integrity. Similarity, appeals, timeline flags, exam controls, audit.
'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, STR, getLang } from '../../../../../lib/client';
import { Badge, Button, DiffView, EmptyState, Icon, Input, Notice, Skeleton, Table } from '../../../../../components/ui';
import { toast } from '../../../../../components/ui/Toast';
import { PageHeader, PageSection } from '../../../../../components/manage';
import { useManage } from '../../../../../components/manage/context';

export default function ManageIntegrityPage({ params }) {
  const t = STR[getLang()];
  const lang = getLang() === 'pl' ? 'pl' : 'en';
  const vtxt = lang === 'pl'
    ? { log: 'Rejestr naruszeń', type: 'Typ', detail: 'Szczegóły' }
    : { log: 'Violation log', type: 'Type', detail: 'Detail' };
  const { contest } = useManage();
  const [pairs, setPairs] = useState(null);
  const [threshold, setThreshold] = useState(0.6);
  const [appeals, setAppeals] = useState([]);
  const [flags, setFlags] = useState([]);
  const [audit, setAudit] = useState([]);
  const [auditQ, setAuditQ] = useState('');
  const [exam, setExam] = useState({ fullscreen: false, pasteBlock: false, shuffle: false, ipAllow: '', timeWindow: '' });
  const [violations, setViolations] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api(`/api/contests/${params.id}/integrity/similarity?threshold=${threshold}`)
      .then((d) => setPairs(d.pairs || []))
      .catch(() => setPairs([]));
    api(`/api/contests/${params.id}/integrity/appeals`).then((d) => setAppeals(d.items || [])).catch(() => setAppeals([]));
    api(`/api/contests/${params.id}/integrity/timeline`).then((d) => setFlags(d.flags || [])).catch(() => setFlags([]));
    api(`/api/contests/${params.id}/audit`).then((d) => setAudit(d.items || [])).catch(() => setAudit([]));
    api(`/api/contests/${params.id}/exam`).then((d) => setExam((prev) => ({ ...prev, ...(d.settings || d) }))).catch(() => { });
    api(`/api/contests/${params.id}/exam/violations`, { noCache: true }).then((d) => setViolations(d.items || [])).catch(() => setViolations(null));
  }, [params.id, threshold]);

  const shown = useMemo(
    () => (pairs || []).filter((p) => (p.score ?? 0) >= threshold).map((p) => ({ ...p, _level: (p.score ?? 0) >= 0.85 ? 'high' : 'flag' })),
    [pairs, threshold],
  );

  async function resolveAppeal(id, verdict) {
    try {
      await api(`/api/contests/${params.id}/integrity/appeals/${id}`, { method: 'POST', body: JSON.stringify({ verdict }) });
      toast(`${t.integrity_appeal_line} ${id} → ${verdict}.`, 'success');
      setAppeals(appeals.filter((a) => a.id !== id));
    } catch (e) { toast(`${t.integrity_resolve_failed} ${e.message}`, 'danger'); }
  }

  async function saveExam() {
    try {
      const r = await api(`/api/contests/${params.id}/exam`, { method: 'PATCH', body: JSON.stringify({ settings: exam }) });
      setExam((prev) => ({ ...prev, ...(r.settings || {}) }));
      toast(t.integrity_saved, 'success');
    } catch (e) { toast(`${t.integrity_save_failed} ${e.message}`, 'danger'); }
  }

  if (pairs === null) return <Skeleton lines={6} />;

  const auditFiltered = audit.filter((a) => !auditQ || `${a.action} ${a.target} ${a.actor}`.toLowerCase().includes(auditQ.toLowerCase()));

  return (
    <div className="w-full min-w-0 max-w-4xl">
      <PageHeader title={t.integrity} description={t.integrity_subtitle} />

      <Notice tone="info" icon={<Icon name="info" size={16} />} dense className="mb-4">
        {t.integrity_jury_note}
      </Notice>

      <PageSection title={t.integrity_similarity} actions={<span className="type-mono text-xs" style={{ color: 'var(--muted)' }}>{t.integrity_legend}</span>}>
        <label className="text-xs flex items-center gap-3 mb-3">
          <span style={{ color: 'var(--muted)' }}>{t.integrity_threshold}</span>
          <input type="range" min="0.4" max="0.95" step="0.05" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          <span className="type-mono">{threshold}</span>
        </label>
        {shown.length ? (
          <Table
            columns={[
              { key: 'a', label: t.integrity_pair, render: (p) => <span className="type-mono">{p.a} ↔ {p.b}</span> },
              { key: 'score', label: t.integrity_score, render: (p) => <Badge tone={p._level === 'high' ? 'danger' : 'warn'}>{p.score?.toFixed?.(2) ?? p.score}</Badge> },
              { key: 'open', label: '', align: 'right', render: (p) => <Button variant="secondary" className="!py-0.5" onClick={() => setSelected(p)}>{t.integrity_diff}</Button> },
            ]}
            rows={shown.map((p, i) => ({ ...p, key: i }))}
          />
        ) : <EmptyState line={t.integrity_none_pairs} />}
        {selected ? (
          <div className="mt-3">
            <DiffView expected={selected.codeA || ''} got={selected.codeB || ''} />
            <Button variant="secondary" className="mt-2" onClick={() => setSelected(null)}>{t.common_close}</Button>
          </div>
        ) : null}
      </PageSection>

      <PageSection title={t.integrity_signals}>
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-4">
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>{t.integrity_appeal} · {appeals.length}</p>
            {appeals.length ? (
              <ul>
                {appeals.map((a) => (
                  <li key={a.id} className="py-2 border-t flex items-center gap-2" style={{ borderColor: 'var(--border)' }}>
                    <span className="text-xs flex-1 min-w-0"><strong className="type-mono">{a.student}</strong> {a.text}</span>
                    <Button variant="secondary" className="!py-0" onClick={() => resolveAppeal(a.id, 'upheld')}>{t.integrity_uphold}</Button>
                    <Button variant="danger" className="!py-0" onClick={() => resolveAppeal(a.id, 'rejected')}>{t.integrity_reject}</Button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm" style={{ color: 'var(--muted)' }}>{t.integrity_no_appeals}</p>}
          </div>
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>{t.integrity_timeline}</p>
            {flags.length ? (
              <ul className="text-xs">
                {flags.map((f, i) => <li key={i} className="py-1 border-t" style={{ borderColor: 'var(--border)' }}>{f.text || JSON.stringify(f)} {t.integrity_timeline_hint}</li>)}
              </ul>
            ) : <p className="text-sm" style={{ color: 'var(--muted)' }}>{t.integrity_none_detected}</p>}
          </div>
        </div>
      </PageSection>

      <PageSection title={t.integrity_exam_controls}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <label className="text-sm flex gap-2 items-center"><input type="checkbox" checked={!!exam.fullscreen} onChange={(e) => setExam({ ...exam, fullscreen: e.target.checked })} /> {t.exam_fullscreen}</label>
          <label className="text-sm flex gap-2 items-center"><input type="checkbox" checked={!!exam.pasteBlock} onChange={(e) => setExam({ ...exam, pasteBlock: e.target.checked })} /> {t.exam_paste_block}</label>
          <label className="text-sm flex gap-2 items-center"><input type="checkbox" checked={!!exam.shuffle} onChange={(e) => setExam({ ...exam, shuffle: e.target.checked })} /> {t.exam_shuffle}</label>
        </div>
        <div className="grid md:grid-cols-2 gap-3 mt-3">
          <Input label={t.integrity_exam_ip_label} value={exam.ipAllow || ''} onChange={(e) => setExam({ ...exam, ipAllow: e.target.value })} placeholder={t.integrity_exam_ip_hint} />
          <Input label={t.integrity_exam_time_label} value={exam.timeWindow || ''} onChange={(e) => setExam({ ...exam, timeWindow: e.target.value })} placeholder={t.integrity_exam_time_hint} />
        </div>
        <Button variant="secondary" className="mt-3" onClick={saveExam}>{t.integrity_save_exam}</Button>
      </PageSection>

      <PageSection
        title={vtxt.log}
        actions={<span className="type-mono text-xs" style={{ color: 'var(--muted)' }}>{(violations || []).length} {t.integrity_violations}</span>}
      >
        <Table
          stickyHeader
          columns={[
            { key: 'at', label: t.integrity_when, render: (v) => <span className="type-mono">{v.at ? new Date(v.at).toLocaleString() : '—'}</span> },
            { key: 'who', label: t.integrity_who, render: (v) => <span className="type-mono">{v.who || '?'}</span> },
            { key: 'type', label: vtxt.type, render: (v) => <Badge tone="warn">{v.type || '—'}</Badge> },
            { key: 'detail', label: vtxt.detail, fill: true, render: (v) => <span className="text-xs">{v.detail || '—'}{v.ip ? ` · ${v.ip}` : ''}</span> },
          ]}
          rows={(violations || []).map((v, i) => ({ ...v, key: v.id ?? i }))}
        />
      </PageSection>

      <PageSection title={t.manage_audit} actions={<Input value={auditQ} onChange={(e) => setAuditQ(e.target.value)} placeholder={t.integrity_filter} className="!w-56" aria-label={t.integrity_filter} />}>
        {auditFiltered.length ? (
          <Table
            stickyHeader
            columns={[
              { key: 'at', label: t.integrity_when, render: (a) => <span className="type-mono">{a.at ? new Date(a.at).toLocaleString() : '—'}</span> },
              { key: 'actor', label: t.integrity_who, render: (a) => <span className="type-mono">{a.actorLogin || a.actorId || '—'}</span> },
              { key: 'action', label: t.integrity_action },
              { key: 'target', label: t.integrity_target, render: (a) => <span className="type-mono" style={{ color: 'var(--muted)' }}>{a.target} {a.meta || a.diff ? JSON.stringify(a.meta || a.diff).slice(0, 100) : ''}</span> },
            ]}
            rows={auditFiltered.slice(-200).reverse().map((a, i) => ({ ...a, key: i }))}
          />
        ) : <EmptyState line={t.integrity_no_audit} />}
      </PageSection>
    </div>
  );
}
