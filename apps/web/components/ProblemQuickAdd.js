// Visual problem onboarding: Blank / Clone / ZIP Polygon / Athina PDF bulk.
// Embeds into manage/problems/page.js. Letter auto-assign A/B/C.
'use client';
import { useState } from 'react';
import { api, STR, getLang } from '../lib/client';
import { Button, Input } from './ui';
import { toast } from './ui/Toast';

function nextLetterCode(items) {
  const used = new Set((items || []).map((p) => (p.alias || p.code || '').toUpperCase()));
  for (let i = 0; i < 26; i++) {
    const l = String.fromCharCode(65 + i);
    if (!used.has(l)) return l;
  }
  return `P${(items || []).length + 1}`;
}

const QUICK_TABS = { blank: 'quick_tab_blank', clone: 'quick_clone', zip: 'quick_tab_zip', pdf: 'quick_tab_pdf' };

export default function ProblemQuickAdd({ contestId, items, onDone }) {
  const t = STR[getLang()];
  const [mode, setMode] = useState('blank');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [cloneId, setCloneId] = useState('');
  const [cloneTarget, setCloneTarget] = useState('');
  const [msg, setMsg] = useState('');

  async function createBlank() {
    const finalCode = (code.trim() || nextLetterCode(items));
    const finalName = name.trim() || t.quick_problem.replace('{code}', finalCode);
    try {
      const r = await api(`/api/contests/${contestId}/problems`, { method: 'POST', body: JSON.stringify({ code: finalCode, name: finalName, visibility: 'draft' }) });
      setMsg(t.quick_draft_created.replace('{code}', finalCode));
      setCode(''); setName('');
      toast(t.quick_draft_created.replace('{code}', finalCode));
      onDone?.(r);
    } catch (e) { setMsg(`${t.wiz_create_failed} ${e.message}`); }
  }

  async function clone() {
    if (!cloneId.trim()) { setMsg(t.quick_paste_clone); return; }
    try {
      await api(`/api/problems/${cloneId.trim()}/clone`, { method: 'POST', body: JSON.stringify({ contestId: cloneTarget.trim() || contestId }) });
      toast(t.quick_cloned);
      setCloneId('');
      onDone?.();
    } catch (e) { setMsg(`${t.quick_clone_failed} ${e.message}`); }
  }

  return (
    <div className="my-2">
      <div className="flex gap-1 flex-wrap" role="tablist" aria-label={t.quick_add_aria}>
        {['blank', 'clone', 'zip', 'pdf'].map((id) => (
          <Button key={id} variant={mode === id ? 'primary' : 'secondary'} onClick={() => setMode(id)} className="!py-1">{t[QUICK_TABS[id]]}</Button>
        ))}
        <span className="text-xs text-muted self-center ml-1">{t.quick_next_letter} {nextLetterCode(items)}</span>
      </div>

      {mode === 'blank' ? (
        <div className="flex gap-2 mt-2 flex-wrap items-end">
          <Input label={t.quick_code} value={code} onChange={(e) => setCode(e.target.value)} placeholder={nextLetterCode(items)} className="!w-32" />
          <Input label={t.mset_name} value={name} onChange={(e) => setName(e.target.value)} placeholder={t.quick_problem.replace('{code}', nextLetterCode(items))} className="!w-64" />
          <Button onClick={createBlank}>{t.quick_create_draft}</Button>
        </div>
      ) : null}

      {mode === 'clone' ? (
        <div className="flex gap-2 mt-2 flex-wrap items-end">
          <Input label={t.quick_source_id} value={cloneId} onChange={(e) => setCloneId(e.target.value)} placeholder="prob_..." className="!w-48" />
          <Input label={t.quick_target} value={cloneTarget} onChange={(e) => setCloneTarget(e.target.value)} placeholder={String(contestId)} className="!w-40" />
          <Button variant="secondary" onClick={clone}>{t.quick_clone}</Button>
        </div>
      ) : null}

      {mode === 'zip' ? (
        <div className="mt-2 text-sm">
          <label className="text-sm">Polygon ZIP <input type="file" accept=".zip" className="block mt-1" onChange={() => toast(t.quick_zip_queued)} /></label>
          <p className="text-xs text-muted mt-1">{t.quick_zip_desc}</p>
        </div>
      ) : null}

      {mode === 'pdf' ? (
        <div className="mt-2 text-sm">
          <label className="text-sm">Athina PDFs <input type="file" accept=".pdf" multiple className="block mt-1" onChange={() => toast(t.quick_pdf_queued)} /></label>
          <p className="text-xs text-muted mt-1">{t.quick_pdf_desc}</p>
        </div>
      ) : null}

      {msg ? <p role="status" className="text-xs mt-2">{msg}</p> : null}
    </div>
  );
}
