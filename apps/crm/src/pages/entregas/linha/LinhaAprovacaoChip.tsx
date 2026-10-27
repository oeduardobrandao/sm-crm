import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Badge, badgeVariants } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { LinhaItem } from '@/store/linhaEditorial';

const VARIANT = {
  aprovado: 'success',
  ajustes: 'warning',
  pendente: 'neutral',
} as const;

interface LinhaAprovacaoChipProps {
  item: Pick<LinhaItem, 'id' | 'aprovacao' | 'aprovacao_at'>;
  /** The linha's `rodada`: the chip shows only once the linha was sent (spec §13.6). */
  rodada: number;
  /** Opens the row's thread. Given, "Ajuste pedido" is a button; absent (phone), a label. */
  onOpenComentarios?: (itemId: string) => void;
}

function dataDe(at: string | null | undefined, pattern: string): string | null {
  if (!at) return null;
  try {
    return format(parseISO(at), pattern);
  } catch {
    return null;
  }
}

/** The client's decision on one linha row: "Aprovado", "Ajuste pedido" or "Pendente". */
export function LinhaAprovacaoChip({ item, rodada, onOpenComentarios }: LinhaAprovacaoChipProps) {
  const { t } = useTranslation('linha');
  if (rodada <= 0) return null;
  const estado = item.aprovacao ?? 'pendente';
  const variant = VARIANT[estado];
  const label = t(`aprovacao.${estado}`);
  const data = estado === 'pendente' ? null : dataDe(item.aprovacao_at, t('aprovacao.dateFormat'));
  const title = data ? t('aprovacao.titulo', { label, data }) : undefined;

  if (estado === 'ajustes' && onOpenComentarios) {
    return (
      <button
        type="button"
        className={cn(
          badgeVariants({ variant, size: 'sm' }),
          'linha-aprovacao linha-aprovacao--btn',
        )}
        title={title}
        onClick={() => onOpenComentarios(item.id)}
      >
        {label}
      </button>
    );
  }
  return (
    <Badge variant={variant} size="sm" className="linha-aprovacao" title={title}>
      {label}
    </Badge>
  );
}
