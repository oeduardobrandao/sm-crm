import { PackageCheck, PackageOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { MaterialBadgeData } from '../materialSummary';

/** "Material · X de N itens" (warning) while waiting, "Material recebido · …" (success) once in. */
export function MaterialBadge({ kind, done, total }: MaterialBadgeData) {
  const { t } = useTranslation('postPanels');
  const waiting = kind === 'aguardando';
  const Icon = waiting ? PackageOpen : PackageCheck;
  return (
    <Badge
      variant={waiting ? 'warning' : 'success'}
      size="sm"
      className="inline-flex items-center gap-1 whitespace-nowrap"
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {t(waiting ? 'material.cardWaiting' : 'material.cardReceived', { done, total, count: total })}
    </Badge>
  );
}
