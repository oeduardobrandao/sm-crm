// Calendar helpers for the admin metrics snapshots. Brazil abolished daylight saving time in
// 2019, so America/Sao_Paulo is a fixed UTC-3 and plain offset arithmetic is exact.

const SP_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Calendar date (YYYY-MM-DD) in São Paulo at the given instant. */
export function saoPauloDate(now: Date): string {
  return new Date(now.getTime() - SP_OFFSET_MS).toISOString().slice(0, 10);
}

/** The metrics close of São Paulo date D: 23:47 local, i.e. D+1 at 02:47 UTC (the cron tick). */
export function closeInstant(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1, 2, 47, 0));
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
