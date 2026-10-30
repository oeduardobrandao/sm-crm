// YouTube analytics reads, shared by the youtube-analytics function and (Phase 4) the report
// snapshot loader. Every function takes a service-role client: the history tables are
// service-role only, and the caller has already confirmed the workspace owns the client. Every
// history read filters by (conta_id, channel_id): two workspaces linking the same channel never
// share rows. Query errors throw; callers answer a generic 500.
import {
  aggregateVideoDaily,
  computeYtKpis,
  computeYtSplit,
  EMPTY_VIDEO_METRICS,
  emptyYtKpis,
  num,
  type YtChannelDailyRow,
  type YtContentType,
  type YtKpiEntry,
  type YtKpiId,
  type YtSplit,
  type YtVideoDailyRow,
  type YtVideoWindowMetrics,
} from "./kpis.ts";
import {
  addDays,
  daysOf,
  laDayStartIso,
  resolveYtWindow,
  spanDays,
  type YtWindow,
  type YtWindowRequest,
} from "./window.ts";
import { fetchAllRows } from "../paginate.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface YouTubeChannelRow {
  id: string;
  client_id: number;
  channel_id: string;
  title: string | null;
  handle: string | null;
  avatar_url: string | null;
  subscriber_count: number | null;
  authorization_status: "active" | "revoked";
  revoked_at: string | null;
  last_synced_at: string | null;
  data_through: string | null;
  content_type_through: string | null;
  traffic_through: string | null;
  videos_through: string | null;
}

/** Explicit allowlist. Tokens live on google_connections, which these reads never touch. */
export const YOUTUBE_CHANNEL_COLUMNS =
  "id, client_id, channel_id, title, handle, avatar_url, subscriber_count, authorization_status, revoked_at, last_synced_at, data_through, content_type_through, traffic_through, videos_through";

const CHANNEL_DAILY_COLUMNS =
  "day, content_type, views, engaged_views, estimated_minutes_watched, likes, comments, shares, subscribers_gained, subscribers_lost, average_view_duration_s";
const VIDEO_COLUMNS = "video_id, title, published_at, is_short, thumbnail_url";
const VIDEO_DAILY_COLUMNS =
  "video_id, day, views, engaged_views, likes, comments, subscribers_gained, average_view_duration_s, average_view_percentage";

// ─── Response shapes (mirrored by apps/crm/src/services/youtubeAnalytics.ts) ───────────

export interface YtOverview {
  channel: {
    title: string | null;
    handle: string | null;
    avatarUrl: string | null;
    subscriberCount: number | null;
    authorizationStatus: "active" | "revoked";
    lastSyncedAt: string | null;
    dataThrough: string | null;
    contentTypeThrough: string | null;
    trafficThrough: string | null;
    videosThrough: string | null;
  };
  window: YtWindow;
  /** Every id present; all null before the first sync. */
  kpis: Record<YtKpiId, YtKpiEntry>;
  split: YtSplit;
}

export interface YtDailyPoint {
  date: string;
  views: number;
  engagedViews: number | null;
  watchMinutes: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  subscribersGained: number | null;
  subscribersLost: number | null;
  /** Present only for days up to content_type_through. */
  shortsViews?: number;
  longViews?: number;
}

export interface YtTrafficRow {
  sourceType: string;
  views: number;
}

export interface YtDemographicRow {
  ageGroup: string;
  gender: string;
  viewerPct: number;
}

export const YT_VIDEO_SORTS = ["views", "published_at", "likes"] as const;
export type YtVideoSort = (typeof YT_VIDEO_SORTS)[number];

export interface YtVideoRow {
  videoId: string;
  title: string | null;
  isShort: boolean;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  views: number;
  engagedViews: number | null;
  avgViewDurationS: number | null;
  avgViewPct: number | null;
  likes: number;
  comments: number;
  subscribersGained: number;
}

// ─── Reads ───────────────────────────────────────────────────────────────────────

// PostgREST caps a response at 1000 rows (a 365-day window of four content types goes past it):
// every list read drains through fetchAllRows, each with a total order ending in its primary key.

export async function loadYouTubeChannel(db: Db, contaId: string, clientId: number): Promise<YouTubeChannelRow | null> {
  const { data, error } = await db.from("youtube_channels").select(YOUTUBE_CHANNEL_COLUMNS)
    .eq("client_id", clientId).eq("conta_id", contaId).maybeSingle();
  if (error) throw error;
  return (data as YouTubeChannelRow | null) ?? null;
}

