const countFmt = new Intl.NumberFormat('pt-BR');

export function fmtCount(n: number): string {
  return countFmt.format(Math.round(n));
}

export function fmtPct(n: number): string {
  return `${n.toFixed(1).replace('.', ',')}%`;
}

/** Delta percentual value vs prev; null quando não computável (prev <= 0). */
export function deltaPct(value: number, prev: number): number | null {
  if (!(prev > 0)) return null;
  return ((value - prev) / prev) * 100;
}

const MONTHS_PT_LOWER = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/**
 * Estampa "DD–DD de mês[ · parcial]" a partir do período real coberto do
 * snapshot (spec de paridade com o app do Instagram, §4.3). Datas do
 * snapshot são timestamps ISO à meia-noite UTC; os dias vêm sempre em UTC
 * para não deslocar com o fuso do navegador.
 *
 * Sem `effectiveEnd` (snapshot antigo, gerado antes deste campo existir)
 * retorna null -- o chamador não estampa período nenhum (mesmo guard do
 * campo `views` nos top posts).
 */
export function fmtPeriodStamp(period: {
  start: string;
  endExclusive: string;
  effectiveEnd?: string;
}): string | null {
  if (!period.effectiveEnd) return null;
  const start = new Date(period.start);
  const effectiveEnd = new Date(period.effectiveEnd);
  const lastDayOfMonthMs = Date.parse(period.endExclusive) - 86_400_000;
  const startDay = String(start.getUTCDate()).padStart(2, '0');
  const endDay = String(effectiveEnd.getUTCDate()).padStart(2, '0');
  const monthName = MONTHS_PT_LOWER[effectiveEnd.getUTCMonth()];
  const range = `${startDay}–${endDay} de ${monthName}`;
  return effectiveEnd.getTime() >= lastDayOfMonthMs ? range : `${range} · parcial`;
}
