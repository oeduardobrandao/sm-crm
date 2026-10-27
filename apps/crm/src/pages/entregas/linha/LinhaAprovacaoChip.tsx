import { format, parseISO } from 'date-fns';
import { Badge, badgeVariants } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { LinhaItem } from '@/store/linhaEditorial';

const ESTADO = {
  aprovado: { label: 'Aprovado', variant: 'success' },
  ajustes: { label: 'Ajuste pedido', variant: 'warning' },
  pendente: { label: 'Pendente', variant: 'neutral' },
} as const;

interface LinhaAprovacaoChipProps {
  item: Pick<LinhaItem, 'id' | 'aprovacao' | 'aprovacao_at'>;
  /** The linha's `rodada`: the chip shows only once the linha was sent (spec §13.6). */
  rodada: number;
  /** Opens the row's thread. Given, "Ajuste pedido" is a button; absent (phone), a label. */
  onOpenComentarios?: (itemId: string) => void;
}

function dataDe(at: string | null | undefined): string | null {
  if (!at) return null;
  try {
    return format(parseISO(at), 'dd/MM/yyyy');
  } catch {
    return null;
  }
}

/** The client's decision on one linha row: "Aprovado", "Ajuste pedido" or "Pendente". */
export function LinhaAprovacaoChip({ item, rodada, onOpenComentarios }: LinhaAprovacaoChipProps) {
  if (rodada <= 0) return null;
  const estado = item.aprovacao ?? 'pendente';
  const { label, variant } = ESTADO[estado];
  const data = estado === 'pendente' ? null : dataDe(item.aprovacao_at);
  const title = data ? `${label} em ${data}` : undefined;

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
