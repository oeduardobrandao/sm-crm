// Formatting and period helpers for the client TikTok tab (desktop now, phone in A9).
import type { CSSProperties } from 'react';
import { format } from 'date-fns';
import { enUS, ptBR } from 'date-fns/locale';
import type { AnalyticsRange, KpiEntry } from '../../../services/tiktokAnalytics';
import { spDayStartMs } from '../../analytics-tiktok/videoRanking';

/** Where a plan-locked section sends the user. */
export { BILLING_PATH } from '../AnalyticsStateCards';

/** Same floor the Instagram heatmap uses before it ranks time slots. */
export const MIN_BEST_TIME_VIDEOS = 5;

/** Last period's numbers stay on screen, dimmed, while the new period loads. */
export const dimmed = (stale: boolean): CSSProperties => ({
  opacity: stale ? 0.55 : 1,
  transition: 'opacity 150ms ease',
});

/** The account AI route accepts `days` in 1..365 only. */
const AI_MAX_DAYS = 365;
const DAY_MS = 86_400_000;

/** A count, pt-BR; a missing one reads "—", never 0. */
export const formatCount = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : n.toLocaleString('pt-BR');

/** A percent (0-100) with one decimal, pt-BR: 6.8 → "6,8%". Null reads "—", never 0%. */
export const formatRate = (v: number | null | undefined): string =>
  v === null || v === undefined
    ? '—'
    : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** A KPI value in its unit; null means "no data" and is left to the caller. */
export const formatKpi = (entry: Pick<KpiEntry, 'unit'>, v: number): string =>
  entry.unit === 'pct' ? formatRate(v) : formatCount(v);

/** Video length in seconds → "m:ss". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) return '—';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatVideoDate(iso: string | null, language: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return language.startsWith('en')
    ? format(d, 'MMM d, yyyy', { locale: enUS })
    : format(d, 'dd/MM/yyyy', { locale: ptBR });
}

/** Today's date in São Paulo, YYYY-MM-DD. */
function spToday(now: Date): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/** The previous calendar month in São Paulo, as an inclusive range. */
export function lastMonthRange(now: Date = new Date()): { start: string; end: string } {
  const [y, m] = spToday(now)
    .split('-')
    .map((p) => parseInt(p, 10));
  const year = m === 1 ? y - 1 : y;
  const month = m === 1 ? 12 : m - 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

/** Inclusive length of a range in days. */
export function rangeDays(range: AnalyticsRange): number {
  if ('days' in range) return range.days;
  return Math.round((Date.parse(range.end) - Date.parse(range.start)) / DAY_MS) + 1;
}

/** The `days` the AI route is sent: the tab's window, capped at the route's 365. */
export const aiDays = (range: AnalyticsRange): number =>
  Math.min(Math.max(rangeDays(range), 1), AI_MAX_DAYS);

/** Period chip: "30d", or "set. 2026" for a calendar month. */
export function periodTag(range: AnalyticsRange, language: string): string {
  if ('days' in range) return `${range.days}d`;
  // Noon of the first day, so no time zone moves it into the previous month.
  const d = new Date(spDayStartMs(range.start) + 12 * 3_600_000);
  return language.startsWith('en')
    ? format(d, 'MMM yyyy', { locale: enUS })
    : format(d, 'MMM yyyy', { locale: ptBR });
}
