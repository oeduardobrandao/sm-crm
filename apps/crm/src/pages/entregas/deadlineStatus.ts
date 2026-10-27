import { i18n } from '@mesaas/i18n';
import type { BoardCard } from './hooks/useEntregasData';

/** Matches StatusFilter in components/EntregasFilters.tsx — same string values. */
export type DeadlineStatus = 'atrasado' | 'urgente' | 'em_dia';

export const DEADLINE_STATUS_ORDER: DeadlineStatus[] = ['em_dia', 'urgente', 'atrasado'];

/**
 * Canonical presentation of the three deadline buckets. cssVar points at the
 * theme token; fallback is the token's light/dark-invariant hex, used only
 * where CSS variables cannot reach (canvas charts, jsdom).
 */
export const DEADLINE_STATUS: Record<
  DeadlineStatus,
  { label: string; cssVar: string; fallback: string }
> = {
  em_dia: {
    get label() {
      return i18n.t('entregas:deadlineStatus.em_dia');
    },
    cssVar: '--success',
    fallback: '#3ecf8e',
  },
  urgente: {
    get label() {
      return i18n.t('entregas:deadlineStatus.urgente');
    },
    cssVar: '--warning',
    fallback: '#f5a342',
  },
  atrasado: {
    get label() {
      return i18n.t('entregas:deadlineStatus.atrasado');
    },
    cssVar: '--danger',
    fallback: '#f55a42',
  },
};

/** Single source of the estourado/urgente precedence rule. */
export function classifyDeadline(deadline: BoardCard['deadline']): DeadlineStatus {
  if (deadline.estourado) return 'atrasado';
  if (deadline.urgente) return 'urgente';
  return 'em_dia';
}

export function computeDeadlineStats(cards: BoardCard[]): Record<DeadlineStatus, number> {
  const stats: Record<DeadlineStatus, number> = { atrasado: 0, urgente: 0, em_dia: 0 };
  for (const card of cards) stats[classifyDeadline(card.deadline)]++;
  return stats;
}
