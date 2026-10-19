// B2.3: statement + samples (tab) + limits + watch + PL/EN. Submit lives on ./submit page.
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, API, STR, getLang } from '../../../../../lib/client';
import { Badge, Button, CopyButton, EmptyState, Markdown, Select, Skeleton, Tabs, VerdictPill } from '../../../../../components/ui';
import EyebrowFx from '../../../../../components/EyebrowFx';

export default function ProblemPage({ params }) {
  const t = STR[getLang()];
  const router = useRouter();
  const [p, setP] = useState(null);
  const [watch, setWatch] = useState(false);
  const [stmtLang, setStmtLang] = useState('pl');
  const [history, setHistory] = useState(null);
  const [related, setRelated] = useState([]);

  useEffect(() => {
    api(`/api/problems/${params.pid}`).then(setP).catch(() => setP(null));
    api(`/api/problems/${params.pid}/limitHistory`).then(setHistory).catch(() => setHistory(null));
    try { setWatch(localStorage.getItem(`satori-watch-${params.pid}`) === '1'); } catch { /* noop */ }
  }, [params.pid]);

  useEffect(() => {
    if (!p?.contestId) return;
    api(`/api/contests/${p.contestId}/problems`).then((d) => setRelated(d.items || [])).catch(() => {});
  }, [p?.contestId]);

  if (p === null) return <EmptyState line={t.pedit_not_found} />;
  if (!p) return <div className="w-full py-2"><Skeleton lines={6} /></div>;

  const lim = p.limits || {};

  function toggleWatch() {
    const next = !watch;
    setWatch(next);
    try { localStorage.setItem(`satori-watch-${params.pid}`, next ? '1' : '0'); } catch { /* noop */ }
  }

  function goSubmit() {
    router.push(`./${p.id}/submit`);
  }

  const idx = related.findIndex((x) => String(x.id) === String(p.id));
  const prev = idx > 0 ? related[idx - 1] : null;
  const next = idx >= 0 && idx < related.length - 1 ? related[idx + 1] : null;
  const solved = p._best === 'OK' || p._best === 'ANS';
  const statement = stmtLang === 'en' ? (p.statementMdEn || p.statementMd) : p.statementMd;
  const samples = p.samples || [];
  const deadlineAt = p.effectiveDeadline || p.deadlineAt || null;
  const policy = p.deadlinePolicy || null;
  const deadlineOn = Boolean(policy && policy.enabled && deadlineAt);
  const overdue = deadlineOn ? new Date(deadlineAt).getTime() < Date.now() : false;

  const samplesContent = (
    <div className="py-4">
      <div className="flex gap-3 items-center justify-between flex-wrap">
        <p className="text-sm text-muted">{!samples.length ? t.prob_samples_none : samples.length === 1 ? t.prob_samples_one : t.prob_samples_many.replace('{n}', String(samples.length))}</p>
        {samples.length ? <Button variant="secondary" onClick={goSubmit} className="!py-1.5">{t.prob_test_samples}</Button> : null}
      </div>
      {samples.map((s, i) => (
        <div key={i} className="py-8 grid md:grid-cols-2 gap-8 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
          <div className="min-w-0">
            <div className="flex gap-3 items-center mb-3">
              <EyebrowFx text={t.prob_sample_in.replace('{n}', String(i + 1))} as="span" />
              <CopyButton text={s.input} />
            </div>
            <pre className="type-mono whitespace-pre-wrap rounded-xl p-4 leading-relaxed bg-bg min-h-[120px]">{s.input}</pre>
          </div>
          <div className="min-w-0">
            <div className="flex gap-3 items-center mb-3">
              <EyebrowFx text={t.prob_sample_out.replace('{n}', String(i + 1))} as="span" />
              <CopyButton text={s.output} />
            </div>
            <pre className="type-mono whitespace-pre-wrap rounded-xl p-4 leading-relaxed bg-bg min-h-[120px]">{s.output}</pre>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="w-full py-2">
      <EyebrowFx text={p.code} />
      <div className="flex gap-4 items-start justify-between flex-wrap mt-2">
        <div className="min-w-0 max-w-2xl">
          <h1 className="type-display">{p.name}</h1>
          <div className="flex gap-2 items-center flex-wrap mt-3">
            {p.visibility ? <Badge>{p.visibility}</Badge> : null}
            {p._best ? <VerdictPill verdict={p._best} /> : null}
          </div>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Button variant="secondary" onClick={toggleWatch} aria-pressed={watch} className="!py-1.5">{watch ? t.prob_watching : t.prob_watch}</Button>
          <Select value={stmtLang} onChange={(e) => setStmtLang(e.target.value)} aria-label={t.prob_stmt_lang_aria} className="!w-24 !py-1.5">
            <option value="pl">PL</option>
            <option value="en">EN</option>
          </Select>
          <Button onClick={goSubmit} className="!py-1.5">{t.prob_submit_solution}</Button>
        </div>
      </div>

      <div className="mt-5 text-sm text-muted flex gap-2 items-center flex-wrap">
        <span><strong className="font-semibold">{t.prob_limits}</strong> {(lim.timeMs || 1000) / 1000}s (×2 Python){lim.perLang?.Python ? ` · Py ×${lim.perLang.Python}` : ''} · {lim.memoryMb || 256}MB · {t.prob_stack} {lim.stackMb || 64}MB</span>
        <Link className="underline focus-ring rounded" href="/languages" prefetch>{t.prob_matrix}</Link>
        {history?.length ? <span className="text-muted">{t.prob_limit_history} {history.map((h) => `${h.at}: ${h.timeMs}ms`).join(' · ')}</span> : null}
      </div>

      {deadlineOn ? (
        <div className="mt-4 border rounded-xl px-3 py-2 text-sm flex gap-2 items-center flex-wrap" role="status" style={overdue ? { borderColor: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 8%, transparent)' } : { borderColor: 'var(--border)' }}>
          <span aria-hidden="true">{overdue ? '⏰' : '🗓️'}</span>
          <span><strong>{t.prob_due}</strong> <span title={new Date(deadlineAt).toString()}>{new Date(deadlineAt).toLocaleString()}</span> ({p.deadlineSource || 'problem'})</span>
          {policy.lateMode === 'hard' ? <Badge>{overdue ? t.prob_dl_closed : t.prob_dl_hard}</Badge> : <Badge>{overdue ? t.prob_dl_late_penalty : `${t.prob_dl_soft.replace('{v}', String(policy.penaltyValue)).replace('{unit}', policy.penaltyKind === 'perHour' ? 'h' : 'd')}${policy.graceMin ? t.prob_dl_grace.replace('{n}', String(policy.graceMin)) : ''}`}</Badge>}
          <a className="underline text-xs" href={`${API}/api/contests/${p.contestId}/grade.ics`}>ICS</a>
        </div>
      ) : null}

      <Tabs
        className="mt-8"
        tabs={[
          {
            id: 'stmt',
            label: t.pedit_statement,
            content: (
              <div className="max-w-prose py-8 space-y-4 leading-relaxed">
                <Markdown text={statement} />
                {stmtLang === 'en' && !p.statementMdEn ? <p className="text-xs text-muted">{t.prob_pl_fallback}</p> : null}
              </div>
            ),
          },
          { id: 'samples', label: `${t.pedit_samples}${samples.length ? ` (${samples.length})` : ''}`, content: samplesContent },
          {
            id: 'pdf',
            label: 'PDF',
            content: (
              <div className="py-8">
                {p.pdfUrl ? <a className="underline text-sm focus-ring rounded" href={p.pdfUrl}>{t.prob_open_pdf}</a> : <p className="text-sm text-muted">{t.prob_no_pdf}</p>}
              </div>
            ),
          },
          {
            id: 'ed',
            label: t.prob_editorial,
            content: (
              <div className="py-8">
                {solved ? <div className="max-w-prose space-y-4 leading-relaxed"><Markdown text={p.editorialMd} fallback={t.prob_no_editorial} /></div> : <p className="text-sm text-muted">{t.prob_locked_until_solved}</p>}
              </div>
            ),
          },
        ]}
      />

      <nav className="flex justify-between text-sm mt-12 pt-6 border-t" style={{ borderColor: 'var(--border)' }} aria-label={t.prob_related_aria}>
        <span>{prev ? <Link className="underline focus-ring rounded text-muted" href={`./${prev.id}`} prefetch>← {prev.code}</Link> : ''}</span>
        <span>{next ? <Link className="underline focus-ring rounded text-muted" href={`./${next.id}`} prefetch>{next.code} →</Link> : ''}</span>
      </nav>
    </div>
  );
}
