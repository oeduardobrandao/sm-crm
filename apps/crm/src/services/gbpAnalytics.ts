// =============================================
// Mesaas - Google Meu Negócio Analytics Service
// =============================================
// Every read goes through the `gbp-analytics` edge function (the history tables are
// service-role only). Response shapes mirror supabase/functions/gbp-analytics.
import { supabase } from '../lib/supabase';
import type { AnalyticsRange } from './tiktokAnalytics';

export type { AnalyticsRange };

const EDGE_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/gbp-analytics';

// ─── Types ──────────────────────────────────────────────────────────────

export type GbpKpiId =
  | 'profile_views'
  | 'calls'
  | 'directions'
  | 'website_clicks'
  | 'messages'
  | 'bookings'
  | 'avg_rating'
  | 'new_reviews';

/** `all` for "Todas as unidades", otherwise one unit's uuid. */
export type GbpLocation = 'all' | (string & {});

export type GbpReviewFilter = 'all' | 'unanswered' | 'low';

export interface GbpKpiEntry {
  value: number | null;
  prev: number | null;
}

export interface GbpOverview {
  /** The earliest `data_through` across the selected units; null before the first sync. */
  dataThrough: string | null;
  window: { start: string; end: string; prevStart: string; prevEnd: string };
  /** All null before the first sync. */
  kpis: Record<GbpKpiId, GbpKpiEntry>;
}

export interface GbpDailyPoint {
  date: string;
  profileViews: number;
  calls: number;
  directions: number;
  websiteClicks: number;
  messages: number;
  bookings: number;
}

export interface GbpSurfaceRow {
  surface: 'desktop_maps' | 'desktop_search' | 'mobile_maps' | 'mobile_search';
  value: number;
  pct: number;
}

export interface GbpKeywordRow {
  keyword: string;
  value: number | null;
  /** Google's "menos de N" bucket, when it withholds the exact value. */
  threshold: number | null;
}

export interface GbpKeywords {
  /** The month shown (YYYY-MM): closed months only, the latest closed one by default. */
  month: string | null;
  months: string[];
  keywords: GbpKeywordRow[];
}

export interface GbpReview {
  reviewer: string | null;
  rating: number;
  comment: string | null;
  unitTitle: string | null;
  /** Null before the first location refresh: "Abrir no Google" is hidden then. */
  unitMapsUri: string | null;
  createTime: string;
  hasReply: boolean;
}

export interface GbpRatingDistribution {
  counts: Record<'1' | '2' | '3' | '4' | '5', number>;
  storedTotal: number;
  total: number;
  /** Only the latest reviews are stored: `storedTotal < total`. */
  partial: boolean;
}

export interface GbpUnitRow {
  id: string;
  title: string | null;
  status: 'active' | 'disconnected' | 'revoked';
  profileViews: number;
  calls: number;
  directions: number;
  websiteClicks: number;
  messages: number;
  bookings: number;
  avgRating: number | null;
  totalReviewCount: number | null;
}

/** 404 `not_connected`: the client has no Google Meu Negócio unit (or the unit is not theirs). */
export class GbpNotConnectedError extends Error {
  constructor() {
    super('not_connected');
    this.name = 'GbpNotConnectedError';
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
    if (res.status === 404 && body?.error === 'not_connected') throw new GbpNotConnectedError();
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

export function getGbpOverview(
  clientId: number,
  range: AnalyticsRange,
  location: GbpLocation,
): Promise<GbpOverview> {
  const q = rangeQuery(range);
  q.set('location', location);
  return request(`/overview/${clientId}?${q}`);
}

export async function getGbpDaily(
  clientId: number,
  range: AnalyticsRange,
  location: GbpLocation,
): Promise<GbpDailyPoint[]> {
  const q = rangeQuery(range);
  q.set('location', location);
  const data = await request<{ daily: GbpDailyPoint[] }>(`/daily/${clientId}?${q}`);
  return data.daily;
}

export async function getGbpSurfaces(
  clientId: number,
  range: AnalyticsRange,
  location: GbpLocation,
): Promise<GbpSurfaceRow[]> {
  const q = rangeQuery(range);
  q.set('location', location);
  const data = await request<{ surfaces: GbpSurfaceRow[] }>(`/surfaces/${clientId}?${q}`);
  return data.surfaces;
}

/** `month` is YYYY-MM; null asks for the latest closed month. */
export function getGbpKeywords(
  clientId: number,
  month: string | null,
  location: GbpLocation,
): Promise<GbpKeywords> {
  const q = new URLSearchParams();
  if (month) q.set('month', month);
  q.set('location', location);
  return request(`/keywords/${clientId}?${q}`);
}

export async function getGbpReviews(
  clientId: number,
  filter: GbpReviewFilter,
  location: GbpLocation,
): Promise<GbpReview[]> {
  const q = new URLSearchParams({ filter, location });
  const data = await request<{ reviews: GbpReview[] }>(`/reviews/${clientId}?${q}`);
  return data.reviews;
}

export function getGbpRatingDistribution(
  clientId: number,
  location: GbpLocation,
): Promise<GbpRatingDistribution> {
  const q = new URLSearchParams({ location });
  return request(`/rating-distribution/${clientId}?${q}`);
}

export async function getGbpUnits(clientId: number, range: AnalyticsRange): Promise<GbpUnitRow[]> {
  const data = await request<{ units: GbpUnitRow[] }>(`/units/${clientId}?${rangeQuery(range)}`);
  return data.units;
}
