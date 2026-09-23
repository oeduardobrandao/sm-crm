import { addDays, dayDiff, dayNum, type DeadlineInfo } from './etapaPrazo';

// Pure logic for the "Minha fila" view and the dashboard teaser. No React, no
// fetching. Spec: docs/superpowers/specs/2026-09-23-minha-fila-design.md.

/** Seções da fila, na ordem de exibição. Tipo próprio: PrazoPreset (filtro)
 *  é serializado em URL e vistas salvas e tem faixas sobrepostas (proximos7
 *  inclui hoje e amanhã); aqui as faixas são disjuntas. */
export type FilaBucket = 'atrasado' | 'hoje' | 'amanha' | 'proximos7' | 'depois' | 'sem_prazo';

export const FILA_BUCKET_ORDER: FilaBucket[] = [
  'atrasado',
  'hoje',
  'amanha',
  'proximos7',
  'depois',
  'sem_prazo',
];

export const FILA_BUCKET_LABELS: Record<FilaBucket, string> = {
  atrasado: 'Atrasado',
  hoje: 'Hoje',
  amanha: 'Amanhã',
  proximos7: 'Próximos 7 dias',
  depois: 'Depois',
  sem_prazo: 'Sem prazo',
};

export type FilaMargem =
  | { kind: 'sem_margem' | 'dias'; dias: number }
  | { kind: 'sem_data' }
  | { kind: 'sem_prazo' };

/**
 * Bucket exclusivo de uma linha. `estourado` vem da flag (getDeadlineInfo trata
 * data_limite como fim do dia; etapaDeadlineDateOf devolve a meia-noite local
 * do mesmo campo, então comparar prazoDate < now marcaria às 00:01 uma etapa
 * que vence hoje). A comparação por dia local depois disso só existe para o
 * cache velho: deadline congelado num refetch de ontem, prazoDate de ontem.
 */
export function filaBucketOf(
  prazoDate: Date | null,
  deadline: DeadlineInfo,
  now: Date,
): FilaBucket {
  if (deadline.estourado) return 'atrasado';
  if (!prazoDate) return 'sem_prazo';
  const day = dayNum(prazoDate);
  const today = dayNum(now);
  if (day < today) return 'atrasado';
  if (day === today) return 'hoje';
  if (day === dayNum(addDays(now, 1))) return 'amanha';
  if (day <= dayNum(addDays(now, 7))) return 'proximos7';
  return 'depois';
}

/** Dias de calendário locais entre o prazo da etapa e a data de publicação. */
export function margemOf(scheduledAt: string | null, prazoDate: Date | null): FilaMargem {
  if (!prazoDate) return { kind: 'sem_prazo' };
  if (!scheduledAt) return { kind: 'sem_data' };
  const publica = new Date(scheduledAt);
  if (isNaN(publica.getTime())) return { kind: 'sem_data' };
  const dias = dayDiff(publica, prazoDate);
  return dias <= 0 ? { kind: 'sem_margem', dias } : { kind: 'dias', dias };
}
