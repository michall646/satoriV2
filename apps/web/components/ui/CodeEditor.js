// Reusable paste-friendly code editor (CodeMirror 6) — upgrade from plain textarea.
// Covers submit page (400px) + cockpit modal (240px). Controlled string API.
'use client';
import { useMemo, useCallback, useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { keymap } from '@codemirror/view';
import { cpp } from '@codemirror/lang-cpp';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { githubLight } from '@uiw/codemirror-theme-github';

export function langFromFilename(name = '') {
  const ext = String(name).split('.').pop()?.toLowerCase();
  if (ext === 'py') return python();
  if (ext === 'java') return java();
  return cpp();
}

function useIsDark(override) {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    if (override != null) {
      setIsDark(!!override);
      return;
    }
    const el = document.documentElement;
    const sync = () => setIsDark(el.classList.contains('dark'));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, [override]);
  return isDark;
}

export default function CodeEditor({
  value,
  onChange,
  filename = 'solution.cpp',
  dark = null,
  onSubmit,
  height = '400px',
  placeholder = 'paste code, choose a file, or drop it here — Ctrl+Enter submits',
}) {
  const isDark = useIsDark(dark);
  const extensions = useMemo(() => {
    const submitExt = keymap.of([
      {
        key: 'Ctrl-Enter',
        mac: 'Cmd-Enter',
        run: () => {
          if (onSubmit) onSubmit();
          return true;
        },
      },
    ]);
    return [langFromFilename(filename), submitExt];
  }, [filename, onSubmit]);

  const handleChange = useCallback(
    (val) => {
      if (onChange) onChange(val);
    },
    [onChange]
  );

  return (
    <div
      className="overflow-hidden rounded-xl focus-ring"
      style={{ border: '1px solid var(--border)' }}
    >
      <CodeMirror
        value={value ?? ''}
        height={height}
        theme={isDark ? vscodeDark : githubLight}
        extensions={extensions}
        onChange={handleChange}
        placeholder={placeholder}
        basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
      />
    </div>
  );
}