/** Rows with `day` in [start, end], oldest first: every content type, or only `contentType`. */
export async function loadChannelDaily(
  db: Db,
  contaId: string,
  channelId: string,
  start: string,
  end: string,
  contentType?: YtContentType,
): Promise<YtChannelDailyRow[]> {
  return await fetchAllRows<YtChannelDailyRow>((from, to) => {
    let q = db.from("youtube_channel_daily").select(CHANNEL_DAILY_COLUMNS)
      .eq("conta_id", contaId)
      .eq("channel_id", channelId);
    if (contentType) q = q.eq("content_type", contentType);
    return q.gte("day", start)
      .lte("day", end)
      .order("day", { ascending: true })
      .order("content_type", { ascending: true })
      .range(from, to);
  });
}

type TrafficDbRow = { day: string; source_type: string; views: number | null };

async function loadTraffic(db: Db, contaId: string, channelId: string, start: string, end: string): Promise<TrafficDbRow[]> {
  return await fetchAllRows<TrafficDbRow>((from, to) =>
    db.from("youtube_traffic_daily").select("day, source_type, views")
      .eq("conta_id", contaId)
      .eq("channel_id", channelId)
      .gte("day", start)
      .lte("day", end)
      .order("day", { ascending: true })
      .order("source_type", { ascending: true })
      .range(from, to)
  );
}

type VideoDbRow = {
  video_id: string;
  title: string | null;
  published_at: string | null;
  is_short: boolean | null;
  thumbnail_url: string | null;
};

/** Videos published in the inclusive Pacific window [start, end], newest first. */
async function loadVideosPublishedIn(
  db: Db,
  contaId: string,
  channelId: string,
  start: string,
  end: string,
): Promise<VideoDbRow[]> {
  return await fetchAllRows<VideoDbRow>((from, to) =>
    db.from("youtube_videos").select(VIDEO_COLUMNS)
      .eq("conta_id", contaId)
      .eq("channel_id", channelId)
      .gte("published_at", laDayStartIso(start))
      .lt("published_at", laDayStartIso(addDays(end, 1)))
      .order("published_at", { ascending: false })
      .order("video_id", { ascending: true })
      .range(from, to)
  );
}

async function loadShorts(db: Db, contaId: string, channelId: string): Promise<VideoDbRow[]> {
  return await fetchAllRows<VideoDbRow>((from, to) =>
    db.from("youtube_videos").select(VIDEO_COLUMNS)
      .eq("conta_id", contaId)
      .eq("channel_id", channelId)
      .eq("is_short", true)
      .order("video_id", { ascending: true })
      .range(from, to)
  );
}

/** Per-video daily rows of the channel with `day` in [start, end]. Read by channel and day, not
 * by a list of video ids, so a long window never builds an oversized `in.(…)` filter. */
async function loadVideoDaily(
  db: Db,
  contaId: string,
  channelId: string,
  start: string,
  end: string,
): Promise<YtVideoDailyRow[]> {
  return await fetchAllRows<YtVideoDailyRow>((from, to) =>
    db.from("youtube_video_daily").select(VIDEO_DAILY_COLUMNS)
      .eq("conta_id", contaId)
      .eq("channel_id", channelId)
      .gte("day", start)
      .lte("day", end)
      .order("video_id", { ascending: true })
      .order("day", { ascending: true })
      .range(from, to)
  );
}

// ─── Builders ────────────────────────────────────────────────────────────────────

const inRange = (day: string, start: string, end: string) => day >= start && day <= end;
const minDay = (a: string, b: string) => (a < b ? a : b);

const emptySplit = (): YtSplit => ({
  views: { shorts: 0, long: 0 },
  minutes: { shorts: 0, long: 0 },
  likes: { shorts: 0, long: 0 },
});

function channelSummary(c: YouTubeChannelRow): YtOverview["channel"] {
  return {
    title: c.title,
    handle: c.handle,
    avatarUrl: c.avatar_url,
    subscriberCount: num(c.subscriber_count),
    authorizationStatus: c.authorization_status,
    lastSyncedAt: c.last_synced_at,
    dataThrough: c.data_through,
    contentTypeThrough: c.content_type_through,
    trafficThrough: c.traffic_through,
    videosThrough: c.videos_through,
  };
}

