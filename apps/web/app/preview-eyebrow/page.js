'use client';
import { useState } from 'react';
import Link from 'next/link';
import EyebrowFx from '../../components/EyebrowFx';

export default function PreviewEyebrow() {
  const [text, setText] = useState('FEATURES');
  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-10 py-10">
      <div>
        <p className="eyebrow">Preview · EyebrowFx</p>
        <h1 className="type-h1 mt-1">Hover morph — rate it</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Move cursor across header. Hit char → fast <span className="type-mono">█</span> in accent → slow fade back. Stop = all return. No glow, no shift.
        </p>
      </div>

      <section className="card flex flex-col gap-6">
        <div>
          <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Before (static .eyebrow)</p>
          <p className="eyebrow">{text}</p>
        </div>
        <div>
          <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>After — move cursor over it</p>
          <EyebrowFx text={text} />
        </div>
        <div>
          <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Longer sample</p>
          <EyebrowFx text="ONLINE JUDGE · ICPC · LABS" />
        </div>
      </section>

      <div className="flex gap-2 items-center flex-wrap">
        <input
          value={text}
          onChange={(e) => setText((e.target.value || 'FEATURES').toUpperCase().slice(0, 40))}
          className="top-search"
          aria-label="Preview text"
          style={{ width: '14rem' }}
        />
        <Link href="/" className="text-[13px] underline" style={{ color: 'var(--muted)' }}>← guest hero for comparison</Link>
      </div>
    </div>
  );
}
