// YouTube Data API v3 + YouTube Analytics API v2 client for the sync crons and the read paths.
// Spec: docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md §5.1.
//
// Every function takes the OAuth access token (from getFreshGoogleToken) and, last, an injectable
// `fetchJson` that defaults to googleFetch, so tests assert URLs and parsing with no network.
// googleFetch already carries the 10 s timeout and maps HTTP failures to GoogleApiError; errors
// propagate untouched, the caller decides what is a skip and what is a failure. The one
// exception is videoContentTypes, which is best-effort (null on a 400).
//
// Analytics rows are parsed by `columnHeaders` name, never by position. A metric the response did
// not return is null (not 0), so a caller can tell "absent" from "zero".
//
// Dates are YYYY-MM-DD strings. The Analytics API reports Pacific-time days (America/Los_Angeles);
// they are returned as is and never converted here.

import { GoogleApiError, googleFetch } from "./google.ts";

const DATA_API = "https://www.googleapis.com/youtube/v3";
const ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports";

export type FetchJson = (url: string, token: string, init?: RequestInit) => Promise<unknown>;

export type YtContentType = "shorts" | "long" | "live";

export interface DateRange {
  start: string;
  end: string;
}

// --- Row types (Task 7 imports these) ---

export interface YtChannel {
  id: string;
  title: string | null;
  handle: string | null;
  avatarUrl: string | null;
  uploadsPlaylistId: string | null;
  /** null when the channel hides its subscriber count. */
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
}

export interface YtVideo {
  id: string;
  title: string | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  /** Parsed from the ISO 8601 contentDetails.duration; 0 when absent (live or upcoming streams report P0D). */
  durationS: number;
  /** durationS <= 180 (the S2 fallback when the Analytics creatorContentType dimension is unavailable). */
  isShortByDuration: boolean;
  /** snippet.liveBroadcastContent: "none" | "upcoming" | "live". */
  liveBroadcastContent: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
}

export interface YtChannelDailyRow {
  day: string;
  /** null for the all-content report (byContentType = false). */
  contentType: YtContentType | null;
  views: number | null;
  engagedViews: number | null;
  estimatedMinutesWatched: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  subscribersGained: number | null;
  subscribersLost: number | null;
  averageViewDuration: number | null;
}

export interface YtTrafficRow {
  day: string;
  /** insightTrafficSourceType as the API returns it (YT_SEARCH, SHORTS, ...). */
  source: string;
  views: number | null;
}

export interface YtDemographicsRow {
  /** e.g. "age18-24". */
  ageGroup: string;
  /** "female" | "male" | "user_specified". */
  gender: string;
  viewerPercentage: number | null;
}

export interface YtVideoDailyRow {
  day: string;
  views: number | null;
  engagedViews: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  subscribersGained: number | null;
  averageViewDuration: number | null;
  averageViewPercentage: number | null;
}

// --- Parsing helpers ---

const SHORT_MAX_DURATION_S = 180;
const MAX_VIDEOS_PER_CALL = 50;

function toCount(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** ISO 8601 duration (PnDTnHnMnS) -> whole seconds. Unparseable or absent -> 0. */
export function parseIsoDuration(iso: string | undefined | null): number {
  if (!iso) return 0;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso);
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return Math.round(
    (Number(d ?? 0) * 24 + Number(h ?? 0)) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0),
  );
}

const CONTENT_TYPES: Record<string, YtContentType> = {
  SHORTS: "shorts",
  VIDEO_ON_DEMAND: "long",
  LIVE_STREAM: "live",
};

function mapContentType(value: unknown): YtContentType | null {
  return typeof value === "string" ? (CONTENT_TYPES[value] ?? null) : null;
}

interface AnalyticsBody {
  columnHeaders?: { name?: string }[];
  rows?: unknown[][];
}

type NamedRow = Record<string, unknown>;

/** Turns an Analytics response into rows keyed by column name. */
function namedRows(body: unknown): NamedRow[] {
  const report = body as AnalyticsBody | null;
  const names = (report?.columnHeaders ?? []).map((h) => h.name ?? "");
  const rows = report?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const named: NamedRow = {};
    names.forEach((name, i) => {
      if (name) named[name] = row[i];
    });
    return named;
  });
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function reportUrl(range: DateRange, params: Record<string, string>): string {
  const url = new URL(ANALYTICS_API);
  url.searchParams.set("ids", "channel==MINE");
  url.searchParams.set("startDate", range.start);
  url.searchParams.set("endDate", range.end);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

// --- Data API ---

interface ChannelItem {
  id?: string;
  snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } };
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean; viewCount?: string; videoCount?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}

