// Manage page header — eyebrow, title, description, actions. Consistent across every manage route.
'use client';
import EyebrowFx from '../EyebrowFx';

export function PageHeader({ title, description, actions, breadcrumb }) {
  return (
    <header className="pt-1 pb-3">
      {breadcrumb ? <EyebrowFx text={breadcrumb} /> : null}
      <div className="flex items-start justify-between gap-4 flex-wrap mt-0.5">
        <div className="min-w-0">
          <h1 className="type-h1">{title}</h1>
          {description ? (
            <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2 flex-wrap">{actions}</div> : null}
      </div>
    </header>
  );
}

export default PageHeader;
