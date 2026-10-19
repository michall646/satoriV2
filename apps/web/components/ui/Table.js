// Table — sticky header prop, sticky first-2-cols, sortable header. Guard clauses.
'use client';
import { STR, getLang } from '../../lib/client';

export default function Table({ columns = [], rows = [], stickyHeader, stickyFirstCols, stickyLast, sort, onSort, caption, className = '' }) {
  const t = STR[getLang()];
  if (!columns.length) return null;
  if (!rows.length) return <p className="text-sm" style={{ color: 'var(--muted)' }}>{t.ui_no_rows}</p>;

  function stickyStyle(ci, total) {
    if (stickyFirstCols && ci === 0) return { left: 0 };
    if (stickyFirstCols && ci === 1) return { left: 52 };
    if ((stickyLast || columns[ci]?.stickyRight) && ci === total - 1) return { right: 0 };
    return undefined;
  }

  function isSticky(ci, total) {
    if (stickyFirstCols && ci < 2) return true;
    if ((stickyLast || columns[ci]?.stickyRight) && ci === total - 1) return true;
    return false;
  }

  return (
    <div className={`table-scroll max-w-full ${stickyHeader ? 'max-h-[70vh]' : ''} ${className}`}>
      <table className="w-max min-w-full table-auto border-collapse text-sm" style={{ fontFeatureSettings: "'tnum'" }}>
        {caption ? <caption className="text-left type-mono pb-2 px-3 pt-3" style={{ color: 'var(--muted)' }}>{caption}</caption> : null}
        <thead className={stickyHeader ? 'table-sticky-head' : undefined}>
          <tr>
            {columns.map((c, i) => {
              const sortable = !!c.sortKey;
              const active = sort?.key === c.sortKey;
              const sticky = isSticky(i, columns.length);
              const pos = stickyStyle(i, columns.length);
              const align = c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left';
              const thStyle = { borderBottom: '1px solid var(--border)', color: 'var(--muted)', background: 'var(--surface)', fontSize: 11, ...(pos || {}), ...(c.minWidth ? { minWidth: c.minWidth } : {}) };
              if (!sortable) return <th key={c.key || i} scope="col" className={`${align} px-3 py-2 font-semibold type-mono uppercase tracking-wider whitespace-nowrap ${sticky ? 'sticky z-20' : ''}`} style={thStyle}>{c.label}</th>;
              return (
                <th key={c.key || i} scope="col" className={`${align} px-3 py-2 font-semibold whitespace-nowrap ${sticky ? 'sticky z-20' : ''}`} style={thStyle}>
                  <button type="button" onClick={() => onSort?.(c.sortKey)} className="focus-ring rounded underline decoration-dotted type-mono uppercase tracking-wider" style={{ color: 'var(--muted)', fontSize: 11 }} aria-sort={active ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}>
                    {c.label}{active ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : ''}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r.key ?? ri} className="row-hover" style={{ borderBottom: '1px solid var(--border)' }}>
              {columns.map((c, ci) => {
                const sticky = isSticky(ci, columns.length);
                const pos = stickyStyle(ci, columns.length);
                const align = c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left';
                const val = typeof c.render === 'function' ? c.render(r) : r[c.key];
                if (c.fill) return <td key={c.key || ci} className={`vcell ${sticky ? 'sticky z-10' : ''}`} style={{ padding: 0, height: '1px', ...(pos || {}), background: sticky ? 'var(--surface)' : undefined }}>{val}</td>;
                return <td key={c.key || ci} className={`px-3 py-2.5 align-top whitespace-nowrap ${align} ${sticky ? 'sticky z-10' : ''}`} style={{ background: sticky ? 'var(--surface)' : undefined, ...(pos || {}), ...(c.minWidth ? { minWidth: c.minWidth } : {}), ...(ci === 1 ? { borderRight: '1px solid var(--border)' } : {}), ...(((stickyLast || c.stickyRight) && ci === columns.length - 1) ? { borderLeft: '1px solid var(--border)', fontWeight: 700 } : {}) }}>{val}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
