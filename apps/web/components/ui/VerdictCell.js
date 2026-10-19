// VerdictCell — single whole-filled verdict renderer for every table column.
// Use with Table column fill:true so td padding is zero and fill is edge-to-edge.
'use client';

export const VERDICT_TONE = {
  OK: 'vcell-OK', ANS: 'vcell-ANS', WA: 'vcell-WA', TLE: 'vcell-TLE',
  MLE: 'vcell-MLE', RE: 'vcell-RE', CE: 'vcell-CE',
  QUE: 'vcell-live', CMP: 'vcell-live', TST: 'vcell-live',
};

export const VERDICT_ICON = {
  OK: '✓', ANS: '✓', WA: '✕', TLE: '⏱', MLE: '⬢', RE: '⚡', CE: '⚠',
  QUE: '…', CMP: '…', TST: '…', todo: '○',
};

export function verdictTone(verdict) {
  if (verdict === 'todo') return 'vcell-todo';
  return VERDICT_TONE[verdict] || 'vcell-CE';
}

export default function VerdictCell({ verdict, sub, staticCell = true, className = '' }) {
  if (!verdict) verdict = 'todo';
  const tone = verdictTone(verdict);
  const icon = VERDICT_ICON[verdict] ? `${VERDICT_ICON[verdict]} ` : '';
  return (
    <span className={`vcell-fill ${staticCell ? 'vcell-fill-static' : ''} ${tone} ${className}`}>
      <span>{icon}{verdict}</span>
      {sub ? <span className="vcell-sub">{sub}</span> : null}
    </span>
  );
}
