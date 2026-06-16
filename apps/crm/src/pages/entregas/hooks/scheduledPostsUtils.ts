import type { ScheduledPost } from '../../../store';

/** Local-midnight [start, nextMonthStart) ISO bounds for the given month. */
export function monthRangeISO(month: Date): { startISO: string; endISO: string } {
  const y = month.getFullYear();
  const m = month.getMonth();
  return {
    startISO: new Date(y, m, 1).toISOString(),
    endISO: new Date(y, m + 1, 1).toISOString(),
  };
}

/** Day key from a Date, using LOCAL components: "YYYY-M-D" (month 0-based). */
export function dateDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Day key from an ISO timestamp, bucketed by the viewer's LOCAL day. */
export function localDayKey(iso: string): string {
  return dateDayKey(new Date(iso));
}

export function bucketByLocalDay(posts: ScheduledPost[]): Map<string, ScheduledPost[]> {
  const map = new Map<string, ScheduledPost[]>();
  for (const p of posts) {
    const key = localDayKey(p.scheduled_at);
    const arr = map.get(key);
    if (arr) arr.push(p);
    else map.set(key, [p]);
  }
  return map;
}

/** Cell summary: total scheduled, plus already-posted and failed counts. */
export function summarizeDay(posts: ScheduledPost[]): {
  total: number;
  postados: number;
  falhas: number;
} {
  let postados = 0;
  let falhas = 0;
  for (const p of posts) {
    if (p.status === 'postado') postados++;
    else if (p.status === 'falha_publicacao') falhas++;
  }
  return { total: posts.length, postados, falhas };
}
