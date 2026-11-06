// YouTube analytics windows (Phase 2 plan, "Shared sync semantics" > Windows). Every boundary is an
// America/Los_Angeles calendar day: the Analytics API reports Pacific days and the sync stores them
// as returned. Windows end at the channel's `data_through`, never at today:
//   ?days=N       -> [data_through - N + 1, data_through], previous = the N days before it.
//   ?start&end    -> end clipped to data_through; the previous window has the clipped length.
//   data_through null (first sync, or a revoked channel after its purge) -> no data.

export interface YtWindow {
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
} // YYYY-MM-DD, Pacific, inclusive

export type YtWindowRequest = { days: number } | { start: string; end: string };

export interface ResolvedYtWindow {
  window: YtWindow;
  /** False before the first sync, or when the range lies entirely after `data_through`. */
  hasData: boolean;
}

export const YT_WINDOW_DAYS = [7, 28, 90] as const;
export const YT_DEFAULT_DAYS = 28;
export const YT_MAX_RANGE_DAYS = 365;

const DAY_MS = 86400 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LA_TZ = "America/Los_Angeles";

/** Epoch ms of UTC midnight of a YYYY-MM-DD string; null when malformed or not a real date. */
function dayMs(date: string): number | null {
  if (!DATE_RE.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === date ? ms : null;
}

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** `date` plus `n` calendar days (n may be negative). */
export function addDays(date: string, n: number): string {
  return isoDay((dayMs(date) as number) + n * DAY_MS);
}

/** Inclusive number of days in [start, end]. */
export function spanDays(start: string, end: string): number {
  return Math.round(((dayMs(end) as number) - (dayMs(start) as number)) / DAY_MS) + 1;
}

const LA_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: LA_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const LA_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Calendar date (YYYY-MM-DD) in Los Angeles at the given instant. */
export function laDate(now: Date): string {
  return LA_DATE.format(now);
}

/** Los Angeles wall clock minus UTC at `instantMs`, in ms (-7 h in PDT, -8 h in PST). */
function laOffsetMs(instantMs: number): number {
  const parts = LA_PARTS.formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - Math.floor(instantMs / 1000) * 1000;
}

/** UTC instant of the Los Angeles midnight that opens `date` (DST-aware). */
export function laDayStartIso(date: string): string {
  const wallMidnight = dayMs(date) as number;
  // Two passes: the offset at the first guess can differ from the offset at the real instant.
  let instant = wallMidnight - laOffsetMs(wallMidnight);
  instant = wallMidnight - laOffsetMs(instant);
  return new Date(instant).toISOString();
}

function build(start: string, end: string): YtWindow {
  const span = spanDays(start, end);
  return { start, end, prevStart: addDays(start, -span), prevEnd: addDays(start, -1) };
}

/** `?days` (7, 28 or 90) or `?start&end` (both valid, start <= end, at most 365 days). No
 * parameter means the default 28 days; anything else, including both forms at once, is null. */
export function parseYtWindowRequest(params: URLSearchParams): YtWindowRequest | null {
  const start = params.get("start");
  const end = params.get("end");
  const days = params.get("days");
  if (start !== null || end !== null) {
    if (days !== null || !start || !end) return null;
    const startMs = dayMs(start);
    const endMs = dayMs(end);
    if (startMs === null || endMs === null || endMs < startMs) return null;
    if (spanDays(start, end) > YT_MAX_RANGE_DAYS) return null;
    return { start, end };
  }
  if (days === null) return { days: YT_DEFAULT_DAYS };
  if (!/^\d+$/.test(days)) return null;
  const n = parseInt(days, 10);
  return (YT_WINDOW_DAYS as readonly number[]).includes(n) ? { days: n } : null;
}

/** The window a request reads, anchored at `dataThrough`. Without a watermark the window is
 * anchored at the Los Angeles today of `now`, only so the response keeps its shape. */
export function resolveYtWindow(req: YtWindowRequest, dataThrough: string | null, now: Date): ResolvedYtWindow {
  if ("days" in req) {
    const anchor = dataThrough ?? laDate(now);
    return { window: build(addDays(anchor, -(req.days - 1)), anchor), hasData: dataThrough !== null };
  }
  if (dataThrough === null) return { window: build(req.start, req.end), hasData: false };
  const end = req.end < dataThrough ? req.end : dataThrough;
  // The whole range is past the last reported day: keep the requested window, with no data.
  if (end < req.start) return { window: build(req.start, req.end), hasData: false };
  return { window: build(req.start, end), hasData: true };
}

/** Every day of [start, end], oldest first. */
export function daysOf(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
