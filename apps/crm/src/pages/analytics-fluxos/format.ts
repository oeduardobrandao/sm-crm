import type { StatDelta } from '@/components/StatCard';

/**
 * Formatting shared by the KPI row, the two tables and the CSV export, so the
 * number a user reads on screen is byte-for-byte the number they export.
 */

/** Value shown where a metric has no samples at all. Never a dash: a dash reads
 *  as "zero" to some people and as "loading" to others. */
export const SEM_DADOS = 'Sem dados';

/**
 * Below this many rated etapas a pontualidade percentage is noise: one late
 * etapa out of two reads as "50% pontual", a verdict the sample cannot support.
 * Shared with the CSV so the export never states a number the page refuses to.
 */
export const MIN_AVALIADAS = 3;

/** What both the table and the export print in place of that unsupported number. */
export const POUCOS_DADOS = 'Poucos dados';

export const POUCOS_DADOS_TOOLTIP = 'Menos de 3 etapas avaliadas no período';

/** Pontualidade of one membro: a percentage, or POUCOS_DADOS under the floor. */
export function formatPontualidadeMembro(noPrazo: number, avaliadas: number): string {
  if (avaliadas < MIN_AVALIADAS) return POUCOS_DADOS;
  return `${Math.round((noPrazo / avaliadas) * 100)}%`;
}

/**
 * Negative durations are theoretically reachable: the RPC derives etapa
 * durations from `iniciado_em`/`concluido_em`, and a hand-edited row can order
 * those backwards. The backend fix is deferred (see the Fase 2 ledger, ruling
 * on negative durations), so DISPLAY clamps at zero rather than printing
 * "-2d 3h", which would read as a bug in the page instead of in the data.
 */
function clampDias(dias: number): number {
  return Math.max(0, dias);
}

/** Fractional days as `Xd Yh` (5.75 -> "5d 18h"). Hours-only below a day. */
export function formatDiasHoras(dias: number): string {
  const totalHoras = Math.round(clampDias(dias) * 24);
  const d = Math.floor(totalHoras / 24);
  const h = totalHoras % 24;
  if (d === 0) return `${h}h`;
  if (h === 0) return `${d}d`;
  return `${d}d ${h}h`;
}

/** Fractional days as a bare pt-BR decimal (`5.0` -> "5,0"), for columns whose
 *  header already carries the unit (the CSV export). */
export function formatDiasNumero(dias: number | null): string {
  if (dias === null) return SEM_DADOS;
  return clampDias(dias).toFixed(1).replace('.', ',');
}

/** Fractional days as pt-BR `X,Xd`, the density the tables need. */
export function formatDiasDecimal(dias: number | null): string {
  if (dias === null) return SEM_DADOS;
  return `${formatDiasNumero(dias)}d`;
}

/** Rounded percentage with the sign, or SEM_DADOS when the metric is null. */
export function formatPct(pct: number | null): string {
  if (pct === null) return SEM_DADOS;
  return `${Math.round(pct)}%`;
}

/**
 * Percent change between the current window and the previous one.
 *
 * Returns null when there is nothing to compare against (`prev` null or zero):
 * a "+100%" against an empty window is noise, and StatCard falls back to its
 * `sub` line in that case. A real change of exactly zero is still a delta, and
 * renders as 'stable'.
 */
export function buildDelta(
  current: number | null,
  prev: number | null,
  caption = 'vs período anterior',
): StatDelta | null {
  if (current === null || prev === null || prev === 0) return null;
  const percent = ((current - prev) / prev) * 100;
  const direction = percent === 0 ? 'stable' : percent > 0 ? 'up' : 'down';
  return { direction, percent, caption };
}

/** 'YYYY-MM-DD' (the RPC's week key) as pt-BR 'dd/MM'. Parsed by hand: `new
 *  Date('2026-08-04')` is UTC midnight and shifts a day west of Greenwich. */
export function formatSemanaCurta(semana: string): string {
  const [, mes, dia] = semana.split('-');
  if (!mes || !dia) return semana;
  return `${dia}/${mes}`;
}

/** Same key as full pt-BR 'dd/MM/yyyy', for the chart tooltip title. */
export function formatSemanaLonga(semana: string): string {
  const [ano, mes, dia] = semana.split('-');
  if (!ano || !mes || !dia) return semana;
  return `${dia}/${mes}/${ano}`;
}
