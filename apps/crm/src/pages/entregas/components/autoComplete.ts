import type { WorkflowPost } from '../../../store';

/** Post statuses that mean "with the client, awaiting their verdict". */
const AWAITING_CLIENTE = new Set(['enviado_cliente', 'correcao_cliente']);

/**
 * True when, DURING this drawer session, the last post awaiting the client transitioned to
 * aprovado_cliente: prev had >= 1 post awaiting, next has none awaiting and >= 1 aprovado_cliente.
 * The prev-state requirement stops it from firing on drawer open for already-approved cycles.
 */
export function shouldAutoCompleteApproval(
  prevPosts: WorkflowPost[] | null,
  nextPosts: WorkflowPost[],
): boolean {
  if (!prevPosts) return false;
  const prevAwaiting = prevPosts.some((p) => AWAITING_CLIENTE.has(p.status));
  const nextAwaiting = nextPosts.some((p) => AWAITING_CLIENTE.has(p.status));
  const nextApproved = nextPosts.some((p) => p.status === 'aprovado_cliente');
  return prevAwaiting && !nextAwaiting && nextApproved;
}
