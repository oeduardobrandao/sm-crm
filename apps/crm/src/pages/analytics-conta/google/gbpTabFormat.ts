// Period and formatting helpers for the client Google Meu Negócio tab (desktop and phone).
// Dates from the server are plain YYYY-MM-DD / YYYY-MM strings (São Paulo days): they are read
// at UTC noon and formatted in UTC, so no time zone moves them to the day before.
import type { AnalyticsRange, GbpOverview } from '../../../services/gbpAnalytics';

/** The tab's own presets (not YouTube's 7/28/90): the server accepts exactly these `days`. */
export const GBP_PERIOD_DAYS = [7, 30, 90] as const;
export const GBP_DEFAULT_RANGE: AnalyticsRange = { days: 30 };
/** The server's longest `start..end` window (18 months, the GMN backfill). */
export const GBP_MAX_CUSTOM_DAYS = 548;

const DAY_MS = 86_400_000;

const isEn = (language: string) => language.startsWith('en');
const locale = (language: string) => (isEn(language) ? 'en-US' : 'pt-BR');

/** `YYYY-MM-DD` → epoch ms at UTC noon. */
const dayMs = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Yesterday in São Paulo, YYYY-MM-DD: the latest day Google could have reported. */
function spYesterday(now: Date): string {
  const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  return isoDay(dayMs(today) - DAY_MS);
}

/**
 * "Personalizado": the server takes only 7, 30 or 90 as `days`, so a custom count becomes a
 * `start..end` range of that length ending on `data_through` (or São Paulo yesterday before the
 * first sync; the server clips the end to `data_through` either way).
 */
export function customRange(
  days: number,
  dataThrough: string | null,
  now: Date = new Date(),
): { start: string; end: string } {
  const end = dataThrough ?? spYesterday(now);
  return { start: isoDay(dayMs(end) - (days - 1) * DAY_MS), end };
}

const spanDays = (start: string, end: string) =>
  Math.round((dayMs(end) - dayMs(start)) / DAY_MS) + 1;

/** Inclusive length of the window the server resolved (after clipping). */
export const windowDays = (window: GbpOverview['window']): number =>
  spanDays(window.start, window.end);

/** Days of the requested period, for the custom "Últimos N dias" line. */
export const rangeLength = (range: AnalyticsRange): number =>
  'days' in range ? range.days : spanDays(range.start, range.end);

/** "27 de out." / "Oct 27". */
export function formatDayMonth(iso: string, language: string): string {
  return new Intl.DateTimeFormat(locale(language), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(dayMs(iso));
}

/** The date inside a sentence that ends in a period: "27 de out" so the copy adds the dot. */
export const formatNoteDate = (iso: string, language: string): string =>
  formatDayMonth(iso, language).replace(/\.$/, '');

/** `YYYY-MM` → "Set." (the month control) or "setembro" (the card subtitle). */
export function formatMonth(month: string, language: string, style: 'short' | 'long'): string {
  const label = new Intl.DateTimeFormat(locale(language), { month: style, timeZone: 'UTC' }).format(
    dayMs(`${month}-01`),
  );
  return style === 'short' ? label.charAt(0).toUpperCase() + label.slice(1) : label;
}

/** A count, pt-BR; from 10 mil up it is compact ("24,8 mil"), as on board 4. */
export function formatGbpCount(n: number): string {
  if (Math.abs(n) >= 10_000) {
    return new Intl.NumberFormat('pt-BR', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(n);
  }
  return n.toLocaleString('pt-BR');
}

/** A star rating with one decimal: 4.7 → "4,7". */
export const formatRating = (n: number): string =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** A signed rating change with one decimal: 0.1 → "+0,1". */
export function formatRatingDelta(diff: number): string {
  const rounded = Math.round(diff * 10) / 10;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  return `${sign}${formatRating(Math.abs(rounded))}`;
}

/** Whole percent of a part, 0 when there is no total. */
export const pctOf = (part: number, total: number): number =>
  total > 0 ? Math.round((part / total) * 100) : 0;
