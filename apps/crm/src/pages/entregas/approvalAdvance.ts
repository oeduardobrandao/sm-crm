import { CLIENT_CLEARED_STATUSES } from '../../store';

/**
 * A decisão de "avançar uma etapa de aprovação do cliente" (spec §6.2), num
 * único lugar. Antes vivia em três: KanbanView.executeForward,
 * EntregasTab.handleForwardConfirm e o auto-complete do WorkflowDrawer.
 * Fluxos passam `total`/`cleared` das contagens por fluxo e
 * `temAprovacaoAdiante = hasLaterApprovalEtapa(...)` (que ignora status, de
 * propósito). O processo individual passa `total = 1`,
 * `cleared = isClientCleared(post.status) ? 1 : 0` e
 * `temAprovacaoAdiante = hasLaterPendingApprovalStep(...)` (só pendentes).
 */
export interface ApprovalAdvanceInput {
  tipo: 'padrao' | 'aprovacao_cliente' | null | undefined;
  total: number;
  cleared: number;
  temAprovacaoAdiante: boolean;
}

export type ApprovalAdvanceDecision =
  | { kind: 'advance'; willRearm: boolean }
  | { kind: 'choose'; willRearm: boolean };

export function decideApprovalAdvance(input: ApprovalAdvanceInput): ApprovalAdvanceDecision {
  if (input.tipo !== 'aprovacao_cliente') return { kind: 'advance', willRearm: false };
  const allCleared = input.total > 0 && input.cleared === input.total;
  if (allCleared) return { kind: 'advance', willRearm: input.temAprovacaoAdiante };
  return { kind: 'choose', willRearm: input.temAprovacaoAdiante };
}

// Computed lazily (not at module scope): several existing test suites mock
// '@/store' / '../../../../store' wholesale without this export, and this
// module is now pulled in transitively (via KanbanView/EntregasTab) by tests
// that never call isClientCleared. A top-level `new Set(CLIENT_CLEARED_STATUSES)`
// would dereference the mocked module's missing export at import time and
// crash vitest's strict-mock proxy for all of them.
export function isClientCleared(status: string | null | undefined): boolean {
  return status != null && (CLIENT_CLEARED_STATUSES as unknown as string[]).includes(status);
}

export function hasLaterPendingApprovalStep(
  steps: readonly { ordem: number; tipo: string; estado: string }[],
  currentOrdem: number,
): boolean {
  return steps.some(
    (s) => s.ordem > currentOrdem && s.tipo === 'aprovacao_cliente' && s.estado === 'pendente',
  );
}
