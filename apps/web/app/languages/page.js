// Language matrix: public versions + flags + availability + hello-world.
// Keys are canonical judge keys (C, C++17, Java, Python, Rust, JavaScript), not file extensions.
'use client';
import { useEffect, useState } from 'react';
import { api, STR, getLang } from '../../lib/client';
import Table from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { CodeBlock, CopyButton } from '../../components/ui/Code';
import { Skeleton, EmptyState } from '../../components/ui/Feedback';

// Fallback only: the API matrix already carries `hello` for every served language.
const HELLO = {
  C: '#include <stdio.h>\nint main(void){ printf("hi\\n"); return 0; }',
  'C++17': '#include <bits/stdc++.h>\nint main(){ std::cout << "hi\\n"; }',
  Java: 'class Main { public static void main(String[] a){ System.out.println("hi"); } }',
  Python: 'print("hi")',
  Rust: 'fn main(){ println!("hi"); }',
  JavaScript: 'console.log("hi")',
};

const CODE_LANG = { C: 'c', 'C++17': 'cpp', Java: 'java', Python: 'python' };

const COPY = {
  en: {
    available: 'available',
    unavailable: 'toolchain missing',
    caption: 'Compiler versions, flags, toolchain availability and a hello-world for each served language.',
    enabled: 'Enabled',
  },
  pl: {
    available: 'dostępny',
    unavailable: 'brak toolchainu',
    caption: 'Wersje kompilatorów, flagi, dostępność toolchainów i hello-world dla każdego obsługiwanego języka.',
    enabled: 'Włączony',
  },
};

function languageRows(matrix, locale = 'en') {
  const copy = COPY[locale] || COPY.en;
  return (matrix || []).map((row) => {
    const hello = row.hello || HELLO[row.lang] || '';
    return {
      ...row,
      key: row.lang,
      hello,
      available: row.available === true,
      availabilityLabel: row.available === true ? copy.available : copy.unavailable,
      codeLanguage: CODE_LANG[row.lang] || 'text',
    };
  });
}

export default function LanguagesPage() {
  const [m, setM] = useState(null);
  const locale = getLang();
  const t = STR[locale];
  const copy = COPY[locale] || COPY.en;
  useEffect(() => {
    let live = true;
    api('/api/languages')
      .then((d) => { if (live) setM(d.matrix || []); })
      .catch(() => { if (live) setM([]); });
    return () => { live = false; };
  }, []);
  if (m === null) return <Skeleton lines={5} />;
  if (!m.length) return <EmptyState line={t.languages_empty} />;
  const rows = languageRows(m, locale);
  return (
    <div>
      <h1 className="type-h1">{t.languages_title}</h1>
      <Table
        stickyHeader
        caption={copy.caption}
        columns={[
          { key: 'lang', label: t.col_lang },
          { key: 'version', label: t.col_version, render: (r) => r.version || '—' },
          { key: 'flags', label: t.col_flags, render: (r) => <span className="type-mono">{r.flags || '—'}</span> },
          {
            key: 'available',
            label: copy.enabled,
            render: (r) => (
              <Badge tone={r.available ? 'accent' : 'warn'} title={r.availabilityLabel}>
                {r.availabilityLabel}
              </Badge>
            ),
          },
          {
            key: 'hello',
            label: 'Hello-world',
            render: (r) => (
              <span className="flex gap-1 items-center">
                <CopyButton text={r.hello} />
                <code className="type-mono">{r.hello ? `${r.hello.slice(0, 24)}…` : '—'}</code>
              </span>
            ),
          },
        ]}
        rows={rows}
      />
      <div className="mt-4 grid md:grid-cols-2 gap-2">
        {rows.map((l) => (
          <CodeBlock key={l.lang} language={l.codeLanguage} code={l.hello} />
        ))}
      </div>
    </div>
  );
}
