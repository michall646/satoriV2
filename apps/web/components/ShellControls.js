// Shell interactive bits — stays Client, layout stays Server. Guard clauses, no nesting.
'use client';
import { useEffect, useState } from 'react';
import { t, getLang } from '../lib/client';

function applyTheme(isDark) {
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  try {
    localStorage.setItem('satori-theme', isDark ? 'dark' : 'light');
  } catch { /* noop */ }
}

export function useLang() {
  const [lang, setLang] = useState('pl');
  useEffect(() => {
    setLang(getLang());
  }, []);
  return lang;
}

export function ThemeToggle() {
  const lang = useLang();
  const [dark, setDark] = useState(null);

  useEffect(() => {
    try {
      // Blocking script in layout already set the class — just sync state, no flash.
      setDark(document.documentElement.classList.contains('dark'));
    } catch { setDark(false); }
  }, []);

  function toggle() {
    const next = !(dark ?? document.documentElement.classList.contains('dark'));
    setDark(next);
    applyTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={!!dark}
      aria-label={dark ? t(lang, 'theme_switch_light') : t(lang, 'theme_switch_dark')}
      title={dark ? t(lang, 'theme_light') : t(lang, 'theme_dark')}
      className="icon-btn focus-ring"
    >
      {dark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
      )}
    </button>
  );
}

export function LangToggle() {
  const lang = useLang();

  function toggle() {
    const next = lang === 'pl' ? 'en' : 'pl';
    try {
      localStorage.setItem('satori-lang', next);
    } catch { /* noop */ }
    window.location.reload();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="icon-btn relative focus-ring"
      aria-label={t(lang, 'lang_switch')}
      title={t(lang, 'lang_switch')}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
      <span aria-hidden="true" className="absolute -bottom-1 -right-1 text-[9px] font-bold rounded-full px-1 leading-3" style={{ background: 'rgb(128 140 155 / 0.2)', color: 'var(--fg)' }}>{lang.toUpperCase()}</span>
    </button>
  );
}
