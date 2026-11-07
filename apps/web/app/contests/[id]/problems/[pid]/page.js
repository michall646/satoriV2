// B2.3: statement + samples (tab) + limits + watch + PL/EN. Submit lives on ./submit page.
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, API, STR, getLang, withAuth } from '../../../../../lib/client';
import { Badge, Button, CopyButton, EmptyState, Markdown, Select, Skeleton, Tabs, VerdictPill } from '../../../../../components/ui';
import EyebrowFx from '../../../../../components/EyebrowFx';
import { toast } from '../../../../../components/ui/Toast';

// E2: KaTeX is not a dependency. Math stays honest code text until a renderer
// ships; flip this flag together with the dependency so the note disappears.
const KATEX_ENABLED = false;

const E2_TXT = {
  en: {
    watchTitle: 'Saved in your account notification prefs. Watch notifications are not sent yet.',
    limitsTitle: 'perLang values are absolute milliseconds, not multipliers.',
    mathNote: 'Math renders as styled code — KaTeX is not enabled yet (KATEX_ENABLED=false).',
    lockNote: 'The editorial unlocks after your first accepted solution.',
    solved: 'Solved',
    tries: 'tries',
    aliasTitle: 'Contest alias',
    noEditorial: 'No editorial yet.',
    loginToSave: 'Watch is kept on this device. Log in to save it to your account.',
  },
  pl: {
    watchTitle: 'Zapisane w preferencjach powiadomień konta. Powiadomienia o obserwowanych zadaniach nie są jeszcze wysyłane.',
    limitsTitle: 'Wartości perLang to bezwzględne milisekundy, nie mnożniki.',
    mathNote: 'Wzory pokazywane jako kod — KaTeX nie jest jeszcze włączony (KATEX_ENABLED=false).',
    lockNote: 'Omówienie odblokuje się po pierwszym zaakceptowanym rozwiązaniu.',
    solved: 'Rozwiązane',
    tries: 'prób',
    aliasTitle: 'Alias konkursowy',
    noEditorial: 'Brak omówienia.',
    loginToSave: 'Obserwacja zostaje na tym urządzeniu. Zaloguj się, aby zapisać ją w koncie.',
  },
};

// Deadline status copy: hard blocks late work, soft applies the configured penalty.
function deadlineText(policy, overdue, t) {
  if (!policy) return '';
  if (policy.lateMode === 'hard') return overdue ? t.prob_dl_closed : t.prob_dl_hard;
  if (overdue) return t.prob_dl_late_penalty;
  const unit = policy.penaltyKind === 'perHour' ? 'h' : 'd';
  const value = t.prob_dl_soft.replace('{v}', String(policy.penaltyValue)).replace('{unit}', unit);
  return policy.graceMin ? `${value}${t.prob_dl_grace.replace('{n}', String(policy.graceMin))}` : value;
}

// Render `$…$` as inline code without a math library. Fenced code blocks stay untouched.
function mathAsCode(md) {
  const src = String(md || '');
  if (!src) return src;
  return src.split(/(```[\s\S]*?```)/g).map((part) => {
    if (part.startsWith('```')) return part;
    return part.replace(/\$([^$\n]+)\$/g, (_, tex) => `\`${tex}\``);
  }).join('');
}

function hasMath(md) {
  return /\$[^$\n]+\$/.test(String(md || ''));
}

