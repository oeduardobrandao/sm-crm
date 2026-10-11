import type { DeadlineInfo } from '../etapaPrazo';
import type { BoardCard } from '../hooks/useEntregasData';

export type DeadlineTone = 'overdue' | 'warning' | 'caution' | 'ok';

/** Same buckets the desktop cards colour by (deadline-overdue/-warning/-caution/-ok). */
export function deadlineTone(dl: DeadlineInfo): DeadlineTone {
  if (dl.estourado) return 'overdue';
  if (dl.urgente) return 'warning';
  if (dl.diasRestantes <= 3) return 'caution';
  return 'ok';
}

/** The desktop card's relative deadline copy ("2d atrasado", "5h restantes"). */
export function relativeDeadline(dl: DeadlineInfo): string {
  if (dl.estourado) return `${Math.abs(dl.diasRestantes)}d atrasado`;
  if (dl.diasRestantes === 0 && dl.horasRestantes === 0) return 'Vence agora';
  if (dl.diasRestantes === 0) return `${dl.horasRestantes}h restantes`;
  if (dl.horasRestantes > 0) return `${dl.diasRestantes}d ${dl.horasRestantes}h restantes`;
  return `${dl.diasRestantes}d restantes`;
}

/**
 * The status line of a fluxo card: the approval badges WorkflowCard shows, as one
 * phrase (null when the desktop card shows none).
 */
export function workflowStatusLine(
  card: BoardCard,
  counts: {
    postsCount: number;
    approvedPostsCount: number;
    clearedClienteCount: number;
    revisaoInternaCount: number;
    awaitingClienteCount: number;
  },
): string | null {
  if (card.etapa.tipo === 'aprovacao_cliente') {
    const cleared = counts.clearedClienteCount ?? counts.approvedPostsCount;
    return counts.postsCount > 0 && cleared === counts.postsCount
      ? 'Aprovado pelo cliente'
      : 'Aguardando aprovação do cliente';
  }
  if (counts.revisaoInternaCount > 0) return 'Aguardando aprovação interna';
  const approvalOrdem = card.allEtapas.find((e) => e.tipo === 'aprovacao_cliente')?.ordem;
  if (
    approvalOrdem != null &&
    card.etapa.ordem > approvalOrdem &&
    counts.awaitingClienteCount > 0
  ) {
    const n = counts.awaitingClienteCount;
    return `${n} post${n === 1 ? '' : 's'} com o cliente`;
  }
  return null;
}

/** "Concluir etapa e avançar" until the last etapa, then "Concluir fluxo" (desktop title). */
export function workflowForwardLabel(card: BoardCard): string {
  return card.etapaIdx < card.totalEtapas - 1 ? 'Concluir etapa e avançar' : 'Concluir fluxo';
}
