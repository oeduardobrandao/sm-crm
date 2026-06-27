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
    return 'Sem prazo';
  }
  if (estourado) {
    return `${Math.abs(diasRestantes)}d atrasado`;
  }
  if (diasRestantes === 0) {
    return 'Vence hoje';
  }
  return `${diasRestantes}d restante${diasRestantes > 1 ? 's' : ''}`;
}
