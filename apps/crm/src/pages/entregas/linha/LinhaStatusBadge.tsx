import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { LinhaStatus } from '@/store/linhaEditorial';

const VARIANT: Record<LinhaStatus, 'neutral' | 'info' | 'warning' | 'success'> = {
  rascunho: 'neutral',
  enviada: 'info',
  ajustes: 'warning',
  aprovada: 'success',
};

export function LinhaStatusBadge({ status }: { status: LinhaStatus }) {
  const { t } = useTranslation('linha');
  return (
    <Badge variant={VARIANT[status]} size="sm">
      {t(`status.${status}`)}
    </Badge>
  );
}