/** The authorized user's channel, or null when the account has none. */
export async function getMyChannel(token: string, fetchJson: FetchJson = googleFetch): Promise<YtChannel | null> {
  const url = `${DATA_API}/channels?part=snippet,statistics,contentDetails&mine=true`;
  const body = (await fetchJson(url, token)) as { items?: ChannelItem[] } | null;
  const item = body?.items?.[0];
  if (!item?.id) return null;
  const stats = item.statistics ?? {};
  return {
    id: item.id,
    title: str(item.snippet?.title),
    handle: str(item.snippet?.customUrl),
    avatarUrl: str(item.snippet?.thumbnails?.default?.url),
    uploadsPlaylistId: str(item.contentDetails?.relatedPlaylists?.uploads),
    subscriberCount: stats.hiddenSubscriberCount ? null : toCount(stats.subscriberCount),
    viewCount: toCount(stats.viewCount),
    videoCount: toCount(stats.videoCount),
  };
}

/** One page (50) of the channel's uploads playlist, newest first. */
export async function listUploads(
  token: string,
  playlistId: string,
  opts: { pageToken?: string } = {},
  fetchJson: FetchJson = googleFetch,
): Promise<{ videoIds: string[]; nextPageToken: string | null }> {
  const url = new URL(`${DATA_API}/playlistItems`);
  url.searchParams.set("part", "contentDetails");
  url.searchParams.set("playlistId", playlistId);
  url.searchParams.set("maxResults", "50");
  if (opts.pageToken) url.searchParams.set("pageToken", opts.pageToken);
  const body = (await fetchJson(url.toString(), token)) as {
    items?: { contentDetails?: { videoId?: string } }[];
    nextPageToken?: string;
  } | null;
  const videoIds: string[] = [];
  for (const item of body?.items ?? []) {
    const id = item.contentDetails?.videoId;
    if (id) videoIds.push(id);
  }
  return { videoIds, nextPageToken: body?.nextPageToken ?? null };
}

interface VideoItem {
  id?: string;
  snippet?: {
    title?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url?: string } | undefined>;
    liveBroadcastContent?: string;
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
}

/** Video metadata for up to 50 ids. Ids the API does not return (deleted, private) are absent. */
export async function getVideos(
  token: string,
  ids: string[],
  fetchJson: FetchJson = googleFetch,
): Promise<YtVideo[]> {
  if (ids.length === 0) return [];
  if (ids.length > MAX_VIDEOS_PER_CALL) {
    throw new RangeError(`getVideos takes at most ${MAX_VIDEOS_PER_CALL} ids, got ${ids.length}`);
  }
  const url = new URL(`${DATA_API}/videos`);
  url.searchParams.set("part", "snippet,contentDetails,statistics");
  url.searchParams.set("id", ids.join(","));
  url.searchParams.set("maxResults", String(MAX_VIDEOS_PER_CALL));
  const body = (await fetchJson(url.toString(), token)) as { items?: VideoItem[] } | null;
  const videos: YtVideo[] = [];
  for (const item of body?.items ?? []) {
    if (!item.id) continue;
    const durationS = parseIsoDuration(item.contentDetails?.duration);
    const thumbs = item.snippet?.thumbnails;
    videos.push({
      id: item.id,
      title: str(item.snippet?.title),
      publishedAt: str(item.snippet?.publishedAt),
      thumbnailUrl: str(thumbs?.medium?.url) ?? str(thumbs?.default?.url),
      durationS,
      isShortByDuration: durationS <= SHORT_MAX_DURATION_S,
      liveBroadcastContent: str(item.snippet?.liveBroadcastContent),
      viewCount: toCount(item.statistics?.viewCount),
      likeCount: toCount(item.statistics?.likeCount),
      commentCount: toCount(item.statistics?.commentCount),
    });
  }
  return videos;
}

// --- Analytics API ---

const CHANNEL_DAILY_METRICS =
  "views,engagedViews,estimatedMinutesWatched,likes,comments,shares,subscribersGained,subscribersLost,averageViewDuration";

/**
 * Daily channel metrics. With byContentType the report also splits by creatorContentType; rows
 * whose type is not SHORTS / VIDEO_ON_DEMAND / LIVE_STREAM are dropped.
 */
