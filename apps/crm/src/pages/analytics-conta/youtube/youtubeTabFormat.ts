// Formatting, period and link helpers for the client YouTube tab (desktop and phone).
import type { AnalyticsRange, YtOverview, YtVideoRow } from '../../../services/youtubeAnalytics';

export { dimmed, formatDuration } from '../tiktok/tiktokTabFormat';

/** YouTube's own presets (the Analytics API's 7/28/90-day windows); 28 is the default. */
export const YT_PERIOD_PRESETS = [7, 28, 90] as const;
export const YT_DEFAULT_RANGE: AnalyticsRange = { days: 28 };
/** The channel backfill covers 365 days, so a longer custom window has nothing to show. */
export const YT_MAX_CUSTOM_DAYS = 365;

/** Shorts red and long-video blue, as in mockup 3. */
export const SHORTS_COLOR = '#dc2626';
export const LONG_COLOR = 'var(--an-male)';
/** Chart.js cannot read CSS variables: the light value of `--an-male`. */
export const LONG_COLOR_HEX = '#4285f4';

const DAY_MS = 86_400_000;
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

/** A count, pt-BR; a missing one reads "—", never 0. */
export const formatCount = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : n.toLocaleString('pt-BR');

/** Large counts as "12,4 mil" (from 10 mil up), smaller ones in full: "9.112". */
export const formatCompact = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : Math.abs(n) >= 10_000 ? compact.format(n) : formatCount(n);

/** A net change with its sign: "+284", "-12", "0". */
export const formatSigned = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : n > 0 ? `+${formatCount(n)}` : formatCount(n);

/** Minutes as whole hours, pt-BR: 110400 → "1.840". */
export const formatHours = (minutes: number): string => formatCount(Math.round(minutes / 60));

/** A 0-100 share as a whole percent: 84.2 → "84%". Null reads "—". */
export const formatPct = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : `${Math.round(v)}%`;

/** `part` as a whole percent of `total`; an empty total is 0%, never "sem dados". */
export const sharePct = (part: number, total: number): number =>
  total > 0 ? Math.round((part / total) * 100) : 0;

/** Inclusive length of a range in days. */
export function rangeDays(range: AnalyticsRange): number {
  if ('days' in range) return range.days;
  return Math.round((Date.parse(range.end) - Date.parse(range.start)) / DAY_MS) + 1;
}

/**
 * "Personalizado": the last `days` days ending at `anchor` (the channel's `dataThrough`), sent
 * as `start`/`end` because the server's `?days` takes only the presets.
 */
export function customRange(days: number, anchor: string): { start: string; end: string } {
  const end = dayDate(anchor);
  const start = new Date(end.getTime() - (days - 1) * DAY_MS);
  return { start: start.toISOString().slice(0, 10), end: anchor.slice(0, 10) };
}

/** A preset's day count, or null for a custom window. */
export const presetDays = (range: AnalyticsRange): number | null =>
  'days' in range && (YT_PERIOD_PRESETS as readonly number[]).includes(range.days)
    ? range.days
    : null;

/** Length of the window the server answered for (it clips `end` to `dataThrough`). */
export function windowDaysOf(overview: YtOverview, range: AnalyticsRange): number {
  const { start, end } = overview.window ?? {};
  if (start && end) return Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS) + 1;
  return rangeDays(range);
}

/** A YYYY-MM-DD day at noon UTC, so no time zone moves it to the day before. */
function dayDate(day: string): Date {
  const [y, m, d] = day
    .slice(0, 10)
    .split('-')
    .map((p) => parseInt(p, 10));
  return new Date(Date.UTC(y, m - 1, d, 12));
}

const locale = (language: string) => (language.startsWith('en') ? 'en-US' : 'pt-BR');

/** "Dados até" dates: "25 de out." (pt) / "Oct 25" (en). */
export function formatThrough(day: string, language: string): string {
  return dayDate(day).toLocaleDateString(locale(language), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** The same date ahead of a sentence's own period: "25 de out" + ". O YouTube…", never "out.." */
export const throughInSentence = (day: string, language: string): string =>
  formatThrough(day, language).replace(/\.$/, '');

/**
 * Axis and table dates: "21 out." (pt) / "Oct 21" (en). A timestamp is read in São Paulo
 * time, a YYYY-MM-DD day as itself.
 */
export function formatShortDate(value: string | null, language: string): string {
  if (!value) return '—';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = dateOnly ? dayDate(value) : new Date(value);
  if (isNaN(date.getTime())) return '—';
  const opts: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    timeZone: dateOnly ? 'UTC' : 'America/Sao_Paulo',
  };
  if (language.startsWith('en')) return date.toLocaleDateString('en-US', opts);
  const parts = new Intl.DateTimeFormat('pt-BR', opts).formatToParts(date);
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  return `${day} ${month}`;
}

/** A card "lags" when its own watermark is older than the channel's. */
export const lagging = (through: string | null, dataThrough: string | null): string | null =>
  through && dataThrough && through < dataThrough ? through : null;

/** The channel page from its handle; no handle, no link. */
export function channelUrl(handle: string | null): string | null {
  if (!handle) return null;
  const clean = handle.replace(/^@/, '');
  return clean ? `https://www.youtube.com/@${encodeURIComponent(clean)}` : null;
}

/** A Short opens in the Shorts player, a long video on its watch page. */
export function videoUrl(video: Pick<YtVideoRow, 'videoId' | 'isShort'>): string {
  const id = encodeURIComponent(video.videoId);
  return video.isShort
    ? `https://www.youtube.com/shorts/${id}`
    : `https://www.youtube.com/watch?v=${id}`;
}
