import { i18n } from '@mesaas/i18n';

/**
 * Builds the human-readable status label for a workflow deadline shown in the
 * "Agendado" panel of the financeiro calendar.
 *
 * Guards against a missing/invalid `diasRestantes`: without this, an event that
 * reaches the panel without its computed deadline fields renders the literal
 * string "undefined" to users (e.g. "UNDEFINEDD RESTANTE").
 */
export function formatDeadlineStatus(
  diasRestantes: number | null | undefined,
  estourado: boolean | null | undefined,
): string {
  if (typeof diasRestantes !== 'number' || Number.isNaN(diasRestantes)) {
    return i18n.t('calendario:deadlineStatus.none');
  }
  if (estourado) {
    return i18n.t('calendario:deadlineStatus.overdue', { count: Math.abs(diasRestantes) });
  }
  if (diasRestantes === 0) {
    return i18n.t('calendario:shared.dueToday');
  }
  return i18n.t('calendario:deadlineStatus.remaining', { count: diasRestantes });
}
