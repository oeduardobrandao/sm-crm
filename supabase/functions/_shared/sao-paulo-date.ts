// São Paulo calendar helpers (admin metrics snapshots, Instagram best-times). Brazil abolished daylight saving time in
// 2019, so America/Sao_Paulo is a fixed UTC-3 and plain offset arithmetic is exact.

const SP_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Marker on the instagram-analytics `best_times` cache payload: the grid is bucketed on the
 * São Paulo wall clock. Rows cached before that change were bucketed in UTC and lack it. */
export const BEST_TIMES_TIMEZONE = "America/Sao_Paulo";

/** Weekday (Monday = 0 … Sunday = 6) and hour (0-23) of the instant on the São Paulo wall clock.
 * The edge runtime runs in UTC, so plain getDay()/getHours() would bucket by UTC instead. */
export function saoPauloWeekdayHour(instant: Date): { day: number; hour: number } {
  const local = new Date(instant.getTime() - SP_OFFSET_MS);
  return { day: (local.getUTCDay() + 6) % 7, hour: local.getUTCHours() };
}

/** Calendar date (YYYY-MM-DD) in São Paulo at the given instant. */
export function saoPauloDate(now: Date): string {
  return new Date(now.getTime() - SP_OFFSET_MS).toISOString().slice(0, 10);
}

/** The metrics close of São Paulo date D: 23:44 local, i.e. D+1 at 02:44 UTC (the cron tick). */
export function closeInstant(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1, 2, 44, 0));
}

/** Last calendar day (YYYY-MM-DD) of month 'YYYY-MM'. */
export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Inclusive list of months 'YYYY-MM' from `from` to `to`; empty when from > to. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** The month before 'YYYY-MM'. */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
