// TikTok KPI cards (spec §A3). Pure: the caller loads the rows and clips them to each window.
//
// Summed counts (views, likes, comments, shares) are lifetime totals of the videos posted in the
// window, so the previous window's videos have had longer to collect them: those cards carry
// `prev: null` instead of a comparison that would show a fake drop. Engagement is a ratio of the
// same counts and keeps its comparison. Follower KPIs read only observed points, never zero and
// never extrapolated.
import type { KpiEntry } from "../report-docs/kpis.ts";

export const TIKTOK_KPI_IDS = [
  "followers_total",
  "followers_gained",
  "views",
  "engagement_rate",
  "likes",
  "comments",
  "shares",
  "posts_count",
  "likes_total",
] as const;
export type TikTokKpiId = (typeof TIKTOK_KPI_IDS)[number];

export interface TikTokVideoRow {
  tiktok_video_id: string;
  posted_at: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
}
export interface FollowerPoint {
  date: string;
  follower_count: number;
}
export interface TikTokKpiInput {
  videos: TikTokVideoRow[];
  prevVideos: TikTokVideoRow[];
  history: FollowerPoint[];
  prevHistory: FollowerPoint[]; // already clipped to each window, any order
  currentFollowers: number | null; // used only when the window ends on SP today
  windowEndsToday: boolean;
  likesTotal: number | null;
}

/** (likes + comments + shares) / views * 100; null when the video has no views. */
export function videoEngagementRate(v: TikTokVideoRow): number | null {
  if (!v.views) return null;
  return (((v.likes || 0) + (v.comments || 0) + (v.shares || 0)) / v.views) * 100;
}

const sum = (rows: TikTokVideoRow[], key: "views" | "likes" | "comments" | "shares"): number =>
  rows.reduce((acc, v) => acc + (v[key] || 0), 0);

/** Ratio of sums over the videos: (likes + comments + shares) / views * 100. Null on zero views. */
function engagement(rows: TikTokVideoRow[]): number | null {
  const views = sum(rows, "views");
  if (views <= 0) return null;
  return ((sum(rows, "likes") + sum(rows, "comments") + sum(rows, "shares")) / views) * 100;
}

const sortedByDate = (points: FollowerPoint[]): FollowerPoint[] =>
  [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

/** Last minus first observed point; null with fewer than two points. */
function delta(sorted: FollowerPoint[]): number | null {
  if (sorted.length < 2) return null;
  return sorted[sorted.length - 1].follower_count - sorted[0].follower_count;
}

const count = (value: number | null, prev: number | null = null): KpiEntry => ({ value, unit: "count", prev });

export function computeTikTokKpis(i: TikTokKpiInput): Record<TikTokKpiId, KpiEntry> {
  const hist = sortedByDate(i.history);
  const prevHist = sortedByDate(i.prevHistory);

  // Seguidores: newest observed point; the live count only stands in when the window ends today.
  const lastPoint = hist.length ? hist[hist.length - 1].follower_count : null;
  const total = i.windowEndsToday && i.currentFollowers !== null ? i.currentFollowers : lastPoint;
  // Comparison = the first observed point in the window, only when there is a second point to
  // make it a real comparison.
  const totalPrev = hist.length >= 2 ? hist[0].follower_count : null;

  const gained = delta(hist);
  // The previous delta is shown only next to a current one.
  const gainedPrev = gained !== null ? delta(prevHist) : null;

  const rate = engagement(i.videos);
  const ratePrev = rate !== null ? engagement(i.prevVideos) : null;

  return {
    followers_total: count(total, totalPrev),
    followers_gained: count(gained, gainedPrev),
    views: count(sum(i.videos, "views")),
    engagement_rate: { value: rate, unit: "pct", prev: ratePrev },
    likes: count(sum(i.videos, "likes")),
    comments: count(sum(i.videos, "comments")),
    shares: count(sum(i.videos, "shares")),
    posts_count: count(i.videos.length, i.prevVideos.length > 0 ? i.prevVideos.length : null),
    likes_total: count(i.likesTotal),
  };
}
