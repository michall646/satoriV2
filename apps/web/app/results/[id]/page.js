// Submit detail: live timeline + explainers + code + re-submit + download + diff.
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, API, STR, getLang } from '../../../lib/client';
import { Button, Card, CodeBlock, CopyButton, DiffView, Skeleton, Table, Textarea, VerdictCell, VerdictPill } from '../../../components/ui';

const DOCS = 'https://docs.satori.example/judge#verdicts';

const APPEAL_TXT = {
  en: {
    appeal: 'Appeal this verdict',
    appealCta: 'Appeal',
    appealLabel: 'What should the jury re-check?',
    appealHint: 'Only your own failed or flagged submission can be appealed.',
    appealSend: 'Send appeal',
    appealOpen: 'Open appeal — the jury has not resolved it yet.',
    appealStatus: 'Status',
    appealResolved: 'Resolved.',
  },
  pl: {
    appeal: 'Odwołaj się od werdyktu',
    appealCta: 'Odwołanie',
    appealLabel: 'Co jury ma sprawdzić ponownie?',
    appealHint: 'Odwołanie dotyczy tylko własnego nieudanego lub oznaczonego zgłoszenia.',
    appealSend: 'Wyślij odwołanie',
    appealOpen: 'Odwołanie otwarte — jury jeszcze go nie rozpatrzyło.',
    appealStatus: 'Status',
    appealResolved: 'Rozpatrzono.',
  },
};

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
  const txt = APPEAL_TXT[getLang() === 'pl' ? 'pl' : 'en'];
  const router = useRouter();
  const [s, setS] = useState(null);
  const [me, setMe] = useState(null);
  const [appeal, setAppeal] = useState({ open: false, text: '', sending: false, error: '', status: null, verdict: null });
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

  useEffect(() => {
    api('/api/me').then(setMe).catch(() => setMe(null));
  }, []);

  // F6: an appeal is real only when the API returns one. No optimistic success.
  useEffect(() => {
    if (!s || !s.contestId) return undefined;
    let live = true;
    api(`/api/contests/${s.contestId}/integrity/appeals/mine`)
      .then((d) => {
        if (!live) return;
        const row = (d.items || []).find((a) => String(a.submitId) === String(s.id));
        if (!row) return;
        setAppeal((prev) => ({ ...prev, status: row.status || 'open', verdict: row.verdict || null }));
      })
      .catch(() => { /* not a member or anonymous: the CTA stays hidden */ });
    return () => { live = false; };
  }, [s?.contestId, s?.id]);
  if (!s) return <Skeleton lines={6} />;
  const ex = explainer(s, t);
  const phase = s.phase || s.status;
  const phaseIdx = phase === 'QUE' ? 0 : phase === 'CMP' ? 1 : phase === 'TST' ? 2 : 3;
  const judged = phaseIdx >= 3 && !LIVE.has(s.status);
  const steps = ['queued', 'compiling', 'testing', 'judged'];
  const isFail = FAIL.has(s.status);
  const isLive = LIVE.has(s.status) || !judged;
  // F6: only the owner of a failed/flagged, judged submission sees the appeal CTA.
  const flagged = s.flagged === true || s.integrityFlag === true;
  const mineSubmit = me != null && String(me.id) === String(s.userId);
  const appealable = mineSubmit && judged && !s.sampleOnly && (isFail || flagged);
  const tests = s.perTest || [];
  const passed = tests.filter((t) => t.verdict === 'OK' || t.verdict === 'ANS').length;

  async function resubmit() {
    try {
      const r = await api(`/api/problems/${s.problemId}/submit`, { method: 'POST', body: JSON.stringify({ code: s.code, filename: s.filename }) });
      router.push(`/results/${r.id}`);
    } catch (e) { router.push(`/results/${s.id}`); }
  }

  async function sendAppeal(e) {
    e.preventDefault();
    const text = String(appeal.text || '').trim();
    if (!text || !s.contestId) return;
    setAppeal((a) => ({ ...a, sending: true, error: '' }));
    try {
      const r = await api(`/api/contests/${s.contestId}/integrity/appeals`, {
        method: 'POST',
        body: JSON.stringify({ submitId: s.id, text }),
      });
      setAppeal({ open: false, text: '', sending: false, error: '', status: r.status || 'open', verdict: r.verdict || null });
    } catch (err) {
      setAppeal((a) => ({ ...a, sending: false, error: err.message }));
    }
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

      {appealable ? (
        <Card className="text-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <strong>{txt.appeal}</strong>
            {appeal.status ? (
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                {txt.appealStatus}: {appeal.status}{appeal.verdict ? ` (${appeal.verdict})` : ''}
              </span>
            ) : null}
          </div>
          {appeal.status === 'open' ? <p className="mt-1">{txt.appealOpen}</p> : null}
          {appeal.status && appeal.status !== 'open' ? <p className="mt-1">{txt.appealResolved}</p> : null}
          {!appeal.status && !appeal.open ? (
            <Button variant="secondary" className="mt-2" onClick={() => setAppeal((a) => ({ ...a, open: true, error: '' }))}>{txt.appealCta}</Button>
          ) : null}
          {!appeal.status && appeal.open ? (
            <form onSubmit={sendAppeal} className="mt-2 flex flex-col gap-2">
              <Textarea
                label={txt.appealLabel}
                rows={3}
                value={appeal.text}
                onChange={(e) => setAppeal((a) => ({ ...a, text: e.target.value }))}
                hint={txt.appealHint}
              />
              {appeal.error ? <p role="alert" className="text-xs" style={{ color: 'var(--wa-text)' }}><span aria-hidden="true">⚠ </span>{appeal.error}</p> : null}
              <div className="flex gap-2">
                <Button type="submit" disabled={appeal.sending || !String(appeal.text || '').trim()}>{txt.appealSend}</Button>
                <Button variant="secondary" onClick={() => setAppeal((a) => ({ ...a, open: false, error: '' }))}>{t.common_close}</Button>
              </div>
            </form>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
