// Submit page — dedicated solution upload. Opened from problem view via "Submit solution".
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, FILENAME_RE, suggestFilename, STR, getLang } from '../../../../../../lib/client';
import { Button, Card, CodeEditor, EmptyState, Input, Skeleton } from '../../../../../../components/ui';
import EyebrowFx from '../../../../../../components/EyebrowFx';

export default function ProblemSubmitPage({ params }) {
  const t = STR[getLang()];
  const router = useRouter();
  const [p, setP] = useState(null);
  const [failed, setFailed] = useState(false);
  const [code, setCode] = useState('');
  const [fn, setFn] = useState('solution.cpp');
  const [sampleOnly, setSampleOnly] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [fnameError, setFnameError] = useState('');

  useEffect(() => {
    api(`/api/problems/${params.pid}`).then(setP).catch(() => setFailed(true));
  }, [params.pid]);

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
    try {
      const r = await api('/api/submits/sample-run', { method: 'POST', body: JSON.stringify({ contestId: p.contestId, problemId: p.id, code, filename: fn, sampleOnly: true }) });
      setMsg(t.subm_sample_queued.replace('{id}', String(r.id)));
    } catch (e) { setMsg(`${t.subm_sample_failed} ${e.message}`); }
    finally { setBusy(false); }
  }

  async function submit() {
    if (!FILENAME_RE.test(fn)) {
      setFnameError(suggestFilename(fn));
      setMsg(`${t.subm_invalid_suggest} ${suggestFilename(fn)}`);
      return;
    }
    if (code.length > 512 * 1024) { setMsg(t.subm_too_large); return; }
    setBusy(true);
    setMsg(t.subm_submitting);
    try {
      const r = await api(`/api/problems/${p.id}/submit`, { method: 'POST', body: JSON.stringify({ code, filename: fn, sampleOnly }) });
      setMsg(`submit #${r.id} ${r.status}`);
      router.push(`/results/${r.id}`);
    } catch (e) { setMsg(`${t.subm_failed} ${e.message}`); }
    finally { setBusy(false); }
  }

  if (failed) return <div className="mx-auto w-full max-w-3xl py-2"><EmptyState line={t.pedit_not_found} /></div>;
  if (!p) return <div className="mx-auto w-full max-w-3xl py-2"><Skeleton lines={5} /></div>;

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
      </Card>
    </div>
  );
}