export async function buildYtOverview(
  db: Db,
  contaId: string,
  channel: YouTubeChannelRow,
  req: YtWindowRequest,
  type: YtContentType,
  now: Date,
): Promise<YtOverview> {
  const { window: w, hasData } = resolveYtWindow(req, channel.data_through, now);
  const base = { channel: channelSummary(channel), window: w };
  if (!hasData) return { ...base, kpis: emptyYtKpis(), split: emptySplit() };

  // Read 1: every content type over both full windows (subscriber KPIs, split, `all` KPIs).
  const rows = await loadChannelDaily(db, contaId, channel.channel_id, w.prevStart, w.end);
  const ofType = (t: string, start: string, end: string) =>
    rows.filter((r) => r.content_type === t && inRange(r.day, start, end));
  const allCurrent = ofType("all", w.start, w.end);
  const allPrev = ofType("all", w.prevStart, w.prevEnd);

  const ctt = channel.content_type_through;
  const splitEnd = ctt ? minDay(w.end, ctt) : null;
  const split = splitEnd
    ? computeYtSplit(rows.filter((r) => inRange(r.day, w.start, splitEnd)))
    : emptySplit();

  const subscriberCount = num(channel.subscriber_count);
  if (type === "all") {
    return {
      ...base,
      kpis: computeYtKpis({
        current: allCurrent,
        prev: allPrev,
        prevCovered: allPrev.length > 0,
        allCurrent,
        allPrev,
        subscriberCount,
      }),
      split,
    };
  }

  // A split type reads only up to content_type_through: the current window ends there and the
  // previous window has the clipped length, right before the start. No split data in the window
  // at all leaves the type's KPIs null.
  const typeWindow = typeWindowOf(w, ctt);
  if (!typeWindow) {
    return {
      ...base,
      kpis: computeYtKpis({ current: null, prev: [], prevCovered: false, allCurrent, allPrev, subscriberCount }),
      split,
    };
  }
  // Read 2 (after read 1 has drained): the selected type over its clipped windows.
  const typed = await loadChannelDaily(db, contaId, channel.channel_id, typeWindow.prevStart, typeWindow.end, type);
  return {
    ...base,
    kpis: computeYtKpis({
      current: typed.filter((r) => inRange(r.day, typeWindow.start, typeWindow.end)),
      prev: typed.filter((r) => inRange(r.day, typeWindow.prevStart, typeWindow.prevEnd)),
      prevCovered: rows.some((r) => r.content_type === "all" && inRange(r.day, typeWindow.prevStart, typeWindow.prevEnd)),
      allCurrent,
      allPrev,
      subscriberCount,
    }),
    split,
  };
}

/** The window clipped to `content_type_through`, with the previous window of the clipped length;
 * null when the watermark is missing or before the window start. */
function typeWindowOf(w: YtWindow, ctt: string | null): YtWindow | null {
  if (!ctt || ctt < w.start) return null;
  const end = minDay(w.end, ctt);
  const len = spanDays(w.start, end);
  return { start: w.start, end, prevStart: addDays(w.start, -len), prevEnd: addDays(w.start, -1) };
}

/** One point per day of the window, a day the report omitted counting as 0. For a split type the
 * window ends at `content_type_through`, as on the overview (empty when that type has no data in
 * the window yet). `shortsViews`/`longViews` are set only on days the split watermark covers. */
export async function buildYtDaily(
  db: Db,
  contaId: string,
  channel: YouTubeChannelRow,
  req: YtWindowRequest,
  type: YtContentType,
  now: Date,
): Promise<YtDailyPoint[]> {
  const { window: w, hasData } = resolveYtWindow(req, channel.data_through, now);
  if (!hasData) return [];
  const ctt = channel.content_type_through;
  let end = w.end;
  if (type !== "all") {
    const typeWindow = typeWindowOf(w, ctt);
    if (!typeWindow) return [];
    end = typeWindow.end;
  }
  const rows = await loadChannelDaily(db, contaId, channel.channel_id, w.start, end);
  const byKey = new Map(rows.map((r) => [`${r.day}|${r.content_type}`, r]));

  return daysOf(w.start, end).map((day) => {
    const row = byKey.get(`${day}|${type}`);
    const metric = (key: keyof YtChannelDailyRow) => (row ? num(row[key]) : 0);
    const point: YtDailyPoint = {
      date: day,
      views: row ? num(row.views) ?? 0 : 0,
      engagedViews: metric("engaged_views"),
      watchMinutes: metric("estimated_minutes_watched"),
      likes: metric("likes"),
      comments: metric("comments"),
      shares: metric("shares"),
      subscribersGained: metric("subscribers_gained"),
      subscribersLost: metric("subscribers_lost"),
    };
    if (ctt !== null && day <= ctt) {
      point.shortsViews = num(byKey.get(`${day}|shorts`)?.views) ?? 0;
      point.longViews = num(byKey.get(`${day}|long`)?.views) ?? 0;
    }
    return point;
  });
}

