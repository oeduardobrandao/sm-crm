import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * "Valores dos seus clientes": tells a member restricted to assigned clients that every
 * Financeiro value is already limited to their clients (the server filters the reads).
 * Shared by the v2 layout and the legacy ledger page.
 */
export function FinanceiroScopeBadge({ className }: { className?: string }) {
  const { t } = useTranslation('financeV2');
  return (
    <Badge variant="neutral" className={cn('shrink-0', className)}>
      {t('layout.scopedBadge')}
    </Badge>
  );
}
