import type { StatDelta } from '@/components/StatCard';
import { makeDelta, type BestPostingTimes } from '../../services/analytics';

/** "2026-09" → "Set 2026" (legacy monthly reports). */
export function formatReportMonth(month: string): string {
  const [y, m] = month.split('-');
  const months = [
    'Jan',
    'Fev',
    'Mar',
    'Abr',
    'Mai',
    'Jun',
    'Jul',
    'Ago',
    'Set',
    'Out',
    'Nov',
    'Dez',
  ];
  return `${months[parseInt(m) - 1]} ${y}`;
}

/** Cards that render via StatCard directly: the KpiDelta → StatDelta mapping KpiCard does. */
export function toStatDelta(
  current: number | undefined,
  previous: number | null | undefined,
): StatDelta | undefined {
  if (current == null || previous == null) return undefined;
  const { direction, deltaPercent } = makeDelta(current, previous);
  return { direction, percent: deltaPercent, caption: 'vs período anterior' };
}

export const BEST_TIME_BUCKET_STARTS = [0, 3, 6, 9, 12, 15, 18, 21];

/**
 * The API returns a 7x24 grid but posts are sparse, so cells are aggregated into 3h
 * buckets (weighted by post count); otherwise slots at e.g. 1h or 23h would be invisible
 * in a grid that samples only every 3rd hour.
 */
export function bucketBestTimes(data: BestPostingTimes) {
  const cols = data.heatmap[0]?.length ?? 0;
  const bucketSize = cols >= 24 ? 3 : 1;
  const buckets = data.labels_days.map((_, d) =>
    BEST_TIME_BUCKET_STARTS.map((start, b) => {
      let eng = 0;
      let n = 0;
      for (let i = 0; i < bucketSize; i++) {
        const h = bucketSize === 3 ? start + i : b;
        eng += (data.heatmap[d]?.[h] ?? 0) * (data.counts[d]?.[h] ?? 0);
        n += data.counts[d]?.[h] ?? 0;
      }
      return { value: n > 0 ? eng / n : 0, count: n };
    }),
  );
  const max = Math.max(...buckets.flat().map((c) => c.value), 0.1);
  const topSlot = data.topSlots[0];
  const topCell = topSlot
    ? { day: topSlot.day, bucket: bucketSize === 3 ? Math.floor(topSlot.hour / 3) : topSlot.hour }
    : null;
  return { buckets, bucketSize, max, topCell };
}
