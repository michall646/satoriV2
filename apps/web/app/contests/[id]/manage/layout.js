// In-contest manage shell: admin gate (403 card) + grouped rail + content.
// Pages read { contest, reload, counts } from context so nothing refetches the contest.
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, STR, getLang } from '../../../../lib/client';
import { EmptyState, ErrorState, Skeleton } from '../../../../components/ui';
import ManageNav from '../../../../components/manage/ManageNav';
import { ManageContext } from '../../../../components/manage/context';

export default function ManageLayout({ children, params }) {
  const t = STR[getLang()];
  const [contest, setContest] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ok | forbidden | error
  const [counts, setCounts] = useState({ problems: 0, pending: 0 });

  async function load() {
    try {
      const c = await api(`/api/contests/${params.id}`);
      setContest(c);
    } catch (e) {
      setStatus(String(e.message).startsWith('403') ? 'forbidden' : 'error');
      return;
    }
    try {
      const mem = await api(`/api/contests/${params.id}/members`);
      setCounts((prev) => ({ ...prev, pending: (mem.pending || []).length }));
      setStatus('ok');
    } catch (e) {
      setStatus(String(e.message).startsWith('401') || String(e.message).startsWith('403') ? 'forbidden' : 'error');
      return;
    }
    try {
      const d = await api(`/api/contests/${params.id}/problems?all=1`);
      setCounts((prev) => ({ ...prev, problems: (d.items || []).length }));
    } catch { /* count is best-effort */ }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

  if (status === 'loading') {
    return (
      <div className="md:pl-56 pt-2">
        <Skeleton lines={2} className="max-w-md" />
        <div className="mt-4"><Skeleton lines={6} /></div>
      </div>
    );
  }

  if (status === 'forbidden') {
    return (
      <div className="max-w-xl pt-2">
        <EmptyState
          icon="🔒"
          line={t.manage_forbidden}
        />
      </div>
    );
  }

  if (status === 'error' || !contest) {
    return (
      <div className="max-w-xl pt-2">
        <ErrorState title={t.manage_load_failed} line={t.manage_load_hint} action={<Button variant="secondary" onClick={() => { setStatus('loading'); load(); }}>{t.common_retry}</Button>} />
      </div>
    );
  }

  return (
    <ManageContext.Provider value={{ contest, reload: load, counts }}>
      <div className="w-full">
        <ManageNav contestId={params.id} counts={counts} />
        <div className="md:pl-56 min-w-0">
          <Link href={`/contests/${params.id}`} prefetch className="focus-ring rounded underline decoration-dotted inline-block mb-1" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>← {contest.name || t.manage_contest} · {t.manage_title}</Link>
          {children}
        </div>
      </div>
    </ManageContext.Provider>
  );
}
