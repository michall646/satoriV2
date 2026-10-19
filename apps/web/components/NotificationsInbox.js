// Notifications inbox: submit.judged, rejudge.done, limit.changed, editorial, grade.feedback, appeals, announcements.
// E7: render payload.text, human type labels, real targets; prefs stay honest (delivery hooks are server-side).
'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, getLang, STR } from '../lib/client';
import { Button, Card, EmptyState, Input, Select, Skeleton, VerdictPill } from './ui';
import { toast } from './ui/Toast';

const TYPE_TXT = {
  'submit.judged': { en: 'Verdict', pl: 'Werdykt' },
  'rejudge.done': { en: 'Rejudge finished', pl: 'Ponowna ocena' },
  'limit.changed': { en: 'Limits changed', pl: 'Zmiana limitów' },
  editorial: { en: 'Editorial', pl: 'Omówienie' },
  'grade.feedback': { en: 'Grade feedback', pl: 'Komentarz do oceny' },
  'clarification.answered': { en: 'Clarification answered', pl: 'Odpowiedź na pytanie' },
  'appeal.resolved': { en: 'Appeal resolved', pl: 'Odwołanie rozpatrzone' },
  announcement: { en: 'Announcement', pl: 'Ogłoszenie' },
  'announcement.posted': { en: 'Announcement', pl: 'Ogłoszenie' },
};

const E7_TXT = {
  en: {
    filterAria: 'notification type',
    prefsNote: 'Stored in your account. E-mail and watch delivery are not implemented server-side yet.',
    results: 'results',
    clarifications: 'clarifications',
    announcements: 'announcements',
    problem: 'problem',
  },
  pl: {
    filterAria: 'typ powiadomienia',
    prefsNote: 'Zapisane w koncie. Wysyłka e-mail i powiadomień o obserwowanych zadaniach nie jest jeszcze zaimplementowana po stronie serwera.',
    results: 'wyniki',
    clarifications: 'wyjaśnienia',
    announcements: 'ogłoszenia',
    problem: 'zadanie',
  },
};

function typeLabel(type, lang) {
  const row = TYPE_TXT[type];
  return row ? row[lang] || row.en : type;
}

// E7: grade feedback and several other types carry their human text in payload.text.
function noteText(n) {
  return n.text || n.payload?.text || n.payload?.message || n.payload?.title || '';
}

function targetFor(n, txt) {
  const p = n.payload || {};
  if ((n.type === 'submit.judged' || n.type === 'appeal.resolved') && p.submitId != null) {
    return { href: `/results/${p.submitId}`, label: `#${p.submitId}` };
  }
  if (n.type === 'grade.feedback' && p.contestId != null) {
    return { href: `/results?contest=${p.contestId}&me=1`, label: txt.results };
  }
  if (n.type === 'clarification.answered' && p.contestId != null) {
    return { href: `/contests/${p.contestId}/clarifications`, label: txt.clarifications };
  }
  if ((n.type === 'announcement' || n.type === 'announcement.posted') && p.contestId != null) {
    return { href: `/contests/${p.contestId}/announcements`, label: txt.announcements };
  }
  if (n.type === 'limit.changed' && p.contestId != null && p.problemId != null) {
    return { href: `/contests/${p.contestId}/problems/${p.problemId}`, label: txt.problem };
  }
  return null;
}

export default function NotificationsInbox({ compact, preview }) {
  const lang = getLang();
  const t = STR[lang];
  const txt = E7_TXT[lang === 'pl' ? 'pl' : 'en'];
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

  const types = useMemo(() => [...new Set((items || []).map((n) => n.type))].sort(), [items]);

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
            {n.payload?.verdict ? <VerdictPill verdict={n.payload.verdict} className="!min-w-0 !px-1.5 !py-0 !text-[10px] shrink-0" /> : null}
            <span className="text-[11px] border px-1 rounded shrink-0" title={n.type}>{typeLabel(n.type, lang)}</span>
            {noteText(n) ? <span className="flex-1 min-w-0 truncate">{noteText(n)}</span> : null}
            {n.at ? <span className="text-[11px] shrink-0 tabular-nums ml-auto" style={{ color: 'var(--muted)' }}>{new Date(n.at).toLocaleDateString()}</span> : null}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div>
      {!compact ? <h1 className="type-h1">{t.notifications}</h1> : null}
      <div className="flex gap-2 my-2 text-sm items-center flex-wrap">
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={txt.filterAria}>
          <option value="all">{t.notif_all}</option>
          {types.map((type) => <option key={type} value={type}>{typeLabel(type, lang)} · {type}</option>)}
        </Select>
        <label className="flex gap-1 items-center"><input type="checkbox" checked={showUnread} onChange={(e) => setShowUnread(e.target.checked)} /> {t.notif_unread_only}</label>
        <Button variant="secondary" onClick={() => markRead(shown.filter((n) => !n.read).map((n) => n.id))}>{t.notifications_mark_read} ({shown.filter((n) => !n.read).length})</Button>
      </div>
      {!shown.length ? <EmptyState line={t.notif_none} /> : (
        <ul>
          {shown.map((n) => {
            const target = targetFor(n, txt);
            const text = noteText(n);
            return (
              <li key={n.id} className={`border-t py-2 text-sm ${n.read ? 'opacity-60' : ''}`}>
                <span className="flex gap-2 items-center flex-wrap">
                  {n.payload?.verdict ? <VerdictPill verdict={n.payload.verdict} /> : null}
                  <span className="text-xs border px-1 rounded" title={typeLabel(n.type, lang)}>{typeLabel(n.type, lang)}</span>
                  <span className="type-mono text-[10px]" style={{ color: 'var(--muted)' }}>{n.type}</span>
                  {target ? <a className="underline text-xs" href={target.href}>{target.label}</a> : null}
                  <span className="text-muted text-xs ml-auto">{n.at ? new Date(n.at).toLocaleString() : ''}</span>
                  {!n.read ? <Button variant="secondary" className="!py-0 !px-2" onClick={() => markRead([n.id])}>{t.notif_mark_small}</Button> : null}
                </span>
                {text ? <span className="block text-xs text-muted mt-0.5 whitespace-pre-wrap">{text}</span> : null}
              </li>
            );
          })}
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
          <p className="text-xs" style={{ color: 'var(--muted)' }}>{txt.prefsNote}</p>
        </div>
      </Card>
    </div>
  );
}
