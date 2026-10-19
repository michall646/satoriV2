// Problem editor — sectioned authoring: Statement, Samples, Tests, Limits, Settings, Danger.
// Polygon-lite. Test manager: inline group points/checker, multi-line case editor,
// real edit/delete, JSON import/export, limit history and version diff.
'use client';
import { useEffect, useRef, useState } from 'react';
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
const CHECKER_OPTIONS = ['token', 'float', 'custom'];
const CHECKER_LANGS = ['C', 'C++17', 'Python', 'JavaScript', 'Java', 'Rust'];
const PER_LANG = ['C', 'C++17', 'Python', 'JavaScript', 'Java', 'Rust'];
const EXT_LANG = { c: 'C', cpp: 'C++17', cc: 'C++17', cxx: 'C++17', py: 'Python', js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', java: 'Java', rs: 'Rust' };

function langFromFile(file) {
  const ext = String(file || '').split('.').pop().toLowerCase();
  return EXT_LANG[ext] || '';
}
function groupDraft(g) {
  let checker = g.checker || 'token';
  let tolerance = g.checkerTolerance ?? '';
  const m = String(checker).match(/^float\s*[:(]\s*([0-9.eE+-]+)\s*\)?$/i);
  if (m) { checker = 'float'; tolerance = m[1]; }
  return {
    name: g.name || '',
    points: g.points ?? 100,
    checker,
    checkerTolerance: tolerance,
    checkerLang: g.checkerLang || langFromFile(g.checkerFile) || 'JavaScript',
    checkerCode: g.checkerCode || '',
  };
}
function isoToLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localToIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function limitsLine(limits) {
  if (!limits) return '—';
  const ms = limits.timeMs == null ? '?' : limits.timeMs;
  const mb = limits.memoryMb == null ? '?' : limits.memoryMb;
  return `${ms} ms / ${mb} MB`;
}

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
  const lbl = (pl, en) => (getLang() === 'pl' ? pl : en);
  const router = useRouter();
  const [p, setP] = useState(null);
  const [tests, setTests] = useState([]);
  const [samples, setSamples] = useState([]);
  const [history, setHistory] = useState([]);
  const [versions, setVersions] = useState([]);
  const [sets, setSets] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [lang, setLang] = useState('pl');
  const [busy, setBusy] = useState(false);
  const [confirmCode, setConfirmCode] = useState('');
  const [newGroup, setNewGroup] = useState({ name: '', points: 100, checker: 'token' });
  const [openGroup, setOpenGroup] = useState(null);
  const [newCase, setNewCase] = useState({ name: '', input: '', expected: '' });
  const [editCase, setEditCase] = useState(null);
  // C5 authoring: validator + reference solution drafts and their real results.
  const [vDraft, setVDraft] = useState({ lang: 'JavaScript', code: '', file: '' });
  const [vResults, setVResults] = useState(null);
  const [vBusy, setVBusy] = useState(false);
  const [rDraft, setRDraft] = useState({ lang: 'JavaScript', code: '' });
  const [rResults, setRResults] = useState(null);
  const [rBusy, setRBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const fileRef = useRef(null);

  function applyTests(items) {
    const list = Array.isArray(items) ? items : [];
    setTests(list);
    const next = {};
    for (const g of list) next[g.id] = groupDraft(g);
    setDrafts(next);
  }

  function loadTests() {
    return api(`/api/problems/${problemId}/tests`)
      .then((d) => applyTests(d.items || d.groups || []))
      .catch(() => applyTests([]));
  }

  function loadHistory() {
    return api(`/api/problems/${problemId}/limitHistory`)
      .then((d) => setHistory(Array.isArray(d) ? d : (d.items || [])))
      .catch(() => setHistory([]));
  }

  function loadVersions() {
    return api(`/api/problems/${problemId}/versions`)
      .then((d) => setVersions(d.items || []))
      .catch(() => setVersions([]));
  }

  useEffect(() => {
    api(`/api/problems/${problemId}`).then((d) => {
      setP(d);
      setSamples(d.samples || []);
      setVDraft({ lang: d.validatorLang || langFromFile(d.validatorFile) || 'JavaScript', code: d.validatorCode || '', file: d.validatorFile || '' });
      setRDraft({ lang: d.referenceLang || 'JavaScript', code: d.referenceCode || '' });
      const cid = contestId || d.contestId;
      if (cid) {
        api(`/api/contests/${cid}/problems?all=1`)
          .then((c) => setSets(c.sets || []))
          .catch(() => setSets([]));
      }
    }).catch(() => setP(null));
    loadTests();
    loadHistory();
    loadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemId, contestId]);

  if (p === null) return <EmptyState line={t.pedit_not_found} />;
  if (!p) return <Skeleton lines={5} />;

  const prevVersion = versions[0] || null;
  const prevSnapshot = prevVersion ? (prevVersion.snapshot || prevVersion) : null;

  async function save() {
    const body = {
      name: p.name,
      code: p.code,
      tags: Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(',').map((x) => x.trim()).filter(Boolean),
      difficulty: Number(p.difficulty) || 0,
      deadlineAt: p.deadlineAt || null,
      setId: p.setId || null,
      statementMd: p.statementMd,
      statementMdEn: p.statementMdEn,
      samples,
      limits: p.limits,
      visibility: p.visibility,
      aliasLetters: p.aliasLetters || {},
      // C5: authoring programs are saved with the problem; running them below
      // uses the drafts directly, so a teacher can test before saving.
      validator: vDraft.code.trim() ? (p.validator || 'custom') : '',
      validatorLang: vDraft.lang || null,
      validatorCode: vDraft.code,
      validatorFile: vDraft.file || null,
      referenceLang: rDraft.lang || null,
      referenceCode: rDraft.code,
    };
    setBusy(true);
    try {
      setP(await api(`/api/problems/${p.id}`, { method: 'PATCH', body: JSON.stringify(body) }));
      toast(t.pedit_saved, 'success');
      loadHistory();
      loadVersions();
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

  async function runValidator() {
    if (!vDraft.code.trim()) { toast(lbl('Walidator nie ma kodu.', 'The validator has no code.'), 'warn'); return; }
    setVBusy(true);
    setVResults(null);
    try {
      const r = await api(`/api/problems/${p.id}/validators/run`, {
        method: 'POST',
        body: JSON.stringify({
          validator: 'custom',
          validatorLang: vDraft.lang,
          validatorCode: vDraft.code,
          validatorFile: vDraft.file,
        }),
      });
      setVResults(r);
      if (r.compileLog) toast(lbl('Walidator nie skompilował się.', 'The validator did not compile.'), 'danger');
      else if (r.ok) toast(lbl('Walidator: wszystkie wejścia poprawne.', 'Validator: every input is valid.'), 'success');
      else toast(lbl('Walidator odrzucił część wejść.', 'Validator rejected some inputs.'), 'danger');
    } catch (e) {
      toast(`${t.pedit_failed} ${e.message}`, 'danger');
    } finally {
      setVBusy(false);
    }
  }

  async function runReference() {
    if (!rDraft.code.trim()) { toast(lbl('Rozwiązanie wzorcowe nie ma kodu.', 'The reference solution has no code.'), 'warn'); return; }
    setRBusy(true);
    setRResults(null);
    try {
      const r = await api(`/api/problems/${p.id}/reference/run`, {
        method: 'POST',
        body: JSON.stringify({ referenceLang: rDraft.lang, referenceCode: rDraft.code }),
      });
      setRResults(r);
      if (r.compileLog && !r.cases?.length) toast(lbl('Rozwiązanie wzorcowe nie skompilowało się.', 'The reference solution did not compile.'), 'danger');
      else if (r.ok) toast(lbl('Rozwiązanie wzorcowe przechodzi wszystkie przypadki.', 'The reference solution passes every case.'), 'success');
      else toast(lbl('Rozwiązanie wzorcowe nie przechodzi wszystkich przypadków.', 'The reference solution does not pass every case.'), 'danger');
    } catch (e) {
      toast(`${t.pedit_failed} ${e.message}`, 'danger');
    } finally {
      setRBusy(false);
    }
  }

  async function generateExpected() {
    if (!rDraft.code.trim()) { toast(lbl('Najpierw dodaj rozwiązanie wzorcowe.', 'Add the reference solution first.'), 'warn'); return; }
    const ok = window.confirm(lbl(
      'Uzupełnić oczekiwane wyjścia tylko dla pustych przypadków? Istniejące oczekiwane wyjścia nie zostaną nadpisane.',
      'Fill expected outputs only for empty cases? Existing expected outputs will not be overwritten.'
    ));
    if (!ok) return;
    setGenBusy(true);
    try {
      const r = await api(`/api/problems/${p.id}/reference/generate`, {
        method: 'POST',
        body: JSON.stringify({ referenceLang: rDraft.lang, referenceCode: rDraft.code, overwrite: false }),
      });
      setRResults(r);
      if (r.compileLog) toast(lbl('Rozwiązanie wzorcowe nie skompilowało się.', 'The reference solution did not compile.'), 'danger');
      else toast(lbl(`Uzupełniono ${r.changed ?? 0} z ${r.considered ?? 0} pustych przypadków.`, `Filled ${r.changed ?? 0} of ${r.considered ?? 0} empty cases.`), r.ok ? 'success' : 'warn');
      await loadTests();
    } catch (e) {
      toast(`${t.pedit_failed} ${e.message}`, 'danger');
    } finally {
      setGenBusy(false);
    }
  }

  function setDraft(gid, patch) {
    setDrafts((prev) => ({ ...prev, [gid]: { ...(prev[gid] || {}), ...patch } }));
  }

  async function addGroup() {
    if (!newGroup.name.trim()) { toast(t.pedit_group_name_req, 'warn'); return; }
    try {
      await api(`/api/problems/${p.id}/tests`, {
        method: 'POST',
        body: JSON.stringify({ group: { problemId: p.id, name: newGroup.name.trim(), points: Number(newGroup.points) || 0, checker: newGroup.checker } }),
      });
      setNewGroup({ name: '', points: 100, checker: 'token' });
      toast(t.pedit_group_added, 'success');
      await loadTests();
    } catch (e) { toast(`${t.pedit_failed} ${e.message}`, 'danger'); }
  }

  async function saveGroup(gid) {
    const d = drafts[gid];
    if (!d) return;
    if (!String(d.name || '').trim()) { toast(t.pedit_group_name_req, 'warn'); return; }
    const body = {
      name: String(d.name).trim(),
      points: Number(d.points) || 0,
      checker: d.checker,
      checkerTolerance: d.checker === 'float' && d.checkerTolerance !== '' ? Number(d.checkerTolerance) : undefined,
      checkerLang: d.checker === 'custom' ? d.checkerLang : undefined,
      checkerCode: d.checker === 'custom' ? d.checkerCode : undefined,
    };
    setBusy(true);
    try {
      const r = await api(`/api/problems/${p.id}/tests/groups/${gid}`, { method: 'PATCH', body: JSON.stringify(body) });
      setTests((prev) => prev.map((g) => (String(g.id) === String(gid) ? { ...g, ...r } : g)));
      toast(t.pedit_saved, 'success');
    } catch (e) { toast(`${t.pedit_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function addCase(groupId) {
    if (!newCase.name.trim()) { toast(t.pedit_case_name_req, 'warn'); return; }
    try {
      // No case-level checker: the case inherits the group checker dynamically.
      await api(`/api/problems/${p.id}/tests`, {
        method: 'POST',
        body: JSON.stringify({ case: { groupId, name: newCase.name.trim(), input: newCase.input, expected: newCase.expected } }),
      });
      setNewCase({ name: '', input: '', expected: '' });
      toast(t.pedit_case_added, 'success');
      await loadTests();
    } catch (e) { toast(`${t.pedit_failed} ${e.message}`, 'danger'); }
  }

  async function saveCase() {
    if (!editCase) return;
    const body = {
      name: editCase.name,
      input: editCase.input,
      expected: editCase.expected,
      checker: editCase.checker,
    };
    if (editCase.timeMs !== '' && editCase.timeMs != null) body.timeMs = Number(editCase.timeMs);
    if (editCase.memoryMb !== '' && editCase.memoryMb != null) body.memoryMb = Number(editCase.memoryMb);
    setBusy(true);
    try {
      await api(`/api/problems/${p.id}/tests/cases/${editCase.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast(t.pedit_saved, 'success');
      setEditCase(null);
      await loadTests();
    } catch (e) { toast(`${t.pedit_failed} ${e.message}`, 'danger'); }
    finally { setBusy(false); }
  }

  async function delCase(caseId) {
    try {
      await api(`/api/problems/${p.id}/tests/cases/${caseId}`, { method: 'DELETE' });
      if (editCase && String(editCase.id) === String(caseId)) setEditCase(null);
      toast(t.pedit_deleted, 'success');
      await loadTests();
    } catch (e) { toast(`${t.pedit_delete_failed} ${e.message}`, 'danger'); }
  }

  async function delGroup(gid) {
    try {
      await api(`/api/problems/${p.id}/tests/${gid}`, { method: 'DELETE' });
      toast(t.pedit_deleted, 'success');
      await loadTests();
    } catch (e) { toast(`${t.pedit_delete_failed} ${e.message}`, 'danger'); }
  }

  async function exportTests() {
    try {
      const bundle = await api(`/api/problems/${p.id}/tests/export`);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${p.code || 'problem'}-tests.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) { toast(`${t.pedit_failed} ${e.message}`, 'danger'); }
  }

  async function importTests(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text());
      const r = await api(`/api/problems/${p.id}/tests/import`, { method: 'POST', body: JSON.stringify(bundle) });
      toast(lbl(`Zaimportowano ${r.imported?.groups ?? 0} grup / ${r.imported?.cases ?? 0} przypadków.`, `Imported ${r.imported?.groups ?? 0} groups / ${r.imported?.cases ?? 0} cases.`), 'success');
      await loadTests();
    } catch (e) { toast(`${t.pedit_failed} ${e.message}`, 'danger'); }
    finally { event.target.value = ''; }
  }

  function setLimit(patch) { setP({ ...p, limits: { ...p.limits, ...patch } }); }

  function setPerLang(langKey, value) {
    const perLang = { ...(p.limits?.perLang || {}) };
    if (value === '') delete perLang[langKey];
    else perLang[langKey] = Number(value);
    // D12: drop the legacy lowercase alias once the canonical key is written.
    if (langKey === 'Python') delete perLang.python;
    setLimit({ perLang });
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

      <Sec title={lbl('Pola zadania', 'Problem fields')} hint={lbl('Nazwa, kod, tagi, trudność, termin i zestaw. Zapis tworzy wersję przy zmianie treści.', 'Name, code, tags, difficulty, deadline and set. A content change creates a version snapshot.')}>
        <div className="grid md:grid-cols-2 gap-3">
          <Input label={t.mset_name} value={p.name || ''} onChange={(e) => setP({ ...p, name: e.target.value })} />
          <Input label={lbl('Kod', 'Code')} value={p.code || ''} onChange={(e) => setP({ ...p, code: e.target.value })} className="!w-32" />
          <Input
            label={lbl('Tagi (oddzielone przecinkami)', 'Tags (comma separated)')}
            value={Array.isArray(p.tags) ? p.tags.join(', ') : (p.tags || '')}
            onChange={(e) => setP({ ...p, tags: e.target.value })}
          />
          <Input label={lbl('Trudność', 'Difficulty')} type="number" min="0" value={p.difficulty ?? 1} onChange={(e) => setP({ ...p, difficulty: Number(e.target.value) })} />
          <Input label={lbl('Termin', 'Deadline')} type="datetime-local" value={isoToLocal(p.deadlineAt)} onChange={(e) => setP({ ...p, deadlineAt: localToIso(e.target.value) })} />
          <Select label={lbl('Zestaw', 'Problem set')} value={p.setId == null ? '' : String(p.setId)} onChange={(e) => setP({ ...p, setId: e.target.value || null })}>
            <option value="">{lbl('— bez zestawu —', '— no set —')}</option>
            {sets.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </Select>
        </div>
      </Sec>

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
        {prevSnapshot ? (
          <div className="mt-3">
            <strong className="text-xs block mb-1">{t.pedit_version_diff} · v{prevVersion.version}</strong>
            <DiffView expected={prevSnapshot.statementMd || ''} got={p.statementMd || ''} />
          </div>
        ) : null}
      </Sec>

      <Sec title={t.pedit_samples} hint={t.pedit_samples_hint}>
        <div className="flex flex-col gap-2">
          {samples.map((s, i) => (
            <div key={i} className="flex gap-2 items-end flex-wrap">
              <Textarea label={i === 0 ? t.pedit_input : null} rows={3} value={s.input ?? ''} onChange={(e) => setSamples(samples.map((x, j) => (j === i ? { ...x, input: e.target.value } : x)))} className="flex-1 !min-w-[12rem]" />
              <Textarea label={i === 0 ? t.pedit_output : null} rows={3} value={s.output ?? ''} onChange={(e) => setSamples(samples.map((x, j) => (j === i ? { ...x, output: e.target.value } : x)))} className="flex-1 !min-w-[12rem]" />
              <Button variant="secondary" onClick={() => setSamples(samples.filter((_, j) => j !== i))} aria-label={t.pedit_remove_sample}>×</Button>
            </div>
          ))}
          <div><Button variant="secondary" onClick={() => setSamples([...samples, { input: '', output: '' }])}>{t.pedit_add_sample}</Button></div>
        </div>
      </Sec>

      <Sec
        title={t.pedit_tests}
        hint={lbl('Grupy/subzadania: punkty, checker i własny program. Przypadki mają wieloliniowe wejście/wyjście. Import/eksport to JSON (bez ZIP).', 'Groups/subtasks: points, checker and a real checker program. Cases have multi-line input/expected. Import/export is JSON (no ZIP).')}
        actions={(
          <span className="flex gap-1">
            <Button variant="secondary" onClick={exportTests}>{lbl('Eksport JSON', 'Export JSON')}</Button>
            <Button variant="secondary" onClick={() => fileRef.current && fileRef.current.click()}>{lbl('Import JSON', 'Import JSON')}</Button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={importTests} aria-label={lbl('Import testów JSON', 'Import tests JSON')} />
          </span>
        )}
      >
        <ul className="flex flex-col gap-1">
          {(Array.isArray(tests) ? tests : []).map((g) => {
            const d = drafts[g.id] || groupDraft(g);
            const cases = Array.isArray(g.cases) ? g.cases : [];
            return (
              <li key={g.id || g.name} className="py-2 border-t" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm flex items-center gap-2 min-w-0">
                    <span className="prob-code text-xs">{g.id != null ? `#${g.id}` : g.name}</span>
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>{cases.length} {lbl('przypadków', 'cases')} · {d.points} {lbl('pkt', 'pts')} · {d.checker}</span>
                  </span>
                  <span className="flex gap-1 shrink-0">
                    <Button variant="secondary" className="!py-0.5" onClick={() => setOpenGroup(openGroup === g.id ? null : g.id)}>{t.pedit_plus_case}</Button>
                    <Button variant="secondary" className="!py-0.5" onClick={() => delGroup(g.id || g.name)} disabled={busy}>{t.common_delete}</Button>
                  </span>
                </div>

                {openGroup === g.id ? (
                  <div className="mt-2 rounded p-3 flex flex-col gap-3" style={{ border: '1px solid var(--border)', background: 'var(--bg)' }}>
                    <div className="grid md:grid-cols-4 gap-2 items-end">
                      <Input label={t.mset_name} value={d.name} onChange={(e) => setDraft(g.id, { name: e.target.value })} />
                      <Input label={lbl('Punkty grupy', 'Group points')} type="number" min="0" value={d.points} onChange={(e) => setDraft(g.id, { points: e.target.value })} className="!w-28" />
                      <Select label="Checker" value={d.checker} onChange={(e) => setDraft(g.id, { checker: e.target.value })}>
                        {CHECKER_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </Select>
                      {d.checker === 'float' ? (
                        <Input label={lbl('Tolerancja', 'Tolerance')} value={d.checkerTolerance} placeholder="1e-6" onChange={(e) => setDraft(g.id, { checkerTolerance: e.target.value })} className="!w-32" />
                      ) : null}
                    </div>
                    {d.checker === 'custom' ? (
                      <div className="flex flex-col gap-2">
                        <Select label={lbl('Język checkera', 'Checker language')} value={d.checkerLang} onChange={(e) => setDraft(g.id, { checkerLang: e.target.value })} className="!w-44">
                          {CHECKER_LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
                        </Select>
                        <Textarea
                          label={lbl('Kod checkera', 'Checker code')}
                          hint={lbl('Kontrakt: checker input.txt expected.txt output.txt — 0 = OK, 1 = WA, inny kod = błąd checkera.', 'Contract: checker input.txt expected.txt output.txt — exit 0 = OK, 1 = WA, any other exit = checker error.')}
                          rows={7}
                          value={d.checkerCode}
                          onChange={(e) => setDraft(g.id, { checkerCode: e.target.value })}
                        />
                      </div>
                    ) : null}
                    <div>
                      <Button variant="secondary" onClick={() => saveGroup(g.id)} disabled={busy}>{lbl('Zapisz grupę', 'Save group')}</Button>
                    </div>

                    <div className="flex flex-col gap-2">
                      <strong className="text-xs">{lbl('Przypadki', 'Cases')}</strong>
                      {cases.map((c, idx) => (
                        <div key={c.id} className="text-sm">
                          {editCase && String(editCase.id) === String(c.id) ? (
                            <div className="rounded p-2 flex flex-col gap-2" style={{ border: '1px solid var(--border)' }}>
                              <div className="flex gap-2 items-end flex-wrap">
                                <Input label={t.mset_name} value={editCase.name} onChange={(e) => setEditCase({ ...editCase, name: e.target.value })} className="!w-40" />
                                <Input label={lbl('Checker (puste = grupa)', 'Checker (empty = group)')} value={editCase.checker || ''} onChange={(e) => setEditCase({ ...editCase, checker: e.target.value })} className="!w-44" />
                                <Input label={lbl('Czas (ms)', 'Time (ms)')} type="number" value={editCase.timeMs ?? ''} onChange={(e) => setEditCase({ ...editCase, timeMs: e.target.value })} className="!w-28" />
                                <Input label={lbl('Pamięć (MB)', 'Memory (MB)')} type="number" value={editCase.memoryMb ?? ''} onChange={(e) => setEditCase({ ...editCase, memoryMb: e.target.value })} className="!w-28" />
                              </div>
                              <Textarea label={t.pedit_input} rows={4} value={editCase.input ?? ''} onChange={(e) => setEditCase({ ...editCase, input: e.target.value })} />
                              <Textarea label={t.pedit_output} rows={4} value={editCase.expected ?? ''} onChange={(e) => setEditCase({ ...editCase, expected: e.target.value })} />
                              <div className="flex gap-1">
                                <Button onClick={saveCase} disabled={busy}>{t.common_save}</Button>
                                <Button variant="secondary" onClick={() => setEditCase(null)}>{lbl('Anuluj', 'Cancel')}</Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-2 py-1">
                              <span className="min-w-0 flex items-center gap-2">
                                <span className="prob-code text-xs">{idx + 1}</span>
                                <span className="text-xs" style={{ color: 'var(--muted)' }}>{c.name || '—'} · {c.checker || lbl('dziedziczy', 'inherit')}{c.timeMs ? ` · ${c.timeMs}ms` : ''}</span>
                              </span>
                              <span className="flex gap-1 shrink-0">
                                <Button variant="secondary" className="!py-0.5" onClick={() => setEditCase({ id: c.id, groupId: g.id, name: c.name || '', input: c.input ?? '', expected: c.expected ?? '', checker: c.checker || '', timeMs: c.timeMs ?? '', memoryMb: c.memoryMb ?? '' })}>{t.common_edit || lbl('Edytuj', 'Edit')}</Button>
                                <Button variant="secondary" className="!py-0.5" onClick={() => delCase(c.id)} disabled={busy}>{t.common_delete}</Button>
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                      <div className="rounded p-2 flex flex-col gap-2 mt-1" style={{ border: '1px dashed var(--border)' }}>
                        <Input label={t.mset_name} value={newCase.name} onChange={(e) => setNewCase({ ...newCase, name: e.target.value })} className="!w-40" />
                        <Textarea label={t.pedit_input} rows={3} value={newCase.input} onChange={(e) => setNewCase({ ...newCase, input: e.target.value })} />
                        <Textarea label={t.pedit_output} rows={3} value={newCase.expected} onChange={(e) => setNewCase({ ...newCase, expected: e.target.value })} />
                        <div><Button onClick={() => addCase(g.id)} disabled={busy}>{t.pedit_add_case}</Button></div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
          {!(Array.isArray(tests) && tests.length) ? <li className="text-sm" style={{ color: 'var(--muted)' }}>{t.pedit_no_groups}</li> : null}
        </ul>

        <div className="flex gap-2 items-end flex-wrap mt-3">
          <Input label={t.pedit_new_group} value={newGroup.name} onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })} placeholder="g1" className="!w-40" />
          <Input label={lbl('Punkty', 'Points')} type="number" min="0" value={newGroup.points} onChange={(e) => setNewGroup({ ...newGroup, points: e.target.value })} className="!w-28" />
          <Select label="Checker" value={newGroup.checker} onChange={(e) => setNewGroup({ ...newGroup, checker: e.target.value })} className="!w-40">
            {CHECKER_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Button variant="secondary" onClick={addGroup}>{t.pedit_add_group}</Button>
        </div>
      </Sec>

      <Sec
        title={lbl('Walidator testów', 'Test validator')}
        hint={lbl(
          'Program sprawdza wejście każdego przypadku. Kontrakt: ścieżka pliku wejściowego jako pierwszy argument (JS: process.argv[2], Python: sys.argv[1], C/C++: argv[1]); wejście trafia też na stdin. Kod 0 = poprawne, 1 = niepoprawne, inny = błąd walidatora. Limit 2 s. „Uruchom” używa kodu powyżej od razu; zapis utrwala go w zadaniu.',
          'Checks every case input. Contract: input file path as the first argument (JS: process.argv[2], Python: sys.argv[1], C/C++: argv[1]); the input is also piped on stdin. Exit 0 = valid, 1 = invalid, any other exit = validator error. 2s timeout. "Run" uses the code above immediately; Save persists it on the problem.'
        )}
      >
        <div className="grid md:grid-cols-2 gap-3">
          <Select label={lbl('Język walidatora', 'Validator language')} value={vDraft.lang} onChange={(e) => setVDraft({ ...vDraft, lang: e.target.value })}>
            {CHECKER_LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
          <Input label={lbl('Plik (opcjonalnie, wykrywa język)', 'File (optional, infers language)')} value={vDraft.file} onChange={(e) => setVDraft({ ...vDraft, file: e.target.value })} placeholder="validator.js" />
        </div>
        <Textarea label={lbl('Kod walidatora', 'Validator code')} rows={7} value={vDraft.code} onChange={(e) => setVDraft({ ...vDraft, code: e.target.value })} />
        <div className="mt-2 flex gap-2 flex-wrap">
          <Button variant="secondary" onClick={runValidator} disabled={vBusy}>{vBusy ? t.common_saving : lbl('Uruchom walidator', 'Run validator')}</Button>
        </div>
        {vResults ? (
          <div className="mt-3">
            {vResults.compileLog ? (
              <pre className="type-mono text-xs p-2 rounded overflow-auto max-h-40" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>{vResults.compileLog}</pre>
            ) : null}
            <div className="overflow-auto" style={{ maxWidth: '100%' }}>
              <table className="w-full text-xs mt-2 type-mono">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>#</th>
                    <th style={{ textAlign: 'left' }}>{lbl('Przypadek', 'Case')}</th>
                    <th style={{ textAlign: 'left' }}>{lbl('Wynik', 'Result')}</th>
                    <th style={{ textAlign: 'left' }}>{lbl('Komunikat', 'Message')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(vResults.cases || []).map((c) => (
                    <tr key={c.caseId}>
                      <td>{c.n}</td>
                      <td>{c.caseName || `#${c.caseId}`}</td>
                      <td><Badge tone={c.valid ? 'accent' : 'danger'}>{c.valid ? 'VALID' : 'INVALID'}</Badge></td>
                      <td>{c.message || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!(vResults.cases || []).length ? <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{lbl('Brak przypadków do sprawdzenia.', 'No cases to validate.')}</p> : null}
          </div>
        ) : null}
      </Sec>

      <Sec
        title={lbl('Rozwiązanie wzorcowe', 'Reference solution')}
        hint={lbl(
          'Wzorzec uruchamiany na każdym wejściu z checkerem problemu/grupy. „Generuj brakujące oczekiwane” wypełnia tylko puste expected — nigdy nie nadpisuje istniejących. Zapis utrwala kod w zadaniu.',
          'Runs on every case input with the problem/group checker. "Generate missing expected" fills only empty expected values — it never overwrites existing ones. Save persists the code on the problem.'
        )}
      >
        <div className="grid md:grid-cols-2 gap-3">
          <Select label={lbl('Język wzorca', 'Reference language')} value={rDraft.lang} onChange={(e) => setRDraft({ ...rDraft, lang: e.target.value })}>
            {CHECKER_LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
        </div>
        <Textarea label={lbl('Kod rozwiązania wzorcowego', 'Reference solution code')} rows={7} value={rDraft.code} onChange={(e) => setRDraft({ ...rDraft, code: e.target.value })} />
        <div className="mt-2 flex gap-2 flex-wrap">
          <Button onClick={runReference} disabled={rBusy}>{rBusy ? t.common_saving : lbl('Uruchom wzorzec', 'Run reference')}</Button>
          <Button variant="secondary" onClick={generateExpected} disabled={genBusy}>{genBusy ? t.common_saving : lbl('Generuj brakujące oczekiwane', 'Generate missing expected')}</Button>
        </div>
        {rResults ? (
          <div className="mt-3">
            {rResults.compileLog ? (
              <pre className="type-mono text-xs p-2 rounded overflow-auto max-h-40" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>{rResults.compileLog}</pre>
            ) : null}
            {rResults.message ? <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{rResults.message}</p> : null}
            {rResults.changed != null ? (
              <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                {lbl(`Uzupełniono ${rResults.changed} z ${rResults.considered ?? 0} pustych przypadków.`, `Filled ${rResults.changed} of ${rResults.considered ?? 0} empty cases.`)}
              </p>
            ) : null}
            {(rResults.cases || []).length ? (
              <div className="overflow-auto" style={{ maxWidth: '100%' }}>
                <table className="w-full text-xs mt-2 type-mono">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>#</th>
                      <th style={{ textAlign: 'left' }}>{lbl('Przypadek', 'Case')}</th>
                      <th style={{ textAlign: 'left' }}>{lbl('Werdykt', 'Verdict')}</th>
                      <th style={{ textAlign: 'left' }}>{lbl('Czas', 'Time')}</th>
                      <th style={{ textAlign: 'left' }}>{lbl('Komunikat', 'Message')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(rResults.cases || []).map((c) => (
                      <tr key={c.caseId}>
                        <td>{c.n}</td>
                        <td>{c.caseName || `#${c.caseId}`}</td>
                        <td><Badge tone={c.verdict === 'OK' ? 'accent' : 'danger'}>{c.verdict}</Badge></td>
                        <td>{c.timeMs != null ? `${c.timeMs} ms` : '—'}</td>
                        <td>{c.message || (c.changed ? lbl('wypełniono', 'filled') : '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {rResults.firstDiff ? (
              <div className="mt-3">
                <strong className="text-xs block mb-1">
                  {lbl('Pierwsza różnica', 'First diff')} · #{rResults.firstDiff.n} {rResults.firstDiff.caseName || ''}
                </strong>
                {rResults.firstDiff.verdict === 'WA' || rResults.firstDiff.verdict === 'CHECKER_ERROR' ? (
                  <DiffView expected={rResults.firstDiff.expected || ''} got={rResults.firstDiff.got || ''} />
                ) : (
                  <pre className="type-mono text-xs p-2 rounded overflow-auto" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>{rResults.firstDiff.message || rResults.firstDiff.verdict}</pre>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </Sec>

      <Sec title={t.pedit_limits} hint={lbl('Jawne limity. Limity per język to bezwzględne milisekundy (D6).', 'Explicit limits. Per-language limits are absolute milliseconds (D6).')}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Input label={t.pedit_time_ms} type="number" value={p.limits?.timeMs ?? 1000} onChange={(e) => setLimit({ timeMs: Number(e.target.value) })} />
          <Input label={t.pedit_memory} type="number" value={p.limits?.memoryMb ?? 256} onChange={(e) => setLimit({ memoryMb: Number(e.target.value) })} />
          <Input label={t.pedit_stack} type="number" value={p.limits?.stackMb ?? 64} onChange={(e) => setLimit({ stackMb: Number(e.target.value) })} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
          {PER_LANG.map((l) => (
            <Input
              key={l}
              label={`${l} (ms)`}
              type="number"
              min="0"
              placeholder={lbl('dziedziczy', 'inherit')}
              value={p.limits?.perLang?.[l] ?? ''}
              onChange={(e) => setPerLang(l, e.target.value)}
            />
          ))}
        </div>
        <div className="mt-3">
          <strong className="text-xs">{lbl('Historia limitów', 'Limit history')}</strong>
          {history.length ? (
            <ul className="type-mono text-xs mt-1 flex flex-col gap-0.5" style={{ color: 'var(--muted)' }}>
              {history.slice(0, 10).map((h) => (
                <li key={h.id}>
                  {h.at ? new Date(h.at).toLocaleString() : '—'} · {limitsLine(h.from)} → {limitsLine(h.to)}
                </li>
              ))}
            </ul>
          ) : <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{lbl('Brak zmian limitów.', 'No limit changes yet.')}</p>}
        </div>
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
