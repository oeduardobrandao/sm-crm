import { Badge } from '@/components/ui/badge';
import type { LinhaStatus } from '@/store/linhaEditorial';

const STATUS: Record<
  LinhaStatus,
  { label: string; variant: 'neutral' | 'info' | 'warning' | 'success' }
> = {
  rascunho: { label: 'Rascunho', variant: 'neutral' },
  enviada: { label: 'Enviada ao cliente', variant: 'info' },
  ajustes: { label: 'Ajustes pedidos', variant: 'warning' },
  aprovada: { label: 'Aprovada', variant: 'success' },
};

export function LinhaStatusBadge({ status }: { status: LinhaStatus }) {
  const { label, variant } = STATUS[status];
  return (
    <Badge variant={variant} size="sm">
      {label}
    </Badge>
  );
}
