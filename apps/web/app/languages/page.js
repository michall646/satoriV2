// Language matrix: public versions + flags + hello-world. Replaces login-walled subpage.
'use client';
import { useEffect, useState } from 'react';
import { api, STR, getLang } from '../../lib/client';
import Table from '../../components/ui/Table';
import { CodeBlock, CopyButton } from '../../components/ui/Code';
import { Skeleton, EmptyState } from '../../components/ui/Feedback';

const HELLO = {
  cpp: '#include <bits/stdc++.h>\nint main(){ std::cout << "hi\\n"; }',
  c: '#include <stdio.h>\nint main(){ printf("hi\\n"); return 0; }',
  python: 'print("hi")',
  java: 'class Main { public static void main(String[] a){ System.out.println("hi"); } }',
};

export default function LanguagesPage() {
  const [m, setM] = useState(null);
  const t = STR[getLang()];
  useEffect(() => { api('/api/languages').then((d) => setM(d.matrix || [])).catch(() => setM([])); }, []);
  if (m === null) return <Skeleton lines={5} />;
  if (!m.length) return <EmptyState line={t.languages_empty} />;
  return (
    <div>
      <h1 className="type-h1">{t.languages_title}</h1>
      <Table
        stickyHeader
        caption={t.languages_caption}
        columns={[
          { key: 'lang', label: t.col_lang },
          { key: 'version', label: t.col_version, render: (r) => r.version || '—' },
          { key: 'flags', label: t.col_flags, render: (r) => <span className="type-mono">{r.flags || '—'}</span> },
          { key: 'timeMult', label: t.col_time_mult, render: (r) => (r.timeMult ? `×${r.timeMult}` : '×1') },
          { key: 'hello', label: 'Hello-world', render: (r) => <span className="flex gap-1 items-center"><CopyButton text={HELLO[r.lang] || HELLO.python} /><code className="type-mono">{(HELLO[r.lang] || HELLO.python).slice(0, 24)}…</code></span> },
        ]}
        rows={m.map((l) => ({ ...l, key: l.lang }))}
      />
      <div className="mt-4 grid md:grid-cols-2 gap-2">
        {m.slice(0, 4).map((l) => (
          <CodeBlock key={l.lang} language={l.lang} code={HELLO[l.lang] || HELLO.python} />
        ))}
      </div>
    </div>
  );
}
