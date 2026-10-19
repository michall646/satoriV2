// Submit detail: live timeline + explainers + code + re-submit + download + diff.
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, API, STR, getLang } from '../../../lib/client';
import { Button, Card, CodeBlock, CopyButton, DiffView, Skeleton, Table, VerdictCell, VerdictPill } from '../../../components/ui';

const DOCS = 'https://docs.satori.example/judge#verdicts';

const FAIL = new Set(['WA', 'TLE', 'MLE', 'RE', 'CE']);
const LIVE = new Set(['QUE', 'CMP', 'TST']);
const STEP_KEY = { queued: 'st_queued', compiling: 'st_compiling', testing: 'st_testing', judged: 'st_judged' };

function explainer(s, t) {
  if (s.status === 'TLE') return { title: t.res_ex_tle_t, body: t.res_ex_tle_b.replace('{used}', String(s.cpuMs ?? '?')).replace('{lim}', String(s.limitMs ?? '?')) };
  if (s.status === 'MLE') return { title: t.res_ex_mle_t, body: t.res_ex_mle_b.replace('{used}', String(s.memMb ?? '?')).replace('{lim}', String(s.limitMb ?? '?')) };
  if (s.status === 'CE') return { title: t.st_ce, body: t.res_ex_ce_b };
  return null;
}

function statusLabel(status, t) {
  if (status === 'OK') return t.st_accepted;
  if (status === 'WA') return t.st_wa;
  if (status === 'TLE') return t.st_tle;
  if (status === 'MLE') return t.st_mle;
  if (status === 'RE') return t.st_re;
  if (status === 'CE') return t.st_ce;
  if (status === 'QUE') return t.st_queued;
  if (status === 'CMP') return t.st_compiling;
  if (status === 'TST') return t.st_testing;
  return status || '?';
}

export default function SubmitPage({ params }) {
  const t = STR[getLang()];
  const router = useRouter();
  const [s, setS] = useState(null);
  useEffect(() => {
    api(`/api/submits/${params.id}`).then(setS).catch(() => {});
    const es = new EventSource(`${API}/api/submits/${params.id}/events`);
    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.status) setS((prev) => ({ ...(prev || {}), ...d }));
      } catch { /* keep */ }
    };
    return () => es.close();
  }, [params.id]);
  if (!s) return <Skeleton lines={6} />;
  const ex = explainer(s, t);
  const phase = s.phase || s.status;
  const phaseIdx = phase === 'QUE' ? 0 : phase === 'CMP' ? 1 : phase === 'TST' ? 2 : 3;
  const judged = phaseIdx >= 3 && !LIVE.has(s.status);
  const steps = ['queued', 'compiling', 'testing', 'judged'];
  const isFail = FAIL.has(s.status);
  const isLive = LIVE.has(s.status) || !judged;
  const tests = s.perTest || [];
  const passed = tests.filter((t) => t.verdict === 'OK' || t.verdict === 'ANS').length;

  async function resubmit() {
    try {
      const r = await api(`/api/problems/${s.problemId}/submit`, { method: 'POST', body: JSON.stringify({ code: s.code, filename: s.filename }) });
      router.push(`/results/${r.id}`);
    } catch (e) { router.push(`/results/${s.id}`); }
  }

  return (
    <div className="max-w-3xl flex flex-col gap-4">
      <header className="submit-card">
        <div className="submit-eyebrow">
          <span className={`submit-dot${isLive ? ' is-live' : ''}${isFail ? ' is-fail' : ''}`} aria-hidden />
          <span>{t.res_submit_hash.replace('{id}', String(s.id))}</span>
          <span aria-hidden>·</span>
          <Link className="underline" href={`/results/${s.id}`}>{t.res_permalink}</Link>
        </div>
        <div className="submit-title">
          <span>{statusLabel(s.status, t)}</span>
          <VerdictPill verdict={s.status} />
        </div>
        <p className="submit-meta">
          <span>{s.lang || '?'}</span><span className="submit-meta-sep">·</span>
          <span>{s.filename || '?'}</span><span className="submit-meta-sep">·</span>
          <span>{s.cpuMs ?? '?'}ms</span><span className="submit-meta-sep">·</span>
          <span>{s.memMb ?? '?'}MB</span>
          {s.status === 'TST' && s.testsDone ? <span>· {t.res_testing_short} {s.testsDone}/{s.testsTotal || 12}</span> : null}
        </p>
        <ol aria-live="polite" className="submit-steps">
          {steps.map((st, i) => {
            const done = i < phaseIdx || judged;
            const now = i === phaseIdx && !judged;
            return (
              <li key={st} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : 'none' }}>
                <span className={`submit-step${done ? ' is-done' : ''}${now ? ' is-now' : ''}`}>
                  <span className="submit-step-dot" aria-hidden>{done ? '✓' : now ? '·' : ''}</span>
                  {t[STEP_KEY[st]]}{st === 'testing' && s.testsDone ? ` ${s.testsDone}/${s.testsTotal || 12}` : ''}
                </span>
                {i < steps.length - 1 ? <span className={`submit-step-conn${done ? ' is-done' : ''}`} aria-hidden /> : null}
              </li>
            );
          })}
        </ol>
      </header>

      {s.explain ? <Card className="text-sm">{s.explain}</Card> : null}
      {ex ? <Card className="text-sm"><strong>{ex.title}</strong><p className="mt-1" style={{ color: 'var(--muted)' }}>{ex.body}</p><a className="underline" href={DOCS}>{t.res_docs}</a></Card> : null}
      {s.compileLog ? <Card><strong className="text-sm">{t.results_compile_log}</strong><pre className="text-xs overflow-auto mt-2 type-mono" style={{ color: 'var(--muted)' }}>{s.compileLog}</pre></Card> : null}

      <section>
        <div className="section-head mb-2">
          <h2>{t.results_tests}</h2>
          <p>{tests.length ? `${t.res_passed.replace('{a}', String(passed)).replace('{b}', String(tests.length))} · ${s.cpuMs ?? '?'}ms · ${s.memMb ?? '?'}MB` : t.res_waiting}</p>
        </div>
        <Table
          columns={[
            { key: 'n', label: '#' },
            {
              key: 'verdict', label: t.prob_verdict, fill: true,
              render: (t) => <VerdictCell verdict={t.verdict} sub={`${t.timeMs ?? '?'}ms · ${t.memMb ?? '?'}MB`} />,
            },
            { key: 'timeMs', label: t.col_time, align: 'right', render: (t) => <span className="tnum">{t.timeMs ?? '?'}ms</span> },
            { key: 'memMb', label: t.col_mem, align: 'right', render: (t) => <span className="tnum">{t.memMb ?? '?'}MB</span> },
            { key: 'msg', label: t.col_message, render: (t) => <span className="tmut">{t.msg || '—'}</span> },
          ]}
          rows={tests.map((t) => ({ ...t, key: t.n }))}
        />
      </section>

      {s.expected != null || s.got != null ? <DiffView expected={s.expected || ''} got={s.got || ''} /> : null}
      {s.code ? <CodeBlock code={s.code} language={s.lang} showLines /> : null}

      <div className="flex gap-2 items-center">
        <Button onClick={resubmit}>{t.results_resubmit}</Button>
        <Button variant="secondary" onClick={() => { const b = new Blob([s.code || ''], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = s.filename || `submit-${s.id}.txt`; a.click(); }}>{t.results_download}</Button>
        <span className="inline-flex"><CopyButton text={s.code || ''} label={t.res_copy_code} /></span>
      </div>
    </div>
  );
}
