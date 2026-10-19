// Manage → Audit log. Filterable table of who changed what.
'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, STR, getLang } from '../../../../../lib/client';
import { EmptyState, Input, Skeleton, Table } from '../../../../../components/ui';
import { PageHeader } from '../../../../../components/manage';
import { useManage } from '../../../../../components/manage/context';

export default function ManageAuditPage({ params }) {
  const t = STR[getLang()];
  const { contest } = useManage();
  const [items, setItems] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    api(`/api/contests/${params.id}/audit`).then((d) => setItems(d.items || [])).catch(() => setItems([]));
  }, [params.id]);

  const shown = useMemo(() => {
    const ql = q.toLowerCase();
    return (items || []).filter((a) => !ql || `${a.action || ''} ${a.target || ''} ${a.actor || ''}`.toLowerCase().includes(ql));
  }, [items, q]);

  if (items === null) return <Skeleton lines={6} />;

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title={t.manage_audit}
        description={`${t.audit_desc} ${contest.name || t.manage_this_contest_loc} ${t.audit_desc_tail}`}
        actions={<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.audit_filter_ph} aria-label={t.audit_filter_aria} className="!w-64" />}
      />
      {shown.length ? (
        <Table
          stickyHeader
          columns={[
            { key: 'at', label: t.integrity_when, render: (a) => <span className="type-mono">{a.at ? new Date(a.at).toLocaleString() : '—'}</span> },
            { key: 'actor', label: t.integrity_who, render: (a) => <span className="type-mono">{a.actorLogin || a.actorId || a.actor || '—'}</span> },
            { key: 'action', label: t.integrity_action },
            { key: 'target', label: t.audit_target, render: (a) => <span className="type-mono">{a.target || '—'}</span> },
            { key: 'diff', label: t.audit_change, render: (a) => <span className="type-mono" style={{ color: 'var(--muted)' }}>{a.meta || a.diff ? JSON.stringify(a.meta || a.diff).slice(0, 120) : '—'}</span> },
          ]}
          rows={shown.slice(-300).reverse().map((a, i) => ({ ...a, key: i }))}
        />
      ) : <EmptyState line={q ? t.audit_no_match : t.audit_no_entries} />}
    </div>
  );
}
