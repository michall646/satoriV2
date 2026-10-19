// Exam guard: persistent exam-mode banner + client-side signals.
// F4: mounted by the contest layout on every contest route. There is no opt-in
// toggle and no off switch once the contest is in exam mode. Browser events are
// reported (type + detail) and shown locally; this is a signal, not a lockdown,
// and the UI does not claim server-side enforcement that does not exist.
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/client';
import { useLang } from './ShellControls';

const TXT = {
  en: {
    mode: 'Exam mode',
    fullscreenRule: 'fullscreen required',
    pasteRule: 'paste blocked',
    shuffleRule: 'order assigned per student',
    enter: 'Enable fullscreen',
    denied: 'The fullscreen request was refused — logged. You can continue in a window.',
    left: 'You left fullscreen — logged. Return to fullscreen.',
    unsupported: 'This browser does not support fullscreen — logged. Continue in a window.',
    paste: 'Paste is blocked in exam mode — the attempt was logged.',
    ip: 'IP allowlist configured:',
    time: 'Time window configured:',
    honest: 'Browser events are reported to the jury as signals. They do not lock the device.',
    logged: 'Last signal logged.',
  },
  pl: {
    mode: 'Tryb egzaminu',
    fullscreenRule: 'wymagany pełny ekran',
    pasteRule: 'wklejanie zablokowane',
    shuffleRule: 'kolejność przydzielana per student',
    enter: 'Włącz pełny ekran',
    denied: 'Żądanie pełnego ekranu odrzucone — odnotowano. Możesz kontynuować w oknie.',
    left: 'Opuszczono pełny ekran — odnotowano. Wróć do pełnego ekranu.',
    unsupported: 'Ta przeglądarka nie obsługuje pełnego ekranu — odnotowano. Kontynuuj w oknie.',
    paste: 'Wklejanie jest zablokowane w trybie egzaminu — próbę odnotowano.',
    ip: 'Skonfigurowana lista dozwolonych IP:',
    time: 'Skonfigurowane okno czasowe:',
    honest: 'Zdarzenia przeglądarki są przekazywane jury jako sygnały. Nie blokują urządzenia.',
    logged: 'Ostatni sygnał odnotowany.',
  },
};

export default function ExamGuard({ contestId, staff = false }) {
  const lang = useLang() === 'pl' ? 'pl' : 'en';
  const txt = TXT[lang];
  const [cfg, setCfg] = useState({ loading: true, exam: false, settings: {} });
  const [inFullscreen, setInFullscreen] = useState(false);
  const [notice, setNotice] = useState('');
  const wasFullscreen = useRef(false);
  const lastReport = useRef({});
  const requesting = useRef(false);

  const settings = cfg.settings || {};
  const guardOn = !staff && (cfg.exam
    || Boolean(settings.fullscreen || settings.pasteBlock || settings.shuffle || settings.ipAllow || settings.timeWindow));

  // One report per signal type per 2.5s: blur + visibilitychange fire together.
  const report = useCallback((type, detail) => {
    if (staff) return;
    const now = Date.now();
    if (now - (lastReport.current[type] || 0) < 2500) return;
    lastReport.current[type] = now;
    api(`/api/contests/${contestId}/exam/violations`, {
      method: 'POST',
      body: JSON.stringify({ type, detail: String(detail || '').slice(0, 500) }),
    }).catch(() => { /* the signal is best effort; never fake success */ });
  }, [contestId, staff]);

  useEffect(() => {
    let live = true;
    api(`/api/contests/${contestId}/exam`, { noCache: true })
      .then((d) => { if (live) setCfg({ loading: false, exam: Boolean(d.exam), settings: d.settings || d || {} }); })
      .catch(() => { if (live) setCfg({ loading: false, exam: false, settings: {} }); });
    return () => { live = false; };
  }, [contestId]);

  const enterFullscreen = useCallback(async () => {
    if (requesting.current || typeof document === 'undefined') return;
    if (document.fullscreenElement) return;
    requesting.current = true;
    setTimeout(() => { requesting.current = false; }, 1000);
    setNotice('');
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      setNotice(TXT[lang].denied);
      report('fullscreen-denied', 'requestFullscreen rejected');
    }
  }, [lang, report]);

  // Fullscreen state: report leaving it, never silently ignore the exit.
  useEffect(() => {
    function onChange() {
      const fs = Boolean(document.fullscreenElement);
      setInFullscreen(fs);
      if (!fs && wasFullscreen.current && guardOn && settings.fullscreen) {
        report('fullscreen-exit', 'document.fullscreenElement=null');
        setNotice(TXT[lang].left);
      }
      wasFullscreen.current = fs;
    }
    onChange();
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [guardOn, settings.fullscreen, report, lang]);

  useEffect(() => {
    if (!guardOn || !settings.fullscreen || typeof document === 'undefined') return undefined;
    if (document.fullscreenEnabled === false) {
      setNotice(TXT[lang].unsupported);
      report('fullscreen-unsupported', 'document.fullscreenEnabled=false');
      return undefined;
    }
    if (inFullscreen) return undefined;
    // First pointer/key event is a user gesture: request fullscreen without an
    // "enter exam" opt-in. The button stays as a fallback.
    function onGesture() { enterFullscreen(); }
    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('keydown', onGesture);
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, [guardOn, settings.fullscreen, inFullscreen, enterFullscreen, report, lang]);

  // Paste, tab and blur signals. Always active while the guard is on.
  useEffect(() => {
    if (!guardOn) return undefined;
    function onPaste(e) {
      if (!settings.pasteBlock) return;
      e.preventDefault();
      const el = e.target && e.target.tagName ? String(e.target.tagName).toLowerCase() : 'document';
      report('paste', `target=${el}`);
      setNotice(TXT[lang].paste);
    }
    function onBlur() { report('blur', 'window lost focus'); }
    function onVisibility() {
      if (document.visibilityState === 'hidden') report('tab-hidden', 'visibility=hidden');
    }
    document.addEventListener('paste', onPaste, true);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('paste', onPaste, true);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [guardOn, settings.pasteBlock, report, lang]);

  if (cfg.loading || !guardOn) return null;

  const rules = [];
  if (settings.fullscreen) rules.push(txt.fullscreenRule);
  if (settings.pasteBlock) rules.push(txt.pasteRule);
  if (settings.shuffle) rules.push(txt.shuffleRule);

  return (
    <div
      role="region"
      aria-label={txt.mode}
      className="sticky top-0 z-30 mb-3 rounded-xl border px-3 py-2 text-xs"
      style={{ background: 'var(--tle-soft)', borderColor: 'var(--tle-line)', color: 'var(--tle-text)' }}
    >
      <div className="flex gap-2 items-center flex-wrap">
        <strong aria-hidden="true">🔒</strong>
        <strong>{txt.mode}</strong>
        {rules.length ? <span>{rules.join(' · ')}</span> : null}
        {settings.fullscreen && !inFullscreen ? (
          <button type="button" onClick={enterFullscreen} className="border px-2 rounded focus-ring">{txt.enter}</button>
        ) : null}
      </div>
      {settings.ipAllow ? <div className="mt-1">{txt.ip} <code className="type-mono">{settings.ipAllow}</code></div> : null}
      {settings.timeWindow ? <div>{txt.time} <code className="type-mono">{settings.timeWindow}</code></div> : null}
      <div className="mt-1" style={{ opacity: 0.8 }}>{txt.honest}</div>
      {notice ? <div role="alert" className="mt-1"><span aria-hidden="true">⚠ </span>{notice}</div> : null}
    </div>
  );
}
