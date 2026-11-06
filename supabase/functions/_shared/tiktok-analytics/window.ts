// TikTok analytics windows. Every boundary is an America/Sao_Paulo calendar day (fixed UTC-3, no
// DST since 2019), and a window [start, end] is inclusive whole SP days.
import { saoPauloDate } from "../sao-paulo-date.ts";

export interface AnalyticsWindow {
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
} // YYYY-MM-DD, SP, inclusive

const DAY_MS = 86400 * 1000;
const MAX_SPAN_DAYS = 730;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Epoch ms of UTC midnight of a YYYY-MM-DD string; null when malformed or not a real date. */
function dayMs(date: string): number | null {
  if (!DATE_RE.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === date ? ms : null;
}

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function build(startMs: number, endMs: number): AnalyticsWindow {
  const spanDays = Math.round((endMs - startMs) / DAY_MS) + 1;
  return {
    start: isoDay(startMs),
    end: isoDay(endMs),
    prevStart: isoDay(startMs - spanDays * DAY_MS),
    prevEnd: isoDay(startMs - DAY_MS),
  };
}

/** The last `days` SP days, ending on the SP today of `now`. The previous window has the same
 * length and ends the day before `start`. */
export function windowFromDays(days: number, now: Date): AnalyticsWindow {
  const endMs = dayMs(saoPauloDate(now)) as number;
  return build(endMs - (days - 1) * DAY_MS, endMs);
}

/** A window from an explicit inclusive range; null on malformed or inverted input or a span
 * over 730 days. */
export function windowFromRange(start: string, end: string): AnalyticsWindow | null {
  const startMs = dayMs(start);
  const endMs = dayMs(end);
  if (startMs === null || endMs === null || endMs < startMs) return null;
  const spanDays = Math.round((endMs - startMs) / DAY_MS) + 1;
  if (spanDays > MAX_SPAN_DAYS) return null;
  return build(startMs, endMs);
}

/** UTC instant of the SP midnight that opens `date`. */
export function spDayStartIso(date: string): string {
  return `${date}T03:00:00.000Z`;
}

/** UTC instant of the SP midnight that opens the day after `date` (exclusive upper bound). */
export function spDayEndExclusiveIso(date: string): string {
  const ms = dayMs(date) as number;
  return `${isoDay(ms + DAY_MS)}T03:00:00.000Z`;
}
