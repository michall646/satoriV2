// Visual contest creation entry: /contests/new — 4-step wizard for teachers.
// API: POST /api/contests (template ICPC|IOI|LABS|EXAM|PLAYGROUND|VIRTUAL), POST .../duplicate, POST .../members/csv.
'use client';
import Link from 'next/link';
import ContestWizard from '../../../components/ContestWizard';

export default function NewContestPage() {
  return (
    <div className="w-full py-2">
      <div className="mt-1">
        <ContestWizard />
      </div>
      <p className="text-sm mt-3"><Link className="underline focus-ring rounded" href="/contests" prefetch>← Back to contests</Link></p>
    </div>
  );
}
