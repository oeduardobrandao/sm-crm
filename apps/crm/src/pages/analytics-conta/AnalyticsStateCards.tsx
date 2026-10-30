import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/** Where a plan-locked card sends the user. */
export const BILLING_PATH = '/configuracao/cobranca';

/** A centred empty state: not connected, expired, first sync. Shared by every analytics tab. */
export function StateCard({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action: ReactNode;
}) {
  return (
    <div className="card animate-up" style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>{title}</h3>
      {body && <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem' }}>{body}</p>}
      {action}
    </div>
  );
}

export function LoadingCard() {
  return (
    <div className="card animate-up">
      <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem 0' }}>
        <Spinner />
      </div>
    </div>
  );
}

/** A section the plan does not include: what it is, and where to upgrade. */
export function LockedCard({
  title,
  body,
  actionLabel,
}: {
  title: string;
  body: string;
  /** The tab's own "Ver planos" string. */
  actionLabel: string;
}) {
  return (
    <div className="card animate-up">
      <div className="dashboard-hub-card-header">
        <h3>{title}</h3>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
          marginTop: '0.75rem',
        }}
      >
        <Lock className="h-4 w-4" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
        <p style={{ color: 'var(--text-muted)', margin: 0, flex: 1 }}>{body}</p>
        <Button asChild size="sm" variant="outline">
          <Link to={BILLING_PATH}>{actionLabel}</Link>
        </Button>
      </div>
    </div>
  );
}
