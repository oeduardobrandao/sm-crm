import type { PostProcess, PostProcessStep } from '../../store';
import { computeDeadlineDate } from './hooks/useEntregasData';

export interface ProcessTarget {
  process: PostProcess;
  post: { id: number; titulo: string | null; status: string; cliente_id: number | null };
}

export function activeStepOf(process: PostProcess): PostProcessStep | null {
  return (
    process.steps.find((s) => s.estado === 'ativo') ??
    process.steps.find((s) => s.ordem === process.etapa_atual) ??
    null
  );
}

/** Próxima etapa PENDENTE por ordem (a RPC pula herdado/ignorado/concluído). */
export function nextPendingStepOf(process: PostProcess): PostProcessStep | null {
  const active = activeStepOf(process);
  if (!active) return null;
  return (
    [...process.steps]
      .filter((s) => s.ordem > active.ordem && s.estado === 'pendente')
      .sort((a, b) => a.ordem - b.ordem)[0] ?? null
  );
}

/** Etapa imediatamente anterior por ordem, qualquer estado (Decisão 15). */
export function previousStepOf(process: PostProcess): PostProcessStep | null {
  const active = activeStepOf(process);
  if (!active) return null;
  return (
    [...process.steps].filter((s) => s.ordem < active.ordem).sort((a, b) => b.ordem - a.ordem)[0] ??
    null
  );
}

/** Decisão 12: concluir só quando nenhuma etapa de ordem maior está pendente. */
export function canConcluir(process: PostProcess): boolean {
  return nextPendingStepOf(process) === null;
}

export function forwardLabelFor(process: PostProcess): 'Avançar etapa' | 'Concluir processo' {
  return canConcluir(process) ? 'Concluir processo' : 'Avançar etapa';
}

/** p_next_deadline: só quando a etapa a ativar tem prazo relativo e ainda não
 *  tem prazo_efetivo (spec §7). A RPC valida e só armazena. */
export function nextDeadlineFor(step: PostProcessStep | null, now: Date): string | null {
  if (!step || step.prazo_efetivo || step.prazo_dias == null || !step.tipo_prazo) return null;
  return computeDeadlineDate(now.toISOString(), step.prazo_dias, step.tipo_prazo).toISOString();
}

export const SEND_TO_PORTAL_REASON =
  'Só posts aprovados internamente podem ser enviados ao cliente.';

/** Mesma regra de sendPostsToCliente (status = aprovado_interno), para n = 1 (spec §6.2). */
export function sendToPortalDisabledReasonFor(status: string): string | undefined {
  return status === 'aprovado_interno' ? undefined : SEND_TO_PORTAL_REASON;
}
