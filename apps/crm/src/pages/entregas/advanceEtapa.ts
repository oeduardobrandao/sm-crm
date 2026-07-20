import { toast } from 'sonner';
import { completeEtapa, completeEtapaWithRearm } from '../../store';
import type { Workflow, WorkflowEtapa } from '../../store';

export interface AdvanceResult {
  workflow: Workflow;
  etapas: WorkflowEtapa[];
  /** Approved posts were reset to rascunho for the next approval cycle. */
  rearmed: boolean;
  /** The etapa advanced but the post reset failed — needs manual remediation. */
  rearmFailed: boolean;
}

/**
 * Complete an etapa on an advance path, re-arming the next approval cycle by default.
 *
 * Pass `{ rearm: false }` for advances whose literal contract is to leave post statuses
 * untouched ("Avançar etapa sem alterar posts").
 *
 * Deliberately emits no toasts: callers differ in how they report success (recurring-workflow
 * branch, i18n vs literal copy) and in where the refresh belongs, so they own that ordering and
 * call `notifyRearmOutcome` at the point that suits them.
 */
export async function completeEtapaForAdvance(
  workflowId: number,
  etapaId: number,
  opts?: { rearm?: boolean },
): Promise<AdvanceResult> {
  if (opts?.rearm === false) {
    const result = await completeEtapa(workflowId, etapaId);
    return { ...result, rearmed: false, rearmFailed: false };
  }
  return completeEtapaWithRearm(workflowId, etapaId);
}

/**
 * Report the approval-cycle re-arm outcome of an advance. A re-arm failure is NOT an advance
 * failure — the etapa did move — so it is reported as a remediation notice, and callers must
 * still run their normal success/refresh handling.
 */
export function notifyRearmOutcome({
  rearmed,
  rearmFailed,
}: Pick<AdvanceResult, 'rearmed' | 'rearmFailed'>): void {
  if (rearmed) {
    toast.info('Posts voltaram para rascunho para o próximo ciclo de aprovação.');
  }
  if (rearmFailed) {
    toast.error(
      'A etapa avançou, mas não foi possível preparar os posts para o próximo ciclo de aprovação. Reinicie os status dos posts manualmente.',
    );
  }
}
