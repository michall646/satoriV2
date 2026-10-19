// Countdown (server-time based) + CopyButton + DiffView + CodeBlock.
'use client';
import { useEffect, useState } from 'react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { STR, getLang } from '../../lib/client';

SyntaxHighlighter.registerLanguage('cpp', cpp);
SyntaxHighlighter.registerLanguage('c', c);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('java', java);

const LANG_MAP = {
  'c++': 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp',
  py: 'python', gyp: 'python',
};

function normalizeLang(l) {
  const k = String(l || 'text').toLowerCase();
  if (LANG_MAP[k]) return LANG_MAP[k];
  if (['cpp', 'c', 'python', 'java'].includes(k)) return k;
  return 'text';
}

function useCodeTheme() {
  const [theme, setTheme] = useState('auto');
  const [sysDark, setSysDark] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('satori-code-theme');
      if (saved === 'dark' || saved === 'light' || saved === 'auto') setTheme(saved);
    } catch { /* noop */ }
    const el = document.documentElement;
    const sync = () => setSysDark(el.classList.contains('dark'));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  function cycle() {
    const next = theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto';
    setTheme(next);
    try { localStorage.setItem('satori-code-theme', next); } catch { /* noop */ }
  }
  const isDark = theme === 'dark' ? true : theme === 'light' ? false : sysDark;
  return { theme, cycle, isDark };
}

export function formatLeft(ms) {
  if (ms <= 0) return '0:00';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (m < 60) return `${m}:${String(s).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return `${h}h ${rm}m`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return `${d}d ${rh}h`;
}

export function Countdown({ to, label }) {
  const t = STR[getLang()];
  const [left, setLeft] = useState('');
  useEffect(() => {
    if (!to) return;
    function tick() {
      const ms = new Date(to).getTime() - Date.now();
      setLeft(formatLeft(ms));
    }
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [to]);
  if (!to) return null;
  return <span className="text-sm tabular-nums" aria-live="off">{left} {label || t.code_left}</span>;
}

export function CopyButton({ text, label }) {
  const t = STR[getLang()];
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text || '');
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch { /* clipboard unavailable */ }
  }
  return (
    <button type="button" onClick={copy} className="code-mini focus-ring">{done ? t.code_copied : (label || t.code_copy)}</button>
  );
}

export function DiffView({ expected = '', got = '', showWhitespace }) {
  const t = STR[getLang()];
  const [ws, setWs] = useState(!!showWhitespace);
  function vis(s) {
    if (!ws) return s;
    return s.replace(/ /g, '·').replace(/\t/g, '→').replace(/\n/g, '⏎\n');
  }
  return (
    <div className="grid md:grid-cols-2 gap-2 text-xs">
      <div>
        <div className="flex gap-2 items-center mb-1">
          <strong className="diff-label">{t.ui_expected}</strong>
          <button type="button" onClick={() => setWs((v) => !v)} className="code-mini focus-ring" aria-pressed={ws}>{t.code_whitespace}</button>
        </div>
        <pre className="diff-pre type-mono">{vis(expected)}</pre>
      </div>
      <div>
        <strong className="diff-label block mb-1">{t.ui_got}</strong>
        <pre className="diff-pre type-mono">{vis(got)}</pre>
      </div>
    </div>
  );
}

export function CodeBlock({ code = '', language = 'text', showLines }) {
  const t = STR[getLang()];
  const [lines, setLines] = useState(!!showLines);
  const { theme, cycle, isDark } = useCodeTheme();
  const lang = normalizeLang(language);
  const rows = String(code).split('\n');
  return (
    <div className="code-card">
      <div className="code-head">
        <span className="code-lang">{language}</span>
        <span className="type-mono" style={{ color: 'var(--muted)', fontSize: 11 }}>{rows.length} {t.code_lines}</span>
        <button type="button" onClick={() => setLines((v) => !v)} className="code-mini focus-ring" aria-pressed={lines}>{t.code_lines_btn}</button>
        <button type="button" onClick={cycle} className="code-mini focus-ring" title={t.code_theme_title}>theme:{theme}</button>
        <span className="ml-auto"><CopyButton text={code} /></span>
      </div>
      <SyntaxHighlighter
        language={lang}
        style={isDark ? oneDark : oneLight}
        showLineNumbers={lines}
        startingLineNumber={1}
        lineNumberStyle={{ opacity: 0.5, minWidth: '2.5em' }}
        customStyle={{ margin: 0, fontSize: '12px', lineHeight: '17px', padding: '8px', background: isDark ? '#0d1117' : '#f6f8fa' }}
        codeTagProps={{ style: { fontFamily: 'var(--font-mono)' } }}
      >
        {String(code)}
      </SyntaxHighlighter>
    </div>
  );
}
