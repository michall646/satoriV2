// Contest home: problems cockpit (tabs live in contests/[id]/layout.js side nav).
'use client';
import { STR, getLang } from '../../../lib/client';
import ProblemCockpit from '../../../components/ProblemCockpit';
import ExamGuard from '../../../components/ExamGuard';

export default function ContestPage({ params }) {
  const t = STR[getLang()];
  return (
    <div className="flex flex-col gap-4 py-4">
      <div>
        <h1 className="type-h1">{t.problems}</h1>
      </div>
      <ExamGuard contestId={params.id} />
      <ProblemCockpit contestId={params.id} />
    </div>
  );
}
