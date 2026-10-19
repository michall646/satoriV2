// Manage → Announcements. Composer with markdown preview + published list.
// F2: the API creates in-app notifications on publish. E-mail delivery does not
// exist yet, so the e-mail toggle is hidden behind an honest note (no dead UI).
'use client';
import { useEffect, useState } from 'react';
import { api, STR, getLang } from '../../../../../lib/client';
import { Badge, Button, EmptyState, Input, Markdown, Skeleton, Textarea } from '../../../../../components/ui';
import { toast } from '../../../../../components/ui/Toast';
import { PageHeader, PageSection } from '../../../../../components/manage';
import { useManage } from '../../../../../components/manage/context';
import EyebrowFx from '../../../../../components/EyebrowFx';

const BLANK = { title: '', bodyMd: '', scheduledAt: '', attachments: '', inApp: true };

const L = {
  en: {
    inApp: 'Send in-app notification',
    emailNote: 'E-mail delivery is not implemented yet — nothing is sent. RSS is always available for published posts.',
    notified: '{n} member(s) notified in-app.',
    reads: 'read',
    scheduled: 'scheduled',
  },
  pl: {
    inApp: 'Wyślij powiadomienie w aplikacji',
    emailNote: 'Wysyłka e-mail nie jest jeszcze zaimplementowana — nic nie zostanie wysłane. RSS jest zawsze dostępny dla opublikowanych wpisów.',
    notified: 'Powiadomiono w aplikacji: {n}.',
    reads: 'przeczytane',
    scheduled: 'zaplanowane',
  },
};

function when(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch { return ''; }
}
function isFuture(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) && t > Date.now();
}

export default function ManageAnnouncementsPage({ params }) {
  const t = STR[getLang()];
  const txt = L[getLang() === 'pl' ? 'pl' : 'en'];
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
      const r = await api(`/api/contests/${params.id}/news`, { method: 'POST', body: JSON.stringify(form) });
      const notified = form.inApp && Number.isFinite(Number(r.notified)) ? ` ${txt.notified.replace('{n}', r.notified)}` : '';
      toast(`${t.ann_posted}${notified}`, 'success');
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
          <div className="flex flex-col gap-1 text-sm">
            <label className="flex gap-2 items-center">
              <input type="checkbox" checked={form.inApp} onChange={(e) => setForm({ ...form, inApp: e.target.checked })} /> {txt.inApp}
            </label>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>{txt.emailNote}</p>
          </div>
          <Button onClick={post} disabled={busy} className="self-start">{busy ? t.ann_posting : t.ann_post_btn}</Button>
        </div>
      </PageSection>

      <PageSection title={t.ann_published} actions={<span className="type-mono text-xs" style={{ color: 'var(--muted)' }}>{items.length}</span>}>
        {items.length ? (
          <ul className="flex flex-col gap-3">
            {[...items].reverse().map((n) => {
              const future = isFuture(n.scheduledAt);
              return (
                <li key={n.id} className="pb-3 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-baseline justify-between gap-2">
                    <strong className="text-sm">{n.title || t.ann_untitled}</strong>
                    <span className="flex items-center gap-2 shrink-0">
                      {future ? <Badge tone="warn">{txt.scheduled}</Badge> : null}
                      <span className="type-mono text-xs" style={{ color: 'var(--muted)' }}>
                        {future ? when(n.scheduledAt) : when(n.publishedAt || n.createdAt)}
                      </span>
                      {Number.isFinite(Number(n.readCount)) ? (
                        <span className="type-mono text-xs" style={{ color: 'var(--muted)' }}>{n.readCount} {txt.reads}</span>
                      ) : null}
                      <Button variant="danger" className="!py-0.5" disabled={busy} onClick={() => remove(n)}>{t.common_delete}</Button>
                    </span>
                  </div>
                  {n.bodyMd ? <div className="text-sm mt-1"><Markdown text={n.bodyMd} /></div> : null}
                  {n.attachments ? <p className="type-mono text-xs mt-1" style={{ color: 'var(--muted)' }}>{Array.isArray(n.attachments) ? n.attachments.join(', ') : n.attachments}</p> : null}
                </li>
              );
            })}
          </ul>
        ) : <EmptyState line={t.ann_empty} />}
      </PageSection>
    </div>
  );
}
