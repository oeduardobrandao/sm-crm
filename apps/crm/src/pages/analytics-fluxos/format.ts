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

/**
 * Fractional HOURS as a compact duration: `0.75` -> "45min", `3` -> "3h",
 * `3.33` -> "3h 20min", `28` -> "1d 4h".
 *
 * Separate from formatDiasHoras because the approval-latency metrics arrive in
 * hours and are routinely sub-day: rounding those to the nearest hour would
 * print "0h" for a client who answers in twenty minutes, which reads as broken
 * rather than as fast. Minutes therefore survive below a day and are dropped
 * above it, where they are noise.
 */
export function formatHoras(horas: number): string {
  const totalMin = Math.round(Math.max(0, horas) * 60);
  if (totalMin < 60) return `${totalMin}min`;
  const totalHoras = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (totalHoras < 24) return min === 0 ? `${totalHoras}h` : `${totalHoras}h ${min}min`;
  const d = Math.floor(totalHoras / 24);
  const h = totalHoras % 24;
  return h === 0 ? `${d}d` : `${d}d ${h}h`;
}

/** Same, but nullable metrics get SEM_DADOS instead of a fabricated "0min". */
export function formatHorasOuSemDados(horas: number | null): string {
  if (horas === null) return SEM_DADOS;
  return formatHoras(horas);
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

/**
 * `workflows.created_via` for humans. The column is `text NOT NULL CHECK IN
 * ('human','agent')`, but the check is the database's, not this function's:
 * anything unrecognised reads as a human, so a future value can never surface
 * as a raw column value on screen or in an export.
 */
export function origemLabel(origem: string): string {
  return origem === 'agent' ? 'Agente' : 'Humano';
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

/**
 * Change in PERCENTAGE POINTS between the two windows, for a metric that is
 * already a percentage.
 *
 * A relative delta on a percentage is a lie by arithmetic: 61% against 69% is
 * "8 points down", not "11.6% down", and the second number is the one people
 * quote in a meeting.
 *
 * The two sample counts are OPTIONAL, because the metrics differ in how they
 * report "no sample". Pontualidade can hand back a non-null percentage while
 * the previous window rated nothing, so it must pass its counts and a delta
 * against nothing is refused. Retrabalho already encodes the same fact in the
 * value: its NULLIF makes the percentage null whenever the window held no
 * event, so the null check above IS its sample guard and passing a fabricated
 * `1, 1` would only add a lie to satisfy the signature.
 *
 * `percent` carries the ABSOLUTE point difference because StatCard renders
 * `Math.abs(percent)` next to a direction arrow; the sign lives in `direction`.
 */
export function buildDeltaPp(
  current: number | null,
  prev: number | null,
  avaliadas?: number,
  avaliadasPrev?: number,
  caption = 'vs período anterior (pp)',
): StatDelta | null {
  if (current === null || prev === null) return null;
  if (avaliadas !== undefined && avaliadas <= 0) return null;
  if (avaliadasPrev !== undefined && avaliadasPrev <= 0) return null;
  const diff = current - prev;
  const direction = diff === 0 ? 'stable' : diff > 0 ? 'up' : 'down';
  return { direction, percent: Math.abs(diff), caption };
}

/**
 * An ISO timestamp as pt-BR 'dd/MM/yyyy', or null when there is nothing to
 * show. Unlike the week keys below this really is a full timestamptz, so it is
 * parsed by Date and rendered in the viewer's local time on purpose: the
 * horizon is "since when do we have data", and an off-by-one-day in the user's
 * own timezone would be the confusing rendering, not the honest one.
 */
export function formatDataCurta(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${d.getFullYear()}`;
}

/** 'Registrado desde dd/MM/yyyy', or null when that event source has no rows
 *  yet — in which case the caption is omitted rather than shown empty. */
export function horizonteCaption(iso: string | null): string | null {
  const data = formatDataCurta(iso);
  return data ? `Registrado desde ${data}` : null;
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
