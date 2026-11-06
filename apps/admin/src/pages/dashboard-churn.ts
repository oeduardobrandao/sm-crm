import type { EndedKind, EndedWorkspace } from '../lib/api';

export type ChurnView = 'todos' | 'churn' | 'trial_expired';

export const ENDED_KIND_LABEL: Record<EndedKind, string> = {
  churn: 'Cancelou',
  trial_expired: 'Teste encerrado',
  unknown: 'Sem histórico',
};

export const ENDED_KIND_HINT: Record<EndedKind, string> = {
  churn: 'Pagou ao menos um período e cancelou',
  trial_expired: 'O teste terminou sem nenhum pagamento',
  unknown: 'Encerrou antes do histórico diário (25/09/2026); não dá para saber se pagou',
};

/** 'todos' keeps every row, including 'unknown'; the other views match the kind exactly. */
export function filterEnded(rows: EndedWorkspace[], view: ChurnView): EndedWorkspace[] {
  if (view === 'todos') return rows;
  return rows.filter((r) => r.kind === view);
}
