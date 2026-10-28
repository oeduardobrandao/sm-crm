// =============================================
// Mesaas - TikTok Analytics Service
// =============================================
// Every read goes through the `tiktok-analytics` edge function (the metrics tables are
// service-role only). Response shapes mirror supabase/functions/tiktok-analytics.
import { supabase } from '../lib/supabase';
import type { BestPostingTimes } from './analytics';

const EDGE_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/tiktok-analytics';

// ─── Types ──────────────────────────────────────────────────────────────

export type TikTokKpiId =
  | 'followers_total'
  | 'followers_gained'
  | 'views'
  | 'engagement_rate'
  | 'likes'
  | 'comments'
  | 'shares'
  | 'posts_count'
  | 'likes_total';

/** `prev` is always null for the summed counts (views, likes, comments, shares, likes_total). */
export interface KpiEntry {
  value: number | null;
  unit: 'count' | 'pct';
  prev: number | null;
}

/** Either a rolling window of N days or an inclusive São Paulo date range (YYYY-MM-DD). */
export type AnalyticsRange = { days: number } | { start: string; end: string };

export interface TikTokOverview {
  account: {
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    authorization_status: 'active' | 'revoked' | 'disconnected' | 'expired';
    last_synced_at: string | null;
    follower_count: number | null;
  };
  window: { start: string; end: string; prevStart: string; prevEnd: string };
  kpis: Record<TikTokKpiId, KpiEntry>;
}

export interface TikTokFollowerPoint {
  date: string;
  follower_count: number;
  source: string;
}

export type TikTokPostSort =
  'posted_at' | 'views' | 'likes' | 'comments' | 'shares' | 'engagement_rate';

export interface TikTokVideoAnalytics {
  tiktok_video_id: string;
  title: string | null;
  video_description: string | null;
  duration: number | null;
  share_url: string | null;
  cover_image_url: string | null;
  posted_at: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  /** (likes + comments + shares) / views; null when views is 0 or missing. */
  engagement_rate: number | null;
}

export interface TikTokPortfolioRow {
  client_id: number;
  client_name: string;
  especialidade: string | null;
  username: string | null;
  avatar_url: string | null;
  authorization_status: 'active' | 'revoked' | 'disconnected' | 'expired';
  follower_count: number | null;
  followers_gained: number | null;
  views: number | null;
  engagement_rate: number | null;
  posts_count: number;
  last_posted_at: string | null;
}

export interface TikTokPortfolioVideo {
  client_id: number;
  client_name: string;
  tiktok_video_id: string;
  title: string | null;
  cover_image_url: string | null;
  share_url: string | null;
  posted_at: string | null;
  views: number | null;
  likes: number | null;
  engagement_rate: number | null;
}

export interface TikTokPortfolio {
  window: { start: string; end: string; prevStart: string; prevEnd: string };
  totals: {
    accounts: number;
    followers: number | null;
    views: number | null;
    engagement_rate: number | null;
    posts_count: number;
  };
  accounts: TikTokPortfolioRow[];
  topVideos: TikTokPortfolioVideo[];
  bottomVideos: TikTokPortfolioVideo[];
  /** Every video of the window, most viewed first, capped at 200 ("Ver todos"). */
  videos: TikTokPortfolioVideo[];
}

/** The AI payload has the same shape as the Instagram account / portfolio analyses. */
export interface TikTokAIResult {
  analysis: any;
  generatedAt: string;
}

/** 404 `not_connected`: the client has no TikTok account. */
export class TikTokNotConnectedError extends Error {
  constructor() {
    super('not_connected');
    this.name = 'TikTokNotConnectedError';
  }
}

/** 429: the per-workspace read limit or the shared `ig-ai` AI budget is spent. */
export class TikTokRateLimitedError extends Error {
  readonly status = 429;
  constructor() {
    super('Error 429');
    this.name = 'TikTokRateLimitedError';
  }
}

/** 403 `feature_disabled`: the workspace plan lacks a flag the route needs. */
export const isTikTokFeatureDisabled = (err: unknown): boolean =>
  err instanceof Error && err.message === 'feature_disabled';

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
    if (res.status === 404 && body?.error === 'not_connected') throw new TikTokNotConnectedError();
    if (res.status === 403 && body?.error === 'feature_disabled') {
      throw new Error('feature_disabled');
    }
    if (res.status === 429) throw new TikTokRateLimitedError();
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

export function getTikTokOverview(
  clientId: number,
  range: AnalyticsRange,
): Promise<TikTokOverview> {
  return request(`/overview/${clientId}?${rangeQuery(range)}`);
}

export async function getTikTokFollowerHistory(
  clientId: number,
  range: AnalyticsRange,
): Promise<TikTokFollowerPoint[]> {
  const data = await request<{ history: TikTokFollowerPoint[] }>(
    `/follower-history/${clientId}?${rangeQuery(range)}`,
  );
  return data.history;
}

export async function getTikTokPostsAnalytics(
  clientId: number,
  range: AnalyticsRange,
  sort?: TikTokPostSort,
): Promise<TikTokVideoAnalytics[]> {
  const q = rangeQuery(range);
  if (sort) q.set('sort', sort);
  const data = await request<{ posts: TikTokVideoAnalytics[] }>(
    `/posts-analytics/${clientId}?${q}`,
  );
  return data.posts;
}

export function getTikTokBestTimes(clientId: number): Promise<BestPostingTimes> {
  return request(`/best-times/${clientId}`);
}

export function getTikTokPortfolio(days: number): Promise<TikTokPortfolio> {
  return request(`/portfolio?days=${days}`);
}

// ─── AI ─────────────────────────────────────────────────────────────────

export function getTikTokAIAnalysis(clientId: number, days: number): Promise<TikTokAIResult> {
  return request(`/ai-analysis/${clientId}`, { method: 'POST', body: JSON.stringify({ days }) });
}

export function getTikTokPortfolioAI(days: number): Promise<TikTokAIResult> {
  return request('/ai-analysis-portfolio', { method: 'POST', body: JSON.stringify({ days }) });
}
