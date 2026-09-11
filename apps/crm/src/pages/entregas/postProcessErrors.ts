import { entitlementMessage, mapEntitlementError } from '@/lib/entitlement-errors';

/**
 * Cópia em português para os códigos identificadores que as RPCs de processos
 * individuais levantam (`RAISE EXCEPTION '<codigo>' USING ERRCODE = 'P0001'`,
 * spec §9.3). Tabela completa em
 * docs/superpowers/plans/2026-09-10-posts-individuais-fase2-rpcs.md, seção
 * "Códigos de erro". `feature_disabled:*` e `plan_limit_exceeded:*` passam
 * pelo mapeamento de entitlement existente, não por esta tabela.
 */
export const POST_PROCESS_ERROR_MESSAGES: Record<string, string> = {
  workspace_not_found: 'Workspace ativo não encontrado. Recarregue a página.',
  permission_denied: 'Você não tem permissão para editar entregas neste workspace.',
  invalid_arguments: 'Não foi possível salvar a ordem da coluna. Recarregue e tente de novo.',
  post_ids_required: 'Selecione pelo menos um post.',
  post_not_found: 'Um ou mais posts não foram encontrados.',
  post_not_in_source_flow: 'Um dos posts já não está neste fluxo. Recarregue a lista.',
  post_in_workflow: 'Este post já pertence a um fluxo. Recarregue para ver o estado atual.',
  post_already_in_flow: 'Este post já pertence a um fluxo.',
  post_has_active_process:
    'Este post tem um processo individual em andamento. Use "Vincular a um fluxo" para encerrá-lo e vincular.',
  post_belongs_to_another_client: 'Este post pertence a outro cliente.',
  post_changed: 'O status do post mudou em outro lugar. Recarregue e tente de novo.',
  workflow_not_found: 'Fluxo não encontrado.',
  workflow_not_active: 'Este fluxo não está mais ativo.',
  workflow_changed: 'O fluxo foi alterado em outro lugar. Recarregue e tente de novo.',
  workflow_etapas_inconsistent:
    'As etapas deste fluxo estão inconsistentes. Só é possível desmembrar como avulso sem etapas.',
  template_not_found: 'Modelo de fluxo não encontrado.',
  template_empty: 'Este modelo não tem etapas.',
  template_invalid: 'Este modelo tem etapas inválidas. Corrija o modelo antes de aplicá-lo.',
  template_changed: 'O modelo foi alterado depois que você abriu este diálogo. Recarregue e tente de novo.',
  invalid_start_ordem: 'Etapa inicial inválida para este modelo.',
  invalid_step_overrides: 'Responsáveis ou prazos inválidos. Revise os campos.',
  invalid_step_deadlines: 'Prazos das etapas futuras inválidos. Revise os campos.',
  start_deadline_required: 'A etapa inicial precisa de um prazo.',
  step_deadline_required: 'Todas as etapas a partir da inicial precisam de uma data.',
  data_entrega_requires_approval_step:
    'No modo data de entrega é preciso haver uma etapa de aprovação do cliente a partir da etapa inicial.',
  active_deadline_required: 'Não foi possível calcular o prazo da etapa atual.',
  next_deadline_required: 'Não foi possível calcular o prazo da próxima etapa.',
  expected_post_status_required: 'Não foi possível conferir o status do post. Recarregue e tente de novo.',
  approval_choice_required: 'Escolha como prosseguir com a aprovação.',
  invalid_approval_choice: 'Opção de aprovação inválida.',
  invalid_command: 'Comando inválido.',
  membro_not_found: 'Responsável não encontrado neste workspace.',
  process_not_found: 'Processo não encontrado.',
  process_changed: 'Este processo foi alterado em outro lugar. Recarregue e tente de novo.',
  process_not_active: 'Este processo não está em andamento.',
  process_not_concluded: 'Só um processo concluído pode ser reaberto.',
  process_already_closed: 'Este processo já foi encerrado.',
  step_not_found: 'Etapa não encontrada.',
  step_not_editable: 'Só etapas pendentes ou em andamento podem ser editadas.',
  no_next_step: 'Não há próxima etapa. Use "Concluir processo".',
  no_previous_step: 'Esta já é a primeira etapa.',
  pending_steps_remaining: 'Ainda há etapas pendentes. Avance até a última antes de concluir.',
  request_id_required: 'Não foi possível identificar a operação. Tente de novo.',
  request_not_found: 'Não foi possível identificar a operação. Tente de novo.',
  request_mismatch: 'A seleção mudou desde a última tentativa. Feche o diálogo e tente de novo.',
};

/** Códigos que significam "seu estado local está velho": além do toast, refetch. */
export const STALE_STATE_CODES: ReadonlySet<string> = new Set([
  'workflow_changed',
  'process_changed',
  'post_changed',
  'template_changed',
  'request_mismatch',
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
