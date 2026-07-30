import type { BoardCard } from './hooks/useEntregasData';
import { computeDeadlineDate } from './hooks/useEntregasData';
import { MESES_ABREV } from '@/utils/postDate';

/** Presets for the "Prazo da etapa" filter in the Publicações modes. */
export type PrazoPreset = 'atrasado' | 'hoje' | 'amanha' | 'proximos7';

export const PRAZO_PRESET_LABELS: Record<PrazoPreset, string> = {
  atrasado: 'Atrasado',
  hoje: 'Hoje',
  amanha: 'Amanhã',
  proximos7: 'Próximos 7 dias',
};

export const PRAZO_PRESET_ORDER: PrazoPreset[] = ['atrasado', 'hoje', 'amanha', 'proximos7'];

/**
 * The calendar date the card's current etapa is due, or null when it has no
 * deadline yet (etapa not started and no fixed date). Mirrors getDeadlineInfo's
 * precedence: an explicit data_limite wins over iniciado_em + prazo_dias.
 */
export function etapaDeadlineDate(card: BoardCard): Date | null {
  const { data_limite, iniciado_em, prazo_dias, tipo_prazo } = card.etapa;
  if (data_limite) {
    // 'YYYY-MM-DD' — build via components so the LOCAL day is preserved
    // (new Date('YYYY-MM-DD') parses as UTC midnight and can shift a day).
    const [y, m, d] = data_limite.slice(0, 10).split('-').map(Number);
    if (y && m && d) return new Date(y, m - 1, d);
    return null;
  }
  if (iniciado_em) return computeDeadlineDate(iniciado_em, prazo_dias, tipo_prazo);
  return null;
}

/** Comparable local-day key (yyyymmdd) — avoids ms arithmetic across DST. */
function dayNum(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

/** 'YYYY-MM-DD' → yyyymmdd, or null for empty/malformed input. */
function parseDayInput(s: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return Number(s.replace(/-/g, ''));
}

/**
 * OR-semantics matcher for the "Prazo da etapa" filter, consistent with the
 * other multi-selects: a post matches if its workflow's etapa deadline hits ANY
 * selected preset or falls inside the custom range. An entirely empty filter
 * matches everything; an active filter excludes cards without a deadline.
 */
export function matchesEtapaPrazo(
  card: BoardCard | undefined,
  presets: PrazoPreset[],
  from: string,
  to: string,
  now: Date = new Date(),
): boolean {
  const fromNum = parseDayInput(from);
  const toNum = parseDayInput(to);
  const rangeActive = fromNum != null || toNum != null;
  if (presets.length === 0 && !rangeActive) return true;
  if (!card) return false;

  // 'atrasado' works off the precise estourado flag and needs no calendar date.
  if (presets.includes('atrasado') && card.deadline.estourado) return true;

  const deadline = etapaDeadlineDate(card);
  if (!deadline) return false;
  const day = dayNum(deadline);
  const today = dayNum(now);

  if (presets.includes('hoje') && day === today) return true;
  if (presets.includes('amanha') && day === dayNum(addDays(now, 1))) return true;
  if (presets.includes('proximos7') && day >= today && day <= dayNum(addDays(now, 7))) return true;
  if (rangeActive && (fromNum == null || day >= fromNum) && (toNum == null || day <= toNum))
    return true;
  return false;
}

/** Compact pt-BR calendar day, e.g. "20 jul" (year appended only when it differs). */
export function formatEtapaDeadlineDay(d: Date, now: Date = new Date()): string {
  const ano = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${MESES_ABREV[d.getMonth()]}${ano}`;
}

/** Relative deadline labels with the urgency palette used by the entregas list. */
export function formatEtapaPrazo(deadline: BoardCard['deadline']): {
  label: string;
  shortLabel: string;
  color: string;
} {
  if (deadline.estourado) {
    const d = Math.abs(deadline.diasRestantes);
    return { label: `${d}d atrasado`, shortLabel: `${d}d atr.`, color: '#ef4444' };
  }
  if (deadline.diasRestantes === 0) {
    const h = deadline.horasRestantes;
    return { label: `${h}h restantes`, shortLabel: `${h}h`, color: '#eab308' };
  }
  const d = deadline.diasRestantes;
  return {
    label: `${d}d restantes`,
    shortLabel: `${d}d`,
    color: deadline.urgente ? '#eab308' : 'var(--text-muted)',
  };
}
