import type { WorkflowEtapa } from '../../store';
import { etapaDeadlineDateOf } from './etapaPrazo';
import { endOfLocalDay, parseLocalISODate } from '@/utils/postDate';

/**
 * Prazos que detach_posts_keeping_process só armazena (spec §7): o prazo
 * congelado da etapa ativa (data_limite = fim daquele dia local; senão
 * iniciado_em + prazo_dias) e o mapa {"<ordem>": ISO} das etapas FUTURAS com
 * data_limite, obrigatório para cada uma delas (step_deadline_required).
 */
export function buildDetachDeadlines(
  allEtapas: WorkflowEtapa[],
  activeEtapa: WorkflowEtapa,
): { activeDeadline: string | null; stepDeadlines: Record<string, string> | null } {
  const endOf = (day: string): string | null => {
    const d = parseLocalISODate(day);
    return d ? endOfLocalDay(d).toISOString() : null;
  };
  const activeDeadline = activeEtapa.data_limite
    ? endOf(activeEtapa.data_limite)
    : (etapaDeadlineDateOf(activeEtapa)?.toISOString() ?? null);
  const stepDeadlines: Record<string, string> = {};
  for (const e of allEtapas) {
    if (e.ordem <= activeEtapa.ordem || !e.data_limite) continue;
    const iso = endOf(e.data_limite);
    if (iso) stepDeadlines[String(e.ordem)] = iso;
  }
  return {
    activeDeadline,
    stepDeadlines: Object.keys(stepDeadlines).length ? stepDeadlines : null,
  };
}
