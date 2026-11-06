// YouTube KPI cards (spec §7). Pure: the caller loads the daily rows and splits them per window.
//
// - `subscribers` is the channel's current count (rounded by YouTube); its `prev` is that count
//   minus the window's net change, so value - prev is the spec's delta.
// - `net_subscribers` is Σ gained − Σ lost, with both sums exposed on the entry.
//   Both subscriber KPIs always read the `all` rows of the full window, whatever the selected
//   content type: Google does not split subscriber metrics by content type.
// - `avg_view_duration_s` is the view-weighted mean of the daily averages.
// - Every other KPI is a Σ of the selected content type's rows. For `shorts`/`long` the caller
//   clips those rows to `content_type_through` (and the previous window to the same length); with
//   no split data in the window at all it passes `current: null` and those KPIs are null.
//
// Null versus zero (Review Focus 4): no rows sums to 0 (a channel with no Shorts has zero Shorts
// views, not "sem dados"); rows whose metric is null on every row sum to null (Google left that
// metric unsplit). A previous window with no `all` rows predates the backfill, so its `prev` is
// null instead of a fake comparison against zero.

export const YT_KPI_IDS = [
  "subscribers",
  "net_subscribers",
  "views",
  "engaged_views",
  "watch_minutes",
  "avg_view_duration_s",
  "likes",
  "shares",
  "comments",
] as const;
export type YtKpiId = (typeof YT_KPI_IDS)[number];

export interface YtKpiEntry {
  value: number | null;
  prev: number | null;
  /** Only on `net_subscribers`: the two sums behind the net. */
  gained?: number | null;
  lost?: number | null;
}

export type YtContentType = "all" | "shorts" | "long";

/** A `youtube_channel_daily` row. numeric columns may arrive as strings; see `num`. */
export interface YtChannelDailyRow {
  day: string;
  content_type: string;
  views: number | null;
  engaged_views: number | null;
  estimated_minutes_watched: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  subscribers_gained: number | null;
  subscribers_lost: number | null;
  average_view_duration_s: number | null;
}

type DailyMetric = Exclude<keyof YtChannelDailyRow, "day" | "content_type">;

export interface YtKpiInput {
  /** Rows of the selected content type in its (possibly clipped) current window; null when that
   * type has no data in the window yet (`content_type_through` null or before the start). */
  current: YtChannelDailyRow[] | null;
  /** Rows of the selected type in the previous window of the same length. */
  prev: YtChannelDailyRow[];
  /** The stored history of the selected type reaches back to the previous window's start, so the
   * whole window is covered. False (data starts inside or after it) nulls the type's prev: a %
   * change against a half-synced window would be wrong, and the UI shows "sem comparação". */
  prevCovered: boolean;
  /** `all` rows of the full current and previous windows (subscriber KPIs). */
  allCurrent: YtChannelDailyRow[];
  allPrev: YtChannelDailyRow[];
  /** Same coverage test for the `all` rows over the full previous window (net subscribers prev). */
  allPrevCovered: boolean;
  subscriberCount: number | null;
}

export interface YtSplitEntry {
  shorts: number;
  long: number;
}
export interface YtSplit {
  views: YtSplitEntry;
  minutes: YtSplitEntry;
  likes: YtSplitEntry;
}

/** A number from a bigint/numeric column (PostgREST may send numeric as a string); null stays null. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Σ of a metric: 0 with no rows, null when every row has it null, else the sum of the known values. */
export function sumMetric<T>(rows: T[], key: keyof T): number | null {
  if (rows.length === 0) return 0;
  let total = 0;
  let known = false;
  for (const r of rows) {
    const v = num(r[key]);
    if (v === null) continue;
    total += v;
    known = true;
  }
  return known ? total : null;
}

/** Σ(avg × views) / Σ views over rows with both values; null on zero weighted views. */
export function weightedAverage<T extends { views: number | null }>(rows: T[], key: keyof T): number | null {
  let weighted = 0;
  let views = 0;
  for (const r of rows) {
    const v = num(r.views);
    const avg = num(r[key]);
    if (v === null || avg === null) continue;
    weighted += avg * v;
    views += v;
  }
  return views > 0 ? weighted / views : null;
}

function net(rows: YtChannelDailyRow[]): { gained: number | null; lost: number | null; net: number | null } {
  const gained = sumMetric(rows, "subscribers_gained");
  const lost = sumMetric(rows, "subscribers_lost");
  return { gained, lost, net: gained !== null && lost !== null ? gained - lost : null };
}

