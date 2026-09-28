// Instagram best-posting-times grid, shared by instagram-analytics (/best-times) and the two
// report paths (report-docs, instagram-report-generator-v2) that read the same cache row.
import { BEST_TIMES_TIMEZONE, saoPauloWeekdayHour } from "./sao-paulo-date.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export const BEST_TIMES_CACHE_KEY = "best_times";
const WINDOW_DAYS = 90;

export interface BestTimesPost {
  posted_at: string;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  shares: number | null;
  reach: number | null;
}

export interface BestTimesPayload {
  heatmap: number[][];
  counts: number[][];
  topSlots: { day: number; hour: number; value: number; postCount: number }[];
  totalPosts: number;
  labels_days: string[];
  labels_hours: string[];
  timezone: typeof BEST_TIMES_TIMEZONE;
}

/** True for a payload bucketed on the São Paulo clock. Rows cached before that change hold
 * UTC hours and lack the marker. */
export function isCurrentBestTimes(data: unknown): data is BestTimesPayload {
  return !!data && typeof data === "object" &&
    (data as { timezone?: unknown }).timezone === BEST_TIMES_TIMEZONE;
}

/** 7x24 grid (Monday = 0) of average engagement rate per São Paulo weekday/hour, plus the top 3
 * slots that actually had posts. */
export function bestTimesFromPosts(posts: BestTimesPost[]): BestTimesPayload {
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const counts: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));

  for (const p of posts) {
    // São Paulo wall clock: the runtime is UTC, and the CRM schedules in local time.
    const { day, hour } = saoPauloWeekdayHour(new Date(p.posted_at));
    const interactions = (p.likes || 0) + (p.comments || 0) + (p.saved || 0) + (p.shares || 0);
    const reach = p.reach || 0;
    heatmap[day][hour] += reach > 0 ? (interactions / reach) * 100 : 0;
    counts[day][hour] += 1;
  }

  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      heatmap[d][h] = counts[d][h] > 0 ? Math.round((heatmap[d][h] / counts[d][h]) * 100) / 100 : 0;
    }
  }

  const slots: BestTimesPayload["topSlots"] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (counts[d][h] > 0) slots.push({ day: d, hour: h, value: heatmap[d][h], postCount: counts[d][h] });
    }
  }
  slots.sort((a, b) => b.value - a.value);

  return {
    heatmap,
    counts,
    topSlots: slots.slice(0, 3),
    totalPosts: posts.length,
    labels_days: ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"],
    labels_hours: Array.from({ length: 24 }, (_, i) => `${i}h`),
    timezone: BEST_TIMES_TIMEZONE,
  };
}

/** Grid over the account's last 90 days of posts. Throws on a query error. */
export async function computeBestTimes(db: Db, accountId: number | string): Promise<BestTimesPayload> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400 * 1000).toISOString();
  const { data, error } = await db
    .from("instagram_posts")
    .select("posted_at, likes, comments, saved, shares, reach")
    .eq("instagram_account_id", accountId)
    .gte("posted_at", since);
  if (error) throw new Error(`best-times posts query failed: ${error.message ?? error}`);
  return bestTimesFromPosts((data ?? []) as BestTimesPost[]);
}

/**
 * For report paths, which read the cache row directly and never call /best-times: returns the
 * cached payload when it is current, otherwise recomputes, rewrites the row, and returns the
 * fresh grid. A failure degrades to `null` (the report omits the section) instead of failing
 * the whole generation.
 */
export async function resolveBestTimes(
  db: Db,
  accountId: number | string,
  cached: unknown,
  logPrefix: string,
): Promise<BestTimesPayload | null> {
  if (isCurrentBestTimes(cached)) return cached;
  try {
    const fresh = await computeBestTimes(db, accountId);
    const { error } = await db.from("instagram_analytics_cache").upsert({
      instagram_account_id: accountId,
      cache_key: BEST_TIMES_CACHE_KEY,
      data: fresh,
      fetched_at: new Date().toISOString(),
    }, { onConflict: "instagram_account_id,cache_key" });
    if (error) console.warn(`${logPrefix} best times cache write failed: ${error.message ?? error}`);
    return fresh;
  } catch (e) {
    console.warn(`${logPrefix} best times recompute failed: ${(e as Error)?.message ?? e}`);
    return null;
  }
}
