import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface QueryErrorCardProps {
  /** Overrides the default title when the failure has a specific cause. */
  title?: ReactNode;
  /** Overrides the muted explanation line. */
  description?: ReactNode;
  /** Renders the retry button when given. Omit it for errors retrying cannot fix. */
  onRetry?: () => void;
  retryLabel?: string;
}

/**
 * The card a page shows when its data query failed. One shape for every such
 * failure, so a broken request never looks like an empty state.
 */
export function QueryErrorCard({
  title = 'Não foi possível carregar os dados.',
  description = 'Verifique sua conexão e tente novamente.',
  onRetry,
  retryLabel = 'Tentar novamente',
}: QueryErrorCardProps) {
  return (
    <div
      className="card animate-up"
      role="alert"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.6rem',
        padding: '3rem 1.5rem',
        textAlign: 'center',
      }}
    >
      <AlertTriangle style={{ width: 28, height: 28, color: 'var(--danger-text)' }} aria-hidden />
      <p style={{ margin: 0, fontWeight: 600 }}>{title}</p>
      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>{description}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry} style={{ marginTop: '0.5rem' }}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
