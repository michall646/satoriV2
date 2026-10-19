// Manage → Webhooks. Register endpoints, choose events, inspect deliveries.
'use client';
import { useEffect, useState } from 'react';
import { api, STR, getLang } from '../../../../../lib/client';
import { Button, EmptyState, Input, Skeleton, Table } from '../../../../../components/ui';
import { toast } from '../../../../../components/ui/Toast';
import { PageHeader, PageSection } from '../../../../../components/manage';
import { useManage } from '../../../../../components/manage/context';

const EVENTS = ['submit.judged', 'rejudge.done', 'limit.changed'];

export default function ManageWebhooksPage({ params }) {
  const t = STR[getLang()];
  const { contest } = useManage();
  const [hooks, setHooks] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState({ 'submit.judged': true });
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setHooks((await api(`/api/contests/${params.id}/webhooks`)).items || []); } catch { setHooks([]); }
    try { setDeliveries((await api(`/api/contests/${params.id}/webhooks/deliveries`)).items || []); } catch { setDeliveries([]); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

  async function register() {
    if (!url.trim()) { toast(t.mwh_url_required, 'warn'); return; }
    setBusy(true);
    try {
      await api(`/api/contests/${params.id}/webhooks`, { method: 'POST', body: JSON.stringify({ url: url.trim(), events: Object.keys(events).filter((k) => events[k]) }) });
      toast(t.mwh_registered, 'success');
      setUrl('');
      await load();
    } catch (e) { toast(`${t.mwh_register_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function ping(h) {
    try {
      const r = await api(`/api/contests/${params.id}/webhooks/${h.id}/ping`, { method: 'POST', body: JSON.stringify({}) });
      toast(r.message || t.mwh_ping_sent, 'success');
      load();
    } catch (e) { toast(`${t.mwh_ping_failed} ${e.message}`, 'danger'); }
  }

  async function remove(h) {
    setBusy(true);
    try {
      await api(`/api/contests/${params.id}/webhooks/${h.id}`, { method: 'DELETE' });
      toast(t.mwh_removed, 'success');
      await load();
    } catch (e) { toast(`${t.manage_delete_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  if (hooks === null) return <Skeleton lines={4} />;

  return (
    <div className="w-full min-w-0 max-w-3xl">
      <PageHeader title={t.mwh_title} description={`${t.manage_wh_desc} ${contest.name || t.manage_contest} ${t.manage_wh_desc2}`} />

      <PageSection title={t.mwh_register_title}>
        <div className="flex flex-col gap-3">
          <Input label="URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          <div>
            <span className="block font-medium mb-1" style={{ fontSize: 13 }}>{t.mwh_events}</span>
            <div className="flex flex-wrap gap-3">
              {EVENTS.map((ev) => (
                <label key={ev} className="flex gap-2 items-center text-sm">
                  <input type="checkbox" checked={!!events[ev]} onChange={(e) => setEvents({ ...events, [ev]: e.target.checked })} /> <span className="type-mono text-xs">{ev}</span>
                </label>
              ))}
            </div>
          </div>
          <Button onClick={register} disabled={busy} className="self-start">{busy ? t.mwh_registering : t.mwh_register}</Button>
        </div>
      </PageSection>

      <PageSection title={t.mwh_registered_title} actions={<span className="type-mono text-xs" style={{ color: 'var(--muted)' }}>{hooks.length}</span>}>
        {hooks.length ? (
          <Table
            columns={[
              { key: 'url', label: 'URL', render: (h) => <span className="type-mono text-xs break-all">{h.url}</span> },
              { key: 'events', label: t.mwh_events, render: (h) => <span className="text-xs">{(h.events || []).join(', ')}</span> },
              { key: 'act', label: '', align: 'right', render: (h) => (
                <span className="flex gap-1 justify-end">
                  <Button variant="secondary" className="!py-0.5" onClick={() => ping(h)}>{t.mwh_test_ping}</Button>
                  <Button variant="danger" className="!py-0.5" disabled={busy} onClick={() => remove(h)}>{t.common_delete}</Button>
                </span>
              ) },
            ]}
            rows={hooks.map((h) => ({ ...h, key: h.id || h.url }))}
          />
        ) : <EmptyState line={t.mwh_no_hooks} />}
      </PageSection>

      <PageSection title={t.mwh_deliveries} actions={<span className="type-mono text-xs" style={{ color: 'var(--muted)' }}>{deliveries.length}</span>}>
        {deliveries.length ? (
          <Table
            columns={[
              { key: 'at', label: t.integrity_when, render: (d) => <span className="type-mono">{d.at ? new Date(d.at).toLocaleString() : '—'}</span> },
              { key: 'event', label: t.mwh_event_col, render: (d) => <span className="type-mono">{d.event}</span> },
              { key: 'status', label: 'Status', render: (d) => <span className="type-mono">{d.ok ? `✓ ${d.httpStatus}` : `✗ ${d.httpStatus || d.error || t.mwh_failed}${d.attempts > 1 ? ` (${d.attempts} ${t.prob_tries.toLowerCase()})` : ''}`}</span> },
            ]}
            rows={deliveries.map((d, i) => ({ ...d, key: i }))}
          />
        ) : <EmptyState line={t.mwh_no_deliveries} />}
      </PageSection>
    </div>
  );
}
