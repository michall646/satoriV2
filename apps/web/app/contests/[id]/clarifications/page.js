// Clarifications: ask form, mine filter, grouped by problem/general, jury answers (F1).
// The jury form is rendered only when GET returns canAnswer === true; that flag is
// owned by the API (Lane A). Without it the page stays read-only — no fake answer UI.
'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, STR, getLang } from '../../../../lib/client';
import { Badge, Button, Card, EmptyState, Input, Select, Skeleton, Textarea } from '../../../../components/ui';
import { toast } from '../../../../components/ui/Toast';

const L = {
  en: {
    onlyMine: 'Only mine',
    pending: 'Awaiting answer',
    answered: 'Answered',
    answerPh: 'Jury answer…',
    answerLabel: 'Jury answer',
    answer: 'Send answer',
    mineTag: 'mine',
    answerSaved: 'Answer saved.',
    answerFailed: 'Answer failed:',
    sourceGeneral: 'General',
    sourceProblem: 'Problem',
    asked: 'asked',
    answeredBy: 'answered by',
    refresh: 'Refresh',
  },
  pl: {
    onlyMine: 'Tylko moje',
    pending: 'Czeka na odpowiedź',
    answered: 'Odpowiedziano',
    answerPh: 'Odpowiedź jury…',
    answerLabel: 'Odpowiedź jury',
    answer: 'Wyślij odpowiedź',
    mineTag: 'moje',
    answerSaved: 'Odpowiedź zapisana.',
    answerFailed: 'Odpowiedź nieudana:',
    sourceGeneral: 'Ogólne',
    sourceProblem: 'Zadanie',
    asked: 'pyta',
    answeredBy: 'odpowiedział',
    refresh: 'Odśwież',
  },
};

function when(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch { return ''; }
}

function answeredByLabel(c) {
  if (c.answeredByLogin) return c.answeredByLogin;
  if (c.answeredByName) return c.answeredByName;
  if (c.answeredBy == null) return '';
  return `#${c.answeredBy}`;
}

export default function ClarificationsPage({ params }) {
  const t = STR[getLang()];
  const lang = getLang() === 'pl' ? 'pl' : 'en';
  const txt = L[lang];
  const [items, setItems] = useState(null);
  const [canAnswer, setCanAnswer] = useState(false);
  const [problems, setProblems] = useState([]);
  const [problem, setProblem] = useState('');
  const [question, setQuestion] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [sending, setSending] = useState(null);

  const load = useCallback(async (silent) => {
    try {
      const d = await api(`/api/contests/${params.id}/clarifications`, { noCache: true });
      setItems(d.items || []);
      setCanAnswer(d.canAnswer === true);
    } catch {
      if (!silent) setItems([]);
    }
  }, [params.id]);

  useEffect(() => {
    load();
    const iv = setInterval(() => load(true), 15000);
    return () => clearInterval(iv);
  }, [load]);

  useEffect(() => {
    api(`/api/contests/${params.id}/problems`).then((d) => setProblems(d.items || [])).catch(() => {});
  }, [params.id]);

  async function ask(e) {
    e.preventDefault();
    if (!question.trim()) return;
    try {
      await api(`/api/contests/${params.id}/clarifications`, {
        method: 'POST',
        body: JSON.stringify({ problem: problem || undefined, question }),
      });
      setQuestion('');
      toast(t.clarif_question_sent);
      await load(true);
    } catch (err) { toast(`${t.clarif_ask_failed} ${err.message}`); }
  }

  async function sendAnswer(c) {
    const text = String(drafts[c.id] || '').trim();
    if (!text) return;
    setSending(c.id);
    try {
      await api(`/api/contests/${params.id}/clarifications/${c.id}/answer`, {
        method: 'POST',
        body: JSON.stringify({ answer: text }),
      });
      toast(txt.answerSaved, 'success');
      setDrafts((d) => { const next = { ...d }; delete next[c.id]; return next; });
      await load(true);
    } catch (err) {
      toast(`${txt.answerFailed} ${err.message}`, 'danger');
    } finally {
      setSending(null);
    }
  }

  if (items === null) return <Skeleton lines={4} />;

  const visible = onlyMine ? items.filter((c) => c.mine) : items;
  const problemById = new Map(problems.map((p) => [String(p.id), p]));
  const groups = [];
  const general = visible.filter((c) => c.problem == null || c.problem === '');
  if (general.length) groups.push({ key: 'general', title: txt.sourceGeneral, rows: general });
  for (const p of problems) {
    const rows = visible.filter((c) => String(c.problem) === String(p.id));
    if (rows.length) groups.push({ key: `p-${p.id}`, title: `${txt.sourceProblem} ${p.code || ''} ${p.name || ''}`.trim(), rows });
  }
  const known = new Set(problems.map((p) => String(p.id)));
  const unknownIds = [...new Set(visible.filter((c) => c.problem != null && c.problem !== '' && !known.has(String(c.problem))).map((c) => String(c.problem)))];
  for (const id of unknownIds) {
    const rows = visible.filter((c) => String(c.problem) === id);
    const p = problemById.get(id);
    groups.push({ key: `p-${id}`, title: p ? `${txt.sourceProblem} ${p.code || ''} ${p.name || ''}`.trim() : `${txt.sourceProblem} #${id}`, rows });
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="type-h1">{t.clarif_title.replace('{id}', params.id)}</h1>
        <Button variant="secondary" className="!py-0.5" onClick={() => load(true)}>{txt.refresh}</Button>
      </div>
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

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
        {txt.onlyMine}
      </label>

      {!visible.length ? <EmptyState line={t.clarif_empty} /> : (
        <div className="mt-2 flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className="type-h2 mb-1">{g.title}</h2>
              <ul>
                {g.rows.map((c) => (
                  <li key={c.id} className="py-3 border-t" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex items-center gap-2 flex-wrap text-xs" style={{ color: 'var(--muted)' }}>
                      <Badge tone={c.answer ? 'accent' : 'warn'}>{c.answer ? txt.answered : txt.pending}</Badge>
                      {c.mine ? <Badge tone="neutral">{txt.mineTag}</Badge> : null}
                      <span>{txt.asked} #{c.authorId ?? '?'}</span>
                      {c.createdAt ? <time dateTime={c.createdAt}>{when(c.createdAt)}</time> : null}
                    </div>
                    <p className="text-sm mt-1"><strong>{t.clarif_q}</strong> {c.question}</p>
                    {c.answer ? (
                      <div className="mt-2 rounded p-2 text-sm" style={{ background: 'var(--hover-wash)' }}>
                        <p><strong>{t.clarif_a}</strong> {c.answer}</p>
                        {answeredByLabel(c) || c.answeredAt ? (
                          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                            {answeredByLabel(c) ? `${txt.answeredBy} ${answeredByLabel(c)}` : ''}
                            {answeredByLabel(c) && c.answeredAt ? ' · ' : ''}
                            {c.answeredAt ? when(c.answeredAt) : ''}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {!c.answer && canAnswer ? (
                      <form
                        className="mt-2 flex flex-col gap-2"
                        onSubmit={(e) => { e.preventDefault(); sendAnswer(c); }}
                      >
                        <Textarea
                          label={txt.answerLabel}
                          name={`answer-${c.id}`}
                          rows={2}
                          value={drafts[c.id] || ''}
                          placeholder={txt.answerPh}
                          onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                        />
                        <Button type="submit" className="self-start" disabled={sending === c.id || !String(drafts[c.id] || '').trim()}>
                          {txt.answer}
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