export async function channelDaily(
  token: string,
  range: DateRange,
  byContentType: boolean,
  fetchJson: FetchJson = googleFetch,
): Promise<YtChannelDailyRow[]> {
  const url = reportUrl(range, {
    dimensions: byContentType ? "day,creatorContentType" : "day",
    metrics: CHANNEL_DAILY_METRICS,
    sort: "day",
  });
  const rows: YtChannelDailyRow[] = [];
  for (const r of namedRows(await fetchJson(url, token))) {
    const day = str(r.day);
    if (!day) continue;
    let contentType: YtContentType | null = null;
    if (byContentType) {
      contentType = mapContentType(r.creatorContentType);
      if (!contentType) continue;
    }
    rows.push({
      day,
      contentType,
      views: toCount(r.views),
      engagedViews: toCount(r.engagedViews),
      estimatedMinutesWatched: toCount(r.estimatedMinutesWatched),
      likes: toCount(r.likes),
      comments: toCount(r.comments),
      shares: toCount(r.shares),
      subscribersGained: toCount(r.subscribersGained),
      subscribersLost: toCount(r.subscribersLost),
      averageViewDuration: toCount(r.averageViewDuration),
    });
  }
  return rows;
}

/** Daily views by traffic source type. */
export async function trafficDaily(
  token: string,
  range: DateRange,
  fetchJson: FetchJson = googleFetch,
): Promise<YtTrafficRow[]> {
  const url = reportUrl(range, { dimensions: "day,insightTrafficSourceType", metrics: "views", sort: "day" });
  const rows: YtTrafficRow[] = [];
  for (const r of namedRows(await fetchJson(url, token))) {
    const day = str(r.day);
    const source = str(r.insightTrafficSourceType);
    if (!day || !source) continue;
    rows.push({ day, source, views: toCount(r.views) });
  }
  return rows;
}

/** Viewer share by age group and gender over the range. */
export async function demographics(
  token: string,
  range: DateRange,
  fetchJson: FetchJson = googleFetch,
): Promise<YtDemographicsRow[]> {
  const url = reportUrl(range, { dimensions: "ageGroup,gender", metrics: "viewerPercentage" });
  const rows: YtDemographicsRow[] = [];
  for (const r of namedRows(await fetchJson(url, token))) {
    const ageGroup = str(r.ageGroup);
    const gender = str(r.gender);
    if (!ageGroup || !gender) continue;
    rows.push({ ageGroup, gender, viewerPercentage: toCount(r.viewerPercentage) });
  }
  return rows;
}

/** Daily metrics for one video. */
export async function videoDaily(
  token: string,
  videoId: string,
  range: DateRange,
  fetchJson: FetchJson = googleFetch,
): Promise<YtVideoDailyRow[]> {
  const url = reportUrl(range, {
    filters: `video==${videoId}`,
    dimensions: "day",
    metrics: "views,engagedViews,likes,comments,shares,subscribersGained,averageViewDuration,averageViewPercentage",
    sort: "day",
  });
  const rows: YtVideoDailyRow[] = [];
  for (const r of namedRows(await fetchJson(url, token))) {
    const day = str(r.day);
    if (!day) continue;
    rows.push({
      day,
      views: toCount(r.views),
      engagedViews: toCount(r.engagedViews),
      likes: toCount(r.likes),
      comments: toCount(r.comments),
      shares: toCount(r.shares),
      subscribersGained: toCount(r.subscribersGained),
      averageViewDuration: toCount(r.averageViewDuration),
      averageViewPercentage: toCount(r.averageViewPercentage),
    });
  }
  return rows;
}

/**
 * Content type per video from the Top videos report (video x creatorContentType, top 200 by
 * views, no `video==` filter: that report does not accept one). Ids absent from the map fall
 * back to the duration heuristic. Best-effort: null when the API rejects the dimension (400,
 * the S2 default); every other error propagates.
 */
export async function videoContentTypes(
  token: string,
  range: DateRange,
  fetchJson: FetchJson = googleFetch,
): Promise<Map<string, YtContentType> | null> {
  const url = reportUrl(range, {
    dimensions: "video,creatorContentType",
    metrics: "views",
    sort: "-views",
    maxResults: "200",
  });
  let body: unknown;
  try {
    body = await fetchJson(url, token);
  } catch (err) {
    // googleFetch maps an unlisted 4xx to UPSTREAM with the status kept.
    if (err instanceof GoogleApiError && err.status === 400) return null;
    throw err;
  }
  const map = new Map<string, YtContentType>();
  for (const r of namedRows(body)) {
    const id = str(r.video);
    const type = mapContentType(r.creatorContentType);
    if (id && type) map.set(id, type);
  }
  return map;
}