const SUMMED: Array<[YtKpiId, DailyMetric]> = [
  ["views", "views"],
  ["engaged_views", "engaged_views"],
  ["watch_minutes", "estimated_minutes_watched"],
  ["likes", "likes"],
  ["shares", "shares"],
  ["comments", "comments"],
];

/** Every KPI present with `value` and `prev` null: the first-sync (and revoked) state. */
export function emptyYtKpis(): Record<YtKpiId, YtKpiEntry> {
  const out = {} as Record<YtKpiId, YtKpiEntry>;
  for (const id of YT_KPI_IDS) out[id] = { value: null, prev: null };
  out.net_subscribers = { value: null, prev: null, gained: null, lost: null };
  return out;
}

export function computeYtKpis(i: YtKpiInput): Record<YtKpiId, YtKpiEntry> {
  const out = emptyYtKpis();

  const allNet = net(i.allCurrent);
  const allPrevNet = i.allPrevCovered && i.allPrev.length > 0 ? net(i.allPrev).net : null;
  out.subscribers = {
    value: i.subscriberCount,
    prev: i.subscriberCount !== null && allNet.net !== null ? i.subscriberCount - allNet.net : null,
  };
  out.net_subscribers = { value: allNet.net, prev: allPrevNet, gained: allNet.gained, lost: allNet.lost };

  const current = i.current;
  if (current === null) return out; // the type's KPIs stay { value: null, prev: null }
  const prevOf = (v: number | null) => (i.prevCovered ? v : null);
  for (const [id, key] of SUMMED) {
    out[id] = { value: sumMetric(current, key), prev: prevOf(sumMetric(i.prev, key)) };
  }
  out.avg_view_duration_s = {
    value: weightedAverage(current, "average_view_duration_s"),
    prev: prevOf(weightedAverage(i.prev, "average_view_duration_s")),
  };
  return out;
}

/** Shorts x long totals over split rows the caller already clipped to `content_type_through`.
 * Rows of other types are ignored; a missing row or an unsplit (null) metric counts as 0. */
export function computeYtSplit(rows: YtChannelDailyRow[]): YtSplit {
  const split: YtSplit = {
    views: { shorts: 0, long: 0 },
    minutes: { shorts: 0, long: 0 },
    likes: { shorts: 0, long: 0 },
  };
  for (const r of rows) {
    if (r.content_type !== "shorts" && r.content_type !== "long") continue;
    const t = r.content_type;
    split.views[t] += num(r.views) ?? 0;
    split.minutes[t] += num(r.estimated_minutes_watched) ?? 0;
    split.likes[t] += num(r.likes) ?? 0;
  }
  return split;
}

/** A `youtube_video_daily` row. */
export interface YtVideoDailyRow {
  video_id: string;
  day: string;
  views: number | null;
  engaged_views: number | null;
  likes: number | null;
  comments: number | null;
  subscribers_gained: number | null;
  average_view_duration_s: number | null;
  average_view_percentage: number | null;
}

export interface YtVideoWindowMetrics {
  views: number;
  engagedViews: number | null;
  avgViewDurationS: number | null;
  avgViewPct: number | null;
  likes: number;
  comments: number;
  subscribersGained: number;
}

/** No daily rows in the window for a video: zero counts, unknown averages. */
export const EMPTY_VIDEO_METRICS: YtVideoWindowMetrics = {
  views: 0,
  engagedViews: null,
  avgViewDurationS: null,
  avgViewPct: null,
  likes: 0,
  comments: 0,
  subscribersGained: 0,
};

/** Per-video sums over the rows given (already clipped to the window); averages view-weighted. */
export function aggregateVideoDaily(rows: YtVideoDailyRow[]): Map<string, YtVideoWindowMetrics> {
  const byVideo = new Map<string, YtVideoDailyRow[]>();
  for (const r of rows) {
    const list = byVideo.get(r.video_id) ?? [];
    list.push(r);
    byVideo.set(r.video_id, list);
  }
  const out = new Map<string, YtVideoWindowMetrics>();
  for (const [id, list] of byVideo) {
    const engaged = sumMetric(list, "engaged_views");
    out.set(id, {
      views: sumMetric(list, "views") ?? 0,
      engagedViews: engaged,
      avgViewDurationS: weightedAverage(list, "average_view_duration_s"),
      avgViewPct: weightedAverage(list, "average_view_percentage"),
      likes: sumMetric(list, "likes") ?? 0,
      comments: sumMetric(list, "comments") ?? 0,
      subscribersGained: sumMetric(list, "subscribers_gained") ?? 0,
    });
  }
  return out;
}