/** Views per traffic source over the window clipped to `traffic_through`, most viewed first. */
export async function buildYtTraffic(
  db: Db,
  contaId: string,
  channel: YouTubeChannelRow,
  req: YtWindowRequest,
  now: Date,
): Promise<YtTrafficRow[]> {
  const { window: w, hasData } = resolveYtWindow(req, channel.data_through, now);
  const through = channel.traffic_through;
  if (!hasData || !through) return [];
  const end = minDay(w.end, through);
  if (end < w.start) return [];
  const rows = await loadTraffic(db, contaId, channel.channel_id, w.start, end);
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.source_type, (totals.get(r.source_type) ?? 0) + (num(r.views) ?? 0));
  return [...totals]
    .map(([sourceType, views]) => ({ sourceType, views }))
    .sort((a, b) => b.views - a.views || (a.sourceType < b.sourceType ? -1 : 1));
}

/** The API's latest 28-day snapshot. It does not follow the selected period. */
export async function buildYtDemographics(db: Db, contaId: string, channel: YouTubeChannelRow): Promise<YtDemographicRow[]> {
  const { data: latest, error } = await db.from("youtube_demographics").select("window_end")
    .eq("conta_id", contaId)
    .eq("channel_id", channel.channel_id)
    .order("window_end", { ascending: false })
    .limit(1);
  if (error) throw error;
  const windowEnd = ((latest ?? []) as { window_end: string }[])[0]?.window_end;
  if (!windowEnd) return [];
  const { data, error: rowsError } = await db.from("youtube_demographics").select("age_group, gender, viewer_pct")
    .eq("conta_id", contaId)
    .eq("channel_id", channel.channel_id)
    .eq("window_end", windowEnd)
    .order("age_group", { ascending: true })
    .order("gender", { ascending: true });
  if (rowsError) throw rowsError;
  return ((data ?? []) as { age_group: string; gender: string; viewer_pct: unknown }[]).map((r) => ({
    ageGroup: r.age_group,
    gender: r.gender,
    viewerPct: num(r.viewer_pct) ?? 0,
  }));
}

function toVideoRow(v: VideoDbRow, metrics: Map<string, YtVideoWindowMetrics>): YtVideoRow {
  return {
    videoId: v.video_id,
    title: v.title,
    isShort: v.is_short === true,
    publishedAt: v.published_at,
    thumbnailUrl: v.thumbnail_url,
    ...(metrics.get(v.video_id) ?? EMPTY_VIDEO_METRICS),
  };
}

const VIDEOS_CAP = 500;
const TOP_SHORTS = 5;

/** Descending on the sort key; nulls last; ties broken by video id for a stable order. */
function compareVideos(sort: YtVideoSort) {
  const key = sort === "published_at" ? "publishedAt" : sort;
  return (a: YtVideoRow, b: YtVideoRow): number => {
    const x = a[key];
    const y = b[key];
    if (x === null && y !== null) return 1;
    if (y === null && x !== null) return -1;
    if (x !== null && y !== null && x !== y) return x < y ? 1 : -1;
    return a.videoId < b.videoId ? -1 : a.videoId > b.videoId ? 1 : 0;
  };
}

/** "Publicados no período": videos published in the window, with metrics summed over it. */
export async function buildYtVideos(
  db: Db,
  contaId: string,
  channel: YouTubeChannelRow,
  req: YtWindowRequest,
  sort: YtVideoSort,
  now: Date,
): Promise<YtVideoRow[]> {
  const { window: w, hasData } = resolveYtWindow(req, channel.data_through, now);
  if (!hasData) return [];
  // Fixed order (videos, then daily rows): the handler tests queue mock rows in it.
  const [videos, daily] = await Promise.all([
    loadVideosPublishedIn(db, contaId, channel.channel_id, w.start, w.end),
    loadVideoDaily(db, contaId, channel.channel_id, w.start, w.end),
  ]);
  const metrics = aggregateVideoDaily(daily);
  return videos.map((v) => toVideoRow(v, metrics)).sort(compareVideos(sort)).slice(0, VIDEOS_CAP);
}

/** The 5 Shorts with the most views in the window, whatever their publish date. */
export async function buildYtTopShorts(
  db: Db,
  contaId: string,
  channel: YouTubeChannelRow,
  req: YtWindowRequest,
  now: Date,
): Promise<YtVideoRow[]> {
  const { window: w, hasData } = resolveYtWindow(req, channel.data_through, now);
  if (!hasData) return [];
  // Fixed order (shorts, then daily rows): the handler tests queue mock rows in it.
  const [shorts, daily] = await Promise.all([
    loadShorts(db, contaId, channel.channel_id),
    loadVideoDaily(db, contaId, channel.channel_id, w.start, w.end),
  ]);
  const metrics = aggregateVideoDaily(daily);
  return shorts
    .map((v) => toVideoRow(v, metrics))
    .filter((v) => v.views > 0)
    .sort(compareVideos("views"))
    .slice(0, TOP_SHORTS);
}
