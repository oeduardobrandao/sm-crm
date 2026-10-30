// =============================================
// Mesaas - YouTube Analytics Service
// =============================================
// Every read goes through the `youtube-analytics` edge function (the history tables are
// service-role only). Response shapes mirror supabase/functions/youtube-analytics.
import { supabase } from '../lib/supabase';
import type { AnalyticsRange } from './tiktokAnalytics';

export type { AnalyticsRange };

const EDGE_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/youtube-analytics';

// ─── Types ──────────────────────────────────────────────────────────────

export type YtKpiId =
  | 'subscribers'
  | 'net_subscribers'
  | 'views'
  | 'engaged_views'
  | 'watch_minutes'
  | 'avg_view_duration_s'
  | 'likes'
  | 'shares'
  | 'comments';

/** Which content type the KPIs, the daily series and the cards are scoped to. */
export type YouTubeContentType = 'all' | 'shorts' | 'long';

export interface YtKpiEntry {
  value: number | null;
  prev: number | null;
}

export interface YtSplitEntry {
  shorts: number;
  long: number;
}

export interface YtOverview {
  channel: {
    title: string | null;
    handle: string | null;
    avatarUrl: string | null;
    subscriberCount: number | null;
    authorizationStatus: 'active' | 'revoked';
    lastSyncedAt: string | null;
    /** Last day (Pacific) the `all` channel report returned; null before the first sync. */
    dataThrough: string | null;
    contentTypeThrough: string | null;
    trafficThrough: string | null;
  };
  window: { start: string; end: string; prevStart: string; prevEnd: string };
  /** All null before the first sync. */
  kpis: Record<YtKpiId, YtKpiEntry>;
  split: { views: YtSplitEntry; minutes: YtSplitEntry; likes: YtSplitEntry };
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
  /** Views of the two content types on that day, for the stacked Shorts x long chart. */
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

export type YtVideoSort = 'views' | 'published_at' | 'likes';

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

/** 404 `not_connected`: the client has no YouTube channel. */
export class YouTubeNotConnectedError extends Error {
  constructor() {
    super('not_connected');
    this.name = 'YouTubeNotConnectedError';
  }
}

export { isGoogleFeatureDisabled } from './google';

// ─── Fetch helper ───────────────────────────────────────────────────────

async function getAuthHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    Authorization: `Bearer ${session?.access_token}`,
    'Content-Type': 'application/json',
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: unknown });
    if (res.status === 404 && body?.error === 'not_connected') throw new YouTubeNotConnectedError();
    if (res.status === 403 && body?.error === 'feature_disabled') {
      throw new Error('feature_disabled');
    }
    // Never surface the server body: it is not user copy.
    throw new Error(`Error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function rangeQuery(range: AnalyticsRange): URLSearchParams {
  const q = new URLSearchParams();
  if ('days' in range) q.set('days', String(range.days));
  else {
    q.set('start', range.start);
    q.set('end', range.end);
  }
  return q;
}

// ─── Reads ──────────────────────────────────────────────────────────────

export function getYouTubeOverview(
  clientId: number,
  range: AnalyticsRange,
  type: YouTubeContentType,
): Promise<YtOverview> {
  const q = rangeQuery(range);
  q.set('type', type);
  return request(`/overview/${clientId}?${q}`);
}

export async function getYouTubeDaily(
  clientId: number,
  range: AnalyticsRange,
  type: YouTubeContentType,
): Promise<YtDailyPoint[]> {
  const q = rangeQuery(range);
  q.set('type', type);
  const data = await request<{ daily: YtDailyPoint[] }>(`/daily/${clientId}?${q}`);
  return data.daily;
}

export async function getYouTubeTraffic(
  clientId: number,
  range: AnalyticsRange,
): Promise<YtTrafficRow[]> {
  const data = await request<{ traffic: YtTrafficRow[] }>(
    `/traffic/${clientId}?${rangeQuery(range)}`,
  );
  return data.traffic;
}

/** The API's own last-28-days snapshot: it does not follow the period. */
export async function getYouTubeDemographics(clientId: number): Promise<YtDemographicRow[]> {
  const data = await request<{ rows: YtDemographicRow[] }>(`/demographics/${clientId}`);
  return data.rows;
}

export async function getYouTubeVideos(
  clientId: number,
  range: AnalyticsRange,
  sort?: YtVideoSort,
): Promise<YtVideoRow[]> {
  const q = rangeQuery(range);
  if (sort) q.set('sort', sort);
  const data = await request<{ videos: YtVideoRow[] }>(`/videos/${clientId}?${q}`);
  return data.videos;
}

/** Top 5 Shorts of the window by views. */
export async function getYouTubeTopShorts(
  clientId: number,
  range: AnalyticsRange,
): Promise<YtVideoRow[]> {
  const data = await request<{ shorts: YtVideoRow[] }>(
    `/top-shorts/${clientId}?${rangeQuery(range)}`,
  );
  return data.shorts;
}
