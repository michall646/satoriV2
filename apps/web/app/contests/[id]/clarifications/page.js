// Clarifications: ask form + my states + ticker. POST exists in API.
'use client';
import { useEffect, useState } from 'react';
import { api, STR, getLang } from '../../../../lib/client';
import { Button, Card, EmptyState, Input, Select, Skeleton } from '../../../../components/ui';
import { toast } from '../../../../components/ui/Toast';

export default function ClarificationsPage({ params }) {
  const t = STR[getLang()];
  const [items, setItems] = useState(null);
  const [problems, setProblems] = useState([]);
  const [problem, setProblem] = useState('');
  const [question, setQuestion] = useState('');

  async function load() {
    try {
      const d = await api(`/api/contests/${params.id}/clarifications`);
      setItems(d.items || []);
    } catch { setItems([]); }
  }

  useEffect(() => {
    load();
    api(`/api/contests/${params.id}/problems`).then((d) => setProblems(d.items || [])).catch(() => {});
  }, [params.id]);

  async function ask(e) {
    e.preventDefault();
    if (!question.trim()) return;
    try {
      await api(`/api/contests/${params.id}/clarifications`, { method: 'POST', body: JSON.stringify({ problem: problem || undefined, question }) });
      setQuestion('');
      toast(t.clarif_question_sent);
      load();
    } catch (err) { toast(`${t.clarif_ask_failed} ${err.message}`); }
  }

  if (items === null) return <Skeleton lines={4} />;
  const mine = items.filter((c) => c.mine);

  return (
    <div className="max-w-2xl">
      <h1 className="type-h1">{t.clarif_title.replace('{id}', params.id)}</h1>
      <Card className="mt-2">
        <form onSubmit={ask} className="flex flex-col gap-2">
          <Select label={t.col_problem} value={problem} onChange={(e) => setProblem(e.target.value)}>
            <option value="">{t.clarif_general}</option>
            {problems.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
          </Select>
          <Input label={t.clarif_question} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t.clarif_ask_ph} />
          <Button type="submit" className="self-start">{t.clarif_ask}</Button>
        </form>
      </Card>
      {mine.length ? <div className="mt-2 text-sm"><strong>{t.clarif_my_questions}</strong><ul>{mine.map((c) => <li key={c.id} className="border-t py-1">{t.clarif_q} {c.question} — {t.clarif_a} {c.answer || t.contests_pending_state}</li>)}</ul></div> : null}
      <div className="mt-2">
        {!items.length ? <EmptyState line={t.clarif_empty} /> : (
          <ul>{items.map((c) => <li key={c.id} className="border-t py-1 text-sm"><b>Q:</b> {c.question} <b>A:</b> {c.answer || '—'}</li>)}</ul>
        )}
      </div>
    </div>
  );
}
