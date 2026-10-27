import { i18n } from '@mesaas/i18n';
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
  if (dl.estourado)
    return i18n.t('entregasPhone:phoneFormat.overdue', { days: Math.abs(dl.diasRestantes) });
  if (dl.diasRestantes === 0 && dl.horasRestantes === 0)
    return i18n.t('entregasPhone:phoneFormat.dueNow');
  if (dl.diasRestantes === 0)
    return i18n.t('entregasPhone:phoneFormat.hoursLeft', { hours: dl.horasRestantes });
  if (dl.horasRestantes > 0)
    return i18n.t('entregasPhone:phoneFormat.daysHoursLeft', {
      days: dl.diasRestantes,
      hours: dl.horasRestantes,
    });
  return i18n.t('entregasPhone:phoneFormat.daysLeft', { days: dl.diasRestantes });
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
      ? i18n.t('entregasPhone:phoneFormat.approvedByClient')
      : i18n.t('entregasPhone:phoneFormat.awaitingClientApproval');
  }
  if (counts.revisaoInternaCount > 0)
    return i18n.t('entregasPhone:phoneFormat.awaitingInternalApproval');
  const approvalOrdem = card.allEtapas.find((e) => e.tipo === 'aprovacao_cliente')?.ordem;
  if (
    approvalOrdem != null &&
    card.etapa.ordem > approvalOrdem &&
    counts.awaitingClienteCount > 0
  ) {
    const n = counts.awaitingClienteCount;
    return i18n.t('entregasPhone:phoneFormat.postsWithClient', { count: n });
  }
  return null;
}

/** "Concluir etapa e avançar" until the last etapa, then "Concluir fluxo" (desktop title). */
export function workflowForwardLabel(card: BoardCard): string {
  return card.etapaIdx < card.totalEtapas - 1
    ? i18n.t('entregasPhone:phoneFormat.completeAndAdvance')
    : i18n.t('entregasPhone:phoneFormat.completeFluxo');
}
