// Manage → Announcements. Composer with markdown preview + published list.
'use client';
import { useEffect, useState } from 'react';
import { api, STR, getLang } from '../../../../../lib/client';
import { Button, EmptyState, Input, Markdown, Skeleton, Textarea } from '../../../../../components/ui';
import { toast } from '../../../../../components/ui/Toast';
import { PageHeader, PageSection } from '../../../../../components/manage';
import { useManage } from '../../../../../components/manage/context';
import EyebrowFx from '../../../../../components/EyebrowFx';

const BLANK = { title: '', bodyMd: '', scheduledAt: '', attachments: '', email: false, inApp: true };

export default function ManageAnnouncementsPage({ params }) {
  const t = STR[getLang()];
  const { contest } = useManage();
  const [items, setItems] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setItems((await api(`/api/contests/${params.id}/news`)).items || []); } catch { setItems([]); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

  async function post() {
    if (!form.title.trim()) { toast(t.manage_title_required, 'warn'); return; }
    setBusy(true);
    try {
      await api(`/api/contests/${params.id}/news`, { method: 'POST', body: JSON.stringify(form) });
      toast(t.ann_posted, 'success');
      setForm(BLANK);
      await load();
    } catch (e) { toast(`${t.ann_post_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function remove(n) {
    setBusy(true);
    try {
      await api(`/api/contests/${params.id}/news/${n.id}`, { method: 'DELETE' });
      toast(t.ann_removed, 'success');
      await load();
    } catch (e) { toast(`${t.manage_delete_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  if (items === null) return <Skeleton lines={6} />;

  return (
    <div className="w-full min-w-0 max-w-3xl">
      <PageHeader title={t.announcements} description={`${t.manage_ann_desc} ${contest.name || t.manage_this_contest_gen}.`} />

      <PageSection title={t.ann_new}>
        <div className="flex flex-col gap-3">
          <Input label={t.ann_title} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Textarea label={t.ann_body} value={form.bodyMd} onChange={(e) => setForm({ ...form, bodyMd: e.target.value })} rows={6} />
          {form.bodyMd ? (
            <div className="rounded p-3 text-sm" style={{ border: '1px solid var(--border)', background: 'var(--bg)' }}>
              <EyebrowFx text={t.common_preview} as="span" />
              <div className="mt-1"><Markdown text={form.bodyMd} /></div>
            </div>
          ) : null}
          <Input label={t.ann_sched} type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
          <Input label={t.ann_attach} value={form.attachments} onChange={(e) => setForm({ ...form, attachments: e.target.value })} />
          <div className="flex gap-4 text-sm">
            <label className="flex gap-2 items-center"><input type="checkbox" checked={form.email} onChange={(e) => setForm({ ...form, email: e.target.checked })} /> e-mail</label>
            <label className="flex gap-2 items-center"><input type="checkbox" checked={form.inApp} onChange={(e) => setForm({ ...form, inApp: e.target.checked })} /> in-app / RSS</label>
          </div>
          <Button onClick={post} disabled={busy} className="self-start">{busy ? t.ann_posting : t.ann_post_btn}</Button>
        </div>
      </PageSection>

      <PageSection title={t.ann_published} actions={<span className="type-mono text-xs" style={{ color: 'var(--muted)' }}>{items.length}</span>}>
        {items.length ? (
          <ul className="flex flex-col gap-3">
            {[...items].reverse().map((n) => (
              <li key={n.id} className="pb-3 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-baseline justify-between gap-2">
                  <strong className="text-sm">{n.title || t.ann_untitled}</strong>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="type-mono text-xs" style={{ color: 'var(--muted)' }}>{n.scheduledAt ? `${t.ann_sched_tag} ${new Date(n.scheduledAt).toLocaleString()}` : n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}</span>
                    <Button variant="danger" className="!py-0.5" disabled={busy} onClick={() => remove(n)}>{t.common_delete}</Button>
                  </span>
                </div>
                {n.bodyMd ? <div className="text-sm mt-1"><Markdown text={n.bodyMd} /></div> : null}
                {n.attachments ? <p className="type-mono text-xs mt-1" style={{ color: 'var(--muted)' }}>{Array.isArray(n.attachments) ? n.attachments.join(', ') : n.attachments}</p> : null}
              </li>
            ))}
          </ul>
        ) : <EmptyState line={t.ann_empty} />}
      </PageSection>
    </div>
  );
}