export default function ProblemPage({ params }) {
  const t = STR[getLang()];
  const txt = E2_TXT[getLang() === 'pl' ? 'pl' : 'en'];
  const router = useRouter();
  const [p, setP] = useState(null);
  const [watch, setWatch] = useState(false);
  const [stmtLang, setStmtLang] = useState('pl');
  const [history, setHistory] = useState(null);
  const [related, setRelated] = useState([]);

  useEffect(() => {
    api(`/api/problems/${params.pid}`).then(setP).catch(() => setP(null));
    api(`/api/problems/${params.pid}/limitHistory`).then((d) => setHistory(d.items || [])).catch(() => setHistory(null));
    try { setWatch(localStorage.getItem(`satori-watch-${params.pid}`) === '1'); } catch { /* noop */ }
    // Account pref is canonical when available (same watch list on every device).
    api('/api/notifications/prefs').then((d) => {
      const ids = String((d.prefs || d).watch || '').split(',').map((x) => x.trim()).filter(Boolean);
      if (ids.includes(String(params.pid))) setWatch(true);
    }).catch(() => { /* local toggle only */ });
  }, [params.pid]);

  useEffect(() => {
    if (!p?.contestId) return;
    api(`/api/contests/${p.contestId}/problems`).then((d) => setRelated(d.items || [])).catch(() => {});
  }, [p?.contestId]);

  if (p === null) return <EmptyState line={t.pedit_not_found} />;
  if (!p) return <div className="w-full py-2"><Skeleton lines={6} /></div>;

  const lim = p.limits || {};
  // E2: perLang values are absolute milliseconds (D6). Never present them as multipliers.
  const perLang = Object.entries(lim.perLang || {})
    .map(([lang, ms]) => [lang, Number(ms)])
    .filter(([, ms]) => Number.isFinite(ms));
  const historyText = (history || [])
    .map((h) => `${h.at}: ${h.to?.timeMs ?? h.timeMs ?? '?'}ms`)
    .join(' · ');

  async function toggleWatch() {
    const next = !watch;
    const key = `satori-watch-${params.pid}`;
    setWatch(next);
    try { localStorage.setItem(key, next ? '1' : '0'); } catch { /* noop */ }
    // E2: persist the real server-side pref, not only the local toggle. The server
    // stores the watch list; emitting watch notifications is a server hook (reported).
    try {
      const d = await api('/api/notifications/prefs');
      const prefs = d.prefs || d || {};
      const ids = String(prefs.watch || '').split(',').map((x) => x.trim()).filter(Boolean);
      const set = new Set(ids.map(String));
      if (next) set.add(String(p.id));
      else set.delete(String(p.id));
      await api('/api/notifications/prefs', { method: 'POST', body: JSON.stringify({ watch: [...set].join(',') }) });
    } catch (e) {
      // Anonymous readers keep the local toggle; there is no account pref to write.
      if (e && e.status === 401) { toast(txt.loginToSave, 'warn'); return; }
      setWatch(!next);
      try { localStorage.setItem(key, next ? '0' : '1'); } catch { /* noop */ }
      toast(`${t.notif_prefs_failed} ${e.message}`, 'danger');
    }
  }

  function goSubmit() {
    router.push(`./${p.id}/submit`);
  }

  const idx = related.findIndex((x) => String(x.id) === String(p.id));
  const prev = idx > 0 ? related[idx - 1] : null;
  const next = idx >= 0 && idx < related.length - 1 ? related[idx + 1] : null;
  // E2: the contest problems list (already fetched for related navigation) is the
  // authoritative per-user row; the detail endpoint may omit these fields.
  const mine = related.find((x) => String(x.id) === String(p.id)) || null;
  const best = mine?._best || p._best || null;
  const score = mine?._score ?? p._bestScore ?? p._score ?? null;
  const tries = mine?._tries ?? p._tries ?? null;
  const alias = mine?.alias || p.alias || p.code;
  const solved = best === 'OK' || best === 'ANS';
  const statement = stmtLang === 'en' ? (p.statementMdEn || p.statementMd) : p.statementMd;
  const samples = p.samples || [];
  const editorial = p.editorialMd || p.editorial || '';
  const deadlineAt = p.effectiveDeadline || p.deadlineAt || null;
  const policy = p.deadlinePolicy || null;
  const deadlineOn = Boolean(policy && policy.enabled && deadlineAt);
  const overdue = deadlineOn ? new Date(deadlineAt).getTime() < Date.now() : false;
  const statusText = deadlineText(policy, overdue, t);

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
      <EyebrowFx text={alias} title={alias !== p.code ? `${txt.aliasTitle}: ${p.code}` : undefined} />
      <div className="flex gap-4 items-start justify-between flex-wrap mt-2">
        <div className="min-w-0 max-w-2xl">
          <h1 className="type-display">{p.name}</h1>
          <div className="flex gap-2 items-center flex-wrap mt-3">
            {p.visibility ? <Badge>{p.visibility}</Badge> : null}
            {solved ? <Badge tone="accent">✓ {txt.solved}</Badge> : null}
            <VerdictPill verdict={best} score={solved && score != null ? score : undefined} />
            {tries ? <span className="text-xs" style={{ color: 'var(--muted)' }}>{tries} {txt.tries}</span> : null}
          </div>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Button variant="secondary" onClick={toggleWatch} aria-pressed={watch} title={txt.watchTitle} className="!py-1.5">{watch ? t.prob_watching : t.prob_watch}</Button>
          <Select value={stmtLang} onChange={(e) => setStmtLang(e.target.value)} aria-label={t.prob_stmt_lang_aria} className="!w-24 !py-1.5">
            <option value="pl">PL</option>
            <option value="en">EN</option>
          </Select>
          <Button onClick={goSubmit} className="!py-1.5">{t.prob_submit_solution}</Button>
        </div>
      </div>

      <div className="mt-5 text-sm text-muted flex gap-2 items-center flex-wrap" title={txt.limitsTitle}>
        <span><strong className="font-semibold">{t.prob_limits}</strong> {lim.timeMs || 1000}ms · {lim.memoryMb || 256}MB · {t.prob_stack} {lim.stackMb || 64}MB{perLang.length ? ` · ${perLang.map(([lang, ms]) => `${lang} ${ms}ms`).join(' · ')}` : ''}</span>
        <Link className="underline focus-ring rounded" href="/languages" prefetch>{t.prob_matrix}</Link>
        {historyText ? <span className="text-muted">{t.prob_limit_history} {historyText}</span> : null}
      </div>

      {deadlineOn ? (
        <div className="mt-6 py-2.5 border-y flex items-center gap-x-3 gap-y-1.5 flex-wrap text-[13px]" role="status" style={{ borderColor: 'var(--border)' }}>
          <span className="eyebrow">{t.prob_due}</span>
          <span className="type-mono tabular-nums" title={new Date(deadlineAt).toString()}>{new Date(deadlineAt).toLocaleString()}</span>
          <span className="text-xs flex items-center gap-2 flex-wrap" style={{ color: 'var(--muted)' }}>
            <span className="type-mono">{p.deadlineSource || 'problem'}</span>
            <span aria-hidden="true">·</span>
            <span style={{ color: overdue ? 'var(--fg)' : 'var(--muted)', fontWeight: overdue ? 500 : 400 }}>{statusText}</span>
          </span>
          <a className="ml-auto type-mono text-[11px] uppercase tracking-[0.08em] underline underline-offset-2 focus-ring rounded" style={{ color: 'var(--muted)' }} href={withAuth(`${API}/api/contests/${p.contestId}/grade.ics`)}>ICS</a>
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
                {solved ? (
                  <div className="max-w-prose space-y-4 leading-relaxed">
                    <Markdown text={mathAsCode(editorial)} fallback={txt.noEditorial} />
                    {hasMath(editorial) && !KATEX_ENABLED ? <p className="text-xs" style={{ color: 'var(--muted)' }}>{txt.mathNote}</p> : null}
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-muted">{t.prob_locked_until_solved}</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{txt.lockNote}</p>
                  </div>
                )}
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
