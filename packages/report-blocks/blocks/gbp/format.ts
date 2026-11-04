// Formatação dos blocos do Google Meu Negócio. As datas da seção (window, daily, keywords.month)
// são strings YYYY-MM-DD / YYYY-MM do fuso de São Paulo: lidas por split, nunca por new Date()
// (que em UTC-3 imprimiria o dia anterior). period.endExclusive e highlight.date são ISO e usam
// getters UTC, como fmtPeriodStamp.
import type { GoogleReportSnapshot, ReportDocSnapshot } from '../../types';
import { MONTHS_PT_LOWER } from '../../format';

type GoogleWindow = NonNullable<NonNullable<ReportDocSnapshot['google']>['window']>;

/** Nota média com uma casa decimal pt-BR: 4.82 -> "4,8". Nunca passa por fmtCount. */
export function fmtRating(n: number): string {
  return n.toFixed(1).replace('.', ',');
}

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return [y, m, d];
}

/** Dias de start a end, inclusive (datas YYYY-MM-DD). */
export function daysInclusive(start: string, end: string): number {
  const [ys, ms, ds] = parts(start);
  const [ye, me, de] = parts(end);
  return Math.round((Date.UTC(ye, me - 1, de) - Date.UTC(ys, ms - 1, ds)) / 86_400_000) + 1;
}

/** "18 de julho" a partir de YYYY-MM-DD (ou ISO, pelos dez primeiros caracteres). */
export function fmtDayMonth(date: string): string {
  const [, m, d] = parts(date);
  return `${d} de ${MONTHS_PT_LOWER[m - 1]}`;
}

/** "Julho de 2026" a partir de YYYY-MM. */
export function fmtMonthYear(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const name = MONTHS_PT_LOWER[m - 1] ?? '';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${y}`;
}

/** "dd/mm" a partir de YYYY-MM-DD. */
export function fmtDayShort(date: string): string {
  const [, m, d] = date.split('-');
  return m && d ? `${d}/${m}` : date;
}

/** Último dia do mês do relatório (YYYY-MM-DD) a partir de period.endExclusive. */
function lastDayOfReportMonth(endExclusive: string): string {
  const last = new Date(Date.parse(endExclusive) - 86_400_000);
  const m = String(last.getUTCMonth() + 1).padStart(2, '0');
  const d = String(last.getUTCDate()).padStart(2, '0');
  return `${last.getUTCFullYear()}-${m}-${d}`;
}

/** Estampa dos blocos GMN a partir da janela da seção: "01–31 de outubro", ou
 * "01–29 de outubro · parcial" quando a janela termina antes do último dia do mês. Nunca usa
 * period.effectiveEnd do Instagram. null sem janela (nada sincronizado no mês). */
export function fmtWindowStamp(win: GoogleWindow | null, endExclusive: string): string | null {
  if (!win) return null;
  const [, , startDay] = parts(win.start);
  const [, endMonth, endDay] = parts(win.end);
  const range = `${String(startDay).padStart(2, '0')}–${String(endDay).padStart(2, '0')} de ${MONTHS_PT_LOWER[endMonth - 1]}`;
  return win.end < lastDayOfReportMonth(endExclusive) ? `${range} · parcial` : range;
}

/** Plural simples pt-BR: "1 avaliação", "612 avaliações". */
export function plural(n: number, one: string, other: string): string {
  return n === 1 ? one : other;
}

/** Seção Google com dado: null sem seção ou sem janela (nada sincronizado no mês; o loader
 * zera as linhas por unidade, que não podem virar cartões de zeros). Mesma regra do
 * blockHasData. */
export function googleWithData(snapshot: ReportDocSnapshot): GoogleReportSnapshot | null {
  const g = snapshot.google;
  return g && g.window ? g : null;
}
