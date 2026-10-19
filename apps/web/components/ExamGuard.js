// Exam guard: fullscreen/paste-block/shuffle client enforcement with server note + visible states.
'use client';
import { useEffect, useState } from 'react';
import { api, t } from '../lib/client';
import { useLang } from './ShellControls';

export default function ExamGuard({ contestId }) {
  const lang = useLang();
  const [settings, setSettings] = useState(null);
  const [active, setActive] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api(`/api/contests/${contestId}/exam`).then((d) => setSettings(d.settings || d)).catch(() => setSettings(null));
  }, [contestId]);

  useEffect(() => {
    if (!settings || !active) return;
    function onPaste(e) {
      if (!settings.pasteBlock) return;
      e.preventDefault();
      setMsg(t(lang, 'exam_paste_blocked'));
      api(`/api/contests/${contestId}/exam/violations`, { method: 'POST', body: JSON.stringify({ type: 'paste' }) }).catch(() => {});
    }
    document.addEventListener('paste', onPaste);
    return () => { document.removeEventListener('paste', onPaste); };
  }, [settings, active, lang, contestId]);

  if (!settings || (!settings.fullscreen && !settings.pasteBlock && !settings.shuffle)) return null;

  async function enter() {
    setMsg('');
    if (settings.fullscreen) {
      try { await document.documentElement.requestFullscreen(); }
      catch {
        setMsg(t(lang, 'exam_fullscreen_denied'));
        api(`/api/contests/${contestId}/exam/violations`, { method: 'POST', body: JSON.stringify({ type: 'fullscreen-denied' }) }).catch(() => {});
      }
    }
    if (settings.ipAllow) setMsg((m) => `${m} ${t(lang, 'exam_ip_note')} ${settings.ipAllow}`);
    if (settings.timeWindow) setMsg((m) => `${m} ${t(lang, 'exam_time_window')} ${settings.timeWindow}.`);
    setActive(true);
  }

  function exit() {
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch { /* noop */ }
    setActive(false);
  }

  return (
    <div className="border rounded px-2 py-1 text-xs my-2" style={{ background: 'var(--tle-soft)', borderColor: 'var(--tle-line)', color: 'var(--tle-text)' }} role="region" aria-label={t(lang, 'exam_mode')}>
      <strong>{t(lang, 'exam_mode')}</strong>
      <span className="ml-2">{settings.fullscreen ? `${t(lang, 'exam_fullscreen')} ` : ''}{settings.pasteBlock ? `${t(lang, 'exam_paste_block')} ` : ''}{settings.shuffle ? `${t(lang, 'exam_shuffle')} ` : ''}</span>
      {!active ? <button onClick={enter} className="ml-2 border px-2 rounded focus-ring">{t(lang, 'exam_enter')}</button>
        : <button onClick={exit} className="ml-2 border px-2 rounded focus-ring">{t(lang, 'exam_exit')}</button>}
      {msg ? <span role="status" className="block mt-1">{msg}</span> : null}
    </div>
  );
}
