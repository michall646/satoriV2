// Contest announcements (F2): published news newest first, markdown body,
// attachments, per-user read state and the RSS feed link. Scheduled posts with a
// future scheduledAt are filtered out by the API for non-admins.
'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, API, STR, getLang } from '../../../../lib/client';
import { Badge, Button, EmptyState, Markdown, Skeleton } from '../../../../components/ui';
import { toast } from '../../../../components/ui/Toast';

const L = {
  en: {
    rss: 'RSS feed',
    refresh: 'Refresh',
    unread: 'unread',
    read: 'read',
    markRead: 'Mark read',
    marking: 'Marking…',
    markFailed: 'Could not mark read:',
    attachments: 'Attachments',
    attachment: 'Attachment',
    pinned: 'pinned',
    empty: 'No announcements yet.',
  },
  pl: {
    rss: 'Kanał RSS',
    refresh: 'Odśwież',
    unread: 'nieprzeczytane',
    read: 'przeczytane',
    markRead: 'Oznacz jako przeczytane',
    marking: 'Oznaczanie…',
    markFailed: 'Nie udało się oznaczyć:',
    attachments: 'Załączniki',
    attachment: 'Załącznik',
    pinned: 'przypięte',
    empty: 'Brak ogłoszeń.',
  },
};

function when(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch { return ''; }
}

// Announcement bodies/attachments are teacher-authored; never link a javascript: URL.
function safeHref(raw) {
  const s = String(raw || '').trim();
  return /^(https?:\/\/|\/)/i.test(s) ? s : '';
}

function attachmentList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean);
  return String(value).split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
}

function sortKey(n) {
  return Date.parse(n.scheduledAt || n.publishedAt || n.createdAt || '') || 0;
}

export default function AnnouncementsPage({ params }) {
  const t = STR[getLang()];
  const txt = L[getLang() === 'pl' ? 'pl' : 'en'];
  const [items, setItems] = useState(null);
  const [marking, setMarking] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await api(`/api/contests/${params.id}/news`, { noCache: true });
      setItems(d.items || []);
    } catch { setItems([]); }
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  async function markRead(n) {
    if (n.read || marking != null) return;
    setMarking(n.id);
    try {
      await api(`/api/contests/${params.id}/news/${n.id}/read`, { method: 'POST', body: '{}' });
      setItems((prev) => (prev || []).map((x) => (String(x.id) === String(n.id) ? { ...x, read: true } : x)));
    } catch (e) {
      toast(`${txt.markFailed} ${e.message}`, 'warn');
    } finally {
      setMarking(null);
    }
  }

  if (items === null) return <Skeleton lines={5} />;

  const sorted = [...items].sort((a, b) => sortKey(b) - sortKey(a));
  const unread = sorted.filter((n) => !n.read).length;

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="type-h1">{t.announcements}</h1>
        {unread ? <Badge tone="accent">{unread} {txt.unread}</Badge> : null}
        <span className="ml-auto flex items-center gap-3">
          <a className="text-sm underline focus-ring rounded" href={`${API}/api/contests/${params.id}/news.rss`} target="_blank" rel="noreferrer">{txt.rss}</a>
          <Button variant="secondary" className="!py-0.5" onClick={load}>{txt.refresh}</Button>
        </span>
      </div>

      {!sorted.length ? <EmptyState line={txt.empty} /> : (
        <ul className="mt-3 flex flex-col gap-4">
          {sorted.map((n) => {
            const dateIso = n.scheduledAt || n.publishedAt || n.createdAt || '';
            const attachments = attachmentList(n.attachments);
            return (
              <li key={n.id} id={`announcement-${n.id}`} className="rounded-xl p-4" style={{ border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2 flex-wrap text-xs" style={{ color: 'var(--muted)' }}>
                  <Badge tone={n.read ? 'neutral' : 'accent'}>{n.read ? txt.read : txt.unread}</Badge>
                  {n.pinned ? <Badge tone="warn">{txt.pinned}</Badge> : null}
                  {dateIso ? <time dateTime={dateIso}>{when(dateIso)}</time> : null}
                  {!n.read ? (
                    <Button variant="secondary" className="!py-0 !px-2 ml-auto" disabled={marking != null} onClick={() => markRead(n)}>
                      {marking != null ? txt.marking : txt.markRead}
                    </Button>
                  ) : null}
                </div>
                <h2 className="type-h2 mt-1">{n.title || t.ann_untitled}</h2>
                {n.bodyMd ? <div className="mt-1"><Markdown text={n.bodyMd} /></div> : null}
                {attachments.length ? (
                  <p className="text-sm mt-2">
                    <span style={{ color: 'var(--muted)' }}>{txt.attachments}: </span>
                    {attachments.map((raw, i) => {
                      const href = safeHref(raw);
                      const label = `${txt.attachment} ${i + 1}`;
                      return href ? (
                        <a key={`${raw}-${i}`} className="underline break-all mr-2 focus-ring rounded" href={href} target="_blank" rel="noreferrer">{label}</a>
                      ) : (
                        <span key={`${raw}-${i}`} className="type-mono text-xs mr-2 break-all">{raw}</span>
                      );
                    })}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
