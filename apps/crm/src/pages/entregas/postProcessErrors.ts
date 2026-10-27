import { lazyLabels } from './postLabels';
import { entitlementMessage, mapEntitlementError } from '@/lib/entitlement-errors';

/**
 * Cópia em português para os códigos identificadores que as RPCs de processos
 * individuais levantam (`RAISE EXCEPTION '<codigo>' USING ERRCODE = 'P0001'`,
 * spec §9.3). Tabela completa em
 * docs/superpowers/plans/2026-09-10-posts-individuais-fase2-rpcs.md, seção
 * "Códigos de erro". `feature_disabled:*` e `plan_limit_exceeded:*` passam
 * pelo mapeamento de entitlement existente, não por esta tabela.
 */
const POST_PROCESS_ERROR_CODES = [
  'workspace_not_found',
  'permission_denied',
  'invalid_arguments',
  'post_ids_required',
  'post_not_found',
  'post_not_in_source_flow',
  'post_in_workflow',
  'post_already_in_flow',
  'post_has_active_process',
  'post_belongs_to_another_client',
  'post_changed',
  'workflow_not_found',
  'workflow_not_active',
  'workflow_changed',
  'workflow_etapas_inconsistent',
  'template_not_found',
  'template_empty',
  'template_invalid',
  'template_changed',
  'invalid_start_ordem',
  'invalid_step_overrides',
  'invalid_step_deadlines',
  'start_deadline_required',
  'step_deadline_required',
  'data_entrega_requires_approval_step',
  'active_deadline_required',
  'next_deadline_required',
  'expected_post_status_required',
  'approval_choice_required',
  'invalid_approval_choice',
  'invalid_command',
  'membro_not_found',
  'process_not_found',
  'process_changed',
  'process_not_active',
  'process_not_concluded',
  'process_already_closed',
  'step_not_found',
  'step_not_editable',
  'tipo_prazo_invalido',
  'no_next_step',
  'no_previous_step',
  'pending_steps_remaining',
  'request_id_required',
  'request_not_found',
  'etapa_changed',
  'not_approval_etapa',
  'expected_counts_required',
  'posts_changed',
  'ciclo_changed',
  'post_locked',
  'request_mismatch',
] as const;

export const POST_PROCESS_ERROR_MESSAGES: Record<string, string> = lazyLabels(
  POST_PROCESS_ERROR_CODES,
  (code) => `entregas:postProcessErrors.${code}`,
);

/** Códigos que significam "seu estado local está velho": além do toast, refetch. */
export const STALE_STATE_CODES: ReadonlySet<string> = new Set([
  'workflow_changed',
  'process_changed',
  'post_changed',
  'template_changed',
  'request_mismatch',
  'etapa_changed',
  'posts_changed',
  'ciclo_changed',
  'not_approval_etapa',
  'expected_counts_required',
  'workflow_not_active',
  'post_has_active_process',
  'post_in_workflow',
  'post_already_in_flow',
]);

export function getErrorIdentifier(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

export function getPostProcessErrorToast(err: unknown, fallback: string): string {
  const ent = mapEntitlementError(err);
  if (ent) return entitlementMessage(ent);
  const id = getErrorIdentifier(err);
  return POST_PROCESS_ERROR_MESSAGES[id] ?? fallback;
}

export function isStaleStateError(err: unknown): boolean {
  return STALE_STATE_CODES.has(getErrorIdentifier(err));
}
