// Contests browser: Joined/Pending/Other tabs, archived toggle persisted, debounced search, sort, Apply states.
'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, STR, getLang } from '../../lib/client';
import { Badge, Button, EmptyState, ErrorState, Input, Select, Skeleton, Tabs } from '../../components/ui';
import { toast } from '../../components/ui/Toast';

export default function ContestsPage() {
  const lang = getLang();
  const [tab, setTab] = useState('joined');
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState('');
  const [deb, setDeb] = useState('');
  const [sort, setSort] = useState('name');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [applying, setApplying] = useState('');

  useEffect(() => {
    try {
      const a = localStorage.getItem('satori-show-archived');
      if (a) setArchived(a === '1');
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    const iv = setTimeout(() => setDeb(q), 150);
    return () => clearTimeout(iv);
  }, [q]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    const qs = new URLSearchParams({ role: tab });
    if (deb) qs.set('q', deb);
    if (archived) qs.set('archived', 'yes');
    api(`/api/contests?${qs}`).then((d) => { if (live) setItems(d.items || []); }).catch((e) => { if (live) setError(String(e.message || e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [tab, deb, archived, reload]);

  function toggleArchived() {
    const next = !archived;
    setArchived(next);
    try { localStorage.setItem('satori-show-archived', next ? '1' : '0'); } catch { /* noop */ }
  }

  function retry() { setReload((n) => n + 1); }

  async function apply(c) {
    setApplying(c.id);
    try {
      const r = await api(`/api/contests/${c.id}/apply`, { method: 'POST', body: JSON.stringify({}) });
      toast(`${c.name}: ${r.state || r.status || 'applied'}`);
      setItems((prev) => prev.map((x) => (x.id === c.id ? { ...x, _member: r.state || 'pending' } : x)));
    } catch (e) { toast(`${t.contests_apply_failed} ${e.message}`); } finally { setApplying(''); }
  }

  const shown = useMemo(() => {
    const arr = [...items];
    if (sort === 'description') arr.sort((a, b) => String(a.description || '').localeCompare(String(b.description || '')));
    else arr.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return arr;
  }, [items, sort]);

  const t = STR[lang];
  const sortNameLabel = t.mset_name;
  const sortDescLabel = t.mset_description;
  const filtered = !!q || archived || tab !== 'other';

  function reset() {
    setQ('');
    setArchived(false);
    setTab('other');
    try { localStorage.setItem('satori-show-archived', '0'); } catch { /* noop */ }
  }

  return (
    <div className="w-full py-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="type-display">{t.contests}</h1>
        <Link href="/contests/new" prefetch className="text-sm underline focus-ring rounded">{t.contests_new}</Link>
      </div>

      <div className="flex flex-wrap gap-3 items-center justify-between mt-6">
        <Tabs
          ariaLabel={t.contests_roles}
          value={tab}
          onChange={setTab}
          tabs={['joined', 'pending', 'other'].map((id) => ({ id, label: t[`contests_${id}`] || id }))}
        />
        <div className="flex flex-wrap gap-2 items-center">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} className="!w-56" />
          <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t.contests_sort_aria} className="!w-36">
            <option value="name">{sortNameLabel}</option>
            <option value="description">{sortDescLabel}</option>
          </Select>
          <label className="flex gap-2 items-center text-sm whitespace-nowrap cursor-pointer" style={{ color: 'var(--muted)' }}>
            <input type="checkbox" checked={archived} onChange={toggleArchived} aria-label={t.contests_archived} /> {t.contests_archived}
          </label>
        </div>
      </div>

      <div className="mt-6">
        {loading ? <Skeleton lines={5} /> : null}
        {!loading && error ? <ErrorState title={t.home_err_contests} line={error} action={<Button variant="secondary" onClick={retry}>{t.common_retry}</Button>} /> : null}
        {!loading && !error && !shown.length ? (
          <EmptyState
            line={t.contests_empty}
            action={filtered
              ? <Button variant="secondary" onClick={reset}>{t.contests_show_all}</Button>
              : <Link className="btn btn-primary" href="/contests/new" prefetch>{t.contests_new}</Link>}
          />
        ) : null}
        {!loading && !error && shown.length ? (
          <div className="doc-table">
            <ul className="divide-y divide-[var(--border)]">
              {shown.map((c) => {
                const state = c._member || c.membership || c.state || '';
                return (
                  <li key={c.id} className={`doc-row ${c.archived ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-4 px-4 py-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link className="text-[15px] font-semibold hover:underline focus-ring rounded truncate" href={`/contests/${c.id}`} prefetch>{c.name}</Link>
                          {c.archived ? <Badge>{t.contests_archived_tag}</Badge> : null}
                        </div>
                        {c.description ? <p className="text-sm mt-0.5 truncate" style={{ color: 'var(--muted)' }}>{c.description}</p> : null}
                        <div className="flex gap-1.5 flex-wrap mt-2">
                          {c.mode ? <Badge>{c.mode}</Badge> : null}
                          {c.lifecycle ? <Badge tone={c.lifecycle === 'running' ? 'accent' : 'neutral'}>{t[`manage_lc_${c.lifecycle}`] || c.lifecycle}</Badge> : null}
                          {c.memberCount != null ? <Badge>{`${c.memberCount} ${t.contests_members}`}</Badge> : null}
                        </div>
                      </div>
                      <div className="shrink-0">
                        {state === 'joined' || state === 'member' ? <Badge tone="accent">{t.contests_joined_state}</Badge>
                          : state === 'pending' ? <Badge tone="warn">{t.contests_pending_state}</Badge>
                          : state === 'managed' ? <Badge tone="accent">{t.manage_title}</Badge>
                          : <Button variant="secondary" onClick={() => apply(c)} disabled={applying === c.id} className="!py-1.5">{applying === c.id ? t.contests_applying : t.contests_apply}</Button>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
