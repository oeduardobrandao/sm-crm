// Google Meu Negócio analytics windows (Phase 2 plan, "Shared sync semantics"). GMN days are São
// Paulo dates, and a window never ends after `data_through`: Google back-fills recent days, so
// the sync never stores a day past the watermark and a window ending "today" would compare a
// half-empty week with a full one.
//
// `?days=N` -> [data_through - N + 1, data_through]; the previous window is the N days before.
// `?start&end` -> `end` clipped to data_through; the previous window has the clipped length.
// `data_through` null (no unit synced yet) -> a placeholder window and no data.
import { saoPauloDate } from "../sao-paulo-date.ts";

export interface AnalyticsWindow {
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
} // YYYY-MM-DD, SP, inclusive

export type WindowRequest = { kind: "days"; days: number } | { kind: "range"; start: string; end: string };

export interface ResolvedWindow {
  window: AnalyticsWindow;
  /** False before the first sync, or when the whole requested range lies after data_through. */
  hasData: boolean;
}

export const GBP_WINDOW_DAYS = [7, 30, 90] as const;
export const GBP_DEFAULT_DAYS = 30;
/** The longest backfill (spike S3: 18 months); a longer range has nothing more to show. */
export const GBP_MAX_RANGE_DAYS = 548;

const DAY_MS = 86400 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Epoch ms of UTC midnight of a YYYY-MM-DD string; null when malformed or not a real date. */
export function dayMs(date: string): number | null {
  if (!DATE_RE.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === date ? ms : null;
}

export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** `date` shifted by `days` (negative goes back). */
export const addDays = (date: string, days: number): string => isoDay((dayMs(date) as number) + days * DAY_MS);

const spanDays = (startMs: number, endMs: number): number => Math.round((endMs - startMs) / DAY_MS) + 1;

function build(startMs: number, endMs: number): AnalyticsWindow {
  const span = spanDays(startMs, endMs);
  return {
    start: isoDay(startMs),
    end: isoDay(endMs),
    prevStart: isoDay(startMs - span * DAY_MS),
    prevEnd: isoDay(startMs - DAY_MS),
  };
}

/** Syntax only: `days` in {7, 30, 90} (absent = 30), or both `start` and `end` as real dates with
 * start <= end and a span of at most 548 days. Null on anything else (the caller answers 400). */
export function parseWindowRequest(params: URLSearchParams): WindowRequest | null {
  const start = params.get("start");
  const end = params.get("end");
  if (start !== null || end !== null) {
    if (!start || !end) return null;
    const startMs = dayMs(start);
    const endMs = dayMs(end);
    if (startMs === null || endMs === null || endMs < startMs) return null;
    if (spanDays(startMs, endMs) > GBP_MAX_RANGE_DAYS) return null;
    return { kind: "range", start, end };
  }
  const raw = params.get("days");
  if (raw === null) return { kind: "days", days: GBP_DEFAULT_DAYS };
  if (!/^\d+$/.test(raw)) return null;
  const days = parseInt(raw, 10);
  return (GBP_WINDOW_DAYS as readonly number[]).includes(days) ? { kind: "days", days } : null;
}

/** The window for a request against the selected units' `data_through`. */
export function resolveWindow(req: WindowRequest, dataThrough: string | null, now: Date): ResolvedWindow {
  if (dataThrough === null) {
    // Placeholder so the response keeps its shape: the requested range, or N days ending on SP
    // yesterday (the newest day a first sync could cover).
    if (req.kind === "range") return { window: build(dayMs(req.start)!, dayMs(req.end)!), hasData: false };
    const endMs = (dayMs(saoPauloDate(now)) as number) - DAY_MS;
    return { window: build(endMs - (req.days - 1) * DAY_MS, endMs), hasData: false };
  }
  const dtMs = dayMs(dataThrough) as number;
  if (req.kind === "days") return { window: build(dtMs - (req.days - 1) * DAY_MS, dtMs), hasData: true };

  const startMs = dayMs(req.start) as number;
  const endMs = Math.min(dayMs(req.end) as number, dtMs);
  // The whole range lies after the watermark: nothing stored for it yet.
  if (endMs < startMs) return { window: build(startMs, dayMs(req.end) as number), hasData: false };
  return { window: build(startMs, endMs), hasData: true };
}

/** The earliest watermark across the selected units. A unit that has never synced has no data in
 * any window, so it does not hold the others back; null only when no unit has synced. */
export function minDataThrough(units: { data_through: string | null }[]): string | null {
  let min: string | null = null;
  for (const u of units) {
    if (u.data_through && (min === null || u.data_through < min)) min = u.data_through;
  }
  return min;
}

/** The watermark a window over the selected units ends on. With an active unit that has synced,
 * the earliest watermark among the ACTIVE units: a revoked unit's data_through freezes at
 * revocation and would otherwise hold the window back until its 30-day expiry (its rows still
 * count in the sums). Otherwise (every unit revoked, or no active unit synced yet) the earliest
 * across all of them. A single unit therefore always uses its own watermark. */
export function windowDataThrough(units: { status: string; data_through: string | null }[]): string | null {
  const active = minDataThrough(units.filter((u) => u.status === "active"));
  return active ?? minDataThrough(units);
}

/** Every day of [start, end], oldest first. */
export function daysOf(start: string, end: string): string[] {
  const out: string[] = [];
  const endMs = dayMs(end) as number;
  for (let ms = dayMs(start) as number; ms <= endMs; ms += DAY_MS) out.push(isoDay(ms));
  return out;
}
