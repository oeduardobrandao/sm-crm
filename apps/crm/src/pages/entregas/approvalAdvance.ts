import { CLIENT_CLEARED_STATUSES } from '../../store';

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
