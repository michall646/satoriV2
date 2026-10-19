'use client';
import Link from 'next/link';
import { STR, getLang } from '../../../../../../lib/client';
import { ProblemEditor } from '../../../../../../components/ProblemEditor';

export default function ManageProblemDetailPage({ params }) {
  const t = STR[getLang()];
  return (
    <div className="w-full max-w-3xl min-w-0">
      <p className="text-sm mb-2">
        <Link className="underline focus-ring rounded" href={`/contests/${params.id}/manage/problems`} prefetch>← {t.problems}</Link>
      </p>
      <ProblemEditor problemId={params.pid} contestId={params.id} full />
    </div>
  );
}
