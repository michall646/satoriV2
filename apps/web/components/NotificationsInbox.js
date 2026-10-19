// Notifications inbox: submit.judged, rejudge.done, limit.changed, editorial; read/unread, filters, prefs.
'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, getLang, STR } from '../lib/client';
import { Button, Card, EmptyState, Input, Select, Skeleton, VerdictPill } from './ui';
import { toast } from './ui/Toast';

export default function NotificationsInbox({ compact, preview }) {
  const t = STR[getLang()];
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState('all');
  const [showUnread, setShowUnread] = useState(false);
  const [prefs, setPrefs] = useState({ inApp: true, email: false, webhook: '' });

  async function load() {
    try {
      const d = await api('/api/notifications');
      setItems(d.items || []);
    } catch { setItems([]); }
    try {
      const p = await api('/api/notifications/prefs');
      setPrefs((prev) => ({ ...prev, ...(p.prefs || p) }));
    } catch { /* keep defaults */ }
  }

  useEffect(() => { load(); }, []);

  async function markRead(ids) {
    if (!ids.length) return;
    try {
      await api('/api/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) });
      setItems((prev) => (prev || []).map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)));
    } catch (e) { toast(`${t.notif_mark_failed} ${e.message}`, 'warn'); }
  }

  async function savePrefs() {
    try {
      const r = await api('/api/notifications/prefs', { method: 'POST', body: JSON.stringify(prefs) });
      if (r.prefs) setPrefs(r.prefs);
      toast(t.notif_prefs_saved, 'success');
    } catch (e) { toast(`${t.notif_prefs_failed} ${e.message}`, 'danger'); }
  }

  const shown = useMemo(() => {
    let arr = items || [];
    if (filter !== 'all') arr = arr.filter((n) => n.type === filter);
    if (showUnread) arr = arr.filter((n) => !n.read);
    return arr;
  }, [items, filter, showUnread]);

  if (items === null) return <Skeleton lines={preview ? 3 : 5} />;

  if (preview) {
    const latest = shown.slice(0, 4);
    if (!latest.length) return <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>{t.notif_none}</p>;
    return (
      <ul className="mt-1">
        {latest.map((n) => (
          <li key={n.id} className={`flex items-center gap-2 py-2 border-b last:border-0 text-sm ${n.read ? 'opacity-60' : ''}`} style={{ borderColor: 'var(--border)' }}>
            <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: n.read ? 'var(--border)' : 'var(--accent)' }} />
            <span className="flex-1 min-w-0 truncate">{n.text || n.payload?.message || n.type}</span>
            {n.at ? <span className="text-[11px] shrink-0 tabular-nums" style={{ color: 'var(--muted)' }}>{new Date(n.at).toLocaleDateString()}</span> : null}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div>
      {!compact ? <h1 className="type-h1">{t.notifications}</h1> : null}
      <div className="flex gap-2 my-2 text-sm items-center flex-wrap">
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="type">
          <option value="all">{t.notif_all}</option>
          <option value="submit.judged">submit.judged</option>
          <option value="rejudge.done">rejudge.done</option>
          <option value="limit.changed">limit.changed</option>
          <option value="editorial">editorial</option>
        </Select>
        <label className="flex gap-1 items-center"><input type="checkbox" checked={showUnread} onChange={(e) => setShowUnread(e.target.checked)} /> {t.notif_unread_only}</label>
        <Button variant="secondary" onClick={() => markRead(shown.filter((n) => !n.read).map((n) => n.id))}>{t.notifications_mark_read} ({shown.filter((n) => !n.read).length})</Button>
      </div>
      {!shown.length ? <EmptyState line={t.notif_none} /> : (
        <ul>
          {shown.map((n) => (
            <li key={n.id} className={`border-t py-2 text-sm ${n.read ? 'opacity-60' : ''}`}>
              <span className="flex gap-2 items-center">
                {n.payload?.verdict ? <VerdictPill verdict={n.payload.verdict} /> : <span className="text-xs border px-1 rounded">{n.type}</span>}
                {n.payload?.submitId ? <a className="underline" href={`/results/${n.payload.submitId}`}>#{n.payload.submitId}</a> : null}
                <span className="text-muted text-xs">{n.at ? new Date(n.at).toLocaleString() : ''}</span>
                {!n.read ? <Button variant="secondary" className="!py-0 !px-2" onClick={() => markRead([n.id])}>{t.notif_mark_small}</Button> : null}
              </span>
              <span className="block text-xs text-muted mt-0.5">{n.text || n.payload?.message || n.type}</span>
            </li>
          ))}
        </ul>
      )}
      <Card className="mt-3">
        <strong className="text-sm">{t.notif_prefs_title}</strong>
        <div className="flex flex-col gap-2 mt-1 text-sm">
          <label className="flex gap-1 items-center"><input type="checkbox" checked={!!prefs.inApp} onChange={(e) => setPrefs({ ...prefs, inApp: e.target.checked })} /> {t.notif_inapp}</label>
          <label className="flex gap-1 items-center"><input type="checkbox" checked={!!prefs.email} onChange={(e) => setPrefs({ ...prefs, email: e.target.checked })} /> e-mail</label>
          <Input label={t.notif_webhook_label} value={prefs.webhook || ''} onChange={(e) => setPrefs({ ...prefs, webhook: e.target.value })} placeholder="https://…" />
          <Input label={t.notif_watch_label} value={prefs.watch || ''} onChange={(e) => setPrefs({ ...prefs, watch: e.target.value })} placeholder="1,2,3" />
          <Button variant="secondary" onClick={savePrefs} className="self-start">{t.notif_save_prefs}</Button>
        </div>
      </Card>
    </div>
  );
}
