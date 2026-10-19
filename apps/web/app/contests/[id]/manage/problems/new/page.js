// Manage → New problem. Rich onboarding: Blank / Clone / ZIP Polygon / Athina PDF.
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, STR, getLang } from '../../../../../../lib/client';
import { Skeleton } from '../../../../../../components/ui';
import ProblemQuickAdd from '../../../../../../components/ProblemQuickAdd';
import { PageHeader } from '../../../../../../components/manage';

export default function NewProblemPage({ params }) {
  const t = STR[getLang()];
  const [items, setItems] = useState(null);
  const router = useRouter();

  useEffect(() => {
    api(`/api/contests/${params.id}/problems?all=1`).then((d) => setItems(d.items || [])).catch(() => setItems([]));
  }, [params.id]);

  function onDone(r) {
    if (r && r.id) router.push(`/contests/${params.id}/manage/problems/${r.id}`);
    else router.push(`/contests/${params.id}/manage/problems`);
  }

  return (
    <div className="w-full max-w-3xl min-w-0">
      <PageHeader
        title={t.mprob_new}
        description={t.mprob_new_desc}
      />
      {items === null ? <Skeleton lines={3} /> : <ProblemQuickAdd contestId={params.id} items={items} onDone={onDone} />}
    </div>
  );
}
