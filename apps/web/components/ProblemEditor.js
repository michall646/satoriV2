// Problem editor — sectioned authoring: Statement, Samples, Tests, Limits, Settings, Danger.
// Polygon-lite. Same API surface as before, cleaner IA and honest states.
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, STR, getLang } from '../lib/client';
import { Badge, Button, DiffView, EmptyState, Input, Markdown, Segmented, Select, Skeleton, Textarea } from './ui';
import { toast } from './ui/Toast';
import EyebrowFx from './EyebrowFx';

const LANG_OPTIONS = [{ value: 'pl', label: 'PL' }, { value: 'en', label: 'EN' }];
const VIS_OPTIONS = [
  { value: 'draft', labelKey: 'mprob_vis_draft' }, { value: 'hidden', labelKey: 'mprob_vis_hidden' },
  { value: 'visible', labelKey: 'mprob_vis_visible' }, { value: 'quarantined', labelKey: 'mprob_vis_quarantined' },
];

function Sec({ title, hint, actions, children }) {
  return (
    <section className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="section-head">
        <h3 style={{ fontSize: 14, fontWeight: 650, letterSpacing: '-0.01em' }}>{title}</h3>
        {actions}
      </div>
      {hint ? <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function ProblemEditor({ problemId, contestId, full }) {
  const t = STR[getLang()];
  const router = useRouter();
  const [p, setP] = useState(null);
  const [tests, setTests] = useState([]);
  const [samples, setSamples] = useState([]);
  const [history, setHistory] = useState(null);
  const [prev, setPrev] = useState(null);
  const [lang, setLang] = useState('pl');
  const [busy, setBusy] = useState(false);
  const [confirmCode, setConfirmCode] = useState('');
  const [newGroup, setNewGroup] = useState({ name: '', checker: 'token' });
  const [openGroup, setOpenGroup] = useState(null);
  const [newCase, setNewCase] = useState({ name: '', input: '', expected: '' });

  useEffect(() => {
    api(`/api/problems/${problemId}`).then((d) => { setP(d); setSamples(d.samples || []); }).catch(() => setP(null));
    api(`/api/problems/${problemId}/tests`).then((d) => setTests(d.items || d.groups || [])).catch(() => setTests([]));
    api(`/api/problems/${problemId}/limitHistory`).then(setHistory).catch(() => setHistory(null));
    api(`/api/problems/${problemId}/versions`).then((d) => setPrev((d.items || [])[0] || null)).catch(() => { });
  }, [problemId]);

  if (p === null) return <EmptyState line={t.pedit_not_found} />;
  if (!p) return <Skeleton lines={5} />;

  async function save() {
    const body = { statementMd: p.statementMd, statementMdEn: p.statementMdEn, samples, limits: p.limits, visibility: p.visibility, aliasLetters: p.aliasLetters };
    setBusy(true);
    try {
      setP(await api(`/api/problems/${p.id}`, { method: 'PATCH', body: JSON.stringify(body) }));
      toast(t.pedit_saved, 'success');
    } catch (e) { toast(`${t.pedit_save_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function rejudge() {
    setBusy(true);
    try {
      const r = await api(`/api/problems/${p.id}/rejudge`, { method: 'POST', body: JSON.stringify({}) });
      toast(`${t.pedit_requeued} ${r.requeued ?? 0}.`, 'success');
    } catch (e) { toast(`${t.mprob_rejudge_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function quarantine() {
    setBusy(true);
    try {
      setP(await api(`/api/problems/${p.id}`, { method: 'PATCH', body: JSON.stringify({ visibility: 'quarantined', quarantineReason: t.mprob_reason_ph }) }));
      toast(t.pedit_quarantined, 'warn');
    } catch (e) { toast(`${t.pedit_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function addGroup() {
    if (!newGroup.name.trim()) { toast(t.pedit_group_name_req, 'warn'); return; }
    try {
      const r = await api(`/api/problems/${p.id}/tests`, { method: 'POST', body: JSON.stringify({ group: { problemId: p.id, name: newGroup.name.trim(), checker: newGroup.checker } }) });
      setTests((prevTests) => [...(prevTests || []), r]);
      setNewGroup({ name: '', checker: 'token' });
      toast(t.pedit_group_added, 'success');
    } catch (e) { toast(`${t.pedit_failed} ${e.message}`, 'danger'); }
  }

  async function addCase(groupId) {
    if (!newCase.name.trim()) { toast(t.pedit_case_name_req, 'warn'); return; }
    try {
      const group = (tests || []).find((g) => String(g.id) === String(groupId));
      await api(`/api/problems/${p.id}/tests`, { method: 'POST', body: JSON.stringify({ case: { groupId, name: newCase.name.trim(), input: newCase.input, expected: newCase.expected, checker: group?.checker || 'token' } }) });
      toast(t.pedit_case_added, 'success');
      setNewCase({ name: '', input: '', expected: '' });
      setOpenGroup(null);
      api(`/api/problems/${p.id}/tests`).then((d) => setTests(d.items || d.groups || [])).catch(() => { });
    } catch (e) { toast(`${t.pedit_failed} ${e.message}`, 'danger'); }
  }

  async function delTest(id) {
    try {
      await api(`/api/problems/${p.id}/tests/${id}`, { method: 'DELETE' });
      setTests((prevTests) => (prevTests || []).filter((t) => (t.id || t.name) !== id));
    } catch { toast(t.pedit_delete_unavailable, 'warn'); }
  }

  async function destroy() {
    if (confirmCode !== p.code) { toast(t.pedit_type_confirm.replace('{code}', p.code), 'warn'); return; }
    setBusy(true);
    try {
      await api(`/api/problems/${p.id}`, { method: 'DELETE' });
      toast(t.pedit_deleted, 'success');
      router.push(`/contests/${contestId || p.contestId}/manage/problems`);
    } catch (e) { toast(`${t.pedit_delete_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  function setLimit(patch) { setP({ ...p, limits: { ...p.limits, ...patch } }); }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="type-h2 flex items-center gap-2 flex-wrap">
            <span className="prob-code">{p.alias || p.code}</span>
            <span>{p.name}</span>
            <Badge>v{p.version}</Badge>
            <Badge tone={p.visibility === 'quarantined' ? 'danger' : p.visibility === 'visible' ? 'accent' : 'neutral'}>{p.visibility || 'visible'}</Badge>
          </h2>
          <p className="type-mono text-xs mt-1" style={{ color: 'var(--muted)' }}>{p.code}</p>
        </div>
        <Button onClick={save} disabled={busy}>{busy ? t.common_saving : t.common_save}</Button>
      </div>

      <Sec
        title={t.pedit_statement}
        hint={t.pedit_statement_hint}
        actions={<Segmented options={LANG_OPTIONS} value={lang} onChange={setLang} ariaLabel={t.pedit_statement_lang_aria} />}
      >
        <div className="grid lg:grid-cols-2 gap-3">
          <Textarea
            label={lang === 'pl' ? t.pedit_statement_pl : t.pedit_statement_en}
            value={(lang === 'pl' ? p.statementMd : p.statementMdEn) || ''}
            onChange={(e) => setP(lang === 'pl' ? { ...p, statementMd: e.target.value } : { ...p, statementMdEn: e.target.value })}
            rows={10}
          />
          <div className="rounded p-3 text-sm overflow-auto max-h-[280px]" style={{ border: '1px solid var(--border)', background: 'var(--bg)' }}>
            <EyebrowFx text={t.common_preview} as="span" />
            <div className="mt-1"><Markdown text={lang === 'pl' ? p.statementMd : p.statementMdEn} /></div>
          </div>
        </div>
        {prev?.statementMd ? (
          <div className="mt-3">
            <strong className="text-xs block mb-1">{t.pedit_version_diff}</strong>
            <DiffView expected={prev.statementMd} got={p.statementMd || ''} />
          </div>
        ) : null}
      </Sec>

      <Sec title={t.pedit_samples} hint={t.pedit_samples_hint}>
        <div className="flex flex-col gap-2">
          {samples.map((s, i) => (
            <div key={i} className="flex gap-2 items-end">
              <Input label={i === 0 ? t.pedit_input : null} value={s.input} onChange={(e) => setSamples(samples.map((x, j) => (j === i ? { ...x, input: e.target.value } : x)))} className="flex-1" />
              <Input label={i === 0 ? t.pedit_output : null} value={s.output} onChange={(e) => setSamples(samples.map((x, j) => (j === i ? { ...x, output: e.target.value } : x)))} className="flex-1" />
              <Button variant="secondary" onClick={() => setSamples(samples.filter((_, j) => j !== i))} aria-label={t.pedit_remove_sample}>×</Button>
            </div>
          ))}
          <div><Button variant="secondary" onClick={() => setSamples([...samples, { input: '', output: '' }])}>{t.pedit_add_sample}</Button></div>
        </div>
      </Sec>

      <Sec title={t.pedit_tests} hint={t.pedit_tests_hint}>
        <ul className="flex flex-col gap-1">
          {(Array.isArray(tests) ? tests : []).map((g) => (
            <li key={g.id || g.name} className="py-2 border-t" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm flex items-center gap-2 min-w-0">
                  <span className="prob-code text-xs">{g.group || g.name}</span>
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>{(g.cases || []).length} cases{g.checker ? ` · ${g.checker}` : ''}</span>
                </span>
                <span className="flex gap-1 shrink-0">
                  <Button variant="secondary" className="!py-0.5" onClick={() => setOpenGroup(openGroup === g.id ? null : g.id)}>{t.pedit_plus_case}</Button>
                  <Button variant="secondary" className="!py-0.5" onClick={() => delTest(g.id || g.name)}>{t.common_delete}</Button>
                </span>
              </div>
              {openGroup === g.id ? (
                <div className="mt-2 rounded p-3" style={{ border: '1px solid var(--border)', background: 'var(--bg)' }}>
                  <div className="flex gap-2 items-end flex-wrap">
                    <Input label={t.mset_name} value={newCase.name} onChange={(e) => setNewCase({ ...newCase, name: e.target.value })} className="!w-32" />
                    <Input label={t.pedit_input} value={newCase.input} onChange={(e) => setNewCase({ ...newCase, input: e.target.value })} className="flex-1 !min-w-[8rem]" />
                    <Input label={t.ui_expected} value={newCase.expected} onChange={(e) => setNewCase({ ...newCase, expected: e.target.value })} className="flex-1 !min-w-[8rem]" />
                    <Button onClick={() => addCase(g.id)}>{t.pedit_add_case}</Button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
          {!(Array.isArray(tests) && tests.length) ? <li className="text-sm" style={{ color: 'var(--muted)' }}>{t.pedit_no_groups}</li> : null}
        </ul>
        <div className="flex gap-2 items-end flex-wrap mt-3">
          <Input label={t.pedit_new_group} value={newGroup.name} onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })} placeholder="g1" className="!w-40" />
          <Select label="Checker" value={newGroup.checker} onChange={(e) => setNewGroup({ ...newGroup, checker: e.target.value })} className="!w-40">
            <option value="token">token</option><option value="float">float</option><option value="custom">custom</option>
          </Select>
          <Button variant="secondary" onClick={addGroup}>{t.pedit_add_group}</Button>
        </div>
      </Sec>

      <Sec title={t.pedit_limits} hint={t.pedit_limits_hint}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Input label={t.pedit_time_ms} type="number" value={p.limits?.timeMs ?? 1000} onChange={(e) => setLimit({ timeMs: Number(e.target.value) })} />
          <Input label={t.pedit_memory} type="number" value={p.limits?.memoryMb ?? 256} onChange={(e) => setLimit({ memoryMb: Number(e.target.value) })} />
          <Input label={t.pedit_stack} type="number" value={p.limits?.stackMb ?? 64} onChange={(e) => setLimit({ stackMb: Number(e.target.value) })} />
          <Input label="Python ×" type="number" value={p.limits?.perLang?.python ?? 2} onChange={(e) => setLimit({ perLang: { ...(p.limits?.perLang || {}), python: Number(e.target.value) } })} />
        </div>
        {history?.length ? (
          <p className="type-mono text-xs mt-2" style={{ color: 'var(--muted)' }}>{t.pedit_history} {history.map((h) => `${new Date(h.at).toLocaleDateString()} → ${h.timeMs ?? h.to?.timeMs}ms`).join(' · ')}</p>
        ) : null}
      </Sec>

      <Sec title={t.pedit_publishing} hint={t.pedit_publishing_hint}>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <span className="block font-medium mb-1" style={{ fontSize: 13 }}>{t.pedit_visibility}</span>
            <Segmented options={VIS_OPTIONS.map((o) => ({ ...o, label: t[o.labelKey] }))} value={p.visibility || 'visible'} onChange={(v) => setP({ ...p, visibility: v })} ariaLabel="visibility" />
          </div>
          <Input label={t.pedit_alias_letter} value={p.aliasLetters?.[contestId] || p.alias || ''} onChange={(e) => setP({ ...p, aliasLetters: { ...(p.aliasLetters || {}), [contestId || p.contestId]: e.target.value } })} className="!w-40" />
        </div>
      </Sec>

      {full ? (
        <section className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--wa-line)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 650, color: 'var(--wa-text)' }}>{t.pedit_danger}</h3>
          <div className="flex gap-2 mt-3 flex-wrap">
            <Button variant="secondary" onClick={rejudge} disabled={busy}>{t.pedit_rejudge_all}</Button>
            <Button variant="secondary" onClick={quarantine} disabled={busy}>{t.pedit_quarantine_btn}</Button>
          </div>
          <div className="mt-3 flex gap-2 items-end flex-wrap">
            <Input label={t.pedit_type_delete.replace('{code}', p.code)} value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} className="!w-56" />
            <Button variant="danger" onClick={destroy} disabled={busy || confirmCode !== p.code}>{t.pedit_delete_problem}</Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default ProblemEditor;
