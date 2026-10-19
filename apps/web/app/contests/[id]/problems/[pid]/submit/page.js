// Submit page — dedicated solution upload. Opened from problem view via "Submit solution".
'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, FILENAME_RE, suggestFilename, STR, getLang } from '../../../../../../lib/client';
import { pendingCount, queueSubmit } from '../../../../../../lib/outbox';
import { Button, Card, CodeEditor, DiffView, EmptyState, Input, Select, Skeleton, VerdictPill } from '../../../../../../components/ui';
import EyebrowFx from '../../../../../../components/EyebrowFx';

// E1: the API only accepts canonical language ids (validators.LANGUAGES); the old
// lowercase ids (cpp/python/java) are rejected with LANG_OFF.
const CANONICAL_LANGS = ['C', 'C++17', 'Java', 'Python', 'Rust', 'JavaScript'];
const LIVE = ['QUE', 'CMP', 'TST'];

// E1: filename extension wins; conservative code hints only when there is no extension.
function detectLang(filename, code) {
  const f = String(filename || '').toLowerCase();
  if (f.endsWith('.py')) return 'Python';
  if (f.endsWith('.java')) return 'Java';
  if (f.endsWith('.rs')) return 'Rust';
  if (f.endsWith('.js')) return 'JavaScript';
  if (/\.(cpp|cc|cxx|hpp)$/.test(f)) return 'C++17';
  if (f.endsWith('.c') || f.endsWith('.h')) return 'C';
  const src = String(code || '');
  if (/\bfn\s+main\s*\(/.test(src)) return 'Rust';
  if (/\bSystem\.out\b|^\s*import\s+java\./m.test(src)) return 'Java';
  if (/\bconsole\.log\s*\(/.test(src)) return 'JavaScript';
  if (/(^|\n)\s*(def\s+\w+\s*\(|print\()/.test(src) || /^\s*(import\s+\w+|from\s+\w+\s+import)/m.test(src)) return 'Python';
  return 'C++17';
}

// E1: an explicit selector value wins only when it is canonical; never send anything else.
function languageOf(value, filename, code) {
  return CANONICAL_LANGS.includes(value) ? value : detectLang(filename, code);
}

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

// G4: offline submits are replayed from IndexedDB by PwaControls on reconnect.
function queuedOfflineMessage() {
  return getLang() === 'pl'
    ? 'Zapisano offline — wyślemy po połączeniu.'
    : 'Queued offline — will send when you reconnect.';
}

export default function ProblemSubmitPage({ params }) {
  const t = STR[getLang()];
  const router = useRouter();
  const [p, setP] = useState(null);
  const [failed, setFailed] = useState(false);
  const [code, setCode] = useState('');
  const [fn, setFn] = useState('solution.cpp');
  const [language, setLanguage] = useState('');
  const [sampleOnly, setSampleOnly] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [fnameError, setFnameError] = useState('');
  const [sample, setSample] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    api(`/api/problems/${params.pid}`).then(setP).catch(() => setFailed(true));
  }, [params.pid]);

  // E1: stop the sample poll when leaving the page.
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  // E1: poll the submit row until the judge reports a terminal verdict.
  function watchSubmit(id) {
    stopPoll();
    let ticks = 0;
    pollRef.current = setInterval(async () => {
      ticks += 1;
      try {
        const d = await api(`/api/submits/${id}`, { noCache: true });
        setSample(d);
        if (!LIVE.includes(d.status)) { stopPoll(); setMsg(''); }
      } catch { if (ticks > 30) stopPoll(); }
    }, 1200);
  }

  function onFile(f) {
    if (!f) return;
    if (f.size > 512 * 1024) { setMsg(t.subm_too_large); return; }
    setFn(f.name || fn);
    if (!FILENAME_RE.test(f.name || '')) setFnameError(suggestFilename(f.name));
    else setFnameError('');
    const r = new FileReader();
    r.onload = () => setCode(String(r.result || ''));
    r.readAsText(f);
  }

  async function sampleRun() {
    if (!FILENAME_RE.test(fn)) { setFnameError(suggestFilename(fn)); setMsg(`${t.subm_invalid_fn} ${suggestFilename(fn)}`); return; }
    setBusy(true);
    setMsg(t.subm_running_samples);
    setSample(null);
    try {
      const r = await api('/api/submits/sample-run', { method: 'POST', body: JSON.stringify({ contestId: p.contestId, problemId: p.id, code, filename: fn, sampleOnly: true, language: languageOf(language, fn, code) }) });
      setMsg(t.subm_sample_queued.replace('{id}', String(r.id)));
      setSample({ id: r.id, status: r.status || 'QUE' });
      watchSubmit(r.id);
    } catch (e) { setMsg(`${t.subm_sample_failed} ${e.message}`); setSample(null); }
    finally { setBusy(false); }
  }

  // G4: the editor is never cleared here, and it must not be cleared until the
  // queue write resolves. If the write itself fails, say so rather than showing
  // a "queued" state that does not exist.
  async function queueForLater(url, body) {
    try {
      await queueSubmit({
        url,
        body,
        lang: body.language,
        contestId: p.contestId,
        problemId: p.id,
      });
      const pending = await pendingCount().catch(() => 0);
      setMsg(`${queuedOfflineMessage()} (${pending})`);
    } catch (e) {
      setMsg(`${t.subm_failed} ${e.message}`);
    }
  }

  async function submit() {
    if (!FILENAME_RE.test(fn)) {
      setFnameError(suggestFilename(fn));
      setMsg(`${t.subm_invalid_suggest} ${suggestFilename(fn)}`);
      return;
    }
    if (code.length > 512 * 1024) { setMsg(t.subm_too_large); return; }

    const body = { code, filename: fn, sampleOnly, language: languageOf(language, fn, code) };
    const url = `/api/problems/${p.id}/submit`;

    // G4: never pretend a submission was sent while the browser is offline.
    if (isOffline()) {
      setBusy(true);
      try { await queueForLater(url, body); }
      finally { setBusy(false); }
      return;
    }

    setBusy(true);
    setMsg(t.subm_submitting);
    try {
      const r = await api(url, { method: 'POST', body: JSON.stringify(body) });
      setMsg(`submit #${r.id} ${r.status}`);
      router.push(`/results/${r.id}`);
    } catch (e) {
      // A dropped connection is not a verdict: keep the submission for replay.
      if (e && e.name === 'TypeError') {
        await queueForLater(url, body);
        return;
      }
      setMsg(`${t.subm_failed} ${e.message}`);
    }
    finally { setBusy(false); }
  }

  if (failed) return <div className="mx-auto w-full max-w-3xl py-2"><EmptyState line={t.pedit_not_found} /></div>;
  if (!p) return <div className="mx-auto w-full max-w-3xl py-2"><Skeleton lines={5} /></div>;

  const sampleTests = Array.isArray(sample?.perTest) ? sample.perTest : [];
  const sampleLive = sample ? LIVE.includes(sample.status) : false;
  const samplePassed = sampleTests.filter((x) => x.verdict === 'OK' || x.verdict === 'ANS').length;
  const sampleFail = sampleTests.find((x) => x.expected != null || x.got != null) || null;
  const sampleExpected = sampleFail?.expected ?? sample?.expected;
  const sampleGot = sampleFail?.got ?? sample?.got;

  return (
    <div className="mx-auto w-full max-w-3xl py-2">
      <Link href={`../${p.id}`} prefetch className="text-sm underline text-muted focus-ring rounded">← {t.subm_back} {p.code} — {p.name}</Link>
      <EyebrowFx text={p.code} className="mt-6" />
      <h1 className="type-h1 mt-2">{t.prob_submit_solution}</h1>
      <p className="text-sm text-muted mt-2">{p.name} · {t.subm_page_hint}</p>

      <Card
        className={`mt-6 space-y-4 ${drag ? '!border-accent' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]); }}
      >
        <div className="flex gap-3 items-end flex-wrap">
          <Input
            label={t.subm_filename}
            value={fn}
            onChange={(e) => { setFn(e.target.value); setFnameError(FILENAME_RE.test(e.target.value) ? '' : suggestFilename(e.target.value)); }}
            error={fnameError ? `${t.subm_invalid_try} ${fnameError}` : ''}
            hint={`${t.subm_drag_hint} · ${t.subm_name_rules}`}
            className="flex-1 min-w-[220px]"
          />
          <label className="text-sm flex gap-2 items-center pb-6 whitespace-nowrap cursor-pointer">
            <input type="checkbox" checked={sampleOnly} onChange={(e) => setSampleOnly(e.target.checked)} />
            {t.subm_sample_only}
          </label>
        </div>
        <div className="flex gap-2 items-center flex-wrap text-sm">
          <input type="file" onChange={(e) => onFile(e.target.files?.[0])} aria-label={t.subm_upload_aria} className="text-sm max-w-full" />
          <span className="flex gap-2 items-center">
            <span style={{ color: 'var(--muted)' }}>{t.cockpit_lang_aria}</span>
            <Select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label={t.cockpit_lang_aria} className="!w-auto !py-1.5">
              <option value="">auto ({detectLang(fn, code)})</option>
              {CANONICAL_LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
          </span>
          {fnameError ? <Button variant="secondary" className="!py-1" onClick={() => { setFn(fnameError); setFnameError(''); }}>{t.cockpit_apply} {fnameError}</Button> : null}
        </div>
        <label className="block text-sm">
          <span className="block font-medium mb-1">{t.prob_code}</span>
          <CodeEditor
            value={code}
            onChange={setCode}
            filename={fn}
            height="400px"
            onSubmit={submit}
          />
        </label>
        <div className="flex gap-2 items-center flex-wrap">
          <Button onClick={submit} disabled={busy || !code.trim()}>{t.submit}</Button>
          <Button variant="secondary" onClick={sampleRun} disabled={busy || !code.trim()}>{t.sample_run}</Button>
        </div>
        {msg ? <p role="status" className="text-sm">{msg}</p> : null}
        {sample ? (
          <div className="border rounded-xl p-3 text-sm" role="status" aria-live="polite" style={{ borderColor: 'var(--border)' }}>
            <div className="flex gap-2 items-center flex-wrap">
              <VerdictPill verdict={sample.status} />
              <Link className="underline focus-ring rounded" href={`/results/${sample.id}`} prefetch>{t.res_submit_hash.replace('{id}', String(sample.id))}</Link>
              {sampleLive ? <span style={{ color: 'var(--muted)' }}>{t.res_waiting}{sample.testsTotal ? ` ${sample.testsDone || 0}/${sample.testsTotal}` : ''}</span> : null}
              {!sampleLive && sampleTests.length ? <span style={{ color: 'var(--muted)' }}>{t.res_passed.replace('{a}', String(samplePassed)).replace('{b}', String(sampleTests.length))}</span> : null}
              <Link className="ml-auto underline focus-ring rounded" href={`/results/${sample.id}`}>{t.cockpit_view_diff}</Link>
            </div>
            {sampleTests.length ? (
              <ul className="mt-2">
                {sampleTests.map((x) => (
                  <li key={x.n} className="flex gap-2 items-center flex-wrap py-1" style={{ borderTop: '1px solid var(--border)' }}>
                    <span className="tabular-nums">#{x.n}</span>
                    <VerdictPill verdict={x.verdict} />
                    {x.timeMs != null ? <span className="tabular-nums" style={{ color: 'var(--muted)' }}>{x.timeMs}ms</span> : null}
                    {x.msg ? <span style={{ color: 'var(--muted)' }}>{x.msg}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {sampleExpected != null || sampleGot != null ? <div className="mt-2"><DiffView expected={sampleExpected || ''} got={sampleGot || ''} /></div> : null}
            {sample.compileLog ? <pre className="text-xs overflow-auto mt-2 type-mono" style={{ color: 'var(--muted)' }}>{sample.compileLog}</pre> : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
