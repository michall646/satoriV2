// Subtree error boundary — friendly page + retry, never blank.
'use client';
import Link from 'next/link';
import { Button, ErrorState } from '../components/ui';
import { STR, getLang } from '../lib/client';

export default function Error({ error, reset }) {
  const digest = error?.digest || 'no-id';
  const t = STR[getLang()];
  return (
    <div className="page">
      <ErrorState
        title={t.err_title}
        line={t.err_line}
        digest={digest}
        action={(
          <>
            <Button onClick={() => reset?.()}>{t.common_retry}</Button>
            <Link href="/" prefetch className="btn btn-secondary focus-ring">{t.nav_home}</Link>
          </>
        )}
      />
    </div>
  );
}
