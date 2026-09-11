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
  return etapaDeadlineDateOf(card.etapa);
}

/**
 * Prazo mais curto primeiro: atrasados, depois urgentes, depois em dia; cards
 * sem prazo por último. Empate mantém a ordem manual (position) — é o modo
 * padrão das colunas do board de Fluxos.
 */
export function sortCardsByPrazo(cards: BoardCard[]): BoardCard[] {
  return [...cards].sort((a, b) => {
    const ad = etapaDeadlineDate(a)?.getTime() ?? Infinity;
    const bd = etapaDeadlineDate(b)?.getTime() ?? Infinity;
    if (ad !== bd) return ad - bd;
    return (a.workflow.position ?? 0) - (b.workflow.position ?? 0);
  });
}

/** Minimal shape needed to compute an etapa's deadline. A WorkflowEtapa
 *  satisfies it; a post_process_steps row satisfies it too (nullable
 *  prazo_dias/tipo_prazo, plus the frozen prazo_efetivo). */
export interface EtapaDeadlineFields {
  data_limite?: string | null;
  iniciado_em?: string | null;
  prazo_dias: number | null;
  tipo_prazo: 'corridos' | 'uteis' | null;
  /** Instante congelado da etapa individual (spec §7). Vence sobre os demais. */
  prazo_efetivo?: string | null;
}

/**
 * The ONE deadline function for the mixed board (spec §7: "não criar uma
 * terceira implementação de prazo"). Precedence: prazo_efetivo (instant) →
 * data_limite (local day) → iniciado_em + prazo_dias → null.
 */
export function etapaDeadlineDateOf(etapa: EtapaDeadlineFields): Date | null {
  const { data_limite, iniciado_em, prazo_dias, tipo_prazo, prazo_efetivo } = etapa;
  if (prazo_efetivo) {
    const d = new Date(prazo_efetivo);
    return isNaN(d.getTime()) ? null : d;
  }
  if (data_limite) {
    // 'YYYY-MM-DD' — build via components so the LOCAL day is preserved
    // (new Date('YYYY-MM-DD') parses as UTC midnight and can shift a day).
    const [y, m, d] = data_limite.slice(0, 10).split('-').map(Number);
    if (y && m && d) return new Date(y, m - 1, d);
    return null;
  }
  if (iniciado_em && prazo_dias != null && tipo_prazo)
    return computeDeadlineDate(iniciado_em, prazo_dias, tipo_prazo);
  return null;
}

export type DeadlineInfo = {
  diasRestantes: number;
  horasRestantes: number;
  estourado: boolean;
  urgente: boolean;
};

/**
 * getDeadlineInfo's shape from a frozen instant (post_process_steps.prazo_efetivo).
 * Unlike the data_limite branch of getDeadlineInfo there is NO "+1 day": a
 * timestamptz is the exact moment the etapa is due. With no instant the etapa
 * has no deadline yet (relative step not activated): `fallbackDias` fills
 * diasRestantes the way getDeadlineInfo does for a pending etapa.
 */
export function deadlineFromPrazoEfetivo(
  prazoEfetivo: string | null,
  fallbackDias: number | null,
  now: Date = new Date(),
): DeadlineInfo {
  if (!prazoEfetivo) {
    return {
      diasRestantes: fallbackDias ?? 0,
      horasRestantes: 0,
      estourado: false,
      urgente: false,
    };
  }
  const msRestantes = new Date(prazoEfetivo).getTime() - now.getTime();
  const totalHoras = Math.floor(msRestantes / (1000 * 60 * 60));
  return {
    diasRestantes: Math.floor(totalHoras / 24),
    horasRestantes: totalHoras % 24,
    estourado: msRestantes < 0,
    urgente: msRestantes >= 0 && msRestantes <= 24 * 60 * 60 * 1000,
  };
}

/** Comparable local-day key (yyyymmdd) — avoids ms arithmetic across DST. */
export function dayNum(d: Date): number {
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
 * OR-semantics matcher for the "Prazo da etapa" filter, over an already
 * projected target (any board entity). An entirely empty filter matches
 * everything; an active filter excludes a missing target or one without a
 * deadline. `estourado` comes from the precise deadline flag, not the date.
 */
export function matchesDeadlineFilter(
  target: { deadline: { estourado: boolean }; date: Date | null } | undefined,
  presets: PrazoPreset[],
  from: string,
  to: string,
  now: Date = new Date(),
): boolean {
  const fromNum = parseDayInput(from);
  const toNum = parseDayInput(to);
  const rangeActive = fromNum != null || toNum != null;
  if (presets.length === 0 && !rangeActive) return true;
  if (!target) return false;

  if (presets.includes('atrasado') && target.deadline.estourado) return true;

  const deadline = target.date;
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
  return matchesDeadlineFilter(
    card ? { deadline: card.deadline, date: etapaDeadlineDate(card) } : undefined,
    presets,
    from,
    to,
    now,
  );
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
    return { label: `${d}d atrasado`, shortLabel: `${d}d atr.`, color: 'var(--danger)' };
  }
  if (deadline.diasRestantes === 0) {
    const h = deadline.horasRestantes;
    return { label: `${h}h restantes`, shortLabel: `${h}h`, color: 'var(--warning)' };
  }
  const d = deadline.diasRestantes;
  return {
    label: `${d}d restantes`,
    shortLabel: `${d}d`,
    color: deadline.urgente ? 'var(--warning)' : 'var(--text-muted)',
  };
}
